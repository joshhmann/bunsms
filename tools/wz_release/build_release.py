#!/usr/bin/env python3
"""Build candidate native WZ + server XML overlay, enforcing exact-node preservation.

Inputs: pinned complete stock directory, feature/boss operation JSON, and isolated
raw sources. Outputs never overwrite baseline or live WZ. Any failed merge,
unsupported format or changed untargeted node aborts before publication.
"""
from __future__ import annotations
import argparse
import copy
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import shutil
import struct
import xml.etree.ElementTree as ET
from native_wz import Archive, FormatError, Node, parse_img, write_img, semantic, semantic_hash, pixels


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def ensure(root, path):
    node = root
    for part in path.split('/') if path else []:
        child = node.child(part)
        if child is None:
            child = Node(part, 'property')
            node.children.append(child)
        if child.kind != 'property':
            raise FormatError(f'Expected property parent: {path}')
        node = child
    return node


def flatten(root, prefix=''):
    result = {}
    for child in root.children:
        path = '/'.join(filter(None, (prefix, child.name)))
        v = copy.copy(child)
        v.children = []
        result[path] = semantic(v)
        result.update(flatten(child, path))
    return result


def compare_outside(before, after, targets):
    left, right = flatten(before), flatten(after)
    def affected(path):
        return any(path == p or path.startswith(p + '/') for p in targets)
    untouched = {k: v for k, v in left.items() if not affected(k)}
    for path, value in untouched.items():
        if right.get(path) != value:
            raise FormatError(f'Non-target semantic change: {path}')
    # New structural ancestors are expected only when creating an authorized subtree.
    for path in right.keys() - left.keys():
        if not affected(path) and not any(p.startswith(path + '/') for p in targets):
            raise FormatError(f'Non-target property added: {path}')
    return {'untouched_nodes': len(untouched), 'untouched_semantic_sha256': hashlib.sha256(
        json.dumps(untouched, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def export_xml(root, target):
    def element(node, img=False):
        kind = 'imgdir' if img or node.kind in ('property', 'convex') else {
            'null': 'null', 'int': 'int', 'long': 'long', 'short': 'short',
            'float': 'float', 'double': 'double', 'string': 'string', 'uol': 'uol',
            'vector': 'vector', 'canvas': 'canvas', 'sound': 'sound'}[node.kind]
        attr = {'name': node.name}
        if node.kind == 'vector':
            attr.update(x=str(node.value[0]), y=str(node.value[1]))
        elif node.kind == 'canvas':
            attr.update(width=str(node.value['width']), height=str(node.value['height']))
        elif node.kind in ('int', 'long', 'short', 'string', 'uol'):
            attr['value'] = str(node.value)
        elif node.kind in ('float', 'double'):
            attr['value'] = str(struct.unpack('<f' if node.kind == 'float' else '<d', node.value)[0])
        elem = ET.Element(kind, attr)
        for child in node.children:
            elem.append(element(child))
        return elem
    target.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.ElementTree(element(root, True))
    ET.indent(tree, space='  ')
    tree.write(target, encoding='UTF-8', xml_declaration=True)


def node_from_spec(spec):
    kind, value = spec['type'], spec.get('value')
    if kind in ('float', 'double'):
        value = struct.pack('<f' if kind == 'float' else '<d', value)
    return Node(spec['name'], kind, value,
                [node_from_spec(c) for c in spec.get('children', [])])




def build(baseline, inputs, output, contracts):
    baseline, inputs, output = map(Path, (baseline, inputs, output))
    if output.exists() and any(output.iterdir()):
        raise ValueError('Candidate output must be empty; no implicit overwrite')
    if baseline.resolve() == output.resolve() or baseline.resolve() in output.resolve().parents:
        raise ValueError('Output must be separate from baseline')
    output.mkdir(parents=True, exist_ok=True)
    native = output / 'native'
    native.mkdir()
    operations, requirements, contract_sources, server_omissions = [], [], [], {}
    known_source_gaps = {}
    for path in contracts:
        path = Path(path)
        contract = json.loads(path.read_text())
        operations += contract.get('operations', [])
        requirements += contract.get('requirements', [])
        for gap in contract.get('known_source_gaps', []):
            if gap.get('classification') not in ('MISSING', 'UNCONSUMED') or not gap.get('evidence'):
                raise ValueError('Source gap needs explicit classification and consumer/source evidence')
            known_source_gaps[(gap['wz'], gap['image'], gap.get('node', ''))] = gap
        for omission in contract.get('server_omit_nodes', []):
            server_omissions.setdefault((omission['wz'], omission['image']), []).extend(omission['nodes'])
        contract_sources.append(dict(path=str(path),sha256=digest(path)))
    grouped, image_imports, duplicate_imports = {}, {}, []
    fragments, duplicate_fragments = set(), []
    for op in operations:
        if op['op'] == 'import_image':
            target = (op['target_wz'], op['target_image'])
            source = (baseline / op.get('source_archive', op['target_wz'])
                      if op.get('source_wz') == 'stock' else inputs / op['source'])
            donor = (digest(source), op.get('source_image', op['target_image']), op.get('source_key'))
            if target in image_imports:
                if image_imports[target] != donor:
                    raise FormatError(f'Conflicting whole-image donors: {target}')
                duplicate_imports.append(op)
                continue
            image_imports[target] = donor
        elif op['op'] == 'set_subtree':
            # Shared family lobbies repeat the same deployed metadata alignment.
            # Applying it twice would erase a source NPC added between those copies.
            fragment = (op['target_wz'], op['target_image'], op['target_node'],
                        semantic_hash(node_from_spec(op['node'])))
            if fragment in fragments:
                duplicate_fragments.append(op)
                continue
            fragments.add(fragment)
        grouped.setdefault(op['target_wz'], []).append(op)
    report = {'contracts':contract_sources, 'archives': [], 'requirements': [], 'sources': [],
              'identical_imports_coalesced': duplicate_imports,
              'identical_subtrees_coalesced': duplicate_fragments}
    # Build one archive at a time; original unmodified image bytes are copied directly.
    for wzname, ops in grouped.items():
        with Archive(baseline / wzname) as wz:
            roots, originals, targets, imports = {}, {}, {}, set()
            original_hashes = {p: hashlib.sha256(wz.raw(e)).hexdigest() for p,e in wz.images()}
            operation_reports = []
            for op in ops:
                image_path = op['target_image']
                if image_path not in roots:
                    try:
                        original = wz.image(image_path)
                        originals[image_path] = copy.deepcopy(original)
                        roots[image_path] = original
                    except KeyError:
                        originals[image_path] = None
                        roots[image_path] = Node(image_path, 'property')
                    targets[image_path] = []
                root = roots[image_path]
                action = op['op']
                if action in ('copy_subtree', 'import_image'):
                    if op.get('source_wz') == 'stock':
                        with Archive(baseline / op.get('source_archive', wzname)) as source_archive:
                            source_root = source_archive.image(op.get('source_image', image_path))
                        source_ref = {'path': str(baseline / op.get('source_archive', wzname)),
                                      'sha256': digest(baseline / op.get('source_archive', wzname))}
                    else:
                        source_path = inputs / op['source']
                        source_ref = {'path':str(source_path),'sha256':digest(source_path)}
                        if source_path.suffix.lower() == '.wz':
                            with Archive(source_path, key=op.get('source_key', 'gms')) as src:
                                source_root = src.image(op.get('source_image', image_path))
                        else:
                            source_root = parse_img(source_path.read_bytes(), image_path, op.get('source_key'))[0]
                    report['sources'].append(source_ref)
                    if action == 'import_image':
                        if originals[image_path] is not None or targets[image_path]:
                            if semantic_hash(root) != semantic_hash(source_root):
                                raise FormatError(f'Refusing whole-image collision {wzname}/{image_path}')
                        roots[image_path] = source_root
                        roots[image_path].name = image_path
                        imports.add(image_path)
                        targets[image_path] = ['']
                    else:
                        target_path = op['target_node']
                        ensure(root, '/'.join(target_path.split('/')[:-1]))
                        selected = copy.deepcopy(source_root.get(op['source_node']))
                        if op.get('pixels_only'):
                            current = root.get(target_path)
                            link_names = ('_outlink', '_inlink', 'source')
                            links = [n.value for n in current.children if n.name in link_names and n.kind == 'string']
                            if current.kind != 'canvas' or selected.kind != 'canvas' or links != [op.get('expected_link')]:
                                raise FormatError(f'Canvas materialization link/type precondition differs: {target_path}')
                            if any(n.name in link_names and n.kind == 'string' for n in selected.children):
                                raise FormatError(f'Canvas materialization donor is itself unresolved: {target_path}')
                            metadata = [copy.deepcopy(n) for n in current.children if not (n.name in link_names and n.kind == 'string')]
                            selected = Node(current.name, 'canvas', selected.value, metadata)
                            source_ref['canvas_materialization'] = {
                                'target': target_path, 'expected_link': op['expected_link'],
                                'source_pixel_sha256': hashlib.sha256(pixels(selected)).hexdigest(),
                                'target_metadata_sha256': semantic_hash(Node(current.name, 'property', children=metadata)),
                                'origin_delay_z_preserved': True}
                        root.put(target_path, selected, replace=True)
                        targets[image_path].append(target_path)
                elif action == 'set_properties':
                    for spec in op['properties']:
                        path = spec['path']
                        ensure(root, '/'.join(path.split('/')[:-1]))
                        root.put(path, Node(path.split('/')[-1], spec['type'], spec['value']), replace=True)
                        targets[image_path].append(path)
                elif action == 'set_subtree':
                    path = op['target_node']
                    ensure(root, '/'.join(path.split('/')[:-1]))
                    root.put(path, node_from_spec(op['node']), replace=True)
                    targets[image_path].append(path)
                elif action == 'remove_node':
                    path = op['target_node']
                    parent = root.get('/'.join(path.split('/')[:-1]))
                    existing = parent.get(path.split('/')[-1])
                    parent.children.remove(existing)
                    targets[image_path].append(path)
                else:
                    raise FormatError(f'Unknown merge operation {action}')
                operation_reports.append(op)
            image_reports = []
            for path, root in roots.items():
                before = originals[path]
                preserved = compare_outside(before, root, targets[path]) if before and path not in imports else None
                blob = write_img(root, wz.key)
                reparsed = parse_img(blob, path, wz.key)[0]
                if semantic_hash(root) != semantic_hash(reparsed):
                    raise FormatError(f'IMG serialization semantic mismatch {path}')
                wz.put_image(path, blob, replace=before is not None)
                image_reports.append(dict(path=path,allowed_targets=targets[path],preservation=preserved,
                    semantic_sha256=semantic_hash(reparsed),sha256=hashlib.sha256(blob).hexdigest()))
                server_root = copy.deepcopy(reparsed)
                for omitted in server_omissions.get((wzname, path), []):
                    parts = omitted.split('/')
                    parent = server_root.get('/'.join(parts[:-1]))
                    child = parent.child(parts[-1])
                    if child is not None:
                        parent.children.remove(child)
                export_xml(server_root, output / 'server-wz-overlay' / wzname / (path + '.xml'))
            wz.save(native / wzname)
        # Re-open complete saved container, not just in-memory image fragments.
        with Archive(native / wzname) as rebuilt:
            observed_paths = {p for p,e in rebuilt.images()}
            if not set(original_hashes).issubset(observed_paths):
                raise FormatError(f'Original IMG dropped from {wzname}')
            untouched_count = 0
            for path, expected in original_hashes.items():
                if path not in roots:
                    if hashlib.sha256(rebuilt.raw(rebuilt.entry(path))).hexdigest() != expected:
                        raise FormatError(f'Non-target IMG byte change {wzname}/{path}')
                    untouched_count += 1
            for image_report in image_reports:
                root = rebuilt.image(image_report['path'])
                if semantic_hash(root) != image_report['semantic_sha256']:
                    raise FormatError(f'Complete WZ reparse mismatch {wzname}/{image_report["path"]}')
                for _, node in walk(root):
                    if node.kind == 'canvas':
                        raw = pixels(node)
                        if not raw:
                            raise FormatError('Empty canvas pixels')
            report['archives'].append(dict(name=wzname,baseline_sha256=digest(baseline / wzname),
                output_sha256=digest(native / wzname),untouched_images_byte_identical=untouched_count,
                images=image_reports,operations=operation_reports))
    # Carry the full stock install/runtime corpus, including Sound/TamingMob + support DLLs.
    for source in sorted(baseline.rglob('*')):
        if source.is_file():
            target = native / source.relative_to(baseline)
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    report['source_asset_dispositions'] = []
    with ExitStack() as stack:
        archives, image_cache = {}, {}
        for req in requirements:
            name = req['wz']
            if name not in archives:
                archives[name] = stack.enter_context(Archive(native / name))
            image_key = (name, req['image'])
            try:
                if image_key not in image_cache:
                    image_cache[image_key] = archives[name].image(req['image'])
                node = image_cache[image_key].get(req.get('node', ''))
            except KeyError as error:
                gap = known_source_gaps.get((name, req['image'], req.get('node', '')))
                if gap is None:
                    raise FormatError(f'Missing required native node: {req}') from error
                if gap not in report['source_asset_dispositions']:
                    report['source_asset_dispositions'].append(gap)
                continue
            if req.get('type') and node.kind != req['type']:
                raise FormatError(f'Requirement type mismatch: {req}')
            if req.get('dimensions') and [node.value['width'],node.value['height']] != req['dimensions']:
                raise FormatError(f'Requirement dimensions mismatch: {req}')
            if 'value' in req:
                expected = node_from_spec({'name': node.name, 'type': node.kind, 'value': req['value']})
                if semantic_hash(node) != semantic_hash(expected):
                    raise FormatError(f'Requirement exact value mismatch: {req}')
            report['requirements'].append(dict(requirement=req,semantic_sha256=semantic_hash(node)))
    files = [dict(name=p.relative_to(native).as_posix(),sha256=digest(p),size=p.stat().st_size,
        source=('exact-node merged; see build-evidence.json' if p.name in grouped else 'pinned GMS v83 installer'),
        baseline_sha256=digest(baseline / p.relative_to(native))) for p in sorted(native.rglob('*')) if p.is_file()]
    report['status'] = ('candidate-with-source-gaps' if any(
        gap['classification'] == 'MISSING' for gap in report['source_asset_dispositions']) else 'complete-candidate')
    report['tool_sources'] = [dict(name=p.name,sha256=digest(p)) for p in sorted(Path(__file__).parent.glob('*.py'))]
    (output / 'build-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
    (output / 'provenance-manifest.json').write_text(json.dumps({
        'status': report['status'], 'source_asset_dispositions': report['source_asset_dispositions'],
        'files': files}, indent=2)+'\n')
    return report


def walk(root, prefix=''):
    for child in root.children:
        path = '/'.join(filter(None,(prefix,child.name)))
        yield path, child
        yield from walk(child,path)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline',required=True)
    p.add_argument('--inputs',required=True)
    p.add_argument('--output',required=True)
    p.add_argument('--contract',required=True,action='append')
    a = p.parse_args()
    result = build(a.baseline,a.inputs,a.output,a.contract)
    print(json.dumps({'status': result['status'], 'archives': len(result['archives']),
                      'source_asset_dispositions': len(result['source_asset_dispositions'])}))
    raise SystemExit(2 if result['status'] == 'candidate-with-source-gaps' else 0)
