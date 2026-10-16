#!/usr/bin/env python3
"""Extract original feature inputs and record provenance; never parse or merge WZ.

Run: python3 tools/wz_release/intake_features.py
Requires Python 3 and 7z. All writes stay under /tmp/wz-release-inputs.
The feature contract documents runtime paths, preservation rules, and unresolved gaps.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile


FEATURE_MEMBERS = {
    "dailycheckin.zip": {
        "wz/UI.wz": "dailycheckin/UI.wz",
        "README.md": "evidence/dailycheckin/README.md",
        "client/src/dailycheckin.cpp": "evidence/dailycheckin/dailycheckin.cpp",
        "server/src/main/java/server/DailyCheckinRewards.java": "evidence/dailycheckin/DailyCheckinRewards.java",
    },
    "cashshop-window.7z": {
        "cashshop-window/wz/UI/CashShop.img": "cashshop/CashShop.img",
        "cashshop-window/img/UI/CashShop.img": "evidence/cashshop/alternate-CashShop.img",
        "cashshop-window/art/backgrnd.png": "evidence/cashshop/backgrnd.png",
        "cashshop-window/data/catalog.tsv": "cashshop/catalog.tsv",
        "cashshop-window/README.md": "evidence/cashshop/README.md",
        "cashshop-window/INTEGRATION.md": "evidence/cashshop/INTEGRATION.md",
        "cashshop-window/client/cashshopwnd.cpp": "evidence/cashshop/cashshopwnd.cpp",
        "cashshop-window/tools/import_cashshop_bg.py": "evidence/cashshop/import_cashshop_bg.py",
        "cashshop-window/tools/make_cashshop_buttons.py": "evidence/cashshop/make_cashshop_buttons.py",
        "cashshop-window/tools/gen_cashshop_catalog_v83.py": "evidence/cashshop/gen_cashshop_catalog_v83.py",
    },
    "weather-time-systems.7z": {},
}
WEATHER_IMAGES = [
    "Effect/WeatherParticles.img", "Effect/WeatherSplash.img",
    "Effect/WeatherPuddle.img", "Effect/WeatherAccum.img",
    "Map/Back/MapleMoonSky.img", "Map/Back/WeatherSnow.img",
    "Map/Back/WeatherFog.img", "Map/Back/WeatherRainbow.img",
    "Map/Obj/MapleMoonLamp.img",
    "Sound/Weather.img",
]
for image in WEATHER_IMAGES:
    FEATURE_MEMBERS["weather-time-systems.7z"]["weather-time-systems/wz/client/" + image] = "weather/" + image
FEATURE_MEMBERS["weather-time-systems.7z"]["weather-time-systems/optional/lamps/MapleMoonLamp2.img"] = "weather/Map/Obj/MapleMoonLamp2.img"
FEATURE_MEMBERS["weather-time-systems.7z"]["weather-time-systems/server/server/weather/WeatherDebuff.java"] = "evidence/weather/WeatherDebuff.java"
for name in ["README.md", "IMPLEMENTATION.md"]:
    FEATURE_MEMBERS["weather-time-systems.7z"]["weather-time-systems/" + name] = "evidence/weather/" + name
for name in ["weather_lamptable.inc", "weather_lamptable2.inc", "lamps.cpp", "weather_profiles.inc", "weatherfx.cpp", "weatheraccum.cpp", "weatherpuddle.cpp", "weathersplash.cpp", "weathersound.cpp"]:
    FEATURE_MEMBERS["weather-time-systems.7z"]["weather-time-systems/client/" + name] = "evidence/weather/" + name
RESEARCH_MEMBERS = {
    "MapleRoot Full Repack.zip": {
        "MapleRoot Full Repack/Game Files/Data/Map/Obj/" + name + ".img": "lamp-research/" + name + ".img"
        for name in ["ShamanBT", "ShaolinCN", "arcana", "guide"]
    },
    "TengaMS2025.7z": {
        "TengaMS2025/" + name: "prism-research/tenga/" + name
        for name in ["Item.wz", "String.wz", "UI.wz", "EzorsiaV2_UI.wz"]
    },
}
PRISM_ICON_URL = "https://maplestorydb.com/dbsource/iconsource/Item/Item.Cash.0578.img.05782000.info.icon.png"
PRISM_PAGE_URL = "https://maplestorydb.com/itemsinfo.php?id=5782000"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def inventory(path: Path) -> list[dict]:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            return [{"member": row.filename.rstrip("/"), "bytes": row.file_size,
                     "directory": row.is_dir()} for row in archive.infolist()]
    result = subprocess.run(["7z", "l", "-slt", str(path)], check=True,
                            capture_output=True, text=True)
    rows = []
    # Ignore the archive header; only blocks after the member separator are members.
    listing = result.stdout.split("----------\n", 1)[1]
    for block in listing.split("\n\n"):
        fields = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
        if "Path" in fields:
            rows.append({"member": fields["Path"], "bytes": int(fields.get("Size", "0")),
                         "directory": fields.get("Folder") == "+" or fields.get("Attributes", "").lstrip().startswith("D")})
    return rows


def extract(archive_path: Path, member: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".intake-part")
    try:
        with temporary.open("wb") as output:
            if archive_path.suffix.lower() == ".zip":
                with zipfile.ZipFile(archive_path) as archive, archive.open(member) as source:
                    shutil.copyfileobj(source, output)
            else:
                subprocess.run(["7z", "x", "-so", "-spd", str(archive_path), member],
                               stdout=output, stderr=subprocess.PIPE, check=True)
        if target.exists():
            if sha256(target) != sha256(temporary):
                raise RuntimeError(f"Refusing to replace differing original input: {target}")
            temporary.unlink()
        else:
            temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def fetch(url: str, target: Path, expected_type: str) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "WZ-release-source-intake/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_type = response.headers.get_content_type()
        if not content_type.startswith(expected_type):
            raise RuntimeError(f"Unexpected source content type {content_type}: {url}")
        payload = response.read()
        final_url = response.url
    if target.exists() and target.read_bytes() != payload:
        raise RuntimeError(f"Remote source changed; refusing to overwrite {target}")
    if not target.exists():
        target.write_bytes(payload)
    return {"url": url, "resolved_url": final_url, "content_type": content_type,
            "bytes": len(payload), "sha256": sha256(target)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-root", type=Path, default=Path("/root/maplestory_dump"))
    parser.add_argument("--output-root", type=Path, default=Path("/tmp/wz-release-inputs/features"))
    parser.add_argument("--fetch-prism-candidate", action="store_true",
                        help="Fetch attributed original item icon candidate; never synthesize art")
    args = parser.parse_args()
    output_root = args.output_root.resolve()
    if not output_root.is_relative_to(Path("/tmp/wz-release-inputs")):
        parser.error("output-root must stay beneath /tmp/wz-release-inputs")
    output_root.mkdir(parents=True, exist_ok=True)
    provenance = {"schema_version": 1, "archives": [], "inputs": [], "remote_sources": [],
                  "scope": "Original raw input intake only; no WZ parsing, merges or serverDB writes"}
    selections = FEATURE_MEMBERS | RESEARCH_MEMBERS
    for archive_path in sorted(args.archive_root.iterdir()):
        if archive_path.suffix.lower() not in {".zip", ".7z"}:
            continue
        rows = inventory(archive_path)
        inventory_file = "inventories/" + archive_path.name + ".json"
        write_json(output_root / inventory_file, rows)
        archive_hash = sha256(archive_path)
        provenance["archives"].append({"archive": archive_path.name, "source_path": str(archive_path),
            "bytes": archive_path.stat().st_size, "sha256": archive_hash, "member_count": len(rows),
            "inventory": inventory_file, "inventory_sha256": sha256(output_root / inventory_file)})
        members = {row["member"]: row for row in rows}
        for member, relative in selections.get(archive_path.name, {}).items():
            if member not in members or members[member]["directory"]:
                raise RuntimeError(f"Required original member missing: {archive_path.name}:{member}")
            target = output_root / relative
            extract(archive_path, member, target)
            if target.stat().st_size != members[member]["bytes"]:
                raise RuntimeError(f"Truncated member: {member}")
            provenance["inputs"].append({"path": relative, "archive": archive_path.name,
                "archive_sha256": archive_hash, "member": member,
                "bytes": target.stat().st_size, "sha256": sha256(target)})
        print(f"Intake {archive_path.name}: {len(rows)} inventoried, {len(selections.get(archive_path.name, {}))} selected", flush=True)
    missing = set(selections) - {row["archive"] for row in provenance["archives"]}
    if missing:
        raise RuntimeError(f"Required archives unavailable: {sorted(missing)}")
    for name in ["README.md", "IMPLEMENTATION.md", "INTEGRATION.md", "INTEGRATION (1).md", "INTEGRATION (2).md"]:
        source = args.archive_root / name
        target = output_root / "evidence/prism" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and sha256(target) != sha256(source):
            raise RuntimeError(f"Refusing to overwrite changed reference {target}")
        if not target.exists():
            shutil.copyfile(source, target)
        provenance["inputs"].append({"path": str(target.relative_to(output_root)), "source_path": str(source),
                                    "bytes": target.stat().st_size, "sha256": sha256(target)})
    if args.fetch_prism_candidate:
        for url, relative, content_type in [
            (PRISM_ICON_URL, "prism-research/5782000-original-icon.webp", "image/"),
            (PRISM_PAGE_URL, "prism-research/5782000-source.html", "text/html"),
        ]:
            record = fetch(url, output_root / relative, content_type)
            record["path"] = relative
            provenance["remote_sources"].append(record)
    write_json(output_root / "provenance.json", provenance)
    print(f"Recorded {len(provenance['inputs'])} raw inputs in {output_root / 'provenance.json'}")


if __name__ == "__main__":
    main()
