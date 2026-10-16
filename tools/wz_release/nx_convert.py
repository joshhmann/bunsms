#!/usr/bin/env python3
"""Build pinned NoLifeWzToNx and create genuine offline world-asset donors.

No native input is modified. The output must be absent or empty. Logs retain
all format diagnostics; failed conversions never receive a success manifest.
This is not a browser UI parity or deployment tool. Input format is v83 PKG1.

The explicit source patch corrects Linux UTF-16 conversion, string hash
collisions, and sequential-image assumptions (real v83 offsets are decoded).
Unresolved aliases and failed pixel conversion are fatal. Historical v83
canvases may exhaust their zlib input without a trailer or contain zero-padded
buffer capacity: all declared pixels must exist, all surplus bytes must be
zero, and zlib data errors remain fatal. No blank art or lossy text fallback.

Only complete IMG blobs selected by the repeated operation contracts (plus
cross-image alias/info-link closure) enter isolated subset WZ files. Native
IMG bytes are unchanged; the pinned independent C++ converter parses them.
This avoids unrelated stock invalid aliases without suppressing any failure.
"""
from __future__ import annotations

import argparse
import ctypes.util
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

import posixpath

from native_wz import Archive
SOURCE_URL = 'https://github.com/ryantpayton/NoLifeWzToNx.git'
SOURCE_COMMIT = '73bddde1214445795d0a5cd4c3d431fe15eb49eb'
WORLD_ARCHIVES = ('Map', 'Mob', 'Npc', 'Item', 'Reactor', 'String', 'Sound', 'Morph', 'Quest')
ARCHIVES = WORLD_ARCHIVES + ('Character',)
PATCH = Path(__file__).with_name('nx_converter.patch')


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def record(path):
    path = Path(path)
    return {'path': str(path.resolve()), 'size': path.stat().st_size, 'sha256': digest(path)}


