const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const {
  PROFILES,
  KAENTAKE_PORT,
  filterManifest,
  stampStockIni,
  stampKaentakeIni,
  separationCheck,
  missingStockDeps,
  assertDownloadable,
} = require("./profiles");

// API base: runtime override via the BUNSMS_API_BASE process env (NOT baked at
// build time — Electron reads process.env at launch). Default prod
// (https://buns.asslorde.com); to reach the test dashboard, launch with
// BUNSMS_API_BASE=http://192.168.0.164:3001 (plain http allowed for LAN).
const API_BASE = process.env.BUNSMS_API_BASE || "https://buns.asslorde.com";
const MANIFEST_URL = `${API_BASE}/api/launcher/manifest`;
const NEWS_URL = `${API_BASE}/api/launcher/news`;
const STATUS_URL = `${API_BASE}/api/server`;

let mainWindow;
let gamePath = ""; // cache of the ACTIVE profile's dir; see profileDir()/setProfilePath()

// ── Profiles (design §2): stock default, Kaentake opt-in, separate folders ──
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf-8"));
  } catch { return {}; }
}

// First run with profile support: seed profiles from the legacy top-level gamePath.
function activeProfileId() {
  const store = readStore();
  return store.activeProfile === "kaentake" ? "kaentake" : "stock";
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
  const host = store.serverHost;
  if (host && fs.existsSync(path.join(dir, "config.ini"))) stampHostIntoDir(id, dir, host);
  return { success: true, ...(sep.warning ? { warning: sep.warning } : {}) };
}

function profileSummary(id) {
  const dir = profileDir(id);
  const def = PROFILES[id];
  let present = [];
  try { if (dir) present = fs.readdirSync(dir); } catch {}
  const exeFound = !!dir && present.includes(def.exe);
  const otherDir = profileDir(id === "stock" ? "kaentake" : "stock");
  const kaentakeIniText = (() => {
    if (id !== "kaentake" || !dir) return "";
    try { return fs.readFileSync(path.join(dir, "config.ini"), "utf-8"); } catch { return ""; }
  })();
  const sep = dir
    ? separationCheck({ dir, otherDir, profileId: id, present, kaentakeIniText })
    : { ok: false, reason: "No folder selected for this profile yet." };
  const missing = id === "kaentake" && dir
    ? missingStockDeps(present, def.requiredStockFiles)
    : [];
  return {
    id, label: def.label, path: dir || "", exeFound,
    depsOk: missing.length === 0, missing,
    separation: sep.ok ? (sep.warning ? { ok: true, warning: sep.warning } : "ok") : { ok: false, reason: sep.reason },
  };
}

// Host writers, selected by profile configKind (never by sniffing file content).
function stampHostIntoDir(id, dir, host) {
  const iniPath = path.join(dir, "config.ini");
  if (!fs.existsSync(iniPath)) return false;
  try {
    const ini = fs.readFileSync(iniPath, "utf-8");
    const next = id === "kaentake" ? stampKaentakeIni(ini, host) : stampStockIni(ini, host);
    fs.writeFileSync(iniPath, next);
    return true;
  } catch (err) {
    console.error(`Failed to write host into ${iniPath}:`, err);
    return false;
  }
}

