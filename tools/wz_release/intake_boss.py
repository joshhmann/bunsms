#!/usr/bin/env python3
"""Stage the exact Ticket9 Wave0 sources, without modifying WZ or server trees.

The sibling boss-contract.json is the allowlist. XML fragments are evidence for
node-level merges, not image replacements. Raw IMG files remain source artifacts:
this intake makes no claim about their client version or semantic loadability.
Only an isolated directory beneath /tmp/wz-release-inputs may be written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import xml.etree.ElementTree as ET
import zipfile


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_relative(value: str) -> Path:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(p in (".", "..") for p in path.parts):
        raise ValueError(f"Unsafe relative path: {value!r}")
    return Path(*path.parts)


def select(root: ET.Element, selector: str) -> ET.Element | None:
    node = root
    for name in selector.split("/"):
        node = next((child for child in node if child.get("name") == name), None)
        if node is None:
            return None
    return node


def fragment(data: bytes, selectors: list[str]) -> bytes:
    root = ET.fromstring(data)
    result = ET.Element(root.tag, root.attrib)
    for selector in selectors:
        original = root
        destination = result
        for name in selector.split("/"):
            child = next((child for child in original if child.get("name") == name), None)
            if child is None:
                raise ValueError(f"Source XML lacks selector {selector!r}")
            existing = next((child for child in destination if child.get("name") == name), None)
            if existing is None:
                existing = ET.SubElement(destination, child.tag, child.attrib)
            original, destination = child, existing
        if len(destination):
            raise ValueError(f"Overlapping XML selectors: {selector!r}")
        destination.text = original.text
        for child in original:
            destination.append(ET.fromstring(ET.tostring(child, encoding="utf-8")))
    return ET.tostring(result, encoding="utf-8", xml_declaration=True)


def stage(output: Path, relative: str, data: bytes) -> dict:
    path = output / safe_relative(relative)
    # Reject existing symlinks, including symlinks to another location in output.
    current = path
    while current != output:
        if current.is_symlink():
            raise ValueError(f"Output contains a symlink: {current}")
        current = current.parent
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f"Refusing to replace different existing intake file: {path}")
    else:
        with path.open("xb") as stream:
            stream.write(data)
    return {"path": relative, "sha256": sha256(data), "size": len(data)}


def intake(args: argparse.Namespace) -> dict:
    contract_path = args.contract.resolve(strict=True)
    contract_data = contract_path.read_bytes()
    contract = json.loads(contract_data)
    source_root = args.source_root.resolve(strict=True)
    output = args.output.absolute()
    allowed = Path("/tmp/wz-release-inputs")
    if not output.resolve().is_relative_to(allowed) or output.resolve() == allowed:
        raise ValueError("--output must be an isolated child of /tmp/wz-release-inputs")
    # resolve() alone would hide symlink traversal; check every original component.
    current = output
    while current != current.parent:
        if current.is_symlink():
            raise ValueError(f"Output path traverses a symlink: {current}")
        current = current.parent
    if output.resolve().is_relative_to(source_root) or source_root.is_relative_to(output.resolve()):
        raise ValueError("Output and stock source tree must not overlap")
    archive_paths = {"community": args.community_archive.resolve(strict=True),
                     "mapleroot": args.mapleroot_archive.resolve(strict=True)}
    if any(path.is_relative_to(output.resolve()) for path in archive_paths.values()):
        raise ValueError("Archives must be outside the output directory")
    provenance = {"schema_version": 1, "contract_sha256": sha256(contract_data),
                  "stock_source_root": str(source_root), "output_root": str(output),
                  "archives": {label: {"path": str(path), "size": path.stat().st_size}
                               for label, path in archive_paths.items()},
                  "assets": [], "semantic_status": "not-verified-by-intake",
                  "issues": contract["issues"]}
    sources: dict[tuple[str, str], bytes] = {}
    with zipfile.ZipFile(archive_paths["community"]) as community, \
            zipfile.ZipFile(archive_paths["mapleroot"]) as mapleroot:
        archives = {"community": community, "mapleroot": mapleroot}
        # Check all inputs before creating output files.
        for asset in contract["assets"] + contract.get("reference_sources", []):
            baseline = asset.get("stock")
            if baseline:
                path = source_root / safe_relative(baseline["path"])
                if not path.is_file() or sha256(path.read_bytes()) != baseline["sha256"]:
                    raise ValueError(f"Stock baseline differs: {baseline['path']}")
            for key in ("raw_source", "xml_source"):
                source = asset.get(key)
                if not source:
                    continue
                identity = (source["archive"], source["member"])
                if identity not in sources:
                    sources[identity] = archives[identity[0]].read(identity[1])
                if sha256(sources[identity]) != source["sha256"]:
                    raise ValueError(f"Source member checksum differs: {identity}")
                if key == "xml_source" and asset.get("selectors"):
                    root = ET.fromstring(sources[identity])
                    for selector in asset["selectors"]:
                        if select(root, selector) is None:
                            raise ValueError(f"Missing XML node: {identity}: {selector}")
        for asset in contract["assets"]:
            record = {"target_wz": asset["target_wz"], "target_image": asset["target_image"],
                      "action": asset["action"], "selectors": asset.get("selectors", []),
                      "outputs": []}
            if asset.get("stock"):
                record["stock"] = asset["stock"]
            for key, kind in (("raw_source", "raw"), ("xml_source", "xml")):
                source = asset.get(key)
                if not source or asset["action"] == "preserve-stock":
                    continue
                data = sources[(source["archive"], source["member"])]
                if kind == "xml" and asset.get("selectors"):
                    data = fragment(data, asset["selectors"])
                target = f"{kind}/{asset['target_wz']}/{asset['target_image']}"
                if kind == "xml":
                    target += ".xml"
                result = stage(output, target, data)
                result["source"] = source
                record["outputs"].append(result)
            provenance["assets"].append(record)
        provenance["reference_sources"] = []
        for reference in contract.get("reference_sources", []):
            record = {"purpose": reference["purpose"], "outputs": []}
            for key, kind in (("raw_source", "raw"), ("xml_source", "xml")):
                source = reference.get(key)
                if not source:
                    continue
                data = sources[(source["archive"], source["member"])]
                target = f"reference/{kind}/{reference['target_wz']}/{reference['target_image']}"
                if kind == "xml":
                    target += ".xml"
                result = stage(output, target, data)
                result["source"] = source
                record["outputs"].append(result)
            provenance["reference_sources"].append(record)
    deltas = (json.dumps(contract.get("integration_deltas", []), indent=2,
                         sort_keys=True, ensure_ascii=False) + "\n").encode()
    provenance["integration_deltas"] = stage(output, "integration-deltas.json", deltas)
    encoded = (json.dumps(provenance, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()
    stage(output, "provenance.json", encoded)
    return provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True,
                        help="Read-only stock server WZ XML directory")
    parser.add_argument("--community-archive", type=Path, required=True)
    parser.add_argument("--mapleroot-archive", type=Path, required=True)
    parser.add_argument("--contract", type=Path,
                        default=Path(__file__).with_name("boss-contract.json"))
    parser.add_argument("--output", type=Path, default=Path("/tmp/wz-release-inputs/boss"))
    args = parser.parse_args()
    try:
        result = intake(args)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        parser.exit(1, f"Intake failed: {error}\n")
    print(json.dumps({"output": str(args.output), "assets": len(result["assets"]),
                      "semantic_status": result["semantic_status"]}, sort_keys=True))


if __name__ == "__main__":
    main()
