// Run inside the built Node-20 dashboard image: node /tests/production-stream.mjs.
// The actual standalone Next server uses isolated temporary storage and no network
// beyond its container loopback. No Java, database, public asset or live NX is touched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root=mkdtempSync(join(tmpdir(),'production-stream-'));
const assets=join(root,'assets'),manifestPath=join(root,'manifest','launcher-manifest.json');
mkdirSync(assets);mkdirSync(join(root,'manifest'));
const initial=Buffer.from('isolated initial executable-byte fixture');
const initialPath=join(root,'initial.exe');writeFileSync(initialPath,initial);
const digest=createHash('sha256').update(initial).digest('hex');
writeFileSync(manifestPath,JSON.stringify({version:'1.0.5',updatedAt:'2026-10-14T13:49:13Z',downloadBase:'http://127.0.0.1:3000/client/',files:[{name:'BunsMS.exe',hash:digest,size:initial.length,url:'http://127.0.0.1:3000/client/BunsMS.exe'}]}));
const secret=randomUUID();
const server=spawn(process.execPath,['server.js'],{cwd:process.env.STANDALONE_ROOT||'/app',env:{...process.env,HOSTNAME:'127.0.0.1',PORT:'3000',ASSET_DIR:assets,LAUNCHER_MANIFEST_PATH:manifestPath,COSMIC_ROOT:root,ASSET_BASE_URL:'http://127.0.0.1:3000',GM_API_SECRET:secret,GAME_CLIENT_HOST:'buns.asslorde.com',GAME_SERVER_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let errorOutput='';server.stderr.on('data',chunk=>{errorOutput=(errorOutput+chunk.toString()).slice(-8000);});
const exited=once(server,'exit');
function peak(){const line=readFileSync(`/proc/${server.pid}/status`,'utf8').split('\n').find(row=>row.startsWith('VmHWM:'));if(!line)throw new Error('No process high-water memory counter');return Number(line.match(/\d+/)[0])*1024;}
async function json(path,payload){
 const req=request({hostname:'127.0.0.1',port:3000,path,method:payload===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-gm-secret':secret}});
 const replied=once(req,'response');req.end(payload===undefined?undefined:JSON.stringify(payload));
 const [res]=await replied;const chunks=[];for await(const chunk of res)chunks.push(chunk);
 const value=JSON.parse(Buffer.concat(chunks).toString());assert.equal(res.statusCode,200,JSON.stringify(value));return value;
}
try{
 let startup='';
 while(!startup.includes('Ready')){
  const outcome=await Promise.race([once(server.stdout,'data').then(([chunk])=>chunk.toString()),exited.then(()=>{throw new Error('Standalone server failed: '+errorOutput);})]);startup+=outcome;
 }
 const first=await json('/api/launcher/manifest',{stage:true});
 await json('/api/launcher/upload',{releaseId:first.releaseId,files:[{name:'BunsMS.exe',path:initialPath}]});
 const seeded=await json('/api/launcher/manifest',{releaseId:first.releaseId,register:[{name:'BunsMS.exe',hash:digest,size:initial.length}]});
 assert.equal(seeded.manifest.version,'1.0.5');
 const oldUrl=seeded.manifest.files[0].url;
 const stage=await json('/api/launcher/manifest',{stage:true});
 const block=Buffer.alloc(1024*1024,0x41),blocks=500,size=blocks*block.length;
 const hash=createHash('sha256');for(let i=0;i<blocks;i++)hash.update(block);const intended=hash.digest('hex');
 const before=peak();
 const boundary='stream-'+randomUUID();
 const prefix=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="releaseId"\r\n\r\n${stage.releaseId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="BunsMS.exe"\r\nContent-Type: application/octet-stream\r\n\r\n`);
 const suffix=Buffer.from(`\r\n--${boundary}--\r\n`);
 const upload=request({hostname:'127.0.0.1',port:3000,path:'/api/launcher/upload',method:'POST',headers:{'x-gm-secret':secret,'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':prefix.length+size+suffix.length}});
 const response=once(upload,'response');
 if(!upload.write(prefix))await once(upload,'drain');
 for(let i=0;i<blocks;i++)if(!upload.write(block))await once(upload,'drain');
 upload.end(suffix);
 const [reply]=await response;const chunks=[];for await(const chunk of reply)chunks.push(chunk);
 assert.equal(reply.statusCode,200,Buffer.concat(chunks).toString());
 const committed=await json('/api/launcher/manifest',{releaseId:stage.releaseId,register:[{name:'BunsMS.exe',hash:intended,size}]});
 assert.equal(committed.manifest.files[0].hash,intended);assert.equal(committed.manifest.files[0].size,size);
 assert.equal(statSync(join(assets,'objects',intended,'BunsMS.exe')).size,size);
 const after=peak();assert.ok(after-before<256*1024*1024,`500MiB upload buffered too much: ${after-before} high-water growth`);
 const rollback=await json('/api/launcher/manifest',{rollback:first.releaseId});assert.equal(rollback.manifest.files[0].url,oldUrl);
 assert.equal(readFileSync(join(assets,'objects',digest,'BunsMS.exe')).compare(initial),0);
 console.log(JSON.stringify({status:'PASS',runtime:process.version,bytes:size,sha256:intended,nextPeakBefore:before,nextPeakAfter:after,nextPeakGrowth:after-before,rollback:'retained immutable URL and bytes; no copying'}));
}finally{
 server.kill('SIGTERM');await exited;rmSync(root,{recursive:true,force:true});
}
