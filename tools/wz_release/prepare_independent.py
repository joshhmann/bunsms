#!/usr/bin/env python3
"""Pin immutable candidate URLs/hashes and exact-node requests for independent MapleLib CI."""
import argparse
import csv
import json
from pathlib import Path
from build_release import digest
from verify_content import item_path,item_name_path


def prepare(native,contracts,catalog,base_url,output):
    native=Path(native);requirements=[];images=set();archives=set()
    for file in contracts:
        c=json.loads(Path(file).read_text())
        for op in c.get('operations',[]):
            images.add(op['target_wz']+'/'+op['target_image'])
            archives.add(op['target_wz'])
        for r in c.get('requirements',[]):
            q={'path':r['wz']+'/'+r['image']+('/'+r['node'] if r.get('node') else '')}
            q.update({k:r[k] for k in ('dimensions','type') if k in r});requirements.append(q)
            archives.add(r['wz'])
        requirements.extend({'path':r['path'],'type':r['type']} for r in c.get('stock_requirements',[]))
    with Path(catalog).open(encoding='utf-8-sig',newline='') as f:
        for row in csv.reader((s for s in f if s.strip() and not s.lstrip().startswith('#')),delimiter='\t'):
            id=int(row[0]);requirements.extend([{'path':item_path(id),'type':'canvas'},
                {'path':item_name_path(id),'type':'string'}])
    for req in requirements:
        archive=req['path'].split('/')[0]
        archives.add(archive if archive.endswith('.wz') else archive+'.wz')
    request={'reader_repository':'https://github.com/lastbattle/MapleLib',
        'reader_commit':'93099ab42c3225272432c3da8942024153a5ffab',
        'candidate_base_url':base_url,'files':[dict(name=n,size=(native/n).stat().st_size,
            sha256=digest(native/n),url=base_url.rstrip('/')+'/'+n) for n in sorted(archives)],
        'decode_images':sorted(images),'requirements':requirements,
        'policy':'Independent established C# reader; decode every canvas/audio leaf in each touched image, plus every catalog icon/name and runtime-required node. No Python writer code runs on verifier.'}
    Path(output).write_text(json.dumps(request,indent=2)+'\n')
    return request


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native',required=True);p.add_argument('--contract',action='append',required=True)
    p.add_argument('--catalog',required=True);p.add_argument('--base-url',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();r=prepare(a.native,a.contract,a.catalog,a.base_url,a.output)
    print(json.dumps({'files':len(r['files']),'images':len(r['decode_images']),'requirements':len(r['requirements'])}))
