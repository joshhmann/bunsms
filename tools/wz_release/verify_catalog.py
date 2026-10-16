#!/usr/bin/env python3
"""Check every real packaged cash catalog row against native WZ, server XML and NX.

No prices/persistence claim: those are server lifecycle tests. Native UI support
is separate. Missing item data, names, or visible icons are concrete release gaps.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
from contextlib import ExitStack
from build_release import digest
from merge_server_xml import parse_server_xml,get
from native_wz import pixels
from nx_format import NX,file_identity
from verify_content import Corpus,item_path,item_name_path


def split(path):
    archive,tail=path.split('/',1)
    image,node=tail.split('.img/',1)
    return archive.removesuffix('.wz'),image+'.img',node


def verify(catalog,native,xml,nx,output,native_report=None,inventory=False):
    catalog,native,xml,nx,output=map(Path,(catalog,native,xml,nx,output))
    if output.exists():raise ValueError('Do not overwrite existing catalog evidence')
    with catalog.open(encoding='utf-8-sig',newline='') as f:
        rows=[r for r in csv.reader((s for s in f if s.strip() and not s.lstrip().startswith('#')),delimiter='\t')]
    if not rows:raise ValueError('Packaged cash catalog is EMPTY')
    if any(not r[0].isdigit() for r in rows):raise ValueError('Expected actual headerless catalog item-ID rows')
    independent={};native_files={}
    if native_report:
        evidence=json.loads(Path(native_report).read_text())
        if evidence['status']!='pass':raise ValueError('Native independent reader proof failed')
        for entry in evidence['canvases_decoded']:
            archive,tail=entry['path'].split('/',1)
            independent[archive.removesuffix('.wz')+'/'+tail]=entry
        native_files={e['name']:e for e in evidence['files']}
    elif not inventory:raise ValueError('Release gate needs independent native canvas evidence')
    xml_manifest=json.loads((xml/'server-corpus-provenance.json').read_text())
    xml_files={e['name']:e for e in xml_manifest['files']};xml_cache={};nx_cache={};checked_files=set()
    nx_manifest_path=nx/'provenance-manifest.json'
    if nx_manifest_path.exists():
        nx_manifest=json.loads(nx_manifest_path.read_text())
        if nx_manifest['status']!='complete-candidate':raise ValueError('NX candidate is not complete')
        nx=nx/'corpus'
        for entry in nx_manifest['files']:
            actual=file_identity(nx/entry['name'])
            if any(actual[k]!=entry[k] for k in ('size','sha256')):raise ValueError('Final NX cohort hash drift')
    elif not inventory:raise ValueError('Release gate requires final complete NX candidate provenance')
    report={'status':'inventory' if inventory else 'pass','catalog':file_identity(catalog),'catalog_rows':len(rows),
        'unique_item_ids':len({int(r[0]) for r in rows}),'items':[],'gaps':[],
        'native_independent_report':file_identity(native_report) if native_report else None,
        'scope':'Exact catalog dependency closure only; no Community bulk import; prices/delivery/persistence tested by server owner'}
    corpus=Corpus(native)
    with ExitStack() as stack:
        stack.callback(corpus.close)
        def xml_node(path):
            archive,image,node=split(path);relative=archive+'.wz/'+image+'.xml'
            if relative not in xml_cache:
                file=xml/relative
                expected=xml_files.get(relative)
                if not expected or digest(file)!=expected['sha256']:raise ValueError('Server XML corpus drift: '+relative)
                xml_cache[relative]=parse_server_xml(file)[0]
            return get(xml_cache[relative],node)
        def nx_node(path):
            archive,image,node=split(path)
            if archive not in nx_cache:
                reader=NX(nx/(archive+'.nx'));stack.callback(reader.close);nx_cache[archive]=reader
            reader=nx_cache[archive];relative=image+'/'+node;index=reader.resolve(relative)
            if index is None:raise KeyError(archive+'.nx/'+relative)
            return reader,index
        for line,row in enumerate(rows,1):
            id=int(row[0]);icon=item_path(id);name=item_name_path(id);info=icon.rsplit('/icon',1)[0]
            record={'row':line,'item_id':id,'catalog_row':row,'icon_path':icon,'info_path':info,'name_path':name,'checks':{}}
            def check(label,operation):
                try:record['checks'][label]=operation()
                except (KeyError,ValueError,FileNotFoundError) as error:
                    gap={'row':line,'item_id':id,'check':label,'error':str(error)}
                    report['gaps'].append(gap);record['checks'][label]={'status':'missing-or-invalid','error':str(error)}
            def native_icon():
                archive,_,_=split(icon);filename=archive+'.wz'
                if filename not in checked_files:
                    actual=file_identity(native/filename)
                    if native_report and (filename not in native_files or any(actual[k]!=native_files[filename][k] for k in ('size','sha256'))):
                        raise ValueError('Final native archive differs from independent proof: '+filename)
                    checked_files.add(filename)
                node=corpus.resolve(icon)
                raw=pixels(node)
                if not raw or not any(raw):raise ValueError('Blank native icon payload')
                evidence=independent.get(icon)
                if native_report and (not evidence or not evidence.get('visible')):raise ValueError('Missing/nonvisible independently decoded native icon')
                return {'status':'present','dimensions':[node.value['width'],node.value['height']],
                    'native_format_payload_sha256':hashlib.sha256(raw).hexdigest(),'independent_bgra_sha256':evidence.get('decoded_bgra_sha256') if evidence else None}
            def native_info():
                node=corpus.resolve(info)
                if node.kind!='property' or not node.children:raise ValueError('Native item info absent')
                return {'status':'present','fields':len(node.children)}
            def native_name():
                node=corpus.resolve(name)
                if node.kind!='string' or not node.value.strip():raise ValueError('Native item name absent')
                return {'status':'present','value':node.value}
            def server_info():
                node=xml_node(info)
                if node.tag!='imgdir' or not len(node):raise ValueError('Server item info absent')
                fields={c.get('name'):c.get('value') for c in node if c.get('name') in ('cash','slotMax','price','quest','only')}
                return {'status':'present','fields':fields}
            def server_name():
                node=xml_node(name);text=node.get('value','')
                if node.tag!='string' or not text.strip():raise ValueError('Server item name absent')
                return {'status':'present','value':text}
            def browser_icon():
                reader,index=nx_node(icon)
                if reader.record(index)[3]!=5:raise ValueError('Browser item icon not a bitmap')
                canvas=reader.canvas(index)
                if not canvas['visible']:raise ValueError('Browser icon has no visible pixels')
                return {'status':'present',**canvas}
            def browser_info():
                reader,index=nx_node(info)
                if not reader.record(index)[2]:raise ValueError('Browser item info empty')
                return {'status':'present','fields':reader.record(index)[2]}
            def browser_name():
                reader,index=nx_node(name);value=reader.value(index)
                if reader.record(index)[3]!=3 or not value.strip():raise ValueError('Browser item name absent')
                return {'status':'present','value':value}
            for label,operation in (('native_icon',native_icon),('native_info',native_info),('native_name',native_name),
                ('server_info',server_info),('server_name',server_name),('nx_icon',browser_icon),('nx_info',browser_info),('nx_name',browser_name)):
                check(label,operation)
            report['items'].append(record)
    report['gap_counts']=dict(Counter(g['check'] for g in report['gaps']))
    if report['gaps']:report['status']='gaps'
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n');return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--catalog',required=True);p.add_argument('--native',required=True)
    p.add_argument('--server-xml',required=True);p.add_argument('--nx',required=True);p.add_argument('--output',required=True)
    p.add_argument('--native-report');p.add_argument('--inventory-only',action='store_true')
    a=p.parse_args();r=verify(a.catalog,a.native,a.server_xml,a.nx,a.output,a.native_report,a.inventory_only)
    print(json.dumps({'status':r['status'],'catalog_rows':r['catalog_rows'],'unique_item_ids':r['unique_item_ids'],'gaps':len(r['gaps']),'gap_counts':r['gap_counts']}))
    raise SystemExit(2 if r['gaps'] else 0)
