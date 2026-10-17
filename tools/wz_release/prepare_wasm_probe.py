#!/usr/bin/env python3
"""Prepare offline browser proof using the actual production WASM code section.

Only additional exports of existing compiled functions are added to a QA copy.
The actual nl::nx::add_file -> public nl::file -> LazyFS reader is invoked;
no private file handle, second NX decoder, replacement art or production I/O.
Serve the isolated output with an existing HTTP Range server, open probe.html,
and retain window.nxWasmProof as the receipt. Preparation is NOT a passing test.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from nx_format import NX, file_identity


def leb(data, offset):
    value = shift = 0
    while True:
        byte = data[offset]; offset += 1
        value |= (byte & 127) << shift
        if byte < 128: return value, offset
        shift += 7
        if shift > 35: raise ValueError('Invalid WASM uint32 LEB')


def encoded(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128); value >>= 7
    result.append(value)
    return bytes(result)


def sections(data):
    if data[:8] != b'\0asm\x01\0\0\0': raise ValueError('Not WASM v1')
    offset = 8
    while offset < len(data):
        kind = data[offset]; start = offset; offset += 1
        size, offset = leb(data, offset)
        end = offset + size
        if end > len(data): raise ValueError('Truncated WASM section')
        yield kind, data[offset:end], data[start:end]
        offset = end


def prepare(candidate, wasm, glue, symbols, native_report, output):
    candidate, wasm, glue, symbols, native_report, output = map(Path, (candidate, wasm, glue, symbols, native_report, output))
    if output.exists() and any(output.iterdir()): raise ValueError('QA output must be empty')
    manifest = json.loads((candidate / 'provenance-manifest.json').read_text())
    if manifest['status'] != 'complete-candidate': raise ValueError('Incomplete NX cohort')
    native = json.loads(native_report.read_text())
    if native['status'] != 'pass': raise ValueError('Independent native proof did not pass')
    native_pixels = {row['path']:row['decoded_bgra_sha256'] for row in native['canvases_decoded']}
    table = [(int(line.split(':',1)[0]), line.split(':',1)[1]) for line in symbols.read_text().splitlines()]
    predicates = {
        'qa_add_file': lambda s:s.startswith('nl::nx::add_file('),
        'qa_child': lambda s:s == 'nl::node::get_child(char const*, unsigned short) const',
        'qa_bitmap': lambda s:s == 'nl::node::operator nl::bitmap() const',
        'qa_pixels': lambda s:s == 'nl::bitmap::data() const',
        'qa_width': lambda s:s == 'nl::bitmap::width() const',
        'qa_height': lambda s:s == 'nl::bitmap::height() const',
        'qa_type': lambda s:s == 'nl::node::data_type() const',
        'qa_string': lambda s:'std::__2::operator+<' not in s and 'std::__2::operator+' in s and s.startswith('std::__2::basic_string<char,') and s.endswith(' const&, char const*)'),
    }
    aliases = {}
    for alias, predicate in predicates.items():
        matches = [(index,name) for index,name in table if predicate(name)]
        if len(matches) != 1: raise ValueError(f'Ambiguous/missing existing symbol {alias}: {matches}')
        aliases[alias] = matches[0]
    original = wasm.read_bytes(); rewritten = bytearray(original[:8]); changed = 0
    for kind, body, raw in sections(original):
        if kind != 7: rewritten.extend(raw); continue
        count, start = leb(body,0); extra = bytearray()
        for alias,(index,_) in aliases.items():
            name = alias.encode(); extra.extend(encoded(len(name)) + name + b'\0' + encoded(index))
        body = encoded(count + len(aliases)) + body[start:] + extra
        rewritten.extend(b'\x07' + encoded(len(body)) + body); changed += 1
    if changed != 1: raise ValueError('Expected exactly one production export section')
    original_sections = [(kind,hashlib.sha256(body).hexdigest()) for kind,body,_ in sections(original) if kind != 7]
    rewritten_sections = [(kind,hashlib.sha256(body).hexdigest()) for kind,body,_ in sections(rewritten) if kind != 7]
    if original_sections != rewritten_sections: raise ValueError('QA altered non-export production bytes')
    output.mkdir(parents=True,exist_ok=True)
    (output/'reader.wasm').write_bytes(rewritten); shutil.copyfile(glue,output/'reader.js')
    (output/'assets').mkdir()
    records = {row['name']:row for row in manifest['files']}
    roots = {}
    for row in json.loads((candidate/'exact-targets.json').read_text())['targets']:
        if row['action']=='replace': roots.setdefault(row['file'],[]).append(row['path'])
    requests = []
    for name,record in records.items():
        source = candidate/'corpus'/name
        observed = file_identity(source)
        if any(observed[k]!=record[k] for k in ('size','sha256')): raise ValueError(f'NX drift: {name}')
        (output/'assets'/name).symlink_to(source.resolve())
        with_source = NX(source)
        try:
            selected = {}
            for root in roots.get(name,[]):
                index = with_source.resolve(root)
                if index is None: raise ValueError(f'Missing genuine target {name}/{root}')
                for relative,child in with_source.walk(index):
                    if with_source.record(child)[3]!=5: continue
                    path = '/'.join(p for p in (root,relative) if p)
                    key = name.removesuffix('.nx')+'.wz/'+path
                    canvas = with_source.canvas(child)
                    if native_pixels.get(key)!=canvas['bgra_sha256']: raise ValueError(f'No independent native pixel match: {key}')
                    selected[path] = {'path':path,'width':canvas['width'],'height':canvas['height'],'sha256':canvas['bgra_sha256']}
            requests.append({'file':name,'canvases':list(selected.values())})
        finally: with_source.close()
    (output/'requests.json').write_text(json.dumps(requests)+'\n')
    (output/'probe.html').write_text(HTML)
    receipt = {'status':'prepared-not-exercised','production_wasm':file_identity(wasm),'production_glue':file_identity(glue),
        'symbol_map':file_identity(symbols),'diagnostic_wasm':file_identity(output/'reader.wasm'),
        'non_export_sections_identical':True,'sections':original_sections,'existing_compiled_exports':aliases,
        'native_report':file_identity(native_report),'nx_cohort':manifest['files'],'target_canvases':sum(len(row['canvases']) for row in requests),
        'production_writes':False,'scope':'Real compiled WASM + real nl::file/LazyFS; no render/UI acceptance implied'}
    (output/'preparation.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


HTML = '''<!doctype html><meta charset="utf-8"><title>Independent actual WASM NX reader proof</title><pre id="status">Initializing actual production module, main disabled…</pre><canvas id="canvas"></canvas>
<script>
window.nxWasmProof={status:'running',canvases:0,files:[],productionWrites:false};
window.Module={noInitialRun:true,canvas:document.getElementById('canvas'),print:console.log,printErr:console.error,
 locateFile:(name)=>name.endsWith('.wasm')?'reader.wasm':name,
 instantiateWasm:(imports,receive)=>{WebAssembly.instantiateStreaming(fetch('reader.wasm'),imports).then(value=>{window.qaRaw=value.instance.exports;receive(value.instance,value.module);}).catch(fail);return{};},
 onRuntimeInitialized:()=>{runProof().catch(fail);}};
function fail(error){window.nxWasmProof.status='failed';window.nxWasmProof.error=String(error?.stack||error);document.getElementById('status').textContent=JSON.stringify(window.nxWasmProof,null,2);console.error(error);}
async function runProof(){
 Module.LazyFS.NxBaseUrl=location.origin+'/assets';
 const api=Asyncify.instrumentWasmExports(window.qaRaw), memory=()=>new Uint8Array(window.qaRaw.memory.buffer);
 async function call(name,...args){const result=api[name](...args);return Asyncify.currData?await Asyncify.whenDone():result;}
 function alloc(n){const p=api.malloc(n);if(!p)throw Error('Actual WASM allocation refused');memory().fill(0,p,p+n);return p;}
 const empty=alloc(32), string=alloc(32), chars=alloc(1024), root=alloc(16), left=alloc(16), right=alloc(16), bitmap=alloc(32);
 const encoder=new TextEncoder();
 function cstring(s){const bytes=encoder.encode(s);if(bytes.length>=1024)throw Error('Probe path component too long');memory().set(bytes,chars);memory()[chars+bytes.length]=0;return bytes.length;}
 const requests=await(await fetch('requests.json')).json();
 for(const file of requests){
  cstring(file.file);await call('qa_string',string,empty,chars);await call('qa_add_file',root,string);
  let checked=0;
  for(const target of file.canvases){
   memory().copyWithin(left,root,root+8);let current=left,next=right;
   for(const part of target.path.split('/')){const len=cstring(part);await call('qa_child',next,current,chars,len);[current,next]=[next,current];}
   if(await call('qa_type',current)!==5)throw Error('Actual WASM canvas missing '+file.file+'/'+target.path);
   await call('qa_bitmap',bitmap,current);
   const width=await call('qa_width',bitmap),height=await call('qa_height',bitmap);
   if(width!==target.width||height!==target.height)throw Error('Actual WASM dimensions differ '+target.path);
   const pointer=await call('qa_pixels',bitmap);if(!pointer)throw Error('Actual WASM present canvas returned null '+target.path);
   const bytes=memory().slice(pointer,pointer+width*height*4);
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(sha!==target.sha256)throw Error('Actual WASM BGRA differs '+file.file+'/'+target.path+': '+sha);
   checked++;window.nxWasmProof.canvases++;
   if(target.path==='Back/extinction.img/ani/5/4')window.nxWasmProof.genuine2x2={file:file.file,path:target.path,width,height,bytes:bytes.length,sha256:sha};
  }
  window.nxWasmProof.files.push({file:file.file,canvases:checked});document.getElementById('status').textContent=JSON.stringify(window.nxWasmProof,null,2);
 }
 window.nxWasmProof.status='pass';document.getElementById('status').textContent=JSON.stringify(window.nxWasmProof,null,2);
}
</script><script src="reader.js"></script>'''


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','wasm','glue','symbols','native-report','output'):p.add_argument('--'+name,required=True)
    a=p.parse_args();r=prepare(a.candidate,a.wasm,a.glue,a.symbols,a.native_report,a.output)
    print(json.dumps({'status':r['status'],'target_canvases':r['target_canvases'],'non_export_sections_identical':r['non_export_sections_identical']}))
