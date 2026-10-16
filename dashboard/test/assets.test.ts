import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Subprocess } from "bun";
import type { PathLike } from "node:fs";
import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";

const directory = fs.mkdtempSync(join(tmpdir(), "selfhost-assets-test-"));
const assetsDirectory = join(directory, "assets");
const cosmic = join(directory, "cosmic");
const authority = join(cosmic, "manifest-writable", "launcher-manifest.json");
process.env.ASSET_DIR = assetsDirectory;
process.env.COSMIC_ROOT = cosmic;
process.env.LAUNCHER_MANIFEST_PATH = authority;
process.env.ASSET_BASE_URL = "http://asset-test.invalid";
process.env.GM_API_SECRET = randomUUID();
process.env.JWT_SECRET = randomUUID();
process.env.OPENROUTER_API_KEY = "isolated-unused-provider";
process.env.GAME_CONTROL_SOCKET = join(directory, "control.sock");
const secretFile = join(directory, "control-secret");
fs.writeFileSync(secretFile, process.env.GM_API_SECRET, { mode: 0o600 });

// A real isolated SQL database, not canned query results. Only the MySQL FOR UPDATE
// suffix is adapted; tests exercise actual transaction commit/rollback and stored JSON.
const database = new Database(":memory:");
database.exec("CREATE TABLE custom_items (id INTEGER PRIMARY KEY, icon_url TEXT, stats TEXT)");
database.exec("CREATE TABLE custom_reactors (id INTEGER PRIMARY KEY, reactor_id INTEGER, idle_png_url TEXT, published INTEGER DEFAULT 0)");
const connection = {
  beginTransaction: async () => { database.exec("BEGIN"); },
  commit: async () => { database.exec("COMMIT"); },
  rollback: async () => { database.exec("ROLLBACK"); },
  release: () => {},
  execute: async (sql: string, params: unknown[] = []) => {
    const statement = database.query(sql.replace(/ FOR UPDATE\s*$/, ""));
    return /^\s*SELECT/i.test(sql) ? [statement.all(...params as never[]), []] : [{ affectedRows: statement.run(...params as never[]).changes }, []];
  },
};
mock.module("@/lib/db", () => ({
  getPool: () => ({ getConnection: async () => connection }),
  query: async (sql: string, params: unknown[] = []) => (await connection.execute(sql, params))[0],
  execute: async (sql: string, params: unknown[] = []) => (await connection.execute(sql, params))[0],
}));
// Deliberate module-loading boundary: environment and the real isolated SQL adapter
// must exist before modules capture the authority paths and DB provider.
const A = await import("../src/lib/assets");
const manifestRoute = await import("../src/app/api/launcher/manifest/route");
const uploadRoute = await import("../src/app/api/launcher/upload/route");
const rawUpload = await import("../src/app/api/admin/wz/upload/route");
const rawRegister = await import("../src/app/api/admin/wz/register/route");
const privateAuthority = await import("../src/app/api/admin/assets/release/route");
const renderWeapon = await import("../src/app/api/admin/items/render-weapon/route");
const migrate = await import("../src/app/api/admin/assets/migrate/route");
const bakerSprite = await import("../src/app/api/admin/baker/sprite/route");
const itemJobs = await import("../src/app/api/admin/items/publish/route");
const assetJobs = await import("../src/app/api/admin/assets/publish/route");
const reactorJobs = await import("../src/app/api/admin/reactors/publish/route");
const { middleware } = await import("../src/middleware");
const { requestGameControl } = await import("../src/lib/game-control");
const { hashBrowserFile } = await import("../src/lib/hash-file");
const { publishStagedWzRelease } = await import("../src/lib/wz-to-nx");
const realFs = { ...fs };
let httpOrigin = "";
let server: Subprocess<"ignore", "pipe", "pipe">;
const initial: Record<string, Buffer> = {
  "BunsMS.exe": Buffer.from("stock client fixture bytes"),
  "config.ini": Buffer.from("[client]\nmode=stock\n"),
  "Kaentake.exe": Buffer.from("experimental client fixture bytes"),
};