function stampHostIntoAllProfiles(host) {
  const stamped = {};
  for (const id of Object.keys(PROFILES)) {
    const dir = profileDir(id);
    stamped[id] = dir ? stampHostIntoDir(id, dir, host) : false;
  }
  return stamped;
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

ipcMain.handle("profile:deps", (_, id) => {
  if (!PROFILES[id]) return { missing: [], error: `Unknown profile: ${id}` };
  const dir = profileDir(id);
  let present = [];
  try { if (dir) present = fs.readdirSync(dir); } catch {}
  return { missing: id === "kaentake" ? missingStockDeps(present, PROFILES.kaentake.requiredStockFiles) : [] };
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

const DEFAULT_SERVER_HOST = "213.188.212.103";

// Server host: written into config.ini ServerIP_Address so the HD DLL routes
// the compiled client (fixed login port 8484) at the chosen host. The launcher
// owns this file after download (manifest ships a prod-default copy), so the
// recipe is coherent: host here + host:8484 reachable + port-forward only if
// the operator remaps 8484 elsewhere.
ipcMain.handle("server:getHost", () => {
  const configPath = path.join(app.getPath("userData"), "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.serverHost) return config.serverHost;
  } catch {}
  return DEFAULT_SERVER_HOST;
});

ipcMain.handle("server:setHost", (_, host) => {
  host = String(host || "").trim();
  if (!host) return { success: false, error: "Empty host" };
  saveConfig({ serverHost: host });
  refreshGamePath();
  const stamped = stampHostIntoAllProfiles(host);
  return { success: true, host, stamped };
});

function writeServerHostToIni(host) {
  // Stock writer; delegates to the pure string transform (design §4).
  refreshGamePath();
  return stampHostIntoDir("stock", gamePath, host);
}

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

ipcMain.handle("game:launch", () => {
  refreshGamePath();
  const id = activeProfileId();
  const exeName = PROFILES[id].exe;
  if (!gamePath) return { success: false, error: "Game path not set" };
  const exePath = path.join(gamePath, exeName);
  if (!fs.existsSync(exePath))
    return { success: false, error: `${exeName} not found` };

  // Kaentake: hard separation stop before anything else. Electron cannot
  // elevate — Kaentake needs run-as-admin; surface guidance, no silent fallback.
  if (id === "kaentake") {
    let present = [];
    try { present = fs.readdirSync(gamePath); } catch {}
    let iniText = "";
    try { iniText = fs.readFileSync(path.join(gamePath, "config.ini"), "utf-8"); } catch {}
    const sep = separationCheck({
      dir: gamePath, otherDir: profileDir("stock"), profileId: "kaentake",
      present, kaentakeIniText: iniText,
    });
    if (!sep.ok) return { success: false, error: sep.reason };
    // Ensure host/port stamped before launch.
    const host = readStore().serverHost || DEFAULT_SERVER_HOST;
    stampHostIntoDir("kaentake", gamePath, host);
    const { execFile } = require("child_process");
    execFile(exePath, { cwd: gamePath }, (err) => {
      if (err) console.error("Launch error:", err);
    });
    return {
      success: true,
      ...(sep.warning ? { warning: sep.warning } : {}),
      note: "If Kaentake fails to start, right-click Kaentake.exe → Run as administrator (the injector requires elevation; the launcher cannot elevate it).",
    };
  }
  // Safety check: remove Ezorsia dinput8.dll if HD mode is off
  // Windows auto-loads any dinput8.dll in the exe directory, causing crashes
  let hdMode = false;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf-8"));
    hdMode = config.hdMode || false;
  } catch {}

  if (!hdMode) {
    const staleFiles = [];
    for (const name of HD_FILES) {
      const filePath = path.join(gamePath, name);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); }
        catch { staleFiles.push(name); }
      }
    }
    if (staleFiles.includes("dinput8.dll")) {
      return {
        success: false,
        error: "Cannot remove dinput8.dll from game folder (file may be locked). Close any running BunsMS processes and try again, or manually delete it from: " + gamePath,
      };
    }
  }

  const { execFile } = require("child_process");
  execFile(exePath, { cwd: gamePath }, (err) => {
    if (err) console.error("Launch error:", err);
  });

  return { success: true };
});

