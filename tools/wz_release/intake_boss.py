#!/usr/bin/env python3
"""Stage pinned boss inputs without modifying release WZ or server trees.

The sibling boss-contract.json is the archive allowlist. XML fragments and raw
IMG files are donor artifacts, never whole-image replacement permission.
Published snapshot mode uses the existing codec for offline raw IMG donors;
neither mode claims native client compatibility or release qualification.
Only an isolated directory beneath /tmp/wz-release-inputs may be written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
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


def intake_published(args: argparse.Namespace) -> dict:
    import base64
    from PIL import Image
    from native_wz import Node, canvas, parse_img, pixels, semantic_hash, write_img
    from build_release import ensure

    manifest_path = args.published_manifest.resolve(strict=True)
    manifest_bytes = manifest_path.read_bytes()
    if sha256(manifest_bytes) != args.published_manifest_sha256:
        raise ValueError("Published snapshot manifest checksum differs")
    manifest = json.loads(manifest_bytes)
    if manifest.get("failures"):
        raise ValueError("Published snapshots still have unresolved retrieval failures")
    source_root = manifest_path.parent
    output = args.output.absolute()
    allowed = Path("/tmp/wz-release-inputs")
    if not output.resolve().is_relative_to(allowed) or output.resolve() == allowed:
        raise ValueError("--output must be an isolated child of /tmp/wz-release-inputs")
    if output.resolve().is_relative_to(source_root) or source_root.is_relative_to(output.resolve()):
        raise ValueError("Output and published source snapshots must not overlap")
    current = output
    while current != current.parent:
        if current.is_symlink():
            raise ValueError(f"Output path traverses a symlink: {current}")
        current = current.parent
    prefix = "https://maplestory.io/api/wz/GMS/195/"
    sources = {}
    # Freeze/check every original JSON/PNG before producing donor files.
    for record in manifest["records"]:
        url = record["sourceUrl"]
        if not url.startswith(prefix):
            raise ValueError(f"Unexpected published source/version: {url}")
        relative = url[len(prefix):]
        if relative in sources:
            raise ValueError(f"Duplicate published snapshot: {relative}")
        snapshot = source_root / safe_relative(record["snapshot"])
        if not snapshot.resolve(strict=True).is_relative_to(source_root):
            raise ValueError(f"Published snapshot escapes source root: {snapshot}")
        payload = snapshot.read_bytes()
        if sha256(payload) != record["snapshotSha256"]:
            raise ValueError(f"Published JSON checksum differs: {relative}")
        spec = json.loads(payload)
        if spec["type"] == 12:
            png_path = source_root / safe_relative(record["png"])
            if not png_path.resolve(strict=True).is_relative_to(source_root):
                raise ValueError(f"Published PNG escapes source root: {png_path}")
            png = png_path.read_bytes()
            if sha256(png) != record["pngSha256"] or base64.b64decode(spec["value"], validate=True) != png:
                raise ValueError(f"Published canvas PNG differs from its raw JSON: {relative}")
        sources[relative] = (record, spec)

    def node_at(path):
        record, spec = sources[path]
        names = spec.get("children", [])
        if len(names) != len(set(names)) or any("/" in name or name in (".", "..") for name in names):
            raise ValueError(f"Published API cannot disambiguate child names: {path}")
        children = [node_at(path + "/" + name) for name in names]
        name, kind, value = path.rsplit("/", 1)[-1], spec["type"], spec.get("value")
        if kind == 13:
            return Node(name, "property", children=children)
        if kind == 12:
            with Image.open(source_root / safe_relative(record["png"])) as image:
                if image.format != "PNG" or (image.width, image.height) != (record["width"], record["height"]):
                    raise ValueError(f"Published PNG format/dimensions differ: {path}")
                result = canvas(name, image, children)
            if sha256(pixels(result)) != record["decodedBgraSha256"]:
                raise ValueError(f"Published BGRA pixel checksum differs: {path}")
            return result
        if children:
            raise ValueError(f"Unexpected scalar children: {path}")
        if kind == 4 and isinstance(value, int) and not isinstance(value, bool):
            return Node(name, "int", value)
        if kind == 6 and isinstance(value, (int, float)) and not isinstance(value, bool):
            return Node(name, "float", struct.pack("<f", value))
        if kind == 8 and isinstance(value, str):
            return Node(name, "string", value)
        if kind == 9 and all(isinstance(value[axis], int) and not isinstance(value[axis], bool) for axis in ("x", "y")):
            return Node(name, "vector", (value["x"], value["y"]))
        raise ValueError(f"Unsupported published node type/value, not omitted: {path}")

    fragments = {}
    for path in manifest["roots"]:
        parts = safe_relative(path).parts
        if len(parts) < 3 or not parts[1].endswith(".img"):
            raise ValueError(f"Expected exact archive/image/node source path: {path}")
        key = (parts[0] + ".wz", parts[1])
        root = fragments.setdefault(key, Node(parts[1], "property"))
        node_path = "/".join(parts[2:])
        ensure(root, "/".join(parts[2:-1]))
        root.put(node_path, node_at(path))
    assets = []
    for (archive, image), root in fragments.items():
        blob = write_img(root, "gms")
        reparsed = parse_img(blob, root.name, "gms")[0]
        if semantic_hash(root) != semantic_hash(reparsed):
            raise ValueError(f"Published raw IMG roundtrip differs: {archive}/{image}")
        assets.append(stage(output, f"raw/{archive}/{image}", blob))
    provenance = {"schema_version": 1, "manifest_sha256": sha256(manifest_bytes),
                  "published_source_root": str(source_root), "assets": assets,
                  "source_records": manifest["records"],
                  "semantic_status": "pinned-source-materialized-not-native-qualified",
                  "policy": "Published child order/metadata and authored pixel extents retained; original binary property order not asserted. Raw fragments are donors only, no release/family approval."}
    stage(output, "provenance.json", (json.dumps(provenance, indent=2) + "\n").encode())
    return provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path,
                        help="Read-only stock server WZ XML directory, required for archive mode")
    parser.add_argument("--community-archive", type=Path)
    parser.add_argument("--mapleroot-archive", type=Path)
    parser.add_argument("--published-manifest", type=Path,
                        help="Offline pinned GMS195 JSON/PNG snapshot manifest")
    parser.add_argument("--published-manifest-sha256",
                        help="Independently frozen checksum of the published snapshot manifest")
    parser.add_argument("--contract", type=Path,
                        default=Path(__file__).with_name("boss-contract.json"))
    parser.add_argument("--output", type=Path, default=Path("/tmp/wz-release-inputs/boss"))
    args = parser.parse_args()
    try:
        if args.published_manifest:
            if not args.published_manifest_sha256 or any((args.source_root, args.community_archive, args.mapleroot_archive)):
                parser.error("Published mode requires its manifest SHA and no archive-mode sources")
            result = intake_published(args)
        else:
            if not all((args.source_root, args.community_archive, args.mapleroot_archive)):
                parser.error("Archive mode requires --source-root, --community-archive and --mapleroot-archive")
            result = intake(args)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        parser.exit(1, f"Intake failed: {error}\n")
    print(json.dumps({"output": str(args.output), "assets": len(result["assets"]),
                      "semantic_status": result["semantic_status"]}, sort_keys=True))


if __name__ == "__main__":
    main()