def capture(args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def build(root, compiler):
    root.mkdir(parents=True, exist_ok=True)
    source = root / 'source'
    if not source.exists():
        subprocess.run(['git', 'clone', '--no-checkout', SOURCE_URL, str(source)], check=True)
        subprocess.run(['git', 'checkout', '--detach', SOURCE_COMMIT], cwd=source, check=True)
        subprocess.run(['git', 'apply', str(PATCH)], cwd=source, check=True)
    actual = capture(['git', 'rev-parse', 'HEAD'], source)
    if actual != SOURCE_COMMIT:
        raise RuntimeError(f'Build source is not pinned commit: {actual}')
    # Reject unrecorded source changes, including unrelated tracked changes.
    actual_patch = subprocess.check_output(['git', 'diff', '--binary'], cwd=source)
    if actual_patch != PATCH.read_bytes():
        raise RuntimeError('Build source differs from the explicit checked-in patch; use a new --build-dir')
    untracked = capture(['git', 'ls-files', '--others', '--exclude-standard'], source)
    if untracked:
        raise RuntimeError(f'Unexpected untracked build source: {untracked}')
    cc = shutil.which(compiler)
    if cc is None:
        raise RuntimeError(f'Native C++ compiler unavailable: {compiler}')
    # Use upstream pinned headers with the installed Linux runtime library;
    # this does not require installing liblz4-dev or modifying the host.
    lz4 = ctypes.util.find_library('lz4')
    if not lz4:
        raise RuntimeError('Native liblz4 prerequisite unavailable')
    flags = ['-std=c++17', '-O2', '-Iincludes/libsquish',
             '-Iincludes/lz4_v1_8_2_win64/include']
    sources = ['NoLifeWzToNx.cpp', 'Keys.cpp'] + [str(p.relative_to(source)) for p in sorted((source / 'includes/libsquish').glob('*.cpp'))]
    binary = root / 'NoLifeWzToNx'
    command = [cc, *flags, *sources, '-lz', f'-l:{lz4}', '-o', str(binary)]
    with (root / 'build.log').open('w') as log:
        subprocess.run(command, cwd=source, stdout=log, stderr=subprocess.STDOUT, check=True)
    return binary, {
        'repository': SOURCE_URL, 'commit': SOURCE_COMMIT,
        'patch': record(PATCH), 'compiler': record(cc),
        'compiler_version': capture([cc, '--version']),
        'command': command, 'cwd': str(source), 'binary': record(binary),
        'libraries': capture(['ldd', str(binary)]),
        'build_log': record(root / 'build.log'),
        'patched_source_sha256': digest(source / 'NoLifeWzToNx.cpp'),
    }


def select_images(native, contracts, allowed):
    selected = {}
    reasons = {}
    for contract in contracts:
        for operation in json.loads(contract.read_text())['operations']:
            archive = operation['target_wz'].removesuffix('.wz')
            if archive not in allowed:
                raise RuntimeError(f'Contract operation requires --archives {archive}: {operation["target_image"]}')
            image = operation['target_image']
            selected.setdefault(archive, set()).add(image)
            reasons[(archive, image)] = ['contract operation']
    pending = [(archive, image) for archive, images in selected.items() for image in images]
    opened = {}
    try:
        def add(archive, image, reason):
            if archive not in allowed:
                raise RuntimeError(f'Cross-image dependency requires --archives {archive}: {image}')
            if image not in selected.setdefault(archive, set()):
                selected[archive].add(image)
                reasons[(archive, image)] = [reason]
                pending.append((archive, image))

        while pending:
            archive, image = pending.pop()
            if archive not in opened:
                opened[archive] = Archive(native / f'{archive}.wz')
            root = opened[archive].image(image)
            stack = [(root, image)]
            while stack:
                node, path = stack.pop()
                stack.extend((child, path + '/' + child.name) for child in node.children)
                if node.kind == 'uol' or (node.name in ('source', '_outlink', '_inlink') and node.kind == 'string'):
                    value = node.value
                    if '.img' not in value:
                        continue
                    parts = value.strip('/').split('/')
                    linked_archive = archive
                    if parts[0].removesuffix('.wz') in ARCHIVES:
                        linked_archive = parts.pop(0).removesuffix('.wz')
                        target = '/'.join(parts)
                    elif node.kind == 'uol':
                        target = posixpath.normpath(posixpath.join(posixpath.dirname(path), value))
                    else:
                        target = value
                    target = target[:target.index('.img') + 4]
                    add(linked_archive, target, f'{archive}/{path} -> {value}')
                elif node.name == 'link' and path.endswith('/info/link') and node.kind in ('string', 'int', 'short', 'long'):
                    value = str(node.value)
                    if not value.isdecimal():
                        raise RuntimeError(f'Unsupported info/link: {archive}/{path} = {value}')
                    if archive == 'Map':
                        target = f'Map/Map{value[0]}/{value.zfill(9)}.img'
                    elif archive in ('Mob', 'Npc', 'Reactor', 'Morph'):
                        target = value.zfill(4 if archive == 'Morph' else 7) + '.img'
                    elif archive == 'Character':
                        width = len(posixpath.basename(image).removesuffix('.img'))
                        target = posixpath.join(posixpath.dirname(image), value.zfill(width) + '.img')
                    else:
                        continue
                    add(archive, target, f'{archive}/{path} -> {value}')
    finally:
        for archive in opened.values():
            archive.close()
    return selected, reasons


def subset(native_path, output_path, images, reasons):
    with Archive(native_path) as archive:
        image_records = []
        for image in sorted(images):
            entry = archive.entry(image)
            if entry.kind != 4:
                raise RuntimeError(f'Not a complete IMG: {image}')
            raw = archive.raw(entry)
            image_records.append({'image': image, 'size': len(raw),
                                  'sha256': hashlib.sha256(raw).hexdigest(),
                                  'reasons': reasons[image]})

        def retain(directory, prefix=''):
            retained = []
            for entry in directory.children:
                path = f'{prefix}/{entry.name}'.lstrip('/')
                if entry.kind == 3:
                    retain(entry, path)
                    if entry.children:
                        retained.append(entry)
                elif path in images:
                    retained.append(entry)
            directory.children = retained

        retain(archive.root)
        archive.save(output_path)
    return {'method': 'Complete original IMG blobs; directory-only subset via native_wz.Archive.save',
            'images': image_records, 'wz': record(output_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True, help='Complete finalized native WZ directory')
    parser.add_argument('--output', type=Path, required=True, help='Absent or empty offline donor directory')
    parser.add_argument('--build-dir', type=Path, default=Path('/tmp/wz-nx-pinned-final-build'))
    parser.add_argument('--compiler', default='g++')
    parser.add_argument('--archives', nargs='+', choices=ARCHIVES, default=list(WORLD_ARCHIVES))
    parser.add_argument('--contract', type=Path, action='append',
                        help='Repeat exact operation contracts; default boss + server-map. Character publication requires explicit archives and contracts.')
    args = parser.parse_args()
    native, output, build_dir = args.native.resolve(), args.output.resolve(), args.build_dir.resolve()
    if output == native or output.is_relative_to(native) or native.is_relative_to(output):
        parser.error('Native and output directories must be disjoint')
    if build_dir == native or build_dir.is_relative_to(native) or native.is_relative_to(build_dir):
        parser.error('Native and build directories must be disjoint')
    if output == build_dir or output.is_relative_to(build_dir) or build_dir.is_relative_to(output):
        parser.error('Output and build directories must be disjoint')
    if output.exists() and any(output.iterdir()):
        parser.error('Output directory must be empty')
    allowed = set(args.archives)
    contracts = args.contract or [Path(__file__).with_name(name) for name in ('boss-contract.json', 'server-map-contract.json')]
    selected, reasons = select_images(native, contracts, allowed)
    archives = sorted(selected)
    if not archives:
        parser.error('Contracts select no donor images')
    inputs = {name: record(native / f'{name}.wz') for name in archives}
    output.mkdir(parents=True, exist_ok=True)
    binary, provenance = build(build_dir, args.compiler)
    manifest = {'schema': 1, 'purpose': 'offline genuine world NX donors; no deployment or UI parity claim',
                'native': str(native), 'build': provenance, 'options': ['-c'], 'archives': {},
                'contracts': [record(path) for path in contracts],
                'pipeline': record(__file__), 'subset_writer': record(Path(__file__).with_name('native_wz.py'))}
    subset_dir = output / 'native-donors'
    subset_dir.mkdir()
    for name in archives:
        with tempfile.TemporaryDirectory(prefix=f'.{name}-', dir=output) as temporary:
            stage = Path(temporary)
            subset_path = subset_dir / f'{name}.wz'
            extraction = subset(native / f'{name}.wz', subset_path, selected[name],
                                {image: reasons[(name, image)] for image in selected[name]})
            staged_wz = stage / f'{name}.wz'
            staged_wz.symlink_to(subset_path)
            command = [str(binary), str(staged_wz), '-c']
            logpath = output / f'{name}.convert.log'
            with logpath.open('w') as log:
                result = subprocess.run(command, cwd=stage, stdout=log, stderr=subprocess.STDOUT)
            diagnostic = stage / 'NoLifeWzToNx.log'
            if diagnostic.exists():
                shutil.copyfile(diagnostic, output / f'{name}.format.log')
            result.check_returncode()
            nx = stage / f'{name}.nx'
            with nx.open('rb') as stream:
                if stream.read(4) != b'PKG4':
                    raise RuntimeError(f'Converter did not produce a PKG4 NX: {name}')
            # Protect provenance if the parent publishes a newer native candidate
            # while this long-running conversion is in flight.
            if record(native / f'{name}.wz') != inputs[name]:
                raise RuntimeError(f'Native input changed during conversion: {name}')
            destination = output / nx.name
            nx.rename(destination)
            manifest['archives'][name] = {'input': inputs[name], 'output': record(destination),
                                          'extraction': extraction,
                                          'command': command, 'log': record(logpath),
                                          'format_log': record(output / f'{name}.format.log')}
            print(f'{name}: {manifest["archives"][name]["output"]["sha256"]}', flush=True)
    # All inputs are rechecked as one cohort; never label mixed candidates complete.
    for name in archives:
        if record(native / f'{name}.wz') != inputs[name]:
            raise RuntimeError(f'Native cohort changed during conversion: {name}')
    (output / 'donor-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