ipcMain.handle("server:status", async () => {
  try {
    const data = await fetchJSON(STATUS_URL);
    return {
      online: data?.status === "running",
      players: data?.players || 0,
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
        const m = fs.readFileSync(iniPath, "utf-8").match(/^sleepTime=(\d+)/m);
        if (m) iniSleepTime = parseInt(m[1]);
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
        ini = ini.replace(/^width=.*/m, `width=${w}`);
        ini = ini.replace(/^height=.*/m, `height=${h}`);
        ini = ini.replace(/^WindowedMode=.*/m, `WindowedMode=${fullscreen ? "false" : "true"}`);
        if (typeof sleepTime === "number" && sleepTime >= 0) {
          ini = ini.replace(/^sleepTime=\d+/m, `sleepTime=${sleepTime}`);
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
  refreshGamePath();
  const id = activeProfileId();
  if (!gamePath) return { status: "no_path" };

  // Read HD mode setting
  let hdMode = false;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf-8"));
    hdMode = config.hdMode || false;
  } catch {}

  // Proactively clean up HD files when HD mode is off — stock profile only,
  // so a Kaentake dir is never touched here. Prevents crashes
  // if user manually placed files or launched the exe directly
  if (id === "stock" && !hdMode) {
    for (const name of HD_FILES) {
      const filePath = path.join(gamePath, name);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }
  }

  // Kaentake separation gate also blocks update checks on a mixed dir.
  if (id === "kaentake") {
    let present = [];
    try { present = fs.readdirSync(gamePath); } catch {}
    let iniText = "";
    try { iniText = fs.readFileSync(path.join(gamePath, "config.ini"), "utf-8"); } catch {}
    const sep = separationCheck({
      dir: gamePath, otherDir: profileDir("stock"), profileId: "kaentake",
      present, kaentakeIniText: iniText,
    });
    if (!sep.ok) return { status: "error", error: sep.reason };
  }

  try {
    // The dashboard serves per-profile filtering (?profile=, absent = stock);
    // filter client-side too so behavior is unchanged either way.
    const manifest = await fetchJSON(`${MANIFEST_URL}?profile=${id}`);
    if (!manifest || !manifest.files) return { status: "error", error: "Invalid manifest" };

    const files = filterManifest(manifest.files, id, hdMode);
    const updates = [];
    for (const file of files) {
      // Fallback only: entries with no URL have nothing to fetch — verify a
      // local copy if present, else report manual_copy_needed (never download).
      if (!file.url) {
        const localPath = path.join(gamePath, file.name);
        if (!fs.existsSync(localPath)) {
          log(`${file.name}: missing (manual copy needed)`);
          updates.push({ ...file, reason: "manual_copy_needed" });
          continue;
        }
        if (file.hash) {
          const localHash = await hashFile(localPath);
          if (localHash !== file.hash) {
            log(`${file.name}: hash mismatch on local copy`);
            updates.push({ ...file, reason: "manual_copy_mismatch" });
          }
        }
        continue;
      }

      const localPath = path.join(gamePath, file.name);
      if (!fs.existsSync(localPath)) {
        log(`${file.name}: missing`);
        updates.push({ ...file, reason: "missing" });
        continue;
      }

      // Skip hash check for config.ini if it exists (user may have customized it)
      if (file.name === "config.ini" && file.hd) continue;

      // Check file size first (fast)
      const stats = fs.statSync(localPath);
      if (stats.size !== file.size) {
        log(`${file.name}: size mismatch (local=${stats.size}, expected=${file.size})`);
        updates.push({ ...file, reason: "size_mismatch" });
        continue;
      }

      // Check hash if sizes match (slower but accurate)
      if (file.hash) {
        const localHash = await hashFile(localPath);
        if (localHash !== file.hash) {
          log(`${file.name}: hash mismatch (local=${localHash.slice(0,16)}..., expected=${file.hash.slice(0,16)}...)`);
          updates.push({ ...file, reason: "hash_mismatch" });
        }
      }
    }
    log(`Update check: ${updates.length} files need updating: ${updates.map(u => u.name).join(", ") || "none"}`);

    return {
      status: updates.length > 0 ? "updates_available" : "up_to_date",
      version: manifest.version,
      updates,
      totalSize: updates.reduce((s, f) => s + f.size, 0),
    };
  } catch (err) {
    return { status: "error", error: err.message };
  }
});

ipcMain.handle("launcher:downloadUpdates", async (_, updates) => {
  refreshGamePath();
  if (!gamePath || !updates?.length) return { success: false };

  // Pre-check: ensure target directory exists and is writable
  try {
    fs.mkdirSync(gamePath, { recursive: true });
    const testFile = path.join(gamePath, ".buns-write-test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (err) {
    return {
      success: false,
      error: `Cannot write to game folder: ${gamePath}\n\n${err.message}\n\nTry choosing a different folder (e.g. C:\\BunsMS), or run the launcher as Administrator.`,
    };
  }

  for (let i = 0; i < updates.length; i++) {
    const file = updates[i];
    // Fallback-only guard: URL-less entries have nothing to fetch and must
    // never reach downloadFile; normally-hosted entries download as usual.
    try { assertDownloadable(file); } catch (err) { return { success: false, error: err.message }; }
    const destPath = path.join(gamePath, file.name);

    const sendProgress = (percent, status) => {
      mainWindow.webContents.send("download:progress", {
        file: file.name,
        index: i,
        total: updates.length,
        percent,
        status,
      });
    };

    const MAX_RETRIES = 5;
    let success = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log(`Download ${file.name} attempt ${attempt}/${MAX_RETRIES} from ${file.url}`);
        sendProgress(0, attempt > 1 ? `Retry ${attempt}/${MAX_RETRIES}` : undefined);

        await downloadFile(file.url, destPath, file.size, (percent) => sendProgress(percent));

        // Verify file size
        const stats = fs.statSync(destPath);
        log(`${file.name}: downloaded ${stats.size} bytes, expected ${file.size}`);
        if (file.size && stats.size !== file.size) {
          throw new Error(`Size mismatch: got ${stats.size}, expected ${file.size}`);
        }

        // Verify hash
        if (file.hash) {
          sendProgress(100, "Verifying...");
          const localHash = await hashFile(destPath);
          log(`${file.name}: hash ${localHash === file.hash ? "OK" : "MISMATCH"} (local=${localHash.slice(0,16)}... expected=${file.hash.slice(0,16)}...)`);
          if (localHash !== file.hash) {
            // Hash failed — delete and retry from scratch
            try { fs.unlinkSync(destPath); } catch {}
            throw new Error(`Hash mismatch after download`);
          }
        }

        log(`${file.name}: OK`);
        success = true;
        break;
      } catch (err) {
        log(`${file.name}: attempt ${attempt} failed: ${err.message}`);
        if (attempt === MAX_RETRIES) {
          let hint = "";
          const msg = err.message || "";
          if (msg.includes("EPROTO") || msg.includes("WRONG_VERSION_NUMBER") || msg.includes("SSL")) {
            hint = "\n\nThis looks like a network/SSL issue. A firewall, proxy, or antivirus may be blocking the download. Try:\n• Disable VPN or proxy\n• Temporarily disable antivirus\n• Download files manually from: https://github.com/joshhmann/bunsms/releases/tag/client-v1.0.1";
          } else if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET")) {
            hint = "\n\nConnection issue. Check your internet and try again. You can also download files manually from: https://github.com/joshhmann/bunsms/releases/tag/client-v1.0.1";
          }
          return { success: false, error: `Failed to download ${file.name}: ${msg}${hint}` };
        }
        // Only delete partial file for non-resumable errors
        // Resume-capable: keep the partial file so next attempt uses Range header
        if (err.message && err.message.includes("Hash mismatch")) {
          try { fs.unlinkSync(destPath); } catch {}
        }
        // Brief backoff before retry
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    // Defensive: if we somehow exit retries without success or early return
    if (!success) {
      return { success: false, error: `Failed to download ${file.name} after ${MAX_RETRIES} retries` };
    }
  }

  // After any download set completes, stamp the saved server host into
  // config.ini (fresh downloads ship the prod-default copy from R2).
  try {
    const config = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf-8"));
    if (config.serverHost && gamePath) stampHostIntoDir(activeProfileId(), gamePath, config.serverHost);
  } catch {}

  return { success: true };
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

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid JSON")); }
      });
    }).on("error", reject);
  });
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
        return downloadFile(res.headers.location, dest, expectedSize, onProgress).then(resolve).catch(reject);
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
