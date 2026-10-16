#!/usr/bin/env python3
"""Private Unix-worker bridge. Produces a candidate, never mutates live NX/authority.

stdin: {releaseId, manifest: prepared complete manifest, operations: [...]}
stdout: {success:true, files:[{name,relativePath,hash,size}]}
Tool stdout/stderr and all evidence stay below ASSET_DIR/nx-candidates/<id>.
Requires Python >=3.11 and the explicitly pinned existing WZ tool checkout.
"""
from __future__ import annotations

import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import shutil
import subprocess
import sys

TOOLS_COMMIT = "776d80a49caadd2c9fc9552e9058948cc793b2df"
CONVERTER_COMMIT = "73bddde1214445795d0a5cd4c3d431fe15eb49eb"
ARCHIVES = ("Base", "Character", "Effect", "Etc", "Item", "Map", "Mob", "Morph", "Npc", "Quest", "Reactor", "Skill", "Sound", "String", "TamingMob", "UI")
CONVERTIBLE = ("Map", "Mob", "Npc", "Item", "Reactor", "String", "Sound", "Morph", "Quest", "Base", "Character", "Skill", "Etc", "TamingMob")
NX_NAMES = {name + ".nx" for name in ARCHIVES}
WZ_NAMES = {name + ".wz" for name in ARCHIVES}


