const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const dns = require("dns").promises;
const { isIP } = require("net");
const { spawn } = require("child_process");
const release = require("./release-config.json");
const {
  PROFILES,
  stampStockIni,
  stampKaentakeIni,
  separationCheck,
  requiredClientFiles,
  isProfileConfig,
  readProfileHost,
  readIniValue,
  setIniSectionValues,
} = require("./profiles");

// RC metadata is packaged, not an ephemeral build environment variable.
// Explicit operator environment overrides are never renderer-controlled.
const API_BASE = process.env.BUNSMS_API_BASE || release.apiBase;
const MANIFEST_URL = process.env.BUNSMS_MANIFEST_URL || release.manifestUrl;
const NEWS_URL = `${API_BASE}/api/launcher/news`;
const STATUS_URL = `${API_BASE}/api/server`;

let mainWindow;
let gamePath = ""; // cache of the ACTIVE profile's dir; see profileDir()/setProfilePath()
const profileChecks = new Map();
const installLeases = new Map(); // At most one immutable checked snapshot per profile.

// Fresh installs use Kaentake; preserve explicit profiles and legacy stock paths.
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf-8"));
  } catch { return {}; }
}

// Existing legacy gamePath is an intentional stock choice, not a new-install default.
function activeProfileId() {
  const store = readStore();
  if (store.activeProfile === "stock" || store.activeProfile === "kaentake") return store.activeProfile;
  return store.gamePath || store.profiles?.stock?.gamePath ? "stock" : "kaentake";
}

function profileDir(id) {
  const store = readStore();
  const dir = store.profiles?.[id || activeProfileId()]?.gamePath;
  if (dir) return dir;
  // Legacy fallback: top-level gamePath belongs to stock (§8 migration).
  if ((id || activeProfileId()) === "stock" && store.gamePath) return store.gamePath;
  return "";
}

function refreshGamePath() {
  gamePath = profileDir() || "";
  return gamePath;
}

function setProfilePath(id, dir) {
  if (!PROFILES[id]) return { success: false, error: `Unknown profile: ${id}` };
  const otherId = id === "stock" ? "kaentake" : "stock";
  const otherDir = profileDir(otherId);
  const present = (() => { try { return fs.readdirSync(dir); } catch { return []; } })();
  const kaentakeIniText = (() => {
    if (id !== "kaentake") return "";
    try { return fs.readFileSync(path.join(dir, "config.ini"), "utf-8"); } catch { return ""; }
  })();
  const sep = separationCheck({ dir, otherDir, profileId: id, present, kaentakeIniText });
  if (!sep.ok) return { success: false, error: sep.reason };
  const store = readStore();
  const profiles = { ...(store.profiles || {}), [id]: { gamePath: dir } };
  saveConfig({ profiles, ...(id === "stock" ? { gamePath: dir } : {}) });
  if (id === activeProfileId()) gamePath = dir;
  return { success: true, ...(sep.warning ? { warning: sep.warning } : {}) };
}

function profileSummary(id) {
  const dir = profileDir(id);
  const def = PROFILES[id];
  let present = [];
  try { if (dir) present = fs.readdirSync(dir); } catch {}
  const exeFound = !!dir && present.some((name) => name.toLowerCase() === def.exe.toLowerCase());
  const otherDir = profileDir(id === "stock" ? "kaentake" : "stock");
  const kaentakeIniText = (() => {
    if (id !== "kaentake" || !dir) return "";
    try { return fs.readFileSync(path.join(dir, "config.ini"), "utf-8"); } catch { return ""; }
  })();
  const sep = dir
    ? separationCheck({ dir, otherDir, profileId: id, present, kaentakeIniText })
    : { ok: false, reason: "No folder selected for this profile yet." };
  const check = profileChecks.get(id);
  const current = check?.dir === dir ? check : null;
  return {
    id, label: def.label, path: dir || "", exeFound,
    depsOk: !!current && !current.error && current.updates.length === 0,
    missing: current ? current.updates.map((file) => file.name) : [],
    depsError: current?.error,
    separation: sep.ok ? (sep.warning ? { ok: true, warning: sep.warning } : "ok") : { ok: false, reason: sep.reason },
  };
}

