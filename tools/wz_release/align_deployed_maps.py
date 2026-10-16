#!/usr/bin/env python3
"""Align newly imported accepted maps to the actual deployed physics/life metadata.

This produces exact-node operations, not blanket server/client WZ replacement.
Only images proven absent in pinned native stock may be aligned this way. Native
art stays from the documented donor. Existing deployed geometry and life win.
"""
import argparse
import json
from pathlib import Path
from build_release import digest
from native_wz import Archive
from merge_server_xml import parse_server_xml

ROOTS=('info','foothold','ladderRope','portal','life','reactor','seat')


def spec(element):
    kind=element.tag
    if kind=='imgdir':kind='property';value=None
    elif kind in ('int','long','short'):value=int(element.get('value'))
    elif kind in ('float','double'):value=float(element.get('value'))
    elif kind in ('string','uol'):value=element.get('value')
    elif kind=='vector':value=[int(element.get('x')),int(element.get('y'))]
    elif kind=='null':value=None
    else:raise ValueError(f'Non-metadata element {element.tag} in owned map root')
    return {'name':element.get('name'),'type':kind,'value':value,'children':[spec(c) for c in element]}


def requirements(node,image,prefix=''):
    path='/'.join(filter(None,(prefix,node['name'])))
    result=[{'wz':'Map.wz','image':image,'node':path,'type':node['type']}]
    if node['type']!='property':result[0]['value']=node['value']
    for child in node['children']:result.extend(requirements(child,image,path))
    return result


def align(stock,native,inputs,maps,output):
    inputs=Path(inputs);operations=[];required=[];sources=[]
    with Archive(Path(stock)/'Map.wz') as baseline,Archive(Path(native)/'Map.wz') as candidate:
        for id in maps:
            image=f'Map/Map{id//100000000}/{id:09d}.img'
            try:baseline.entry(image)
            except KeyError:pass
            else:raise ValueError(f'Cannot align legacy stock map {id}')
            donor=candidate.image(image)
            source=inputs/'deployed-xml'/'Map.wz'/(image+'.xml')
            root,controls=parse_server_xml(source)
            record={'path':source.relative_to(inputs).as_posix(),'sha256':digest(source),'normalization':controls}
            sources.append(record);children={c.get('name'):c for c in root}
            for name in ROOTS:
                if name in children:
                    node=spec(children[name])
                    operations.append({'op':'set_subtree','target_wz':'Map.wz','target_image':image,'target_node':name,
                        'node':node,'source_provenance':record})
                    required.extend(requirements(node,image))
                elif donor.child(name) is not None:
                    operations.append({'op':'remove_node','target_wz':'Map.wz','target_image':image,'target_node':name,
                        'source_provenance':record})
    result={'schema_version':1,'purpose':'New native map imports: preserve actual deployed info/physics/portals/life, not differing modern donor metadata',
        'sources':sources,'operations':operations,'requirements':required}
    Path(output).write_text(json.dumps(result,indent=2)+'\n');return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--stock',required=True);p.add_argument('--native',required=True)
    p.add_argument('--inputs',required=True);p.add_argument('--map',type=int,action='append',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();r=align(a.stock,a.native,a.inputs,a.map,a.output)
    print(json.dumps({'operations':len(r['operations']),'requirements':len(r['requirements']),'sources':r['sources']}))
