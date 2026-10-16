"use strict";
// Execute the production IPC handlers against real HTTP transfers and real files.
// Electron's window/app shell alone is supplied by this Node test harness.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "buns-install-test-"));
  const original = path.join(root, "original"), changed = path.join(root, "changed");
  fs.mkdirSync(original); fs.mkdirSync(changed);
  const userIni = "[config]\nhost=192.168.0.187\nport=28484\nwidth=1366\nheight=768\n";
  const shellHandlers = new Map(), requests = [], payloads = new Map();
  let manifest, holdDownload = false, corruptDownload = false, releaseDownload, sawDownload;
  const transferStarted = new Promise((resolve) => { sawDownload = resolve; });
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith("/manifest")) return response.end(JSON.stringify(manifest));
    const bytes = payloads.get(request.url);
    if (!bytes) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { "Content-Length": corruptDownload ? 2 : bytes.length });
    if (corruptDownload) return response.end("NO");
    if (holdDownload && request.url.endsWith("BunsMS.dll")) {
      response.write(bytes.subarray(0, 2));
      releaseDownload = () => response.end(bytes.subarray(2));
      sawDownload();
    } else response.end(bytes);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    function publish(version, companion) {
      const content = new Map(["MapleStory.exe", "Kaentake.exe", "Kaentake.dll", "Custom.wz", "BunsMS.dll"]
        .map((name) => [name, Buffer.from(name === "BunsMS.dll" ? companion : `fixture-${name}`)]));
      content.set("config.ini", Buffer.from("[config]\nhost=buns.asslorde.com\nport=8484\n"));
      const files = [...content].map(([name, bytes]) => {
        const url = `/${version}/${name}`;
        payloads.set(url, bytes);
        return { name, size: bytes.length, hash: hash(bytes), url: base + url,
          profiles: ["kaentake"], ...(name === "config.ini" ? { configKind: "kaentake", mutable: true } : {}) };
      });
      const provenance = Buffer.from(JSON.stringify({ files: files.map(({ name, size, hash }) => ({ name, size, sha256: hash })) }));
      payloads.set(`/${version}/provenance.json`, provenance);
      manifest = { version, completeProfiles: ["kaentake"], files,
        provenance: { url: `${base}/${version}/provenance.json`, sha256: hash(provenance) } };
      return content;
    }
    const first = publish("first", "first-verified-companion");
    for (const [name, bytes] of first) fs.writeFileSync(path.join(original, name), bytes);
    fs.writeFileSync(path.join(original, "BunsMS.dll"), "old-usable-companion");
    fs.writeFileSync(path.join(original, "config.ini"), userIni);
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ activeProfile: "kaentake", profiles: { kaentake: { gamePath: original } } }));
    const mainPath = path.resolve(__dirname, "../src/main.js");
    const nativeRequire = createRequire(mainPath);
    const context = vm.createContext({
      require: (name) => name === "electron" ? {
        app: { getPath: () => root, whenReady: () => new Promise(() => {}), on() {} },
        ipcMain: { handle: (name, callback) => shellHandlers.set(name, callback) },
      } : nativeRequire(name),
      process: { env: { BUNSMS_API_BASE: base, BUNSMS_MANIFEST_URL: `${base}/manifest` }, argv: [] },
      __dirname: path.dirname(mainPath), Buffer, URL, console,
      setTimeout: (callback) => setImmediate(callback), clearTimeout,
    });
    vm.runInContext(fs.readFileSync(mainPath, "utf8"), context, { filename: mainPath });
    vm.runInContext("mainWindow = { webContents: { send() {} } }", context);
    const invoke = (name, ...args) => shellHandlers.get(name)({}, ...args);
    const checked = await invoke("launcher:checkUpdates");
    assert.equal(checked.status, "updates_available");
    assert.deepEqual(Array.from(checked.updates, (file) => file.name), ["BunsMS.dll"]);
    holdDownload = true;
    const installing = invoke("launcher:downloadUpdates", {
      profile: checked.profile, leaseId: checked.leaseId,
      updates: checked.updates.map((file) => ({ ...file, url: `${base}/poison`, hash: "0".repeat(64) })),
    });
    await transferStarted;
    publish("second", "second-verified-companion");
    assert.equal(invoke("profile:setPath", "kaentake", changed).success, true);
    invoke("profile:set", "stock");
    releaseDownload();
    assert.equal((await installing).success, true);
    assert.equal(fs.readFileSync(path.join(original, "BunsMS.dll"), "utf8"), first.get("BunsMS.dll").toString());
    assert.deepEqual(fs.readdirSync(changed), []);
    assert.equal(fs.readFileSync(path.join(original, "config.ini"), "utf8"), userIni);
    assert.equal(requests.includes("/poison"), false);
    assert.equal(requests.includes("/second/BunsMS.dll"), false);
    assert.equal((await invoke("launcher:downloadUpdates", checked)).success, false);

    // A short/corrupt response can never replace the previously usable bytes.
    holdDownload = false;
    invoke("profile:setPath", "kaentake", original);
    invoke("profile:set", "kaentake");
    const second = await invoke("launcher:checkUpdates");
    assert.equal(second.status, "updates_available");
    corruptDownload = true;
    const rejected = await invoke("launcher:downloadUpdates", { profile: second.profile, leaseId: second.leaseId, updates: second.updates });
    assert.equal(rejected.success, false);
    assert.match(rejected.error, /Size mismatch/);
    assert.equal(fs.readFileSync(path.join(original, "BunsMS.dll"), "utf8"), first.get("BunsMS.dll").toString());
    assert.equal(fs.readdirSync(original).some((name) => name.includes(".download-")), false);
    assert.equal(fs.readFileSync(path.join(original, "config.ini"), "utf8"), userIni);
    console.log("install: immutable profile/manifest lease, authoritative URLs, mutable INI, and failed-temp preservation passed");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
