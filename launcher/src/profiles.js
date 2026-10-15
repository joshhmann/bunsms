// ── Launcher client profiles (pure, Electron-free) ──
// Stock path (BunsMS.exe, Ezorsia HD) is the default; Kaentake is opt-in and
// lives in its own folder. No Kaentake binaries are shipped in this repo:
// the manifest carries the 3 Kaentake entries as manual-copy-only
// ({ manual: true, url: "" }) until a redistribution grant exists.
"use strict";

const KAENTAKE_PORT = 8484;

// Mirrors configKind selection in main.js; kept here so tests pin the sets.
const KAENTAKE_EXCLUSIVE = ["Kaentake.exe", "Kaentake.dll", "Custom.wz"];
const KAENTAKE_BANNED = ["dinput8.dll", "EzorsiaV2_UI.wz"];

const PROFILES = {
  stock: {
    id: "stock",
    label: "BunsMS",
    exe: "BunsMS.exe",
    configKind: "ezorsia", // [general] ServerIP_Address
  },
  kaentake: {
    id: "kaentake",
    label: "Kaentake",
    exe: "Kaentake.exe",
    configKind: "kaentake", // [config] host/port
    exclusiveFiles: KAENTAKE_EXCLUSIVE,
    bannedFiles: KAENTAKE_BANNED,
    // Checked for guidance only (profile:deps); the launcher never downloads these.
    requiredStockFiles: [
      "MapleStory.exe",
      "Canvas.dll",
      "Gr2D_DX8.dll",
      "ijl15.dll",
      "bz32ex.dll",
      "aossdk.dll",
      "l3codeca.acm",
      "ASPLnchr.exe",
      "Base.wz",
      "Character.wz",
      "Effect.wz",
      "Etc.wz",
      "Item.wz",
      "List.wz",
      "Map.wz",
      "Mob.wz",
    ],
  },
};

// Manifest entries without `profiles` are stock-only (back-compat with the
// 16-file manifest). HD entries never apply to Kaentake.
function filterManifest(files, activeProfile, hdMode) {
  return (files || []).filter((file) => {
    const profiles = file.profiles || ["stock"];
    if (!profiles.includes(activeProfile)) return false;
    if (file.hd && (activeProfile !== "stock" || !hdMode)) return false;
    return true;
  });
}

// Stock writer, string-level twin of the existing writeServerHostToIni logic.
function stampStockIni(iniText, host) {
  if (/^ServerIP_Address=.*/m.test(iniText)) {
    return iniText.replace(/^ServerIP_Address=.*/m, `ServerIP_Address=${host}`);
  }
  return iniText.replace(/^(\[general\])/m, `$1\nServerIP_Address=${host}`);
}

// Kaentake writer: [config] host/port, port pinned to KAENTAKE_PORT.
// Preserves every other line; creates [config] when absent.
function stampKaentakeIni(iniText, host) {
  let ini = iniText || "";
  if (/^\[config\]/m.test(ini)) {
    if (/^host=.*/m.test(ini)) {
      ini = ini.replace(/^host=.*/m, `host=${host}`);
    } else {
      ini = ini.replace(/^(\[config\]).*$/m, `$1\nhost=${host}`);
    }
    if (/^port=.*/m.test(ini)) {
      ini = ini.replace(/^port=.*/m, `port=${KAENTAKE_PORT}`);
    } else {
      ini = ini.replace(/^host=.*$/m, `$&\nport=${KAENTAKE_PORT}`);
    }
    return ini;
  }
  if (ini && !ini.endsWith("\n")) ini += "\n";
  return `${ini}[config]\nhost=${host}\nport=${KAENTAKE_PORT}\n`;
}

// Case-insensitive dir equality (Windows paths).
function sameDir(a, b) {
  const norm = (s) => String(s || "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

// Separation guard: { ok, reason?, warning? }.
// `present`: basenames in the profile dir; `otherDir`: the other profile's dir.
function separationCheck({ dir, otherDir, profileId, present = [], kaentakeIniText = "" }) {
  if (sameDir(dir, otherDir)) {
    return { ok: false, reason: "Both profiles point at the same folder — Kaentake needs its own isolated folder." };
  }
  if (profileId === "kaentake") {
    const banned = (present || []).filter((n) => KAENTAKE_BANNED.includes(n));
    if (banned.length > 0) {
      return {
        ok: false,
        reason: `Kaentake folder must not contain: ${banned.join(", ")}. Use a clean folder with the stock v83 files + the 3 Kaentake assets only.`,
      };
    }
    if (/^\[general\]/m.test(kaentakeIniText || "")) {
      return {
        ok: true,
        warning: "config.ini looks like an Ezorsia config ([general]) — Kaentake reads [config] host/port and will ignore it.",
      };
    }
    return { ok: true };
  }
  const stray = (present || []).filter((n) => KAENTAKE_EXCLUSIVE.includes(n));
  if (stray.length > 0) {
    return { ok: true, warning: `Stock folder contains Kaentake files (inert for BunsMS.exe): ${stray.join(", ")}.` };
  }
  return { ok: true };
}

function missingStockDeps(present, required) {
  const have = new Set(present || []);
  return (required || []).filter((n) => !have.has(n));
}

// Downloader guard: manual-copy entries have no URL and must never reach downloadFile.
function assertDownloadable(file) {
  if (file.manual || !file.url) {
    throw new Error(
      `${file.name} is manual-copy-only (no redistribution grant): copy it from the upstream v3.4.1 release zip — the launcher will hash-verify it.`
    );
  }
}

module.exports = {
  KAENTAKE_PORT,
  PROFILES,
  KAENTAKE_EXCLUSIVE,
  KAENTAKE_BANNED,
  filterManifest,
  stampStockIni,
  stampKaentakeIni,
  sameDir,
  separationCheck,
  missingStockDeps,
  assertDownloadable,
};
