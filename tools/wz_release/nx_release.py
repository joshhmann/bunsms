#!/usr/bin/env python3
"""Offline deployed-NX inventory and exact-node world-asset merger.

Inventory (read-only sources):
  nx_release.py --baseline DIR --contract boss-contract.json \
    --contract server-map-contract.json --world-ids ids.json \
    --inventory-only --output EMPTY_DIR
Merge (genuine final-native converter donor, never a live NX swap):
  nx_release.py --baseline DIR --donor DONOR_DIR --contract boss-contract.json \
    --contract server-map-contract.json --world-ids ids.json --output EMPTY_DIR

Native operation contracts authorize target paths only: donor already contains
all final native edits. Untargeted baseline nodes and compressed media bytes
are preserved. UI/Effect are rejected; no native browser UI parity is implied.
Outputs are candidates only when coverage, target equality, and full non-target
preservation pass. No deployment commands, DB access, downloads, or fallbacks.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import tempfile
from collections import Counter, deque
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path

from nx_format import HEADER, NODE, NX, NXError, U32, U64, file_identity

WORLD_ARCHIVES = {'Map.nx', 'Mob.nx', 'Npc.nx', 'Item.nx', 'Morph.nx',
                  'Reactor.nx', 'Quest.nx', 'String.nx', 'Sound.nx', 'Skill.nx'}
MUTABLE_ARCHIVES = WORLD_ARCHIVES | {'Character.nx'}
RUNTIME_ARCHIVES = WORLD_ARCHIVES | {'Base.nx', 'Character.nx', 'Effect.nx',
                                    'Etc.nx', 'TamingMob.nx', 'UI.nx'}
TERMINAL = '$target'


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def safe_path(value):
    if not isinstance(value, str) or not value or any(p in ('', '.', '..') for p in value.split('/')):
        raise NXError(f'Not an exact relative NX node path: {value!r}')
    if any(c in value for c in ('*', '?', '\\', '\x00')):
        raise NXError(f'Wildcard/ambiguous node path: {value!r}')
    return value


def nx_name(value):
    name = Path(value).name
    if name != value:
        raise NXError(f'Not an archive filename: {value!r}')
    if name.endswith('.wz'):
        name = name[:-3] + '.nx'
    if name not in MUTABLE_ARCHIVES:
        raise NXError(f'Outside explicit world/Character asset scope: {name}')
    return name


def load_contracts(paths):
    targets, requirements, provenance = {}, {}, []
    for path in paths:
        contract = json.loads(Path(path).read_text())
        provenance.append(file_identity(path))
        for target in contract.get('targets', []):
            key = (nx_name(target['file']), safe_path(target['path']))
            targets[key] = {'action': target.get('action', 'replace'), 'contract': str(path)}
        for operation in contract.get('operations', []):
            name = nx_name(operation['target_wz'])
            image = safe_path(operation['target_image'])
            op = operation['op']
            if op == 'import_image':
                nodes = ['']
            elif op in ('copy_subtree', 'set_subtree', 'remove_node'):
                nodes = [operation['target_node']]
            elif op == 'set_properties':
                nodes = [p['path'] for p in operation['properties']]
            else:
                raise NXError(f'Unsupported exact-target operation {op}')
            for node in nodes:
                full = safe_path('/'.join(p for p in (image, node) if p))
                targets[(name, full)] = {'action': 'remove' if op == 'remove_node' else 'replace',
                                       'contract': str(path), 'native_operation': op}
        for requirement in contract.get('requirements', []):
            name = nx_name(requirement['wz'])
            full = safe_path('/'.join(p for p in (requirement['image'], requirement.get('node', '')) if p))
            requirements[(name, full)] = {**requirement, 'file': name, 'path': full}
    if not targets:
        raise NXError('An explicit nonempty world-node allowlist is required')
    for entry in targets.values():
        if entry['action'] not in ('replace', 'remove'):
            raise NXError(f'Unsupported target action: {entry}')
    # Whole-image authorization subsumes metadata edits below it. Always read
    # final donor paths, never source_node paths from pre-merge raw inputs.
    roots = {}
    for (name, path), spec in sorted(targets.items(), key=lambda x: (x[0][0], x[0][1].count('/'), x[0][1])):
        ancestors = [p for f, p in roots if f == name and path.startswith(p + '/')]
        if ancestors:
            if any(roots[(name, p)]['action'] == 'remove' for p in ancestors):
                raise NXError(f'Target below removed root: {name}/{path}')
            continue
        roots[(name, path)] = spec
    return roots, list(requirements.values()), provenance


def trie_for(targets, name):
    root = {}
    for (file, path), spec in targets.items():
        if file != name:
            continue
        branch = root
        for part in path.split('/'):
            branch = branch.setdefault(part, {})
        branch[TERMINAL] = spec
    return root


def media_required(name, path):
    return (name in ('Mob.nx', 'Npc.nx', 'Morph.nx', 'Reactor.nx', 'Character.nx') and path.endswith('.img')) or (
        name == 'Item.nx' and len(path.split('/')) == 3) or (
        name == 'Map.nx' and path.split('/')[0] in ('Back', 'Tile', 'Obj'))


class Corpus:
    def __init__(self, root, stack):
        self.root, self.stack, self.readers = Path(root), stack, {}

    def get(self, name):
        if name not in self.readers:
            path = self.root / name
            if not path.is_file() or path.is_symlink():
                return None
            reader = NX(path)
            self.stack.callback(reader.close)
            self.readers[name] = reader
        return self.readers[name]

    def inspect(self, name, path, visual=False):
        reader = self.get(name)
        if reader is None:
            return {'file': name, 'path': path, 'status': 'missing-file'}
        try:
            return {'file': name, **reader.inspect(path, visual)}
        except (NXError, UnicodeError, struct.error) as error:
            return {'file': name, 'path': path, 'status': 'invalid', 'error': str(error)}


def value_at(reader, path, default=None):
    index = reader.resolve(path)
    return default if index is None else reader.value(index)


def dependencies(corpus, name, path):
    """Edges actually consumed by nlnx world loaders; no filename-only proof."""
    reader = corpus.get(name)
    index = reader.resolve(path) if reader else None
    if index is None:
        return []
    result = []

    def edge(file, target, reason, visual=False, kind=None):
        result.append({'file': file, 'path': safe_path(target), 'reason': reason,
                       'from': f'{name}/{path}', 'visual': visual, 'kind': kind})

    def get(relative, default=''):
        return value_at(reader, f'{path}/{relative}', default)

    if name == 'Map.nx' and path.startswith('Map/Map') and path.endswith('.img'):
        link = get('info/link')
        if link:
            number = str(link).zfill(9)
            edge('Map.nx', f'Map/Map{number[0]}/{number}.img', 'map info/link')
        bgm = get('info/bgm')
        if bgm:
            parts = str(bgm).split('/', 1)
            if len(parts) != 2:
                raise NXError(f'Invalid map BGM at {path}: {bgm}')
            edge('Sound.nx', parts[0] + '.img/' + parts[1], 'map BGM', kind=6)
        mark = get('info/mapMark')
        if mark:
            edge('Map.nx', f'MapHelper.img/mark/{mark}', 'minimap mapMark', visual=True)
        back = reader.resolve(path + '/back')
        for _, child in reader.children(back).items() if back is not None else ():
            base = path + '/back/' + reader.name(child)
            collection = value_at(reader, base + '/bS')
            if collection:
                mode = 'ani' if value_at(reader, base + '/ani', 0) else 'back'
                edge('Map.nx', f'Back/{collection}.img/{mode}/{value_at(reader, base + "/no", 0)}',
                     'map background', visual=True)
        for layer, layer_index in reader.children(index).items():
            if not layer.isdigit():
                continue
            prefix = path + '/' + layer
            tile_set = value_at(reader, prefix + '/info/tS')
            for family in ('tile', 'obj'):
                group = reader.resolve(prefix + '/' + family)
                for node, _ in reader.children(group).items() if group is not None else ():
                    base = prefix + '/' + family + '/' + node
                    if family == 'tile':
                        if not tile_set:
                            raise NXError(f'Missing tile set for {name}/{base}')
                        edge('Map.nx', f'Tile/{tile_set}.img/{value_at(reader, base + "/u")}/{value_at(reader, base + "/no")}',
                             'map tile', visual=True)
                    else:
                        fields = [value_at(reader, base + '/' + p) for p in ('oS', 'l0', 'l1', 'l2')]
                        if any(v is None for v in fields):
                            raise NXError(f'Incomplete object reference {base}: {fields}')
                        edge('Map.nx', f'Obj/{fields[0]}.img/' + '/'.join(map(str, fields[1:])),
                             'map object', visual=True)
        life = reader.resolve(path + '/life')
        for child, _ in reader.children(life).items() if life is not None else ():
            base = path + '/life/' + child
            kind = value_at(reader, base + '/type')
            number = value_at(reader, base + '/id')
            if kind not in ('n', 'm') or number is None:
                raise NXError(f'Invalid map life reference {base}')
            edge('Npc.nx' if kind == 'n' else 'Mob.nx', f'{int(number):07d}.img', 'map life', visual=True)
    if name in ('Npc.nx', 'Mob.nx', 'Reactor.nx') and path.endswith('.img'):
        link = get('info/link')
        if link:
            edge(name, f'{int(link):07d}.img', 'entity info/link', visual=True)
    if name == 'Character.nx' and path.endswith('.img'):
        link = get('info/link')
        if link:
            parent, _, filename = path.rpartition('/')
            width = len(filename.removesuffix('.img'))
            edge(name, f'{parent}/{int(link):0{width}d}.img', 'character sibling info/link', visual=True)
    if name == 'Mob.nx' and path.endswith('.img'):
        revive = reader.resolve(path + '/revive')
        for _, child in reader.children(revive).items() if revive is not None else ():
            edge('Mob.nx', f'{int(reader.value(child)):07d}.img', 'mob revive', visual=True)
    if name == 'Item.nx':
        morph = get('spec/morph', 0)
        if morph:
            edge('Morph.nx', f'{int(morph):04d}.img', 'item morph', visual=True)
        if len(path.split('/')) == 3:
            edge('Item.nx', path + '/info/icon', 'inventory icon', visual=True, kind=5)
            edge('Item.nx', path + '/info/iconRaw', 'inventory raw icon', visual=True, kind=5)
    return result


def coverage(corpus, targets, requirements, world_ids):
    requests = {}
    world_catalog = []
    for (name, path), spec in targets.items():
        if spec['action'] == 'replace':
            requests[(name, path)] = {'file': name, 'path': path,
                                      'visual': media_required(name, path), 'reason': 'exact target'}
    for entry in requirements:
        key = (entry['file'], entry['path'])
        requests.setdefault(key, {**entry, 'visual': entry.get('type') == 'canvas', 'reason': 'native world requirement'})
    # Server facts are an independent inventory input, not authorization to widen
    # the merge. Text-only refs remain recorded facts, not invented item paths.
    for category, name in (('maps', 'Map.nx'), ('mobs', 'Mob.nx'), ('npcs', 'Npc.nx'), ('reactors', 'Reactor.nx')):
        for number in world_ids.get(category, []):
            number = int(number)
            path = f'Map/Map{number // 100000000}/{number:09d}.img' if category == 'maps' else f'{number:07d}.img'
            requests.setdefault((name, path), {'file': name, 'path': path, 'visual': category != 'maps', 'reason': 'server world ID'})
            world_catalog.append({'category': category, 'id': number, 'file': name, 'path': path})
    for number in world_ids.get('items', []):
        number = int(number)
        if number in world_ids.get('text_only_items', []):
            world_catalog.append({'category': 'items', 'id': number, 'status': 'text-only-reference'})
            continue
        groups = {2: 'Consume', 3: 'Install', 4: 'Etc', 5: 'Cash'}
        if number // 1000000 not in groups:
            raise NXError(f'Unmapped world item category: {number}')
        path = f'{groups[number // 1000000]}/{number // 10000:04d}.img/{number:08d}'
        requests.setdefault(('Item.nx', path), {'file': 'Item.nx', 'path': path, 'visual': True, 'reason': 'server world item'})
        world_catalog.append({'category': 'items', 'id': number, 'file': 'Item.nx', 'path': path})
    queue = deque(requests.values())
    entries, edges = [], []
    while queue:
        request = queue.popleft()
        name, path = request['file'], request['path']
        entry = corpus.inspect(name, path, request.get('visual', False))
        entry['reason'] = request.get('reason')
        reader = corpus.get(name)
        index = reader.resolve(path) if reader else None
        expected = request.get('kind', {'canvas': 5, 'property': 0}.get(request.get('type')))
        if index is not None and expected is not None and reader.record(index)[3] != expected:
            entry['status'] = 'wrong-node-type'
        if index is not None and request.get('dimensions') and reader.record(index)[3] == 5:
            if list(reader.value(index)[1:]) != request['dimensions']:
                entry['status'] = 'wrong-canvas-dimensions'
        # Linked entity roots can legitimately own no local canvases; linked
        # artwork is inspected separately and must succeed in the same closure.
        outgoing = dependencies(corpus, name, path)
        if entry['status'] == 'missing-visible-art' and any(e['reason'] == 'entity info/link' for e in outgoing):
            entry['status'] = 'present-linked-art'
        entries.append(entry)
        for edge in outgoing:
            edges.append(edge)
            key = (edge['file'], edge['path'])
            if key not in requests:
                requests[key] = edge
                queue.append(edge)
    indexed = {(entry['file'], entry['path']): entry for entry in entries}
    adjacency = {}
    for edge in edges:
        adjacency.setdefault(edge['from'], []).append(edge)

    def linked_visual(key, seen):
        if key in seen:
            return False
        seen = seen | {key}
        entry = indexed[key]
        if entry.get('visible_canvases', 0):
            return True
        return any(linked_visual((edge['file'], edge['path']), seen)
                   for edge in adjacency.get('/'.join(key), [])
                   if edge['reason'] == 'entity info/link')

    for key, entry in indexed.items():
        if entry['status'] == 'present-linked-art' and not linked_visual(key, set()):
            entry['status'] = 'missing-linked-art'
    missing = [{k: e[k] for k in ('file', 'path', 'status', 'reason', 'error') if k in e}
               for e in entries if e['status'] not in ('present', 'present-linked-art')]
    statuses = {(entry['file'], entry['path']): entry['status'] for entry in entries}
    for entry in world_catalog:
        if 'file' in entry:
            entry['status'] = statuses[(entry['file'], entry['path'])]
            root = (entry['file'], entry['path'])
            related = {key for key in indexed if key[0] == root[0] and
                       (key[1] == root[1] or key[1].startswith(root[1] + '/'))}
            pending = list(related)
            while pending:
                key = pending.pop()
                for edge in adjacency.get('/'.join(key), []):
                    dependency = (edge['file'], edge['path'])
                    if dependency not in related:
                        related.add(dependency)
                        pending.append(dependency)
            gaps = [key for key in sorted(related)
                    if indexed[key]['status'] not in ('present', 'present-linked-art')]
            entry['supported'] = not gaps
            entry['missing_nodes_or_dependencies'] = [
                {'file': key[0], 'path': key[1], 'status': indexed[key]['status']} for key in gaps]
    return {'entries': entries, 'dependencies': edges, 'missing': missing,
            'counts': dict(Counter(e['status'] for e in entries)), 'complete': not missing,
            'server_world_ids': world_ids,
            'world_id_coverage': world_catalog,
            'entry_visibility_policy': world_ids.get('entry_visibility_policy',
                'Do not spawn/warp browser clients into unsupported art; gate entry/visibility with a clear message. Keep stock-world paths unchanged.'),
            'browser_native_ui_parity': False}


def preserve_proof(before, after, trie):
    """Compare every untargeted node/value/payload and forbid unrelated additions."""
    digest = hashlib.sha256()
    count = added_ancestors = 0

    def visit(left, right, branch, path):
        nonlocal count, added_ancestors
        if TERMINAL in branch:
            return
        if left is None:
            if right is None:
                return
            if not branch or after.record(right)[3] != 0:
                raise NXError(f'Unauthorized new node/value: {path}')
            added_ancestors += 1
        else:
            if right is None or before.semantic_value(left) != after.semantic_value(right):
                raise NXError(f'Untargeted value/payload changed: {path}')
            encoded = path.encode('utf-8')
            digest.update(struct.pack('<I', len(encoded)))
            digest.update(encoded)
            digest.update(before.semantic_value(left))
            count += 1
        old = before.children(left) if left is not None else {}
        new = after.children(right) if right is not None else {}
        for name in sorted(old.keys() | new.keys(), key=lambda s: s.encode('utf-8')):
            visit(old.get(name), new.get(name), branch.get(name, {}), (path + '/' + name).lstrip('/'))

    if before.name(0) != after.name(0):
        raise NXError('Untargeted root name changed')
    visit(0, 0, trie, '')
    return {'all_untargeted_nodes_equal': True, 'nodes_compared': count,
            'baseline_semantic_sha256': digest.hexdigest(), 'candidate_semantic_sha256': digest.hexdigest(),
            'new_structural_ancestors': added_ancestors,
            'payload_comparison': 'Exact original compressed bitmap/audio bytes + dimensions/length; string UTF-8 and scalar bits'}


def merge_file(baseline, donor, trie, destination):
    """Append immutable original media, then rebuild tables without recompression."""
    baseline.validate_graph()
    donor.validate_graph()
    shutil.copyfile(baseline.path, destination)
    string_offsets = [baseline.table_offset('string', i) for i in range(baseline.string_count)]
    bitmap_offsets = [baseline.table_offset('bitmap', i) for i in range(baseline.bitmap_count)]
    audio_offsets = [baseline.table_offset('audio', i) for i in range(baseline.audio_count)]
    strings, bitmaps, audios = {}, {}, {}
    names = {}
    queue = deque([(baseline, 0, trie, baseline.name(0))])
    next_index = 1
    node_count = 0

    with Path(destination).open('r+b') as output, tempfile.TemporaryFile() as records:
        output.seek(0, 2)

        def new_string(raw):
            if raw not in names:
                if len(raw) > 65535:
                    raise NXError('NX UTF-8 string exceeds uint16 length')
                names[raw] = len(string_offsets)
                string_offsets.append(output.tell())
                output.write(struct.pack('<H', len(raw)))
                output.write(raw)
            return names[raw]

        def string_id(source, number):
            if source is baseline:
                return number
            if number not in strings:
                strings[number] = new_string(source.string(number))
            return strings[number]

        while queue:
            source, index, branch, name = queue.popleft()
            if index is None:
                if not branch:
                    raise NXError(f'Empty unapproved structural ancestor {name}')
                name_id, kind, data = new_string(name.encode('utf-8')), 0, b'\0' * 8
                children = {}
            else:
                name_id, _, _, kind, data = source.record(index)
                name_id = string_id(source, name_id)
                children = {n: (source, i, {}, n) for n, i in source.children(index).items()}
            for child_name, child_branch in branch.items():
                if child_name == TERMINAL:
                    raise NXError('Internal overlapping target branch')
                terminal = child_branch.get(TERMINAL)
                if terminal:
                    donor_index = donor.resolve(terminal['path'])
                    if terminal['action'] == 'remove':
                        if donor_index is not None:
                            raise NXError(f'Removed target still present in donor: {terminal["path"]}')
                        children.pop(child_name, None)
                    else:
                        if donor_index is None:
                            raise NXError(f'Missing genuine donor target: {terminal["path"]}')
                        children[child_name] = (donor, donor_index, {}, child_name)
                else:
                    existing = children.get(child_name)
                    children[child_name] = (existing[0], existing[1], child_branch, child_name) if existing else (baseline, None, child_branch, child_name)
            ordered = [children[n] for n in sorted(children, key=lambda s: s.encode('utf-8'))]
            if len(ordered) > 65535:
                raise NXError('NX child count exceeds uint16')
            if source is donor and index is not None:
                number = U32.unpack_from(data)[0]
                if kind == 3:
                    data = U32.pack(string_id(source, number)) + data[4:]
                elif kind in (5, 6):
                    offsets, remap = (bitmap_offsets, bitmaps) if kind == 5 else (audio_offsets, audios)
                    start, length = source.payload(index)
                    key = (number, length)
                    if key not in remap:
                        remap[key] = len(offsets)
                        offsets.append(output.tell())
                        output.write(memoryview(source.data)[start:start + length])
                    data = U32.pack(remap[key]) + data[4:]
            records.write(NODE.pack(name_id, next_index if ordered else 0, len(ordered), kind, data))
            next_index += len(ordered)
            queue.extend(ordered)
            node_count += 1
        if node_count != next_index or node_count > 0xFFFFFFFF:
            raise NXError('Inconsistent NX tree/index count')
        output.write(b'\0' * (-output.tell() % 16))
        node_offset = output.tell()
        records.seek(0)
        shutil.copyfileobj(records, output)
        offsets = []
        for table in (string_offsets, bitmap_offsets, audio_offsets):
            output.write(b'\0' * (-output.tell() % 8))
            offsets.append(output.tell())
            for offset in table:
                output.write(U64.pack(offset))
        output.seek(0)
        output.write(HEADER.pack(0x34474B50, node_count, node_offset, len(string_offsets), offsets[0],
                                 len(bitmap_offsets), offsets[1], len(audio_offsets), offsets[2]))
    return {'nodes': node_count, 'donor_strings_added': len(names),
            'donor_bitmaps_added': len(bitmaps), 'donor_audio_added': len(audios),
            'baseline_original_payload_region_retained': True,
            'baseline_original_size': baseline.size}


def corpus_files(root):
    root = Path(root)
    files = sorted(root.glob('*.nx'))
    if not files or any(p.is_symlink() or not p.is_file() for p in files):
        raise NXError(f'Expected regular deployed NX corpus at {root}')
    if len({p.name.casefold() for p in files}) != len(files):
        raise NXError('Ambiguous case-colliding NX filenames')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--donor', type=Path)
    parser.add_argument('--contract', type=Path, action='append', required=True)
    parser.add_argument('--world-ids', type=Path, help='Independent server world-visible ID facts JSON')
    parser.add_argument('--baseline-manifest', type=Path, help='Observed deployed manifest with files:[name,size,sha256]')
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.inventory_only and not args.donor:
        parser.error('--donor is required for a merge')
    output = args.output.resolve()
    inputs = [args.baseline.resolve()] + ([args.donor.resolve()] if args.donor else [])
    if any(output == source or output.is_relative_to(source) or source.is_relative_to(output) for source in inputs):
        parser.error('Output and source directories must be disjoint')
    if output.exists() and any(output.iterdir()):
        parser.error('Output must be empty')
    output.mkdir(parents=True, exist_ok=True)
    targets, requirements, contracts = load_contracts(args.contract)
    world = json.loads(args.world_ids.read_text()) if args.world_ids else {}
    files = corpus_files(args.baseline)
    missing_archives = sorted(RUNTIME_ARCHIVES - {path.name for path in files})
    if missing_archives:
        raise NXError(f'Incomplete deployed runtime corpus: {missing_archives}')
    rollback = {'schema_version': 1, 'source': str(args.baseline.resolve()),
                'captured_at': datetime.now(timezone.utc).isoformat(),
                'files': [file_identity(path) for path in files],
                'rollback_policy': 'Restore this entire original corpus as a unit; do not mix baseline and candidate files.',
                'production_writes_performed': False}
    if args.baseline_manifest:
        observed = json.loads(args.baseline_manifest.read_text())
        expected = {f['name']: (f['size'], f['sha256']) for f in observed['files']}
        actual = {f['name']: (f['size'], f['sha256']) for f in rollback['files']}
        if expected != actual:
            raise NXError('Local baseline differs from actual deployed corpus manifest')
        rollback['deployment_observation'] = observed
    save(output / 'rollback-manifest.json', rollback)
    save(output / 'exact-targets.json', {'contracts': contracts,
        'targets': [{'file': f, 'path': p, **s} for (f, p), s in targets.items()]})
    with ExitStack() as stack:
        baseline = Corpus(args.baseline, stack)
        baseline_coverage = coverage(baseline, targets, requirements, world)
        save(output / 'baseline-coverage.json', baseline_coverage)
        if args.inventory_only:
            print(json.dumps({'inventory': str(output), 'counts': baseline_coverage['counts'],
                              'missing': len(baseline_coverage['missing']), 'production_writes': False}))
            return
        donor = Corpus(args.donor, stack)
        donor_files = [file_identity(p) for p in corpus_files(args.donor)]
        native_manifest = args.donor / 'donor-manifest.json'
        if not native_manifest.is_file():
            raise NXError('Genuine pinned converter donor-manifest.json is required')
        donor_provenance = file_identity(native_manifest)
        donor_manifest = json.loads(native_manifest.read_text())
        if not donor_manifest.get('build', {}).get('commit'):
            raise NXError('Donor manifest has no pinned converter source commit')
        native_root = Path(donor_manifest['native'])
        donor_actual = {f['name']: f for f in donor_files}
        for archive, record in donor_manifest['archives'].items():
            actual = donor_actual.get(archive + '.nx')
            expected = record['output']
            if actual is None or any(actual[k] != expected[k] for k in ('size', 'sha256')):
                raise NXError(f'Donor bytes differ from pinned converter manifest: {archive}')
            native = file_identity(native_root / (archive + '.wz'))
            if any(native[k] != record['input'][k] for k in ('size', 'sha256')):
                raise NXError(f'Donor is stale against final native input: {archive}')
        undeclared = set(donor_actual) - {a + '.nx' for a in donor_manifest['archives']}
        if undeclared:
            raise NXError(f'Unprovenanced donor NX archives: {sorted(undeclared)}')
        absent = sorted(set(f for f, _ in targets) - {p.name for p in files})
        if absent:
            raise NXError(f'Cannot add entire NX archives without a deployed counterpart: {absent}')
        candidate = output / 'corpus'
        candidate.mkdir()
        proof = {}
        for path in files:
            name = path.name
            destination = candidate / name
            trie = trie_for(targets, name)
            if not trie:
                shutil.copyfile(path, destination)
                identity = file_identity(destination)
                original = next(f for f in rollback['files'] if f['name'] == name)
                if (identity['sha256'], identity['size']) != (original['sha256'], original['size']):
                    raise NXError(f'Untargeted archive bytes changed: {name}')
                proof[name] = {'whole_file_byte_identical': True}
                continue
            before, source = baseline.get(name), donor.get(name)
            if source is None:
                raise NXError(f'Missing genuine donor archive {name}')
            for (file, node), spec in targets.items():
                if file != name:
                    continue
                branch = trie
                for part in node.split('/'):
                    branch = branch[part]
                branch[TERMINAL]['path'] = node
            written = merge_file(before, source, trie, destination)
            after = NX(destination)
            stack.callback(after.close)
            non_target = preserve_proof(before, after, trie)
            target_proof = []
            for (file, node), spec in targets.items():
                if file != name:
                    continue
                old, new = source.resolve(node), after.resolve(node)
                if spec['action'] == 'remove':
                    if old is not None or new is not None:
                        raise NXError(f'Removed target remains: {name}/{node}')
                    target_proof.append({'path': node, 'removed': True})
                else:
                    if old is None or new is None:
                        raise NXError(f'Missing donor/candidate target: {name}/{node}')
                    source_hash, target_hash = source.semantic_hash(old), after.semantic_hash(new)
                    if source_hash != target_hash:
                        raise NXError(f'Donor-to-candidate semantic mismatch: {name}/{node}')
                    target_proof.append({'path': node, 'donor': source_hash, 'candidate': target_hash, 'equal': True})
            proof[name] = {'writer': written, 'preservation': non_target, 'targets': target_proof}
        result = coverage(Corpus(candidate, stack), targets, requirements, world)
        save(output / 'candidate-coverage.json', result)
        save(output / 'semantic-preservation.json', proof)
        manifest = {'schema_version': 1, 'status': 'complete-candidate' if result['complete'] else 'blocked-incomplete-coverage',
                    'files': [], 'baseline': rollback, 'donor_files': donor_files,
                    'donor_provenance': donor_provenance, 'contracts': contracts,
                    'builder_sources': [file_identity(Path(__file__)), file_identity(Path(__file__).with_name('nx_format.py'))],
                    'production_writes_performed': False, 'browser_native_ui_parity': False}
        for path in sorted(candidate.glob('*.nx')):
            original = next(f for f in rollback['files'] if f['name'] == path.name)
            manifest['files'].append({**file_identity(path), 'baseline_sha256': original['sha256'],
                'source': 'deployed baseline + exact approved genuine donor nodes' if trie_for(targets, path.name) else 'deployed baseline byte-identical'})
        save(output / 'provenance-manifest.json', manifest)
        if not result['complete']:
            raise NXError(f'Candidate NOT publishable: {len(result["missing"])} missing/invalid world nodes; see candidate-coverage.json')
        print(json.dumps({'candidate': str(candidate), 'manifest': str(output / 'provenance-manifest.json'),
                          'coverage': result['counts'], 'production_writes': False}))


if __name__ == '__main__':
    try:
        main()
    except (NXError, OSError, UnicodeError, KeyError, ValueError) as error:
        raise SystemExit(f'NX release refused: {error}')
