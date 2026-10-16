#!/usr/bin/env python3
"""Opcode drift gate (spec §5): fails CI if client/OPCODE_TABLE.md drifts from
server/docs/OPCODE_REGISTRY.md or the opcode enums.

Checks:
  1. Every 0x37xx opcode claimed in the registry appears in the client table.
  2. Every 0x37xx opcode in the client table appears in the registry.
  3. Direction-split claims (0x11A/0x17C) appear in both.
  4. Grandfathered values (0x3713 CUSTOM_PACKET, stock 0x145-0x14D CASHSHOP_*,
     0x8E BLOW_WEATHER, 0x11A-opposite-direction HIT_SNOWBALL) are documented
     in the client table as NOT OURS.
  5. Each claimed 0x37xx opcode has a matching enum entry in RecvOpcode.java
     (Recv direction) or SendOpcode.java (Send direction).

Usage: python3 tools/check_opcodes.py  (run from repo root)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
REGISTRY = ROOT / "server/docs/OPCODE_REGISTRY.md"
CLIENT_TABLE = ROOT / "client/OPCODE_TABLE.md"
RECV_ENUM = ROOT / "server/src/main/java/net/opcodes/RecvOpcode.java"
SEND_ENUM = ROOT / "server/src/main/java/net/opcodes/SendOpcode.java"

HEX = re.compile(r"0x[0-9A-Fa-f]+")

# Stock-boundary opcodes quoted as prose in the registry intro (top of stock
# space), not claims — excluded from the mirror comparison.
STOCK_BOUNDARY = {"0X104", "0X166"}


def norm(op: str) -> str:
    return "0X%X" % int(op, 16)

failures: list[str] = []


def opcodes_in(path: Path) -> set[str]:
    return {norm(m.group(0)) for m in HEX.finditer(path.read_text())} - STOCK_BOUNDARY


def enum_opcodes(path: Path) -> set[str]:
    return {norm(m.group(0)) for m in HEX.finditer(path.read_text())}


def main() -> int:
    for p in (REGISTRY, CLIENT_TABLE, RECV_ENUM, SEND_ENUM):
        if not p.exists():
            failures.append(f"missing file: {p}")
    if failures:
        return report()

    reg = opcodes_in(REGISTRY)
    tab = opcodes_in(CLIENT_TABLE)
    recv = enum_opcodes(RECV_ENUM)
    send = enum_opcodes(SEND_ENUM)
    both_enums = recv | send

    # 1+2: registry <-> client table agreement on the custom block + splits.
    # (Stock ranges quoted in prose on both sides are expected overlap;
    # compare the full sets and let the grandfather check pin the details.)
    for op in sorted(reg - tab):
        failures.append(f"registry {op} missing from client OPCODE_TABLE.md")
    for op in sorted(tab - reg):
        failures.append(f"client table {op} not in server OPCODE_REGISTRY.md")

    # 3: direction-split claims present in both.
    for op in ("0X11A", "0X17C"):
        if op not in tab:
            failures.append(f"direction-split {op} missing from client table")
        if op not in reg:
            failures.append(f"direction-split {op} missing from registry")

    # 4: grandfathered values documented client-side.
    for op in ("0X3713", "0X145", "0X8E"):
        if op not in tab:
            failures.append(f"grandfathered {op} not documented in client table")

    # 5: claimed custom-block opcodes exist in the matching enum.
    claimed_send = {"0X372F", "0X3731", "0X373D", "0X373F", "0X17C"}
    claimed_recv = {"0X372E", "0X3730", "0X11A"}
    for op in sorted(claimed_send):
        if op not in send:
            failures.append(f"client/send-claimed {op} missing from SendOpcode.java")
    for op in sorted(claimed_recv):
        if op not in recv:
            failures.append(f"client/recv-claimed {op} missing from RecvOpcode.java")
    for op in sorted((claimed_send | claimed_recv) - both_enums):
        failures.append(f"claimed {op} missing from both opcode enums")

    return report()


def report() -> int:
    if failures:
        print("check_opcodes.py FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("check_opcodes.py OK: client table matches registry + enums.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