function metadata(key: string, data: Buffer) {
  return { key, hash: createHash("sha256").update(data).digest("hex"), size: data.length };
}
function source(key: string, data: Buffer) {
  const path = join(directory, "sources", randomUUID());
  fs.writeFileSync(path, data);
  return { ...metadata(key, data), path };
}
function jsonRequest(path: string, value: unknown) {
  return new NextRequest(`http://private-test.invalid${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-gm-secret": process.env.GM_API_SECRET! }, body: JSON.stringify(value) });
}
async function bootstrap() {
  return A.publishFiles(Object.entries(initial).map(([key, data]) => source(key, data)));
}
async function downloaded(url: string): Promise<Buffer> {
  const response = await fetch(httpOrigin + new URL(url).pathname);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

beforeAll(async () => {
  const staticRoot = join(directory, "static");
  fs.mkdirSync(join(staticRoot, "web"), { recursive: true });
  fs.mkdirSync(join(staticRoot, "build"));
  fs.mkdirSync(join(directory, "nx-baseline"));
  fs.writeFileSync(join(staticRoot, "web", "index.html"), "isolated browser root");
  const applyScript = join(directory, "apply.py");
  fs.writeFileSync(applyScript, `import pathlib,sys\np=pathlib.Path(${JSON.stringify(directory)})\ncode=int((p/'apply-result').read_text())\nif not code:(p/'applied').write_text('applied')\nsys.exit(code)\n`);
  fs.writeFileSync(join(directory, "apply-result"), "0");
  server = Bun.spawn(["python3", "test/asset_http_fixture.py"], {
    cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, STATIC_ROOT: staticRoot, CLIENT_ASSETS_DIR: assetsDirectory,
      NX_DIR: join(directory, "nx-baseline"), GM_SECRET_FILE: secretFile,
      GAME_RESTART_COMMAND: JSON.stringify(["python3", applyScript]),
      NX_PREPARE_COMMAND: JSON.stringify(["python3", "-c", "import sys;sys.stderr.write('isolated conversion rejection');sys.exit(17)"]),
    },
  });
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder(); let ready = "";
  while (!ready.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Asset HTTP fixture exited: ${await new Response(server.stderr).text()}`);
    ready += decoder.decode(chunk.value);
  }
  reader.releaseLock();
  httpOrigin = `http://127.0.0.1:${JSON.parse(ready.trim()).port}`;
});
beforeEach(() => {
  for (const path of [assetsDirectory, cosmic, join(directory, "sources")]) fs.rmSync(path, { recursive: true, force: true });
  fs.mkdirSync(assetsDirectory); fs.mkdirSync(join(directory, "sources")); fs.mkdirSync(join(cosmic, "manifest-writable"), { recursive: true });
  fs.writeFileSync(authority, JSON.stringify({ version: "1.0.5", updatedAt: "2026-10-14T13:49:13Z", downloadBase: "http://old-test.invalid/client/", files: Object.entries(initial).map(([name, data]) => ({ name, hash: metadata(name, data).hash, size: data.length, url: `http://old-test.invalid/client/${name}`, ...(name === "Kaentake.exe" ? { profiles: ["kaentake"] } : {}) })) }));
  database.exec("DELETE FROM custom_items; DELETE FROM custom_reactors");
  fs.writeFileSync(join(directory, "apply-result"), "0");
  fs.rmSync(join(directory, "applied"), { force: true });
});
afterAll(async () => {
  server?.kill("SIGTERM");
  if (server) await server.exited;
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("immutable release transaction through actual handlers and byte service", () => {
  test("bootstrap preserves hash/size/version/timestamp and profile views are isolated", async () => {
    const staged = await (await manifestRoute.POST(jsonRequest("/api/launcher/manifest", { stage: true }))).json();
    const files = Object.entries(initial).map(([name, data]) => ({ name, ...source(name, data) }));
    expect((await uploadRoute.POST(jsonRequest("/api/launcher/upload", { releaseId: staged.releaseId, files }))).status).toBe(200);
    const response = await manifestRoute.POST(jsonRequest("/api/launcher/manifest", { releaseId: staged.releaseId, register: files.map((file) => ({ name: file.name, hash: file.hash, size: file.size })) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.manifest.version).toBe("1.0.5");
    expect(result.manifest.updatedAt).toBe("2026-10-14T13:49:13Z");
    for (const file of result.manifest.files) expect(await downloaded(file.url)).toEqual(initial[file.name]);
    const stock = await (await manifestRoute.GET(new NextRequest("http://private-test.invalid/api/launcher/manifest"))).json();
    const experimental = await (await manifestRoute.GET(new NextRequest("http://private-test.invalid/api/launcher/manifest?profile=kaentake"))).json();
    expect(stock.files.some((file: { name: string }) => file.name === "BunsMS.exe")).toBe(true);
    expect(stock.files.some((file: { name: string }) => file.name === "Kaentake.exe")).toBe(false);
    expect(experimental.files.map((file: { name: string }) => file.name)).toEqual(["Kaentake.exe"]);
    expect(stock.assets).toBeUndefined();
    expect((await manifestRoute.GET(new NextRequest("http://private-test.invalid/api/launcher/manifest?profile=unknown"))).status).toBe(400);
    expect((await (await privateAuthority.GET()).json()).allowlist).toContain("Kaentake.exe");
  });

  test("first publication must retain the approved existing bytes before accepting a content update", async () => {
    const files = Object.entries(initial).map(([key, data]) => source(key, key === "BunsMS.exe" ? Buffer.from("new content before seed retention") : data));
    await expect(A.publishFiles(files)).rejects.toMatchObject({ status: 409 });
    expect(A.readManifest().manifest.releaseId).toBeUndefined();
    expect(A.readManifest().manifest.files[0].hash).toBe(metadata("BunsMS.exe", initial["BunsMS.exe"]).hash);
  });

  test("wrong expected hash, duplicate item and later-file failure never change authority or old bytes", async () => {
    const old = await bootstrap();
    const before = fs.readFileSync(authority, "utf8");
    const id = A.beginRelease();
    const file = source("BunsMS.exe", Buffer.from("unapproved replacement"));
    await A.stageFile(id, file.key, file.path);
    const bad = await manifestRoute.POST(jsonRequest("/api/launcher/manifest", { releaseId: id, register: [{ name: file.key, hash: "0".repeat(64), size: file.size }] }));
    expect(bad.status).toBe(400);
    expect(fs.readFileSync(authority, "utf8")).toBe(before);
    const duplicate = A.beginRelease(); await A.stageFile(duplicate, file.key, file.path);
    await expect(A.prepareRelease(duplicate, [file, file])).rejects.toThrow(/Duplicate/);
    const later = A.beginRelease(); const config = source("config.ini", Buffer.from("changed config"));
    await A.stageFile(later, file.key, file.path); await A.stageFile(later, config.key, config.path);
    await expect(A.publishRelease(later, [file, { ...config, hash: "f".repeat(64) }])).rejects.toThrow(/mismatch/i);
    expect(fs.readFileSync(authority, "utf8")).toBe(before);
    expect(await downloaded(old.manifest.files[0].url)).toEqual(initial["BunsMS.exe"]);
  });

  test("old manifest URLs stay valid during preparation, commit, Range resume and rollback", async () => {
    const old = await bootstrap();
    const update = source("BunsMS.exe", Buffer.from("new client bytes with a distinct tail"));
    const id = A.beginRelease(); await A.stageFile(id, update.key, update.path);
    await A.prepareRelease(id, [update]);
    expect(A.readManifest().manifest.releaseId).toBe(old.releaseId);
    expect(await downloaded(old.manifest.files[0].url)).toEqual(initial["BunsMS.exe"]);
    const current = await A.commitRelease(id);
    expect(current.manifest.version).toBe("1.0.6");
    expect(await downloaded(old.manifest.files[0].url)).toEqual(initial["BunsMS.exe"]);
    expect(await downloaded(current.manifest.files[0].url)).toEqual(fs.readFileSync(update.path));
    const partial = await fetch(httpOrigin + new URL(old.manifest.files[0].url).pathname, { headers: { Range: "bytes=6-" } });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer()).equals(initial["BunsMS.exe"].subarray(6))).toBe(true);
    const rollback = await manifestRoute.POST(jsonRequest("/api/launcher/manifest", { rollback: old.releaseId }));
    expect(rollback.status).toBe(200);
    expect(A.readManifest().manifest.releaseId).toBe(old.releaseId);
    expect(await downloaded(old.manifest.files[0].url)).toEqual(initial["BunsMS.exe"]);
    expect(await downloaded(current.manifest.files[0].url)).toEqual(fs.readFileSync(update.path));
  });

  test("partial and concurrent same-key streams cannot corrupt completed staging", async () => {
    await bootstrap(); const id = A.beginRelease();
    const broken = new Readable({ read() { this.push(Buffer.from("partial")); this.destroy(new Error("transfer interrupted")); } });
    await expect(A.stageStream(id, "BunsMS.exe", broken)).rejects.toThrow("transfer interrupted");
    const started = Promise.withResolvers<void>(); const finish = Promise.withResolvers<void>();
    const body = new ReadableStream<Uint8Array>({ async start(controller) { controller.enqueue(Buffer.from("intended stream")); started.resolve(); await finish.promise; controller.close(); } });
    const pending = A.stageStream(id, "BunsMS.exe", body);
    await started.promise;
    const other = source("BunsMS.exe", Buffer.from("wrong competing bytes"));
    await expect(A.stageFile(id, other.key, other.path)).rejects.toThrow(/progress/);
    finish.resolve(); await pending;
    const expected = metadata("BunsMS.exe", Buffer.from("intended stream"));
    const result = await A.publishRelease(id, [expected]);
    expect(await downloaded(result.manifest.files[0].url)).toEqual(Buffer.from("intended stream"));
  });

  test("expected metadata is frozen, staged replacement is refused, external object mutation is detected", async () => {
    await bootstrap(); const id = A.beginRelease();
    const file = source("BunsMS.exe", Buffer.from("expected frozen bytes")); await A.stageFile(id, file.key, file.path);
    const input = [{ key: file.key, hash: file.hash, size: file.size }];
    const pending = A.prepareRelease(id, input); input[0].hash = "0".repeat(64);
    const prepared = await pending;
    await expect(A.stageFile(id, file.key, file.path)).rejects.toThrow(/frozen/);
    const object = A.resolveRevisionPath(file.key, file.hash);
    fs.chmodSync(object, 0o644); fs.writeFileSync(object, Buffer.alloc(file.size, 1)); fs.chmodSync(object, 0o444);
    await expect(A.commitRelease(prepared.releaseId)).rejects.toThrow(/changed/);
    expect(A.readManifest().manifest.releaseId).not.toBe(id);
    await expect(A.publishFiles([file])).rejects.toThrow(/does not match its digest/);
    expect(A.readManifest().manifest.releaseId).not.toBe(id);
  });

  test("reusing a retained digest cannot bless a same-size read-only corrupted object", async () => {
    const baseline = await bootstrap();
    const file = source("BunsMS.exe", initial["BunsMS.exe"]);
    const object = A.resolveAssetPath(file.key);
    fs.chmodSync(object, 0o644); fs.writeFileSync(object, Buffer.alloc(file.size, 1)); fs.chmodSync(object, 0o444);
    await expect(A.publishFiles([file])).rejects.toThrow(/changed/);
    expect(A.readManifest().manifest.releaseId).toBe(baseline.releaseId);
  });

  test("a killed publisher releases kernel authority locks without deleting private lock files", async () => {
    const baseline = await bootstrap();
    const candidate = source("BunsMS.exe", Buffer.from("child candidate that never commits"));
    const signal = join(directory, "held-authority");
    const ready = Promise.withResolvers<void>();
    const watcher = fs.watch(directory, (_event, name) => { if (String(name) === "held-authority") ready.resolve(); });
    const program = `
      import { mock } from "bun:test";
      import * as fs from "node:fs";
      const actual = { ...fs };
      mock.module("fs", () => ({ ...actual, renameSync: (from, to) => {
        if (String(to) === process.env.LAUNCHER_MANIFEST_PATH) {
          actual.writeFileSync(${JSON.stringify(signal)}, "held");
          process.kill(process.pid, "SIGSTOP");
        }
        return actual.renameSync(from, to);
      }}));
      const A = await import(${JSON.stringify(join(import.meta.dir, "../src/lib/assets.ts"))});
      await A.publishFiles([${JSON.stringify(candidate)}]);
    `;
    const child = Bun.spawn(["bun", "-e", program], { env: process.env, stdout: "pipe", stderr: "pipe" });
    child.exited.then((code) => ready.reject(new Error(`Publisher exited before the crash seam: ${code}`)));
    try {
      await ready.promise;
      child.kill("SIGKILL"); await child.exited;
      expect(A.readManifest().manifest.releaseId).toBe(baseline.releaseId);
      const next = source("BunsMS.exe", Buffer.from("next actual register after process death"));
      const id = A.beginRelease(); await A.stageFile(id, next.key, next.path);
      const response = await manifestRoute.POST(jsonRequest("/api/launcher/manifest", { releaseId: id, register: [{ name: next.key, hash: next.hash, size: next.size }] }));
      expect(response.status).toBe(200);
      expect(await downloaded(A.readManifest().manifest.files[0].url)).toEqual(fs.readFileSync(next.path));
    } finally {
      watcher.close();
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    }
  });

  test("two prepared releases conflict rather than lose a successful commit", async () => {
    await bootstrap();
    const one = A.beginRelease(); const two = A.beginRelease();
    const exe = source("BunsMS.exe", Buffer.from("first concurrent client"));
    const config = source("config.ini", Buffer.from("second concurrent config"));
    await A.stageFile(one, exe.key, exe.path); await A.stageFile(two, config.key, config.path);
    await A.prepareRelease(one, [exe]); await A.prepareRelease(two, [config]);
    await A.commitRelease(one);
    await expect(A.commitRelease(two)).rejects.toThrow(/authority changed/i);
    expect(A.readManifest().manifest.files[0].hash).toBe(exe.hash);
    expect(A.readManifest().manifest.files[1].hash).toBe(metadata("config.ini", initial["config.ini"]).hash);
  });

  test("manifest rename failure leaves the previous complete release authoritative", async () => {
    const old = await bootstrap(); const file = source("BunsMS.exe", Buffer.from("commit must fail"));
    const id = A.beginRelease(); await A.stageFile(id, file.key, file.path); await A.prepareRelease(id, [file]);
    mock.module("fs", () => ({ ...realFs, renameSync: (from: PathLike, to: PathLike) => {
      if (String(to) === authority) throw Object.assign(new Error("injected manifest rename failure"), { code: "EACCES" });
      return realFs.renameSync(from, to);
    } }));
    try { await expect(A.commitRelease(id)).rejects.toThrow("injected manifest rename failure"); }
    finally { mock.module("fs", () => realFs); }
    expect(A.readManifest().manifest.releaseId).toBe(old.releaseId);
    expect(await downloaded(old.manifest.files[0].url)).toEqual(initial["BunsMS.exe"]);
  });

  test("real multipart raw upload verifies intended bytes and retires direct-live registration", async () => {
    await bootstrap(); const data = Buffer.from("streamed browser client replacement");
    const expected = metadata("BunsMS.exe", data);
    const form = new FormData(); form.append("name", expected.key); form.append("expected", JSON.stringify([expected]));
    form.append("operations", "[]"); form.append("file", new File([data], expected.key));
    const request = new Request("http://private-test.invalid/api/admin/wz/upload", { method: "POST", headers: { "x-gm-secret": process.env.GM_API_SECRET! }, body: form });
    // The streaming implementation must not call the buffering Request.formData API.
    request.formData = () => { throw new Error("whole-body buffering is forbidden"); };
    const response = await rawUpload.POST(request);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(await downloaded(result.assets.find((asset: { key: string }) => asset.key === expected.key).url)).toEqual(data);
    expect((await rawRegister.POST(jsonRequest("/api/admin/wz/register", { name: expected.key }))).status).toBe(400);
    expect(await hashBrowserFile(new Blob([data]))).toEqual({ hash: expected.hash, size: expected.size });
  });

  test("nested art multipart and render handlers publish retained exact bytes without traversal", async () => {
    await bootstrap(); const icon = Buffer.from("isolated icon payload"); const key = "custom-items/123/icon.png";
    const form = new FormData(); form.append("mode", "art"); form.append("expected", JSON.stringify([metadata(key, icon)])); form.append("file", new File([icon], "icon.png"));
    const upload = await uploadRoute.POST(new Request("http://private-test.invalid/api/launcher/upload", { method: "POST", headers: { "x-gm-secret": process.env.GM_API_SECRET! }, body: form }));
    expect(upload.status).toBe(200); const uploaded = await upload.json();
    expect(await downloaded(uploaded.assets[0].url)).toEqual(icon);
    const rendered = await renderWeapon.POST(jsonRequest("/api/admin/items/render-weapon", { itemId: 123, origins: { stand1: [{ x: 0, y: 0 }] }, icon: icon.toString("base64"), frames: { stand1: [Buffer.from("frame A").toString("base64"), Buffer.from("frame B").toString("base64")] } }));
    expect(rendered.status).toBe(200); const result = await rendered.json();
    expect(result.releaseId).not.toBe(uploaded.releaseId);
    expect(await downloaded(result.frames.stand1[1])).toEqual(Buffer.from("frame B"));
    expect(await downloaded(uploaded.assets[0].url)).toEqual(icon);
    const before = A.readManifest().manifest.releaseId;
    expect((await renderWeapon.POST(jsonRequest("/api/admin/items/render-weapon", { itemId: "../../escape", origins: {}, frames: { stand1: [] } }))).status).toBe(400);
    expect((await renderWeapon.POST(jsonRequest("/api/admin/items/render-weapon", { itemId: 123, origins: {}, frames: { "../../escape": [] } }))).status).toBe(400);
    expect(A.readManifest().manifest.releaseId).toBe(before);
    const bad = await fetch(`${httpOrigin}/client/r/${"a".repeat(64)}/../../control-secret`);
    expect(bad.status).not.toBe(200);
  });

  test("server tar and marker commit together; explicit browser conversion failure leaves both old", async () => {
    await bootstrap(); const tar = source("server-wz.tar.gz", Buffer.from("isolated tar-byte transport fixture"));
    const committed = await A.publishFiles([tar]);
    const descriptor = JSON.parse((await downloaded(committed.manifest.assets!["server-wz.version"].url)).toString());
    expect(descriptor.hash).toBe(tar.hash); expect(descriptor.size).toBe(tar.size);
    expect(await downloaded(descriptor.url)).toEqual(fs.readFileSync(tar.path));
    const id = A.beginRelease(); const changed = source("server-wz.tar.gz", Buffer.from("candidate that cannot convert"));
    await A.stageFile(id, changed.key, changed.path);
    await expect(publishStagedWzRelease(id, [changed], [{ op: "import_image", target_wz: "Npc.wz", target_image: "9900200.img" }], "native-and-browser")).rejects.toThrow("isolated conversion rejection");
    expect(A.readManifest().manifest.releaseId).toBe(committed.releaseId);
    expect(await downloaded(descriptor.url)).toEqual(fs.readFileSync(tar.path));
    expect((await fetch(`${httpOrigin}/restart`, { method: "POST" })).status).toBe(404);
    await requestGameControl("restart"); expect(fs.readFileSync(join(directory, "applied"), "utf8")).toBe("applied");
    fs.writeFileSync(join(directory, "apply-result"), "7");
    await expect(requestGameControl("restart")).rejects.toThrow(/failed/i);
  });

  test("explicit legacy art import updates actual isolated DB references transactionally", async () => {
    await bootstrap(); const old = "https://retired-test.invalid/icon.png";
    database.query("INSERT INTO custom_items(id,icon_url,stats) VALUES(?,?,?)").run(1, old, JSON.stringify({ _weaponFrames: { frames: { stand1: [old] } } }));
    const file = source("custom-items/456/icon.png", Buffer.from("imported exact art"));
    const invalid = await migrate.POST(jsonRequest("/api/admin/assets/migrate", { files: [{ ...file, hash: "0".repeat(64) }], records: [{ kind: "item", id: 1, urls: [{ from: old, key: file.key }] }] }));
    expect(invalid.status).toBe(400);
    const untouched = database.query<{ icon_url: string }, []>("SELECT icon_url FROM custom_items WHERE id=1").get();
    expect(untouched?.icon_url).toBe(old);
    const response = await migrate.POST(jsonRequest("/api/admin/assets/migrate", { files: [file], records: [{ kind: "item", id: 1, urls: [{ from: old, key: file.key }] }] }));
    expect(response.status).toBe(200); const result = await response.json();
    const row = database.query<{ icon_url: string; stats: string }, []>("SELECT icon_url,stats FROM custom_items WHERE id=1").get();
    if (!row) throw new Error("The selected SQL row disappeared");
    expect(row.icon_url).toBe(result.assets[0].url);
    expect(JSON.parse(row.stats)._weaponFrames.frames.stand1[0]).toBe(row.icon_url);
    const conflict = await migrate.POST(jsonRequest("/api/admin/assets/migrate", { files: [file], records: [{ kind: "item", id: 1, urls: [{ from: row.icon_url, key: file.key }] }, { kind: "item", id: 2, urls: [{ from: old, key: file.key }] }] }));
    expect(conflict.status).toBe(409);
    const restored = database.query<{ icon_url: string }, []>("SELECT icon_url FROM custom_items WHERE id=1").get();
    expect(restored?.icon_url).toBe(row.icon_url);
  });

  test("Baker sprite is committed art, not an ephemeral manual file", async () => {
    await bootstrap(); const data = Buffer.from("isolated baker sprite transport bytes"); const key = "assets/npc/baker-sprite.png";
    const form = new FormData(); form.append("expected", JSON.stringify([metadata(key, data)])); form.append("file", new File([data], "baker.png"));
    const response = await bakerSprite.POST(new Request("http://private-test.invalid/api/admin/baker/sprite", { method: "POST", headers: { "x-gm-secret": process.env.GM_API_SECRET! }, body: form }));
    expect(response.status).toBe(200); const result = await response.json();
    expect(await downloaded(result.url)).toEqual(data);
    expect(fs.readFileSync(A.resolveAssetPath(key))).toEqual(data);
  });

  test("streaming routes reject anonymous requests before parsing their bodies", async () => {
    for (const [path, handler] of [
      ["/api/launcher/upload", uploadRoute.POST],
      ["/api/admin/wz/upload", rawUpload.POST],
      ["/api/admin/baker/sprite", bakerSprite.POST],
    ] as const) {
      const response = await handler(new Request(`http://private-test.invalid${path}`, { method: "POST", body: "not a multipart body" }));
      expect(response.status).toBe(401);
    }
  });

  test("job liveness uses a kernel lock, not stale status, and durable status failure cannot acknowledge start", async () => {
    await bootstrap();
    for (const [name, handler] of [
      ["publish-status.json", itemJobs.POST],
      ["assets-publish-status.json", assetJobs.POST],
      ["reactor-publish-status.json", reactorJobs.POST],
    ] as const) {
      A.writePublicationStatus(name, { id: "previous-job", status: "running", startedAt: new Date().toISOString() });
      const unlock = await A.lockPublicationJob(name);
      try { expect((await handler()).status).toBe(409); }
      finally { unlock(); }
      mock.module("fs", () => ({ ...realFs, renameSync: (from: PathLike, to: PathLike) => {
        if (String(to) === join(assetsDirectory, "jobs", name)) throw new Error("injected durable job-status failure");
        return realFs.renameSync(from, to);
      } }));
      try {
        const response = await handler();
        expect(response.status).toBe(500);
        expect((await response.json()).started).not.toBe(true);
      } finally { mock.module("fs", () => realFs); }
    }
  });

  test("private writes authenticate and the real GM handler and CLI stage, commit, reject auth failure and roll back", async () => {
    await bootstrap();
    expect((await middleware(new NextRequest("http://private-test.invalid/api/launcher/manifest", { method: "POST" }))).status).toBe(401);
    expect((await middleware(new NextRequest("http://private-test.invalid/api/launcher/manifest"))).headers.get("x-middleware-next")).toBe("1");
    const gateway = createServer(async (incoming, outgoing) => {
      try {
        const url = `http://127.0.0.1${incoming.url}`;
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key, value);
        const auth = await middleware(new NextRequest(url, { method: incoming.method, headers }));
        let response: Response;
        if (auth.status === 401) response = auth;
        else if (incoming.method === "GET" && incoming.url === "/api/admin/assets/release") response = await privateAuthority.GET();
        else {
          // Node and DOM declarations disagree, but toWeb supplies this exact WHATWG stream at runtime.
          const body = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
          const init: RequestInit & { duplex: "half" } = { method: incoming.method, headers, body, duplex: "half" };
          const request = new Request(url, init);
          response = incoming.url === "/api/launcher/upload" ? await uploadRoute.POST(request) : await manifestRoute.POST(request);
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { outgoing.writeHead(500); outgoing.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
    process.env.COSMIC_DASHBOARD_URL = `http://127.0.0.1:${address.port}`;
    try {
      // The real GM client captures its private API origin at module load.
      const { toolHandlers } = await import("../src/lib/gamemaster/engine");
      const file = source("BunsMS.exe", Buffer.from("GM actual source publication"));
      const result = JSON.parse(await toolHandlers.publish_client_update({ files: [{ name: file.key, path: file.path, hash: file.hash, size: file.size }], operations: [] }));
      expect(result.success).toBe(true);
      expect(await downloaded(A.readManifest().manifest.files[0].url)).toEqual(fs.readFileSync(file.path));
      const beforeCli = A.readManifest().manifest.releaseId!;
      const cliSource = join(directory, "cli-input"); fs.mkdirSync(cliSource);
      const cliBytes = Buffer.from("real CLI independently hashes and streams these bytes");
      fs.writeFileSync(join(cliSource, "BunsMS.exe"), cliBytes);
      async function runCli(args: string[], credential = secretFile) {
        const child = Bun.spawn(["bash", join(import.meta.dir, "../../tools/publish_assets.sh"), ...args], {
          env: { ...process.env, DASHBOARD_URL: process.env.COSMIC_DASHBOARD_URL!, GM_SECRET_FILE: credential },
          stdout: "pipe", stderr: "pipe",
        });
        return { code: await child.exited, output: await new Response(child.stdout).text(), error: await new Response(child.stderr).text() };
      }
      const published = await runCli([cliSource]);
      expect(published.code).toBe(0);
      expect(published.output).toContain("Committed immutable release:");
      expect(await downloaded(A.readManifest().manifest.files[0].url)).toEqual(cliBytes);
      const committed = A.readManifest().manifest.releaseId;
      const wrongCredential = join(directory, "wrong-cli-credential"); fs.writeFileSync(wrongCredential, randomUUID(), { mode: 0o600 });
      const rejected = await runCli([cliSource], wrongCredential);
      expect(rejected.code).toBe(1); expect(rejected.output).not.toContain("Committed");
      expect(A.readManifest().manifest.releaseId).toBe(committed);
      const restored = await runCli(["--rollback", beforeCli]);
      expect(restored.code).toBe(0); expect(A.readManifest().manifest.releaseId).toBe(beforeCli);
      expect(await downloaded(A.readManifest().manifest.files[0].url)).toEqual(fs.readFileSync(file.path));
    } finally { await new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve())); }
  });
});
