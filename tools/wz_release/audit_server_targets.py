#!/usr/bin/env python3
"""Read-only precondition audit for authored portal/life/script server XML deltas."""
import argparse
import hashlib
import json
from pathlib import Path
from merge_server_xml import parse_server_xml,get,flat


def signature(node):
    return hashlib.sha256(json.dumps([node.tag,node.attrib,flat(node)],sort_keys=True).encode()).hexdigest()


def audit(baseline,merged,contracts,output):
    baseline,merged,output=map(Path,(baseline,merged,output))
    if output.exists():raise ValueError('Do not overwrite authored-target audit')
    result=[]
    for contract in contracts:
        for delta in json.loads(Path(contract).read_text()).get('integration_deltas',[]):
            relative=Path(delta['target_wz'])/(delta['target_image']+'.xml')
            beforefile=baseline/relative;afterroot=parse_server_xml(merged/relative)[0]
            try:before=get(parse_server_xml(beforefile)[0],delta['target_path']) if beforefile.exists() else None
            except KeyError:before=None
            after=get(afterroot,delta['target_path'])
            operation=delta['operation'];reason=''
            if operation=='add-node':
                valid=before is None or signature(before)==signature(after)
                reason='actual deployed target absent' if before is None else 'already identical' if valid else 'COLLISION: existing deployed node differs'
            elif operation=='replace-value':
                expected=delta['precondition']
                valid=before is None and not beforefile.exists() or before is not None and before.tag==expected['type'] and before.get('value') in (str(expected['value']),str(delta['value']))
                reason='new image; no existing deployed value overwritten' if before is None and not beforefile.exists() else 'expected existing value or already identical' if valid else 'COLLISION: existing deployed value differs from approved precondition'
            else:raise ValueError('Unknown authored delta operation')
            fields=lambda node:None if node is None else {'tag':node.tag,'attributes':node.attrib,
                'direct_scalar_children':{c.get('name'):c.get('value') for c in node if 'value' in c.attrib}}
            result.append({'id':delta['id'],'path':relative.as_posix(),'target':delta['target_path'],
                'precondition_pass':valid,'reason':reason,'actual_deployed_before':fields(before),'approved_after':fields(after),
                'before_semantic_sha256':signature(before) if before is not None else None,'after_semantic_sha256':signature(after)})
    report={'status':'pass' if all(r['precondition_pass'] for r in result) else 'refused','authored_deltas':result,
        'production_writes':False,'scope':'No inferred authority to overwrite deployed custom portals/life/script values'}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline',required=True);p.add_argument('--merged',required=True)
    p.add_argument('--contract',action='append',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();r=audit(a.baseline,a.merged,a.contract,a.output)
    print(json.dumps({'status':r['status'],'deltas':len(r['authored_deltas']),'collisions':[r['id'] for r in r['authored_deltas'] if not r['precondition_pass']]}))
    raise SystemExit(0 if r['status']=='pass' else 2)