// Resolve only at launch, asynchronously. Stored/UI host text is never replaced
// by its address; Ezorsia's numeric-only field gets IPv4, Kaentake keeps text.
async function stampHostIntoDir(id, dir, host) {
  const iniPath = await clientFilePath(dir, "config.ini");
  const ini = await fs.promises.readFile(iniPath, "utf-8");
  if (!isProfileConfig(id, ini))
    throw new Error(`Invalid ${id} config.ini; repair the complete client before launching.`);
  const endpoint = id === "stock" && isIP(host) !== 4
    ? (await dns.lookup(host, { family: 4 })).address : host;
  const next = id === "kaentake" ? stampKaentakeIni(ini, endpoint) : stampStockIni(ini, endpoint);
  await fs.promises.writeFile(iniPath, next, "utf-8");
  return endpoint;
}

// Kaentake's channel redirects are server-determined (WSPConnect hook rewrites only the
// initial 63.251.217.x login target): this stamp controls the initial login routing only.
const KAENTAKE_DEFAULT_PATHS = [
  "C:\\KaentakeMS",
  path.join(app.getPath("home"), "KaentakeMS"),
];
// Debug log file — writes to game folder so user can inspect
let logStream = null;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    if (!logStream && gamePath) {
      logStream = fs.createWriteStream(path.join(gamePath, "launcher.log"), { flags: "a" });
    }
    if (logStream) logStream.write(line + "\n");
  } catch {}
}