def metadata(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"Not a regular candidate input: {path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"hash": digest.hexdigest(), "size": info.st_size}


def expectation(value):
    digest = value.get("hash", value.get("sha256"))
    size = value.get("size")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or type(size) is not int or size <= 0:
        raise ValueError("Expected independent SHA-256 and positive byte size")
    return {"hash": digest, "size": size}


def regular_beneath(root, relative):
    root = Path(root).resolve(strict=True)
    relative = str(relative)
    parts = PurePosixPath(relative).parts
    if not parts or relative != "/".join(parts) or any(part in (".", "..") for part in parts) or "\\" in relative:
        raise ValueError("Unsafe relative candidate path")
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("Symlink in candidate input path")
    if not path.resolve(strict=True).is_relative_to(root) or not path.is_file():
        raise ValueError("Input escaped its storage authority")
    return path


def copy_verified(source, destination, expected):
    expected = expectation(expected)
    source = Path(source)
    if not stat.S_ISREG(source.lstat().st_mode):
        raise ValueError("Snapshot source is not a regular file")
    digest, size = hashlib.sha256(), 0
    with source.open("rb") as incoming, Path(destination).open("xb") as outgoing:
        while block := incoming.read(1024 * 1024):
            size += len(block)
            if size > expected["size"]:
                raise ValueError("Snapshot source exceeded independent expected size")
            digest.update(block)
            outgoing.write(block)
    if {"hash": digest.hexdigest(), "size": size} != expected:
        raise ValueError(f"Snapshot hash/size mismatch: {source.name}")
    Path(destination).chmod(0o444)

def snapshot_immutable(root, key, value, destination):
    source = immutable_object(root, key, value)
    expected = expectation(value)
    def identity(info):
        return {"dev": str(info.st_dev), "ino": str(info.st_ino), "size": str(info.st_size),
                "mtimeNs": str(info.st_mtime_ns), "ctimeNs": str(info.st_ctime_ns)}
    with source.open("rb") as incoming, Path(destination).open("xb") as outgoing:
        before = os.fstat(incoming.fileno())
        if identity(before) != value.get("identity") or before.st_size != expected["size"]:
            raise ValueError("Verified immutable input identity changed")
        try:
            fcntl.ioctl(outgoing.fileno(), 0x40049409, incoming.fileno())  # Linux FICLONE
        except OSError as error:
            if error.errno not in (errno.EOPNOTSUPP, errno.ENOTTY, errno.EINVAL, errno.EXDEV, errno.ENOSYS):
                raise
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
        if identity(os.fstat(incoming.fileno())) != identity(before):
            raise ValueError("Immutable input changed while snapshotting")
    Path(destination).chmod(0o444)


def baseline_snapshot(directory, manifest_path, destination, names, *, native_extras=False):
    observed = json.loads(Path(manifest_path).read_text())
    rows = observed["files"]
    records = {item["name"]: item for item in rows}
    if len(records) != len(rows) or not names.issubset(records) or (not native_extras and set(records) != names):
        raise ValueError("Approved baseline manifest is not the complete 16-file cohort")
    if native_extras and any(not isinstance(name, str) or Path(name).name != name or not name.endswith(".wz") for name in records):
        raise ValueError("Native baseline may contain only explicitly approved flat WZ files")
    for name in sorted(records):
        copy_verified(regular_beneath(directory, name), destination / name, records[name])
    return {name: expectation(row) for name, row in records.items()}


def immutable_object(root, key, value):
    if value.get("key") != key:
        raise ValueError("Prepared asset key does not match its authority entry")
    expected = expectation(value)
    path = regular_beneath(root, f"objects/{expected['hash']}/{key}")
    if path.stat().st_mode & 0o222:
        raise ValueError("Prepared asset object is writable")
    return path


def approved_operations(values):
    if not isinstance(values, list) or not values:
        raise ValueError("Explicit nonempty native operations are required")
    operations = []
    for value in values:
        if not isinstance(value, dict) or value.get("target_wz") not in {name + ".wz" for name in CONVERTIBLE}:
            raise ValueError("Operation targets unsupported or protected archive")
        operation = dict(value)
        operation["op"] = operation.get("op", "import_image")
        if operation["op"] not in ("import_image", "set_subtree"):
            raise ValueError("Only explicit image import/subtree operations are approved")
        for field in ("target_image", "target_node"):
            path = operation.get(field)
            if field == "target_node" and operation["op"] == "import_image":
                continue
            if not isinstance(path, str) or not path or path != "/".join(PurePosixPath(path).parts) or path.startswith("/") or any(p in (".", "..") for p in path.split("/")) or any(c in path for c in ("\\", "*", "?", "\0")):
                raise ValueError(f"Operation requires an exact safe {field}")
        if not operation["target_image"].endswith(".img"):
            raise ValueError("Operation must identify a complete native IMG")
        if operation["target_wz"] == "Item.wz" and operation["target_image"].split("/")[0] in ("Consume", "Install", "Etc", "Cash") and operation["op"] != "set_subtree":
            raise ValueError("Grouped Item images require exact item subtree operations to preserve browser siblings")
        operations.append(operation)
    return operations


def pinned_tools(root):
    if os.environ.get("WZ_RELEASE_TOOLS_COMMIT", TOOLS_COMMIT) != TOOLS_COMMIT:
        raise ValueError("Configured WZ tool pin differs from approved bridge source")
    root = Path(root).resolve(strict=True)
    actual = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if actual != TOOLS_COMMIT:
        raise ValueError("WZ tools checkout is not the approved committed source pin")
    subprocess.run(["git", "-C", str(root), "diff", "--quiet", "HEAD", "--", "tools/wz_release"], check=True)
    untracked = subprocess.check_output(["git", "-C", str(root), "ls-files", "--others", "--exclude-standard", "--", "tools/wz_release"], text=True)
    if untracked.strip():
        raise ValueError("WZ tools contain unreviewed source files")
    return root / "tools" / "wz_release"


def run_tool(argv, log):
    try:
        with Path(log).open("xb") as output:
            subprocess.run(argv, check=True, stdout=output, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as error:
        with Path(log).open("rb") as output:
            output.seek(max(0, output.seek(0, 2) - 8192))
            detail = output.read().decode(errors="replace")
        raise ValueError(f"{Path(argv[1]).name} failed: {detail}") from error


def validate_result(result, donor, native_expected, nx_expected, tools):
    provenance = json.loads((result / "provenance-manifest.json").read_text())
    coverage = json.loads((result / "candidate-coverage.json").read_text())
    preservation = json.loads((result / "semantic-preservation.json").read_text())
    genuine = json.loads((donor / "donor-manifest.json").read_text())
    if provenance.get("status") != "complete-candidate" or provenance.get("production_writes_performed") is not False or coverage.get("complete") is not True or coverage.get("missing"):
        raise ValueError("Pinned merger did not prove complete candidate coverage")
    build = genuine.get("build", {})
    if build.get("commit") != CONVERTER_COMMIT or expectation(build["patch"]) != metadata(tools / "nx_converter.patch"):
        raise ValueError("Donor does not identify the pinned genuine converter and source patch")
    for name, record in genuine["archives"].items():
        output = regular_beneath(donor, name + ".nx")
        if expectation(record["input"]) != native_expected[name + ".wz"] or output.stat().st_size != expectation(record["output"])["size"]:
            raise ValueError("Donor provenance differs from verified native inputs/output size")
    if expectation(provenance["donor_provenance"]) != metadata(donor / "donor-manifest.json"):
        raise ValueError("Merger donor provenance does not match genuine conversion")
    builders = {Path(row["name"]).name: expectation(row) for row in provenance["builder_sources"]}
    if builders != {name: metadata(tools / name) for name in ("nx_release.py", "nx_format.py")}:
        raise ValueError("Merger evidence came from different source tools")
    records = {row["name"]: row for row in provenance["files"]}
    if len(records) != len(provenance["files"]) or set(records) != NX_NAMES or set(preservation) != NX_NAMES:
        raise ValueError("Candidate proof is not the complete 16-file NX cohort")
    corpus = result / "corpus"
    if {path.name for path in corpus.iterdir()} != NX_NAMES:
        raise ValueError("Candidate corpus has extra or missing output files")
    rows = []
    for name in sorted(NX_NAMES):
        path = regular_beneath(corpus, name)
        actual = expectation(records[name])
        if path.stat().st_size != actual["size"]:
            raise ValueError("Candidate output size differs from producer provenance")
        path.chmod(0o444)
        proof = preservation[name]
        if proof.get("whole_file_byte_identical") is True:
            if actual != nx_expected[name]:
                raise ValueError("Untargeted NX bytes were not preserved")
        elif proof.get("preservation", {}).get("all_untargeted_nodes_equal") is not True or not proof.get("targets") or any(target.get("equal") is not True for target in proof["targets"]):
            raise ValueError("Candidate lacks exact target equality/non-target preservation proof")
        if name in ("UI.nx", "Effect.nx") and actual != nx_expected[name]:
            raise ValueError("Protected browser UI/Effect archive changed")
        rows.append({"name": name, **actual})
    return rows


class CapacityError(ValueError):
    def __init__(self, receipt):
        self.receipt = receipt
        super().__init__("Insufficient candidate filesystem capacity: " + json.dumps(receipt, sort_keys=True))


def baseline_records(directory, manifest_path, names, *, native_extras=False):
    rows = json.loads(Path(manifest_path).read_text())["files"]
    records = {row["name"]: row for row in rows}
    if len(records) != len(rows) or not names.issubset(records) or (not native_extras and set(records) != names):
        raise ValueError("Approved baseline manifest is not the complete 16-file cohort")
    for name, row in records.items():
        if Path(name).name != name or (native_extras and not name.endswith(".wz")):
            raise ValueError("Unsafe baseline name")
        if regular_beneath(directory, name).stat().st_size != expectation(row)["size"]:
            raise ValueError("Baseline size differs from approved capacity input")
    return records


def capacity_preflight(root, request, current, assets):
    native = baseline_records(os.environ["NATIVE_WZ_BASELINE_DIR"], os.environ["NATIVE_WZ_BASELINE_MANIFEST"], WZ_NAMES, native_extras=True)
    native_bytes = sum(expectation(row)["size"] for row in native.values())
    # Snapshot is copied before replacements; count both writes conservatively.
    replacement_bytes = sum(immutable_object(root, key, row).stat().st_size for key, row in assets.items() if key.endswith(".wz") and Path(key).name == key)
    committed = {name: current.get("assets", {}).get("nx/" + name) for name in NX_NAMES}
    if any(committed.values()):
        if not all(committed.values()):
            raise ValueError("Committed NX authority is an incomplete cohort")
        nx_bytes = sum(immutable_object(root, "nx/" + name, row).stat().st_size for name, row in committed.items())
    else:
        records = baseline_records(os.environ["NX_BASELINE_DIR"], os.environ["NX_BASELINE_MANIFEST"], NX_NAMES)
        nx_bytes = sum(expectation(row)["size"] for row in records.values())
    # Future output sizes are budgets, not measured converter output.
    # Two full validated corpora per output, plus a cold-build reserve.
    corpus_budget = 2 * max(native_bytes + replacement_bytes, nx_bytes)
    build_reserve = int(os.environ.get("NX_CONVERTER_BUILD_RESERVE_BYTES", str(2 * 1024**3)))
    overhead_reserve = int(os.environ.get("NX_PREPARE_OVERHEAD_RESERVE_BYTES", str(512 * 1024**2)))
    if build_reserve < 0 or overhead_reserve < 0:
        raise ValueError("Capacity reserves cannot be negative")
    plan = {"converterOutputBudgetBytes": corpus_budget,
            "converterBuildReserveBytes": build_reserve,
            "candidateOutputBudgetBytes": corpus_budget,
            "publicationCopyBudgetBytes": corpus_budget,
            "overheadReserveBytes": overhead_reserve}
    if request.get("mode") == "baseline":
        plan = {"converterOutputBudgetBytes": 0, "converterBuildReserveBytes": 0,
                "candidateOutputBudgetBytes": 0,
                "publicationCopyBudgetBytes": native_bytes + replacement_bytes + nx_bytes,
                "overheadReserveBytes": overhead_reserve}
    required = native_bytes + replacement_bytes + nx_bytes + sum(plan.values())
    fs = os.statvfs(root)
    receipt = {"path": str(root), "filesystemDevice": root.stat().st_dev,
               "requiredBytes": required, "availableBytes": fs.f_bavail * fs.f_frsize,
               "nativeSnapshotBytes": native_bytes, "replacementBytes": replacement_bytes,
               "nxSnapshotBytes": nx_bytes, "budgets": plan}
    if receipt["availableBytes"] < required:
        raise CapacityError(receipt)
    return receipt

def require_remaining_capacity(root, required, phase):
    fs = os.statvfs(root)
    receipt = {"path": str(root), "filesystemDevice": root.stat().st_dev,
               "phase": phase, "requiredBytes": required,
               "availableBytes": fs.f_bavail * fs.f_frsize}
    if receipt["availableBytes"] < required:
        raise CapacityError(receipt)
    return receipt



def prepare(request):
    release_id = request["releaseId"]
    if not isinstance(release_id, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{7,95}", release_id):
        raise ValueError("Invalid candidate release identity")
    candidate = request["manifest"]
    if candidate.get("releaseId") != release_id:
        raise ValueError("Prepared manifest does not identify this release")
    mode = request.get("mode", "convert")
    if mode not in ("baseline", "convert"):
        raise ValueError("Unknown NX preparation mode")
    operations = [] if mode == "baseline" else approved_operations(request["operations"])
    root = Path(os.environ["ASSET_DIR"]).resolve(strict=True)
    tools = pinned_tools(os.environ["WZ_RELEASE_TOOLS_DIR"])
    current = json.loads(Path(os.environ["LAUNCHER_MANIFEST_PATH"]).read_text())
    if candidate.get("previousReleaseId") != current.get("releaseId"):
        raise ValueError("Committed authority changed before NX preparation")
    capacity = capacity_preflight(root, request, current, candidate["assets"])
    job = root / "nx-candidates" / release_id
    if job.parent.is_symlink():
        raise ValueError("NX candidate storage is a symlink")
    job.parent.mkdir(exist_ok=True)
    job.mkdir()  # No reuse/overwrite of another candidate identity.
    native, nx_baseline, donor, result = (job / name for name in ("native", "nx-baseline", "donor", "result"))
    native.mkdir()
    nx_baseline.mkdir()
    native_expected = {name: expectation(row) for name, row in baseline_records(
        os.environ["NATIVE_WZ_BASELINE_DIR"], os.environ["NATIVE_WZ_BASELINE_MANIFEST"], WZ_NAMES, native_extras=True).items()}
    assets = candidate["assets"]
    for key, value in assets.items():
        if key.endswith(".wz") and Path(key).name == key:
            native_expected[key] = expectation(value)
    for name, expected in sorted(native_expected.items()):
        if name in assets:
            snapshot_immutable(root, name, assets[name], native / name)
        else:
            copy_verified(regular_beneath(os.environ["NATIVE_WZ_BASELINE_DIR"], name), native / name, expected)
    committed_nx = {name: current.get("assets", {}).get("nx/" + name) for name in NX_NAMES}
    if any(committed_nx.values()):
        if not all(committed_nx.values()):
            raise ValueError("Committed NX authority is an incomplete cohort")
        nx_expected = {name: expectation(value) for name, value in committed_nx.items()}
        for name, value in committed_nx.items():
            snapshot_immutable(root, "nx/" + name, value, nx_baseline / name)
    else:
        nx_expected = baseline_snapshot(os.environ["NX_BASELINE_DIR"], os.environ["NX_BASELINE_MANIFEST"], nx_baseline, NX_NAMES)
    native_files = [{"name": name, **expected, "relativePath": f"nx-candidates/{release_id}/native/{name}"} for name, expected in sorted(native_expected.items())]
    if mode == "baseline":
        nx_baseline.rename(job / "corpus")
        files = [{"name": name, **expected, "relativePath": f"nx-candidates/{release_id}/corpus/{name}"} for name, expected in sorted(nx_expected.items())]
        return {"success": True, "files": files, "nativeFiles": native_files, "capacity": capacity}
    observed = job / "observed-nx.json"
    observed.write_text(json.dumps({"files": [{"name": name, "sha256": nx_expected[name]["hash"], "size": nx_expected[name]["size"]} for name in sorted(NX_NAMES)]}))
    contract = job / "operations.json"
    contract.write_text(json.dumps({"operations": operations}))
    touched = sorted({operation["target_wz"].removesuffix(".wz") for operation in operations})
    run_tool([sys.executable, str(tools / "nx_convert.py"), "--native", str(native), "--output", str(donor), "--build-dir", str(job / "converter-build"), "--archives", *touched, "--contract", str(contract)], job / "convert.log")
    donor_bytes = sum(path.stat().st_size for path in donor.rglob("*") if path.is_file())
    capacity["beforeMerge"] = require_remaining_capacity(
        root, 2 * max(donor_bytes, capacity["nxSnapshotBytes"]) + capacity["budgets"]["overheadReserveBytes"],
        "before-merge")
    run_tool([sys.executable, str(tools / "nx_release.py"), "--baseline", str(nx_baseline), "--baseline-manifest", str(observed), "--donor", str(donor), "--contract", str(contract), "--output", str(result)], job / "merge.log")
    files = validate_result(result, donor, native_expected, nx_expected, tools)
    capacity["beforePublicationCopy"] = require_remaining_capacity(
        root, sum(row["size"] for row in files) + capacity["budgets"]["overheadReserveBytes"],
        "before-publication-copy")
    (result / "corpus").rename(job / "corpus")
    for row in files:
        (job / "corpus" / row["name"]).chmod(0o444)
        row["relativePath"] = f"nx-candidates/{release_id}/corpus/{row['name']}"
    (job / "bridge-provenance.json").write_text(json.dumps({"toolsCommit": TOOLS_COMMIT, "releaseId": release_id, "files": files}, indent=2) + "\n")
    return {"success": True, "files": files, "nativeFiles": native_files, "capacity": capacity}


def main():
    try:
        raw = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("NX prepare request exceeds limit")
        result = prepare(json.loads(raw))
        print(json.dumps(result))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        result = {"success": False, "error": str(error)}
        if isinstance(error, CapacityError):
            result["capacity"] = error.receipt
        print(json.dumps(result))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
