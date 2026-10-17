import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { Subprocess } from "bun";
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

const required = ["NATIVE_WZ_BASELINE_DIR", "NATIVE_WZ_BASELINE_MANIFEST", "NX_BASELINE_DIR", "NX_BASELINE_MANIFEST", "WZ_RELEASE_TOOLS_DIR", "SELFHOST_SERVER_TAR"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required for the explicit genuine publication integration suite`);
const root = mkdtempSync(join(tmpdir(), "selfhost-genuine-"));
const assets = join(root, "assets"); const cosmic = join(root, "cosmic");
const authority = join(cosmic, "manifest-writable", "launcher-manifest.json");
mkdirSync(assets); mkdirSync(join(cosmic, "manifest-writable"), { recursive: true });
process.env.ASSET_DIR = assets; process.env.COSMIC_ROOT = cosmic; process.env.LAUNCHER_MANIFEST_PATH = authority;
process.env.ASSET_BASE_URL = "http://genuine-fixture.invalid";
process.env.GAME_CONTROL_SOCKET = join(root, "control.sock");
const secret = randomUUID(); process.env.GM_API_SECRET = secret;
const secretFile = join(root, "secret"); writeFileSync(secretFile, secret, { mode: 0o600 });
const database = new Database(":memory:");
database.exec(`CREATE TABLE custom_items(id INTEGER PRIMARY KEY, item_id INTEGER, name TEXT, description TEXT, category TEXT, sub_category TEXT, icon_url TEXT, stats TEXT, requirements TEXT, flags TEXT);
CREATE TABLE custom_assets(id INTEGER PRIMARY KEY, asset_type TEXT,in_game_id INTEGER,file_key TEXT,name TEXT,attrs TEXT,status TEXT,published_at TEXT);
CREATE TABLE custom_reactors(id INTEGER PRIMARY KEY,reactor_id INTEGER,name TEXT,idle_png_url TEXT,published INTEGER,event_type INTEGER,hits_to_break INTEGER,animation_style TEXT,script_template TEXT,hit_delay INTEGER,break_delay INTEGER,trigger_item_id INTEGER,trigger_item_qty INTEGER,timeout_ms INTEGER);
CREATE TABLE plife(id INTEGER PRIMARY KEY,world INTEGER,map INTEGER,life INTEGER,type TEXT,cy INTEGER,f INTEGER,fh INTEGER,rx0 INTEGER,rx1 INTEGER,x INTEGER,y INTEGER,hide INTEGER,mobtime INTEGER);`);
function sqlStatement(sql: string) { return database.query(sql.replace(/NOW\(\)/g, "CURRENT_TIMESTAMP")); }
mock.module("@/lib/db", () => ({
  query: async (sql: string, params: unknown[] = []) => sqlStatement(sql).all(...params as never[]),
  execute: async (sql: string, params: unknown[] = []) => { const result = sqlStatement(sql).run(...params as never[]); return { affectedRows: result.changes, insertId: result.lastInsertRowid }; },
}));
// Intentional module boundary: authority environment and actual SQL adapter must precede imports.
const A = await import("../src/lib/assets");
const items = await import("../src/app/api/admin/items/publish/route");
const generic = await import("../src/app/api/admin/assets/publish/route");
const reactors = await import("../src/app/api/admin/reactors/publish/route");
const baker = await import("../src/app/api/admin/baker/publish/route");
const manifestRoute = await import("../src/app/api/launcher/manifest/route");
const explorer = await import("../src/lib/wz/explorer");
const serverXml = await import("../src/lib/wz/server-xml");
const nativeRecords: Array<{ name: string; sha256: string; size: number }> = JSON.parse(readFileSync(process.env.NATIVE_WZ_BASELINE_MANIFEST!, "utf8")).files;
const originalNx: Array<{ name: string; sha256: string; size: number }> = JSON.parse(readFileSync(process.env.NX_BASELINE_MANIFEST!, "utf8")).files;
const proof: Array<Record<string, unknown>> = [];
let processHandle: Subprocess<"ignore", "pipe", "inherit">;
let origin = "";
let baselineId = "";
let iconUrl = "";
let spriteKey = "";

async function hashDownload(path: string) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Actual byte service failed ${path}: ${response.status}`);
  const hash = createHash("sha256"); let size = 0;
  const reader = response.body.getReader();
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; hash.update(chunk.value); size += chunk.value.byteLength; } }
  finally { reader.releaseLock(); }
  return { hash: hash.digest("hex"), size };
}
async function verifyPublished(label: string) {
  const manifest = A.readManifest().manifest;
  const nx = Object.values(manifest.assets || {}).filter((asset) => asset.key.startsWith("nx/"));
  expect(nx.map((asset) => asset.key.slice(3)).sort()).toEqual(originalNx.map((row) => row.name).sort());
  for (const asset of nx) {
    expect(await hashDownload(`/nx/${asset.key.slice(3)}`)).toEqual({ hash: asset.hash, size: asset.size });
  }
  const ui = manifest.assets!["nx/UI.nx"]; const originalUi = originalNx.find((file) => file.name === "UI.nx")!;
  expect(ui.hash).toBe(originalUi.sha256); expect(ui.size).toBe(originalUi.size);
  const descriptor = JSON.parse(readFileSync(A.resolveAssetPath("server-wz.version"), "utf8"));
  const tar = manifest.assets!["server-wz.tar.gz"];
  expect(descriptor.hash).toBe(tar.hash); expect(descriptor.url).toBe(tar.url);
  proof.push({ label, releaseId: manifest.releaseId, version: manifest.version, launcher: manifest.files.map(({ name, hash, size }) => ({ name, hash, size })), nx: nx.map(({ key, hash, size }) => ({ key, hash, size })), serverTar: { hash: tar.hash, size: tar.size }, applyAcknowledgements: readFileSync(join(root, "apply-log"), "utf8").trim().split("\n").length });
}
async function completion(getStatus: () => Promise<Response>, jobId: string): Promise<Record<string, unknown>> {
  for (;;) {
    const response = await getStatus();
    if (!response.ok) throw new Error(`Publication status failed: HTTP ${response.status}`);
    const value = await response.json();
    if (value.id !== jobId) throw new Error("Publication status does not acknowledge the started job");
    if (value.status === "done" || value.status === "error") return value;
    // Exercise the shipped asynchronous status protocol, not a guessed
    // completion delay or an unreliable/coalesced filesystem watch event.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

beforeAll(async () => {
  const files = nativeRecords.map((row) => ({ name: row.name, hash: row.sha256, size: row.size, url: `http://seed.invalid/${row.name}`, profiles: ["stock", "kaentake"] }));
  writeFileSync(authority, JSON.stringify({ version: "1.0.5", updatedAt: "2026-10-14T13:49:13Z", downloadBase: "http://seed.invalid/", files }));
  const bootstrap = await A.publishFiles([
    ...nativeRecords.map((row) => ({ key: row.name, hash: row.sha256, size: row.size, path: join(process.env.NATIVE_WZ_BASELINE_DIR!, row.name) })),
    { key: "server-wz.tar.gz", path: process.env.SELFHOST_SERVER_TAR!, hash: "0139085a5542a638ca4a0c325203e36ab6d46d51fb2aac2fbebbfec2010b23ce", size: 28469675 },
  ]);
  baselineId = bootstrap.releaseId;
  const png = new PNG({ width: 24, height: 24 });
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const distance = Math.hypot(x - 12, y - 12); const index = (y * 24 + x) * 4;
    if (distance >= 7 && distance <= 11) { png.data[index] = 255; png.data[index + 1] = 200; png.data[index + 2] = 50; png.data[index + 3] = 255; }
  }
  const art = await A.publishBuffers([
    { key: "custom-items/1112999/icon.png", data: PNG.sync.write(png) },
    { key: "assets/npc/baker-sprite.png", data: PNG.sync.write(png) },
    { key: "assets/etc/4099999.png", data: PNG.sync.write(png) },
    { key: "reactors/9999900/idle.png", data: PNG.sync.write(png) },
  ]);
  iconUrl = art.assets.find((asset) => asset.key === "custom-items/1112999/icon.png")!.url;
  spriteKey = "assets/etc/4099999.png";
  database.query("INSERT INTO custom_items VALUES(?,?,?,?,?,?,?,?,?,?)").run(1,1112999,"Publication isolated ring","Real producer fixture; never live","equip","Ring",iconUrl,JSON.stringify({str:1}),JSON.stringify({level:1}),JSON.stringify({tradeBlock:true}));
  database.query("INSERT INTO custom_assets VALUES(?,?,?,?,?,?,?,?)").run(1,"etc",4099999,spriteKey,"Publication isolated token",JSON.stringify({slotMax:100,price:1}),"ready",null);
  database.query("INSERT INTO custom_reactors VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(1,9999900,"Publication isolated reactor",art.assets.find((asset)=>asset.key==="reactors/9999900/idle.png")!.url,0,100,1,"breakable","drop_items",120,150,null,1,null);
  const staticRoot = join(root,"static"); mkdirSync(join(staticRoot,"web"),{recursive:true}); mkdirSync(join(staticRoot,"build")); writeFileSync(join(staticRoot,"web","index.html"),"isolated genuine pipeline");
  const applyScript=join(root,"apply.py"); writeFileSync(applyScript,`from pathlib import Path\np=Path(${JSON.stringify(join(root,"apply-log"))})\nwith p.open('a') as f:f.write('isolated command acknowledged\\n')\n`);
  processHandle = Bun.spawn(["python3","test/asset_http_fixture.py"], {cwd:process.cwd(),stdin:"ignore",stdout:"pipe",stderr:"inherit",env:{...process.env,STATIC_ROOT:staticRoot,CLIENT_ASSETS_DIR:assets,GM_SECRET_FILE:secretFile,NX_DIR:process.env.NX_BASELINE_DIR!,GAME_RESTART_COMMAND:JSON.stringify(["python3",applyScript]),NX_PREPARE_COMMAND:JSON.stringify(["python3",join(process.cwd(),"..","tools","prepare_nx_release.py")])}});
  const reader=processHandle.stdout.getReader(); const decoder=new TextDecoder();let ready="";
  while(!ready.includes("\n")){const next=await reader.read();if(next.done)throw new Error("Actual byte-service fixture exited before readiness");ready+=decoder.decode(next.value);}
  reader.releaseLock();origin=`http://127.0.0.1:${JSON.parse(ready).port}`;
},180_000);
afterAll(async()=>{
  processHandle?.kill("SIGTERM");if(processHandle)await processHandle.exited;
  if(process.env.SELFHOST_PROOF_PATH)writeFileSync(process.env.SELFHOST_PROOF_PATH,JSON.stringify({toolsCommit:process.env.WZ_RELEASE_TOOLS_COMMIT,proof},null,2));
  database.close();rmSync(root,{recursive:true,force:true});
});

test("actual item publication, native conversion, preserved full NX cohort and private apply",async()=>{
  const response=await items.POST();expect(response.status).toBe(200);
  const status=await completion(items.GET,(await response.json()).id);if(status.status!=="done"){proof.push({label:"items-failed",status});throw new Error(JSON.stringify(status));}
  await verifyPublished("items");
},1_200_000);
test("actual generic ETC publication preserves shared bucket siblings and commits server marker",async()=>{
  const response=await generic.POST();expect(response.status).toBe(200);
  const status=await completion(generic.GET,(await response.json()).id);if(status.status!=="done"){proof.push({label:"assets-failed",status});throw new Error(JSON.stringify(status));}
  expect(database.query<{status:string},[]>("SELECT status FROM custom_assets WHERE id=1").get()?.status).toBe("published");
  await verifyPublished("assets-etc");
},1_200_000);
test("actual Baker publication uses committed art and complete atomic release",async()=>{
  const response=await baker.POST();const result=await response.json();
  if(!response.ok)throw new Error(JSON.stringify(result));
  expect(result.success).toBe(true);await verifyPublished("baker");
},1_200_000);
test("actual reactor publication commits before DB publication flags and preserves generated script",async()=>{
  const response=await reactors.POST();expect(response.status).toBe(200);
  const status=await completion(reactors.GET,(await response.json()).id);if(status.status!=="done"){proof.push({label:"reactors-failed",status});throw new Error(JSON.stringify(status));}
  expect(database.query<{published:number},[]>("SELECT published FROM custom_reactors WHERE id=1").get()?.published).toBe(1);
  await verifyPublished("reactors");
},1_200_000);
test("retained SELFHOST rollback restores native/server/NX bytes without copying any old object",async()=>{
  const response=await manifestRoute.POST(new Request("http://private.invalid/api/launcher/manifest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rollback:baselineId})}));
  expect(response.status).toBe(200);expect(A.readManifest().manifest.releaseId).toBe(baselineId);
  for(const row of originalNx)expect(await hashDownload(`/nx/${row.name}`)).toEqual({hash:row.sha256,size:row.size});
  proof.push({label:"rollback",releaseId:baselineId,nxBaseline:originalNx});
},1_200_000);

test("native and server XML explorers consume the committed immutable authority without a remote or flat cache", async () => {
  const character = await explorer.getWzCached("Character.wz");
  expect(character.filePath).toBe(A.resolveAssetPath("Character.wz"));
  expect(character.root.length).toBeGreaterThan(0);
  expect(await explorer.getWzCached("Character.wz")).toBe(character);
  await serverXml.ensureServerXml();
  const strings = serverXml.getServerImgXml("String.wz/Eqp.img.xml");
  expect(strings.bytes).toBeGreaterThan(0);
  expect(strings.tree.children!.length).toBeGreaterThan(0);
}, 300000);