// Default game paths to check
const DEFAULT_PATHS = [
  "C:\\BunsMS",
  "C:\\Nexon\\MapleStory",
  "C:\\MapleStory",
  path.join(app.getPath("home"), "BunsMS"),
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: "#0a0a0f",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Dev tools in dev mode
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

// ── IPC Handlers ──

ipcMain.handle("window:minimize", () => mainWindow.minimize());
ipcMain.handle("window:close", () => mainWindow.close());

ipcMain.handle("shell:openExternal", (_, url) => shell.openExternal(url));

// ── Profiles: new channels (pure additions; legacy names below delegate) ──

ipcMain.handle("profile:get", () => {
  refreshGamePath();
  return { active: activeProfileId(), profiles: Object.keys(PROFILES).map(profileSummary) };
});

ipcMain.handle("profile:set", (_, id) => {
  if (!PROFILES[id]) return { success: false, error: `Unknown profile: ${id}` };
  saveConfig({ activeProfile: id });
  refreshGamePath();
  return { success: true, active: id, path: gamePath };
});

ipcMain.handle("profile:setPath", (_, id, dir) => setProfilePath(id, dir));

ipcMain.handle("profile:deps", async (_, id) => {
  try {
    const result = await inspectProfile(id, profileDir(id));
    return { missing: result.updates.map((file) => file.name), complete: result.updates.length === 0 };
  } catch (error) {
    return { missing: [], complete: false, error: error.message };
  }
});

ipcMain.handle("game:findPath", () => {
  // Check saved path first (active profile; legacy top-level gamePath seeds stock)
  refreshGamePath();
  if (gamePath && fs.existsSync(gamePath)) {
    return { found: true, path: gamePath };
  }

  // Check default paths for the active profile's exe
  const id = activeProfileId();
  const exe = PROFILES[id].exe;
  const searchPaths = id === "kaentake" ? KAENTAKE_DEFAULT_PATHS : DEFAULT_PATHS;
  for (const p of searchPaths) {
    const exePath = path.join(p, exe);
    if (fs.existsSync(exePath)) {
      setProfilePath(id, p);
      refreshGamePath();
      return { found: true, path: gamePath };
    }
  }

  return { found: false, path: null };
});

ipcMain.handle("game:setPath", (_, newPath) => {
  // Legacy stock alias: delegates to the stock profile (top-level mirror kept for downgrade).
  return setProfilePath("stock", newPath);
});

// Canonical default; public native-port activation is intentionally deferred.
// Explicit stored QA/user overrides remain authoritative; never fall back to LAN.
const DEFAULT_SERVER_HOST = "buns.asslorde.com";

// Explicit stored choice wins; otherwise display the same profile-owned host
// that launch preserves. Backend status is not authority to select a LAN host.
ipcMain.handle("server:getHost", () => {
  const stored = readStore().serverHost;
  if (stored) return stored;
  const id = activeProfileId(), dir = profileDir(id);
  if (dir) {
    try {
      const ini = fs.readFileSync(path.join(dir, "config.ini"), "utf-8");
      if (isProfileConfig(id, ini)) {
        const host = readProfileHost(id, ini);
        if (host) return host;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return DEFAULT_SERVER_HOST;
});

ipcMain.handle("server:setHost", (_, host) => {
  host = String(host || "").trim();
  if (!host) return { success: false, error: "Empty host" };
  saveConfig({ serverHost: host });
  return { success: true, host };
});


ipcMain.handle("game:selectFolder", async () => {
  const { dialog } = require("electron");
  const active = activeProfileId();
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: active === "kaentake" ? "Select Kaentake Installation Folder (isolated)" : "Select BunsMS Installation Folder",
  });
  if (result.canceled || !result.filePaths.length) return null;
  const selected = result.filePaths[0];
  const res = setProfilePath(active, selected);
  if (!res.success) return { error: res.error };
  refreshGamePath();
  return selected;
});

ipcMain.handle("game:launch", async () => {
  const id = activeProfileId();
  const dir = profileDir(id);
  const storedHost = readStore().serverHost; // Snapshot before asynchronous preflight.
  if (!dir) return { success: false, error: "Game path not set" };
  try {
    const { files, updates } = await inspectProfile(id, dir);
    if (updates.length) {
      return {
        success: false,
        error: `Complete client preflight failed: ${updates.length} required file(s) need repair.`,
        missing: updates.map((file) => file.name),
      };
    }
    if (files.some((file) => file.name.toLowerCase() === "config.ini")) {
      const iniPath = await clientFilePath(dir, "config.ini");
      const ini = await fs.promises.readFile(iniPath, "utf-8");
      const host = storedHost || readProfileHost(id, ini) || DEFAULT_SERVER_HOST;
      await stampHostIntoDir(id, dir, host);
    }
    const exePath = await clientFilePath(dir, PROFILES[id].exe);
    const process = await startNativeClient(id, exePath, dir);
    return { success: true, state: "process-started", ...process };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("server:status", async () => {
  try {
    const data = await fetchJSON(STATUS_URL);
    return {
      online: data?.status === "running",
      players: data?.players || 0,
      gameHost: typeof data?.gameHost === "string" ? data.gameHost : undefined,
      gamePort: data?.gamePort || 8484,
    };
  } catch {
    return { online: false, players: 0 };
  }
});

ipcMain.handle("launcher:news", async () => {
  try {
    return await fetchJSON(NEWS_URL);
  } catch {
    return { news: [] };
  }
});

// Site/config helpers so the renderer never hardcodes the deploy domain.
ipcMain.handle("site:open", (_, sitePath) => shell.openExternal(API_BASE + (sitePath || "/")));
ipcMain.handle("site:config", async () => {
  try {
    const data = await fetchJSON(`${API_BASE}/api/config`);
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
});

// HD files that get removed when HD mode is disabled
const HD_FILES = ["dinput8.dll", "config.ini", "EzorsiaV2_UI.wz"];

ipcMain.handle("settings:getHD", () => {
  const configPath = path.join(app.getPath("userData"), "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.hdMode || false;
  } catch { return false; }
});

ipcMain.handle("settings:setHD", (_, enabled) => {
  // HD is Ezorsia/stock-only: refuse to target a Kaentake dir. Cleanup below
  // always runs against the STOCK dir (never the active Kaentake dir), so a
  // Kaentake config.ini can never be wiped from here.
  if (enabled && activeProfileId() === "kaentake") {
    return { success: false, error: "HD Mode is BunsMS-only and does not apply to the Kaentake profile." };
  }
  saveConfig({ hdMode: enabled });
  const stockDir = profileDir("stock");
  if (!enabled && stockDir) {
    const failed = [];
    for (const name of HD_FILES) {
      const filePath = path.join(stockDir, name);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        failed.push(name);
      }
    }
    if (failed.length > 0) {
      return {
        success: true,
        warning: `Could not remove: ${failed.join(", ")}. Close BunsMS and try toggling HD off again, or manually delete from game folder.`,
      };
    }
  }

  return { success: true };
});

ipcMain.handle("settings:getHDOptions", () => {
  const configPath = path.join(app.getPath("userData"), "config.json");
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {}

  // If config.ini exists in the STOCK folder, treat it as the source of truth
  // for sleepTime — the user may have edited it manually to fix a startup crash.
  // Never sniff the Kaentake dir (different schema, no sleepTime).
  let iniSleepTime = null;
  const stockDirForSniff = profileDir("stock");
  if (stockDirForSniff) {
    const iniPath = path.join(stockDirForSniff, "config.ini");
    try {
      if (fs.existsSync(iniPath)) {
        const value = readIniValue(fs.readFileSync(iniPath, "utf-8"), "debug", "sleepTime");
        if (value !== null && /^\d+/.test(value)) iniSleepTime = parseInt(value);
      }
    } catch {}
  }

  return {
    resolution: stored.hdResolution || "1280x720",
    fullscreen: stored.hdFullscreen || false,
    sleepTime: iniSleepTime ?? (typeof stored.hdSleepTime === "number" ? stored.hdSleepTime : 30),
  };
});

ipcMain.handle("settings:setHDOptions", (_, { resolution, fullscreen, sleepTime }) => {
  // HD options only ever touch the stock dir (configKind gate).
  const stockDir = profileDir("stock");
  if (activeProfileId() === "kaentake" || (gamePath && stockDir && gamePath !== profileDir("stock"))) {
    return { success: false, error: "HD options apply to the BunsMS profile only." };
  }
  const patch = { hdResolution: resolution, hdFullscreen: fullscreen };

  // Write config.ini in game directory if it exists. Only patch the specific
  // keys we manage — preserve everything else (sleepTime if not provided,
  // custom dlls, dev flags, etc.) so users can hand-edit other fields.
  if (stockDir) {
    const iniPath = path.join(stockDir, "config.ini");
    if (fs.existsSync(iniPath)) {
      try {
        let ini = fs.readFileSync(iniPath, "utf-8");
        const [w, h] = resolution.split("x");
        ini = setIniSectionValues(ini, "general", { width: w, height: h, WindowedMode: fullscreen ? "false" : "true" });
        if (typeof sleepTime === "number" && sleepTime >= 0) {
          ini = setIniSectionValues(ini, "debug", { sleepTime });
        }
        fs.writeFileSync(iniPath, ini);
      } catch (err) {
        console.error("Failed to update config.ini:", err);
      }
    }
  }

  return { success: true };
});

ipcMain.handle("launcher:checkUpdates", async () => {
  const id = activeProfileId();
  const dir = profileDir(id);
  if (!dir) return { status: "no_path" };
  try {
    const { manifest, files, updates } = await inspectProfile(id, dir);
    const leaseId = crypto.randomUUID();
    installLeases.set(id, Object.freeze({ leaseId, id, dir, manifest, files, updates }));
    return {
      status: updates.length ? "updates_available" : "up_to_date",
      version: manifest.version,
      profile: id, leaseId,
      verifiedFiles: files.length - updates.length,
      updates,
      totalSize: updates.reduce((size, file) => size + file.size, 0),
    };
  } catch (error) {
    return { status: "error", error: error.message };
  }
});

ipcMain.handle("launcher:downloadUpdates", async (_, request) => {
  const lease = installLeases.get(request?.profile);
  if (!lease || lease.leaseId !== request?.leaseId)
    return { success: false, error: "Check this profile's complete manifest again before installing." };
  const { id, dir, manifest, files, updates } = lease;
  if (profileDir(id) !== dir)
    return { success: false, error: "The checked client folder changed. Check its complete manifest again." };
  installLeases.delete(id); // A lease can start only one install operation.
  try {
    const requested = new Set((request.updates || []).map((file) => file.name));
    if (!requested.size || updates.length !== requested.size || updates.some((file) => !requested.has(file.name)))
      throw new Error("The requested files do not match the checked complete manifest.");
    await fs.promises.mkdir(dir, { recursive: true });
    const operation = crypto.randomUUID();
    for (let index = 0; index < updates.length; index++) {
      // Use publisher-authoritative entries, never renderer-supplied URLs/hashes.
      const file = updates[index];
      const destination = await clientFilePath(dir, file.name);
      const partial = `${destination}.download-${operation}`;
      const progress = (percent, status) => mainWindow.webContents.send("download:progress", {
        profile: id, file: file.name, index, total: updates.length, percent, status,
      });
      const maxAttempts = 5; // Preserve the existing bounded resume policy.
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          progress(0, attempt > 1 ? `Retry ${attempt}/${maxAttempts}` : undefined);
          await downloadFile(file.url, partial, file.size, (percent) => progress(percent));
          const stats = await fs.promises.stat(partial);
          if (stats.size !== file.size) throw new Error(`Size mismatch for ${file.name}`);
          progress(100, "Verifying...");
          if (await hashFile(partial) !== file.hash.toLowerCase()) {
            await fs.promises.unlink(partial);
            throw new Error(`Hash mismatch for ${file.name}`);
          }
          // Replace only after verification; a failed transfer keeps the user's
          // previous file intact and never follows a final-file symlink to write.
          await fs.promises.rename(partial, destination);
          break;
        } catch (error) {
          if (attempt === maxAttempts) {
            await fs.promises.rm(partial, { force: true });
            throw new Error(`Failed to install ${file.name}: ${error.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    const remaining = await inspectClientFiles(id, dir, files);
    profileChecks.set(id, { dir, updates: remaining });
    if (remaining.length)
      throw new Error(`Complete client verification still needs ${remaining.length} file(s).`);
    // Keep the stored host text untouched. Managed INI fields are stamped only
    // when launching, after complete-file verification has succeeded.
    return { success: true, version: manifest.version, verifiedFiles: files.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── Helpers ──

function saveConfig(config) {
  const configPath = path.join(app.getPath("userData"), "config.json");
  try {
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {}
    fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...config }, null, 2));
  } catch {}
}

function fetchBytes(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const request = mod.get(url, { timeout: 10000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return fetchBytes(new URL(response.headers.location, url).href).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Metadata request failed: HTTP ${response.statusCode}`));
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Metadata request timed out")));
  });
}

async function fetchJSON(url) {
  return JSON.parse((await fetchBytes(url)).toString("utf-8"));
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// Resolve existing names case-insensitively, like the Windows loader, without
// creating Linux case-colliding engine DLLs during repair.
async function clientFilePath(dir, name, directories = new Map()) {
  const parts = name.replace(/\\/g, "/").split("/");
  let cursor = path.resolve(dir);
  for (const part of parts) {
    if (!directories.has(cursor)) {
      try { directories.set(cursor, await fs.promises.readdir(cursor)); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        directories.set(cursor, []);
      }
    }
    const matches = directories.get(cursor).filter((entry) => entry.toLowerCase() === part.toLowerCase());
    if (matches.length > 1)
      throw new Error(`Case-colliding client paths in ${cursor}: ${matches.join(", ")}`);
    cursor = path.join(cursor, matches[0] || part);
    if (matches.length) {
      const stats = await fs.promises.lstat(cursor);
      if (stats.isSymbolicLink())
        throw new Error(`Client files must stay inside their isolated folder: ${cursor}`);
    }
  }
  return cursor;
}

async function inspectClientFiles(id, dir, files) {
  const directories = new Map();
  const updates = [];
  for (const file of files) {
    const localPath = await clientFilePath(dir, file.name, directories);
    try {
      const stats = await fs.promises.stat(localPath);
      if (!stats.isFile()) {
        updates.push({ ...file, reason: "not_file" });
      } else if (file.mutable) {
        const text = await fs.promises.readFile(localPath, "utf-8");
        if (!isProfileConfig(id, text)) updates.push({ ...file, reason: "invalid_config" });
      } else if (stats.size !== file.size) {
        updates.push({ ...file, reason: "size_mismatch" });
      } else if (await hashFile(localPath) !== file.hash.toLowerCase()) {
        updates.push({ ...file, reason: "hash_mismatch" });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      updates.push({ ...file, reason: "missing" });
    }
  }
  return updates;
}

async function inspectProfile(id, dir) {
  if (!PROFILES[id] || !dir) throw new Error("Choose a client profile and its isolated folder first.");
  try {
    const summary = profileSummary(id);
    if (summary.separation !== "ok" && !summary.separation?.ok)
      throw new Error(summary.separation.reason);
    const hdMode = !!readStore().hdMode;
    if (id === "stock" && !hdMode) {
      let names = [];
      try { names = await fs.promises.readdir(dir); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (names.some((name) => name.toLowerCase() === "dinput8.dll"))
        throw new Error("HD mode is disabled but its dinput8.dll is still present. Use the HD setting to remove it or select an isolated rollback folder.");
    }
    const url = new URL(MANIFEST_URL);
    url.searchParams.set("profile", id); // New launcher always names its profile.
    const manifest = await fetchJSON(url.href);
    const files = Object.freeze(requiredClientFiles(manifest, id, hdMode).map((file) => {
      const address = new URL(file.url, `${API_BASE}/`);
      if (address.protocol !== "https:" && address.protocol !== "http:")
        throw new Error(`Unsupported client download URL for ${file.name}`);
      return Object.freeze({ ...file, url: address.href });
    }));
    const provenance = manifest.provenance;
    if (!provenance?.url || !/^[a-f\d]{64}$/i.test(provenance.sha256 || ""))
      throw new Error("Complete client manifest has no pinned provenance authority.");
    const bytes = await fetchBytes(new URL(provenance.url, url).href);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== provenance.sha256.toLowerCase())
      throw new Error("Complete client provenance hash does not match the published pin.");
    const sourceFiles = JSON.parse(bytes.toString("utf-8")).files;
    const key = (name) => String(name).replace(/\\/g, "/").toLowerCase();
    const required = new Map(files.map((file) => [key(file.name), file]));
    if (!Array.isArray(sourceFiles) || sourceFiles.length !== files.length)
      throw new Error("Complete client manifest and provenance have different file sets.");
    const seen = new Set();
    for (const source of sourceFiles) {
      const name = key(source.name);
      const file = required.get(name);
      if (seen.has(name) || !file || source.size !== file.size ||
          String(source.sha256).toLowerCase() !== file.hash.toLowerCase())
        throw new Error(`Complete client provenance disagrees on ${source.name || "<unnamed>"}.`);
      seen.add(name);
    }
    const updates = await inspectClientFiles(id, dir, files);
    profileChecks.set(id, { dir, updates });
    return { manifest, files, updates };
  } catch (error) {
    profileChecks.set(id, { dir, updates: [], error: error.message });
    throw error;
  }
}

function launchStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("game:launchStatus", message);
}

function startNativeClient(id, executable, dir) {
  return new Promise((resolve, reject) => {
    const elevated = process.platform === "win32" && PROFILES[id].requiresElevation;
    let command;
    let args;
    const environment = { ...process.env }; // Includes the user's WINEPREFIX/environment.
    if (elevated) {
      // Normal ShellExecute UAC flow required by the pinned Kaentake manifest.
      // Report actual OS creation, then the real launcher exit; never claim login.
      environment.BUNSMS_LAUNCH_EXE = executable;
      environment.BUNSMS_LAUNCH_DIR = dir;
      command = "powershell.exe";
      args = ["-NoProfile", "-NonInteractive", "-Command", [
        "$ErrorActionPreference='Stop'",
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
        "try {",
        "$p=Start-Process -FilePath $env:BUNSMS_LAUNCH_EXE -WorkingDirectory $env:BUNSMS_LAUNCH_DIR -Verb RunAs -PassThru",
        "[Console]::Out.WriteLine('BUNS_STARTED:'+$p.Id)",
        "$p.WaitForExit(); exit $p.ExitCode",
        "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
      ].join("; ")];
    } else if (process.platform === "linux") {
      command = "wine";
      args = [executable];
    } else if (process.platform === "win32") {
      command = executable;
      args = [];
    } else {
      return reject(new Error("Native client launch is supported on Windows and Linux with Wine."));
    }
    let child;
    try {
      child = spawn(command, args, { cwd: dir, env: environment, stdio: elevated ? ["ignore", "pipe", "pipe"] : "ignore" });
    } catch (error) {
      return reject(error);
    }
    let started = false;
    let pid;
    let output = "";
    let startupError = "";
    const startedProcess = (actualPid) => {
      if (started) return;
      started = true;
      pid = actualPid;
      const runner = process.platform === "linux" ? "wine" : "windows";
      launchStatus({ profile: id, state: "process-started", pid, runner });
      resolve({ pid, runner });
    };
    if (elevated) {
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = /(?:^|\r?\n)BUNS_STARTED:(\d+)(?:\r?\n)/.exec(output);
        if (match) startedProcess(Number(match[1]));
      });
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk) => {
        if (startupError.length < 4096) startupError = (startupError + chunk).slice(0, 4096);
      });
    } else {
      child.once("spawn", () => startedProcess(child.pid));
    }
    child.once("error", (error) => {
      if (!started) reject(new Error(`Could not start ${command}: ${error.message}`));
      else launchStatus({ profile: id, state: "error", pid, error: error.message });
    });
    child.once("close", (code, signal) => {
      if (!started) {
        reject(new Error(startupError.trim() || `Client did not start (${code ?? signal}).`));
      } else {
        launchStatus({ profile: id, state: "exited", pid, code, signal, error: startupError.trim() || undefined });
      }
    });
  });
}

function downloadFile(url, dest, expectedSize, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;

    // Check for existing partial file to resume
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let existingSize = 0;
    try { existingSize = fs.statSync(dest).size; } catch {}

    const headers = {};
    if (existingSize > 0 && expectedSize && existingSize < expectedSize) {
      headers["Range"] = `bytes=${existingSize}-`;
    } else if (existingSize > 0) {
      // File exists but is same size or larger — start fresh
      existingSize = 0;
    }

    const req = mod.get(url, { headers, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // drain the response
        return downloadFile(new URL(res.headers.location, url).href, dest, expectedSize, onProgress).then(resolve).catch(reject);
      }

      const isResume = res.statusCode === 206;
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      // If server doesn't support Range, start from scratch
      if (!isResume && existingSize > 0) {
        existingSize = 0;
      }

      const contentLength = parseInt(res.headers["content-length"], 10) || 0;
      const totalSize = isResume ? existingSize + contentLength : (contentLength || expectedSize || 0);
      let downloaded = existingSize;

      const fileStream = fs.createWriteStream(dest, isResume ? { flags: "a" } : {});

      // Socket timeout: abort if no data for 30 seconds
      res.socket?.setTimeout(30000);
      res.socket?.on("timeout", () => {
        req.destroy(new Error("Download stalled (30s timeout)"));
      });

      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) onProgress(Math.round((downloaded / totalSize) * 100));
      });

      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close(() => resolve());
      });

      fileStream.on("error", (err) => {
        fileStream.close();
        reject(err);
      });

      res.on("error", (err) => {
        fileStream.close();
        reject(err);
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Connection timeout"));
    });
  });
}
