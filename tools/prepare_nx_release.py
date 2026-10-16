#!/usr/bin/env python3
"""Private Unix-worker bridge. Produces a candidate, never mutates live NX/authority.

stdin: {releaseId, manifest: prepared complete manifest, operations: [...]}
stdout: {success:true, files:[{name,relativePath,hash,size}]}
Tool stdout/stderr and all evidence stay below ASSET_DIR/nx-candidates/<id>.
Requires Python >=3.11 and the explicitly pinned existing WZ tool checkout.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
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


def validate_result(result, donor, native, nx_baseline, tools):
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
        if expectation(record["input"]) != metadata(native / (name + ".wz")) or expectation(record["output"]) != metadata(donor / (name + ".nx")):
            raise ValueError("Donor provenance differs from verified native inputs/output bytes")
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
        actual = metadata(path)
        if expectation(records[name]) != actual:
            raise ValueError("Candidate output differs from its provenance digest")
        proof = preservation[name]
        if proof.get("whole_file_byte_identical") is True:
            if actual != metadata(nx_baseline / name):
                raise ValueError("Untargeted NX bytes were not preserved")
        elif proof.get("preservation", {}).get("all_untargeted_nodes_equal") is not True or not proof.get("targets") or any(target.get("equal") is not True for target in proof["targets"]):
            raise ValueError("Candidate lacks exact target equality/non-target preservation proof")
        if name in ("UI.nx", "Effect.nx") and actual != metadata(nx_baseline / name):
            raise ValueError("Protected browser UI/Effect archive changed")
        rows.append({"name": name, **actual})
    return rows


def prepare(request):
    release_id = request["releaseId"]
    if not isinstance(release_id, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{7,95}", release_id):
        raise ValueError("Invalid candidate release identity")
    candidate = request["manifest"]
    if candidate.get("releaseId") != release_id:
        raise ValueError("Prepared manifest does not identify this release")
    operations = approved_operations(request["operations"])
    root = Path(os.environ["ASSET_DIR"]).resolve(strict=True)
    tools = pinned_tools(os.environ["WZ_RELEASE_TOOLS_DIR"])
    current = json.loads(Path(os.environ["LAUNCHER_MANIFEST_PATH"]).read_text())
    if candidate.get("previousReleaseId") != current.get("releaseId"):
        raise ValueError("Committed authority changed before NX preparation")
    job = root / "nx-candidates" / release_id
    if job.parent.is_symlink():
        raise ValueError("NX candidate storage is a symlink")
    job.parent.mkdir(exist_ok=True)
    job.mkdir()  # No reuse/overwrite of another candidate identity.
    native, nx_baseline, donor, result = (job / name for name in ("native", "nx-baseline", "donor", "result"))
    native.mkdir()
    nx_baseline.mkdir()
    baseline_snapshot(os.environ["NATIVE_WZ_BASELINE_DIR"], os.environ["NATIVE_WZ_BASELINE_MANIFEST"], native, WZ_NAMES, native_extras=True)
    assets = candidate["assets"]
    for key in sorted(key for key in assets if key.endswith(".wz") and Path(key).name == key):
        # Replace only in this new isolated native snapshot, never baseline/live.
        destination = native / key
        if destination.exists():
            destination.unlink()
        copy_verified(immutable_object(root, key, assets[key]), destination, assets[key])
    committed_nx = {name: current.get("assets", {}).get("nx/" + name) for name in NX_NAMES}
    if any(committed_nx.values()):
        if not all(committed_nx.values()):
            raise ValueError("Committed NX authority is an incomplete cohort")
        for name, value in committed_nx.items():
            copy_verified(immutable_object(root, "nx/" + name, value), nx_baseline / name, value)
    else:
        baseline_snapshot(os.environ["NX_BASELINE_DIR"], os.environ["NX_BASELINE_MANIFEST"], nx_baseline, NX_NAMES)
    observed = job / "observed-nx.json"
    observed.write_text(json.dumps({"files": [{"name": name, "sha256": (meta := metadata(nx_baseline / name))["hash"], "size": meta["size"]} for name in sorted(NX_NAMES)]}))
    contract = job / "operations.json"
    contract.write_text(json.dumps({"operations": operations}))
    run_tool([sys.executable, str(tools / "nx_convert.py"), "--native", str(native), "--output", str(donor), "--build-dir", str(job / "converter-build"), "--archives", *CONVERTIBLE, "--contract", str(contract)], job / "convert.log")
    run_tool([sys.executable, str(tools / "nx_release.py"), "--baseline", str(nx_baseline), "--baseline-manifest", str(observed), "--donor", str(donor), "--contract", str(contract), "--output", str(result)], job / "merge.log")
    files = validate_result(result, donor, native, nx_baseline, tools)
    (result / "corpus").rename(job / "corpus")
    for row in files:
        (job / "corpus" / row["name"]).chmod(0o444)
        row["relativePath"] = f"nx-candidates/{release_id}/corpus/{row['name']}"
    (job / "bridge-provenance.json").write_text(json.dumps({"toolsCommit": TOOLS_COMMIT, "releaseId": release_id, "files": files}, indent=2) + "\n")
    return {"success": True, "files": files}


def main():
    try:
        raw = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("NX prepare request exceeds limit")
        result = prepare(json.loads(raw))
        print(json.dumps(result))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({"success": False, "error": str(error)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
