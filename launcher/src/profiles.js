// Profile folders and authoritative managed-file policy. Fresh installs use
// complete Kaentake manifests. Stock retains existing-client patch updates;
// its patch list is never a fresh-client dependency authority.
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

// Require the complete native dependency authority for fresh Kaentake installs.
// Stock keeps its existing patch-list contract, with the same file validation.
function requiredClientFiles(manifest, profileId, hdMode) {
  if (!PROFILES[profileId] || !Array.isArray(manifest?.files) ||
      (profileId === "kaentake" && (!Array.isArray(manifest.completeProfiles) ||
        !manifest.completeProfiles.includes(profileId)))) {
    throw new Error(`A complete client manifest is not available for ${profileId}; this profile is not ready to install or launch.`);
  }
  const files = filterManifest(manifest.files, profileId, hdMode).map((file) =>
    profileId === "stock" && String(file.name).toLowerCase() === "config.ini" &&
      file.configKind === undefined
      ? { ...file, configKind: PROFILES.stock.configKind }
      : file);
  const names = new Set();
  for (const file of files) {
    const name = String(file.name || "").replace(/\\/g, "/");
    const invalidPart = name.split("/").some((part) => !part || part === "." || part === ".." ||
      /[<>:"|?*\u0000-\u001f]|[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
    if (invalidPart || names.has(name.toLowerCase()) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 ||
        !/^[a-f\d]{64}$/i.test(file.hash || "")) {
      throw new Error(`Invalid or colliding managed client file: ${name || "<unnamed>"}`);
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

function iniSection(text, name) {
  const headers = /^[\t \uFEFF]*\[([^\]\r\n]+)\][^\r\n]*(?:\r?\n|$)/gm;
  let section = null, match;
  while ((match = headers.exec(text))) {
    if (section) return { ...section, end: match.index, body: text.slice(section.start, match.index) };
    if (match[1].toLowerCase() === name.toLowerCase())
      section = { start: headers.lastIndex, end: text.length };
  }
  return section ? { ...section, body: text.slice(section.start) } : null;
}

function readIniValue(text, sectionName, key) {
  const section = iniSection(text, sectionName);
  if (!section) return null;
  const match = section.body.match(new RegExp(`^[\\t ]*${key}[\\t ]*=[\\t ]*([^\\r\\n]*)`, "im"));
  return match ? match[1].trim() : null;
}

function setIniSectionValues(text, sectionName, values) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let section = iniSection(text, sectionName);
  if (!section) {
    if (text && !text.endsWith("\n")) text += newline;
    text += `[${sectionName}]${newline}`;
    section = { start: text.length, end: text.length, body: "" };
  }
  let body = section.body;
  let added = "";
  for (const [key, value] of Object.entries(values)) {
    const field = new RegExp(`^([\\t ]*${key}[\\t ]*=)[^\\r\\n]*`, "im");
    if (field.test(body)) body = body.replace(field, (_, prefix) => prefix + value);
    else added += `${key}=${value}${newline}`;
  }
  const separator = section.start && text[section.start - 1] !== "\n" ? newline : "";
  return text.slice(0, section.start) + separator + added + body + text.slice(section.end);
}

function readProfileHost(profileId, text) {
  return profileId === "kaentake"
    ? readIniValue(text, "config", "host")
    : readIniValue(text, "general", "ServerIP_Address");
}

// The IP-only Ezorsia field receives launch-time resolved IPv4, never host text.
function stampStockIni(iniText, host) {
  if (isIP(host) !== 4) throw new Error("Ezorsia requires a resolved IPv4 address.");
  return setIniSectionValues(iniText, "general", { ServerIP_Address: host });
}

// Only the owned host changes; retain an existing owned test port verbatim.
function stampKaentakeIni(iniText, host) {
  const text = iniText || "";
  const values = { host };
  if (readIniValue(text, "config", "port") === null) values.port = KAENTAKE_PORT;
  return setIniSectionValues(text, "config", values);
}

function isProfileConfig(profileId, text) {
  const host = readProfileHost(profileId, text);
  return !!host && (profileId !== "kaentake" || /^\d+$/.test(readIniValue(text, "config", "port") || ""));
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
    if (iniSection(kaentakeIniText || "", "general")) {
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
  readProfileHost,
  readIniValue,
  setIniSectionValues,
  assertDownloadable,
};
