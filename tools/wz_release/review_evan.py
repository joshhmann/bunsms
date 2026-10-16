#!/usr/bin/env python3
"""Read-only Evan XML merge review; writes evidence only, never merges assets."""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def nodes(root,prefix=''):
    out={}
    for child in root:
        path='/'.join(filter(None,(prefix,child.get('name',''))))
        out[path]={'tag':child.tag,'attributes':{k:v for k,v in child.attrib.items() if k!='basedata'}}
        out.update(nodes(child,path))
    return out


def review(archive,xml_root,manifest):
    archive,xml_root,manifest=map(Path,(archive,xml_root,manifest))
    result={'scope':'Ticket4 REVIEW + playable prerequisites only. No Evan assets merged; no class implementation.',
        'archive':str(archive),'archive_sha256':sha(archive.read_bytes()),
        'source_lineage':'User-provided Evan.zip; XML contains embedded basedata PNG. No upstream owner/revision metadata supplied; no guessed repository attribution.',
        'reference_xml_root':str(xml_root),'reference_xml_version':(xml_root/'.version').read_text().strip() if (xml_root/'.version').exists() else None,
        'server_base_commit':'b8bfc931d5c62524ff6168d66c7076747fa23f34','files':[]}
    with zipfile.ZipFile(archive) as z:
        for info in sorted(z.infolist(),key=lambda i:i.filename):
            if not info.filename.endswith('.img.xml'):continue
            relative=info.filename.removeprefix('Evan/')
            category,tail=relative.split('/',1)
            target_relative=category+'.wz/'+tail
            source=z.read(info);sroot=ET.fromstring(source);sn=nodes(sroot)
            target=xml_root/target_relative
            if target.exists():
                original=target.read_bytes();troot=ET.fromstring(original);tn=nodes(troot)
                verdict='DO-NOT-WHOLESALE-MERGE' if category in ('UI','String') else 'COLLISION-NODE-REVIEW'
            else:
                original=None;troot=None;tn={};verdict='SAFE-ADD-REVIEW-ONLY'
            row={'source_member':info.filename,'source_sha256':sha(source),'source_bytes':len(source),
                'target':target_relative,'target_exists':original is not None,
                'reference_xml_sha256':sha(original) if original is not None else None,'verdict':verdict,
                'source_top_nodes':[n.get('name') for n in sroot],
                'reference_top_nodes':[n.get('name') for n in troot] if troot is not None else [],
                'source_only_paths':sorted(sn.keys()-tn.keys()),'reference_only_paths':sorted(tn.keys()-sn.keys()),
                'shared_metadata_changed':[p for p in sorted(sn.keys()&tn.keys()) if sn[p]!=tn[p]],
                'source_basedata_canvases':sum(1 for e in sroot.iter('canvas') if e.get('basedata')),
                'skill_ids':[n.get('name') for group in sroot if group.get('name')=='skill' for n in group]}
            if category=='Skill' and tail.startswith('Dragon/'):
                row['warning']='Animation states, not skill books. Keep Skill/Dragon hierarchy; flattening into Skill overwrites same-numbered real skill books.'
            if category=='Character' and tail.startswith('Dragon/') and original is not None:
                row['warning']='Keep server level/info/exp data; source icon art does not establish that the existing growth data is unused.'
            if category in ('UI','String'):
                row['warning']='Exact node additions only; preserve every reference-only node and existing custom feature subtree. No blanket replacement.'
            result['files'].append(row)
    counts={}
    for row in result['files']:counts[row['verdict']]=counts.get(row['verdict'],0)+1
    result['counts']=counts
    manifest.parent.mkdir(parents=True,exist_ok=True)
    manifest.write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',required=True);p.add_argument('--xml-root',required=True);p.add_argument('--manifest',required=True)
    a=p.parse_args();r=review(a.archive,a.xml_root,a.manifest)
    print(json.dumps({'archive_sha256':r['archive_sha256'],'file_count':len(r['files']),'verdicts':r['counts']}))
