#!/usr/bin/env python3
"""Prepare an isolated exact-node XML overlay without replacing deployed custom siblings.

Existing full-image imports are additive only: deployed scalar values win and
conflicts are reported, never silently overwritten. Explicit exact-node operations
retain their contract ownership. This script never installs or uploads anything.
"""
import argparse
import copy
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse_server_xml(path):
    text=Path(path).read_text(encoding='utf-8')
    controls=Counter(f'U+{ord(c):04X}' for c in re.findall(r'[\x00-\x08\x0B\x0C\x0E-\x1F]',text))
    # Match the actual server provider, not a permissive recovery parser:
    # server/src/main/java/provider/wz/XMLDomMapleData.java:54-56.
    sanitized=re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F]','',text)
    try:return ET.fromstring(sanitized),dict(controls)
    except ET.ParseError as error:raise ValueError(f'Malformed XML after server-equivalent sanitation: {path}: {error}') from error


def children(node):
    # Legacy XML convex/extended arrays can repeat a name. Preserve each ordered
    # entry; an exact contract must not ambiguously address one by the bare name.
    counts=Counter(child.get('name') for child in node);seen=Counter();out={}
    for child in node:
        name=child.get('name')
        if name is None:raise ValueError(f'Unnamed XML child in {node.tag} {node.attrib}')
        index=seen[name];seen[name]+=1
        key=name if counts[name]==1 else f'{name}[{index}]'
        out[key]=child
    return out


def get(root,path,create=False):
    for part in path.split('/') if path else []:
        match=children(root).get(part)
        if match is None:
            if not create:raise KeyError(path)
            match=ET.SubElement(root,'imgdir',{'name':part})
        root=match
    return root


def flat(root,prefix=''):
    result={}
    for name,node in children(root).items():
        path='/'.join(filter(None,(prefix,name)))
        result[path]=[node.tag,dict(node.attrib),node.text.strip() if node.text and node.text.strip() else '']
        result.update(flat(node,path))
    return result


def additive(target,source,conflicts,path=''):
    if target.tag!=source.tag or target.attrib!=source.attrib:
        conflicts.append({'path':path,'deployed':[target.tag,dict(target.attrib)],'candidate':[source.tag,dict(source.attrib)]})
    existing=children(target)
    for name,child in children(source).items():
        p='/'.join(filter(None,(path,name)))
        if name in existing:additive(existing[name],child,conflicts,p)
        else:target.append(copy.deepcopy(child))


def replace(root,path,source):
    parent_path,_,name=path.rpartition('/')
    parent=get(root,parent_path,True);old=children(parent).get(name)
    replacement=copy.deepcopy(get(source,path))
    if old is None:parent.append(replacement)
    else:
        index=list(parent).index(old);parent.remove(old);parent.insert(index,replacement)


def merge(baseline,candidate,contracts,output):
    baseline,candidate,output=map(Path,(baseline,candidate,output))
    if output.exists() and any(output.iterdir()):raise ValueError('Merged XML destination must be empty')
    output.mkdir(parents=True,exist_ok=True)
    groups={};omissions={}
    for file in contracts:
        contract=json.loads(Path(file).read_text())
        for op in contract['operations']:groups.setdefault((op['target_wz'],op['target_image']),[]).append(op)
        for spec in contract.get('server_omit_nodes',[]):
            omissions.setdefault((spec['wz'],spec['image']),[]).extend(spec['nodes'])
    files=[]
    for (archive,image),ops in groups.items():
        relative=Path(archive)/(image+'.xml');original=baseline/relative;native=candidate/relative
        source,source_controls=parse_server_xml(native)
        if original.exists():root,original_controls=parse_server_xml(original)
        else:root,original_controls=ET.Element('imgdir',{'name':source.get('name')}),{}
        before=flat(root);allowed=[];conflicts=[]
        def omitted(path):return any(path==n or path.startswith(n+'/') for n in omissions.get((archive,image),[]))
        for op in ops:
            kind=op['op']
            if kind=='import_image':
                # Do not flatten imported map/mob/quest data over deployed custom content.
                additive(root,source,conflicts)
                continue
            paths=([s['path'] for s in op['properties']] if kind=='set_properties' else [op['target_node']])
            for path in paths:
                if omitted(path):continue
                allowed.append(path)
                if kind=='remove_node':
                    parent,_,name=path.rpartition('/');p=get(root,parent);old=children(p).get(name)
                    if old is not None:p.remove(old)
                else:replace(root,path,source)
        after=flat(root)
        def owned(path):return any(path==p or path.startswith(p+'/') for p in allowed)
        preserved={p:v for p,v in before.items() if not owned(p)}
        for path,value in preserved.items():
            if after.get(path)!=value:raise ValueError(f'Deployed non-target change {relative}/{path}')
        target=output/relative;target.parent.mkdir(parents=True,exist_ok=True)
        ET.indent(root,space='  ');ET.ElementTree(root).write(target,encoding='UTF-8',xml_declaration=True)
        if flat(ET.parse(target).getroot())!=after:raise ValueError(f'XML serialization changed {relative}')
        files.append({'path':relative.as_posix(),'baseline_sha256':digest(original) if original.exists() else None,
            'candidate_source_sha256':digest(native),'merged_sha256':digest(target),'size':target.stat().st_size,
            'server_equivalent_control_normalization':{'baseline':original_controls,'candidate':source_controls},
            'explicit_targets':allowed,'original_non_target_nodes_preserved':len(preserved),
            'original_non_target_semantic_sha256':hashlib.sha256(json.dumps(preserved,sort_keys=True).encode()).hexdigest(),
            'deployed_conflicts_retained':conflicts})
    result={'status':'pass','policy':'Preserve every deployed original node outside explicitly owned subtree; full-image imports additive only; no install performed',
        'baseline_snapshot':json.loads((baseline/'snapshot-provenance.json').read_text()),'files':files}
    (output/'merge-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline',required=True);p.add_argument('--candidate',required=True)
    p.add_argument('--contract',action='append',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();r=merge(a.baseline,a.candidate,a.contract,a.output)
    print(json.dumps({'status':r['status'],'files':len(r['files']),'preserved_nodes':sum(f['original_non_target_nodes_preserved'] for f in r['files']),
        'retained_conflicts':sum(len(f['deployed_conflicts_retained']) for f in r['files'])}))
