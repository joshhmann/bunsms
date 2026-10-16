#!/usr/bin/env python3
"""Compile the unmodified browser nlnx reader and independently consume a candidate.

The C++ adapter parses no NX records itself. The established runtime emits actual
scalar/decoded-media bytes; Python compares their SHA256s to strict inspection.
Optional MapleLib BGRA evidence additionally checks native-to-browser art parity
for every independently decoded authorized target canvas (not unrelated stock).
"""
import argparse
from collections import Counter
import ctypes.util
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from nx_format import NX, file_identity


def expected(reader,index):
    _,_,count,kind,data=reader.record(index);width=height=0
    if kind==0:payload=b''
    elif kind in (1,2,4):payload=data
    elif kind==3:payload=reader.string(struct.unpack_from('<I',data)[0])
    elif kind==5:
        canvas=reader.canvas(index);width,height=canvas['width'],canvas['height']
        return kind,count,width,height,width*height*4,canvas['bgra_sha256']
    elif kind==6:
        offset,length=reader.payload(index);payload=memoryview(reader.data)[offset:offset+length]
    else:raise ValueError(f'Unknown strict NX type {kind}')
    return kind,count,width,height,len(payload),hashlib.sha256(payload).hexdigest()


def read_payload(stream,length):
    digest=hashlib.sha256()
    while length:
        data=stream.read(min(length,1024*1024))
        if not data:raise ValueError('Runtime ended before its framed payload')
        digest.update(data);length-=len(data)
    if stream.read(1)!=b'\n':raise ValueError('Runtime framing delimiter differs')
    return digest.hexdigest()


