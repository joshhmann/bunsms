// Profile folders and complete-client manifest policy. Fresh installs use
// Kaentake; explicit existing stock folders remain isolated rollback/testing
// choices. A profile is never launchable from a partial patch manifest.
"use strict";
const { isIP } = require("node:net");

const KAENTAKE_PORT = 8484;

// Mirrors configKind selection in main.js; kept here so tests pin the sets.
const KAENTAKE_EXCLUSIVE = ["Kaentake.exe", "Kaentake.dll", "Custom.wz", "BunsMS.dll"];
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
    requiresElevation: true, // Pinned upstream executable manifest, not a generic troubleshooting suggestion.
    exclusiveFiles: KAENTAKE_EXCLUSIVE,
    bannedFiles: KAENTAKE_BANNED,
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

// Every profile-matching file in a publisher-certified COMPLETE manifest is
// required. A patch manifest is not a fresh-client dependency authority.
function requiredClientFiles(manifest, profileId, hdMode) {
  if (!PROFILES[profileId] || !Array.isArray(manifest?.files) ||
      !Array.isArray(manifest.completeProfiles) || !manifest.completeProfiles.includes(profileId)) {
    throw new Error(`A complete client manifest is not available for ${profileId}; this profile is not ready to install or launch.`);
  }
  const files = filterManifest(manifest.files, profileId, hdMode);
  const names = new Set();
  for (const file of files) {
    const name = String(file.name || "").replace(/\\/g, "/");
    const invalidPart = name.split("/").some((part) => !part || part === "." || part === ".." ||
      /[<>:"|?*\u0000-\u001f]|[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
    if (invalidPart || names.has(name.toLowerCase()) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 ||
        !/^[a-f\d]{64}$/i.test(file.hash || "")) {
      throw new Error(`Invalid or colliding file in complete client manifest: ${name || "<unnamed>"}`);
    }
    names.add(name.toLowerCase());
    assertDownloadable(file);
    const managedConfig = name.toLowerCase() === "config.ini" &&
      file.configKind === PROFILES[profileId].configKind;
    if ((file.mutable || file.configKind || name.toLowerCase() === "config.ini") && !managedConfig)
      throw new Error(`Managed config ownership does not match ${profileId}: ${name}`);
  }
  const entryFiles = profileId === "kaentake"
    ? ["MapleStory.exe", ...KAENTAKE_EXCLUSIVE, "config.ini"]
    : [PROFILES[profileId].exe];
  for (const name of entryFiles) {
    if (!names.has(name.toLowerCase()))
      throw new Error(`Complete ${profileId} manifest omits its required entry file: ${name}`);
  }
  return files.map((file) => ({
    ...file,
    mutable: file.configKind === PROFILES[profileId].configKind,
  }));
}

// The IP-only Ezorsia field receives launch-time resolved IPv4, never host text.
function stampStockIni(iniText, host) {
  if (isIP(host) !== 4) throw new Error("Ezorsia requires a resolved IPv4 address.");
  if (/^ServerIP_Address=.*/mi.test(iniText)) {
    return iniText.replace(/^ServerIP_Address=.*/mi, `ServerIP_Address=${host}`);
  }
  if (/^\[general\]/mi.test(iniText))
    return iniText.replace(/^(\[general\])/mi, `$1\nServerIP_Address=${host}`);
  return `[general]\nServerIP_Address=${host}\n${iniText}`;
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

function isProfileConfig(profileId, text) {
  return profileId === "kaentake"
    ? /^\[config\]\s*$/mi.test(text) && /^host=.+$/mi.test(text) && /^port=\d+\s*$/mi.test(text)
    : /^\[general\]\s*$/mi.test(text) && /^ServerIP_Address=.+$/mi.test(text);
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
    const banned = (present || []).filter((n) => KAENTAKE_BANNED.some((b) => b.toLowerCase() === n.toLowerCase()));
    if (banned.length > 0) {
      return {
        ok: false,
        reason: `Kaentake folder must not contain: ${banned.join(", ")}. Select its isolated complete-client folder.`,
      };
    }
    if (/^\[general\]/m.test(kaentakeIniText || "")) {
      return {
        ok: false,
        reason: "config.ini belongs to Ezorsia ([general]), not the isolated Kaentake profile.",
      };
    }
    return { ok: true };
  }
  const stray = (present || []).filter((n) => KAENTAKE_EXCLUSIVE.some((b) => b.toLowerCase() === n.toLowerCase()));
  if (stray.length > 0) {
    return { ok: false, reason: `Stock rollback folder contains Kaentake runtime files: ${stray.join(", ")}. Keep the profiles in separate folders.` };
  }
  return { ok: true };
}


// A complete install never substitutes manual-copy instructions for artifacts.
function assertDownloadable(file) {
  if (!file.url) {
    throw new Error(`The complete client manifest has no download URL for ${file.name}.`);
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
  requiredClientFiles,
  isProfileConfig,
  assertDownloadable,
};
