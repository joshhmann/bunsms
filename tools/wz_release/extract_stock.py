#!/usr/bin/env python3
"""Recover both embedded CAB volumes of the pinned GMS v83 installer offline."""
import argparse
import hashlib
import json
import mmap
from pathlib import Path
import struct
import subprocess

INSTALLER_SHA256 = '1a1128ac97e11c7845aacec1a5484e650558a67da94b94147d72292e1568366d'


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def extract(installer, output, cabinets):
    installer, output, cabinets = map(Path, (installer, output, cabinets))
    if digest(installer) != INSTALLER_SHA256:
        raise ValueError('Installer hash differs from pinned MapleGlobal-v83-setup.exe')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Stock extraction destination must be empty (never overwrite a live tree)')
    output.mkdir(parents=True, exist_ok=True)
    cabinets.mkdir(parents=True, exist_ok=True)
    volumes = []
    with installer.open('rb') as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as data:
        offset = data.find(b'MSCF')
        while offset >= 0:
            h = struct.unpack_from('<4sIIIII BBHHHHH', data, offset)
            if h[6:8] != (3, 1) or not 36 <= h[2] <= len(data) - offset:
                offset = data.find(b'MSCF', offset + 4)
                continue
            index = h[-1]
            target = cabinets / f'MapleStory_{index + 1}.cab'
            with target.open('wb') as cab:
                cab.write(data[offset:offset + h[2]])
            volumes.append({'name': target.name, 'offset': offset, 'size': h[2], 'sha256': digest(target)})
            offset = data.find(b'MSCF', offset + h[2])
    if [v['name'] for v in volumes] != ['MapleStory_1.cab', 'MapleStory_2.cab']:
        raise ValueError(f'Unexpected cabinet chain: {volumes}')
    subprocess.run(['7z', 'x', '-y', str(cabinets / 'MapleStory_1.cab'), f'-o{output}'], check=True)
    files = [dict(name=p.relative_to(output).as_posix(), sha256=digest(p), size=p.stat().st_size,
                  source=f'GMS v83 installer sha256:{INSTALLER_SHA256}')
             for p in sorted(output.rglob('*')) if p.is_file()]
    (output.parent / 'stock-provenance.json').write_text(json.dumps(
        {'installer': str(installer), 'sha256': INSTALLER_SHA256, 'volumes': volumes, 'files': files}, indent=2) + '\n')
    return files


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installer', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--cabinets', required=True)
    args = parser.parse_args()
    extract(args.installer, args.output, args.cabinets)