def verify(candidate,runtime,build,output,native_report=None,lz4_include=None):
    candidate,runtime,build,output=map(Path,(candidate,runtime,build,output))
    if output.exists():raise ValueError('Do not overwrite existing independent evidence')
    if build.exists() and any(build.iterdir()):raise ValueError('Independent build destination must be empty')
    build.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((candidate/'provenance-manifest.json').read_text())
    if manifest['status']!='complete-candidate':raise ValueError('NX candidate is not complete')
    corpus=candidate/'corpus';targets=json.loads((candidate/'exact-targets.json').read_text())['targets']
    coverage=json.loads((candidate/'candidate-coverage.json').read_text())
    native={}
    if native_report:
        proof=json.loads(Path(native_report).read_text())
        if proof['status']!='pass':raise ValueError('Independent native report did not pass')
        native={v['path']:v for v in proof['canvases_decoded']}
    requests={f['name']:{''} for f in manifest['files']}
    for entry in coverage['entries']:
        if entry['status'] in ('present','present-linked-art'):requests.setdefault(entry['file'],set()).add(entry['path'])
    roots={}
    for entry in targets:
        if entry['action']=='replace':roots.setdefault(entry['file'],[]).append(entry['path'])
    source_files=[runtime/name for name in ('file.cpp','node.cpp','bitmap.cpp','audio.cpp')]
    source_records=[file_identity(p) for p in sorted(runtime.glob('*.cpp'))+sorted(runtime.glob('*.hpp'))]
    adapter=Path(__file__).with_name('nx_runtime_probe.cpp');binary=build/'nx-runtime-probe'
    library=ctypes.util.find_library('lz4')
    if not library:raise ValueError('Actual browser runtime requires installed liblz4; no automatic install')
    includes=['-I',str(runtime.parent)]
    if lz4_include:
        include=Path(lz4_include)
        source_records.append(file_identity(include/'lz4.h'));includes+=['-I',str(include)]
    command=['g++','-std=c++17','-O2',*includes,str(adapter),*[str(p) for p in source_files],'-l:'+library,'-o',str(binary)]
    subprocess.run(command,check=True)
    compiler=subprocess.check_output(['g++','--version'],text=True).splitlines()[0]
    results=[];counts=Counter();native_checked=0
    for record in manifest['files']:
        name=record['name'];path=corpus/name
        actual=file_identity(path)
        if any(actual[k]!=record[k] for k in ('sha256','size')):raise ValueError(f'Candidate hash drift: {name}')
        with ExitStack() as stack:
            reader=NX(path);stack.callback(reader.close)
            for root in roots.get(name,[]):
                index=reader.resolve(root)
                if index is None:raise ValueError(f'Missing exact target {name}/{root}')
                for relative,_ in reader.walk(index):requests[name].add('/'.join(p for p in (root,relative) if p))
            paths=sorted(requests[name])
            if any('\n' in p or '\r' in p or '\t' in p for p in paths):raise ValueError('Ambiguous runtime request path')
            request=build/(name+'.paths.txt');request.write_text(''.join(p+'\n' for p in paths))
            process=subprocess.Popen([str(binary),str(path),str(request)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            summary=Counter();stream_hash=hashlib.sha256()
            try:
                for ordinal,nodepath in enumerate(paths):
                    header=process.stdout.readline()
                    if not header:raise ValueError(f'Runtime stopped at {name}/{nodepath}')
                    fields=tuple(map(int,header.decode('ascii').rstrip('\n').split('\t')))
                    if len(fields)!=6 or fields[0]!=ordinal:raise ValueError(f'Bad runtime record framing: {header!r}')
                    index=reader.resolve(nodepath);wanted=expected(reader,index)
                    if fields[1:]!=wanted[:5]:raise ValueError(f'Runtime scalar/type/dimensions differ at {name}/{nodepath}: {fields[1:]} vs {wanted[:5]}')
                    sha=read_payload(process.stdout,fields[-1])
                    if sha!=wanted[-1]:raise ValueError(f'Runtime decoded payload differs at {name}/{nodepath}')
                    stream_hash.update(nodepath.encode()+b'\x00'+bytes.fromhex(sha))
                    summary[str(fields[1])]+=1
                    if fields[1]==5 and any(nodepath==p or nodepath.startswith(p+'/') for p in roots.get(name,[])):
                        key=name.removesuffix('.nx')+'.wz/'+nodepath
                        if native_report:
                            original=native.get(key)
                            if not original or 'decoded_bgra_sha256' not in original:raise ValueError(f'No independent MapleLib target-canvas BGRA proof: {key}')
                            if sha!=original['decoded_bgra_sha256']:raise ValueError(f'Native/browser decoded art differs: {key}')
                            native_checked+=1
                if process.stdout.read(1):raise ValueError(f'Unexpected extra runtime bytes: {name}')
                stderr=process.stderr.read().decode(errors='replace')
                if process.wait()!=0:raise ValueError(f'Runtime failed for {name}: {stderr}')
            except BaseException:
                process.kill();process.wait()
                raise
            counts.update(summary);results.append({'name':name,'sha256':record['sha256'],'runtime_nodes':len(paths),
                'types':dict(summary),'decoded_semantic_stream_sha256':stream_hash.hexdigest(),'stderr':stderr})
    result={'status':'pass','reader':'Actual unmodified browser maplestory-wasm nlnx C++ sources',
        'source_files':source_records,'adapter':file_identity(adapter),'binary':file_identity(binary),'compiler':compiler,'build_command':command,
        'files':results,'counts':dict(counts),'native_target_canvases_compared':native_checked,
        'native_independent_report':file_identity(native_report) if native_report else None,
        'writer_executed_in_cpp_probe':False,'production_writes':False}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n');return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidate',required=True);p.add_argument('--runtime-source',required=True)
    p.add_argument('--build-dir',required=True);p.add_argument('--output',required=True);p.add_argument('--native-report')
    p.add_argument('--lz4-include',help='Pinned converter-vendored LZ4 header directory when system development headers are absent')
    a=p.parse_args();r=verify(a.candidate,a.runtime_source,a.build_dir,a.output,a.native_report,a.lz4_include)
    print(json.dumps({'status':r['status'],'archives':len(r['files']),'counts':r['counts'],'native_target_canvases_compared':r['native_target_canvases_compared']}))
