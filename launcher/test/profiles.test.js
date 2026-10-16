// Launcher profile pure-function tests (design §9). Plain node:assert, no Electron.
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  filterManifest,
  stampStockIni,
  stampKaentakeIni,
  separationCheck,
  requiredClientFiles,
  isProfileConfig,
  KAENTAKE_PORT,
} = require("../src/profiles.js");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "launcher-manifest.json"), "utf-8")
);
const ezorsiaTemplate = fs.readFileSync(
  path.join(__dirname, "..", "assets", "ezorsia-config.ini"),
  "utf-8"
);

// ── filterManifest ──
{
  // Old manifest (no `profiles` key) filters to stock-only.
  const old = [{ name: "BunsMS.exe" }, { name: "dinput8.dll", hd: true }];
  assert.deepEqual(filterManifest(old, "stock", false).map((f) => f.name), ["BunsMS.exe"]);
  assert.deepEqual(filterManifest(old, "kaentake", false).map((f) => f.name), []);
}

{
  // Shared WZ passes both filters; hd excluded for kaentake regardless of hdMode.
  const files = [
    { name: "Character.wz", profiles: ["stock", "kaentake"] },
    { name: "BunsMS.exe" },
    { name: "Kaentake.exe", profiles: ["kaentake"], manual: true },
    { name: "dinput8.dll", hd: true },
  ];
  assert.deepEqual(
    filterManifest(files, "kaentake", true).map((f) => f.name).sort(),
    ["Character.wz", "Kaentake.exe"]
  );
  assert.deepEqual(
    filterManifest(files, "stock", false).map((f) => f.name).sort(),
    ["BunsMS.exe", "Character.wz"]
  );
  assert.deepEqual(
    filterManifest(files, "stock", true).map((f) => f.name).sort(),
    ["BunsMS.exe", "Character.wz", "dinput8.dll"]
  );
}

{
  // Live manifest contract: stock = today's 16-file set; kaentake = 12 shared + 3 Kaentake.
  const stock = filterManifest(manifest.files, "stock", true);
  assert.equal(stock.length, 16);
  assert.ok(stock.some((f) => f.name === "BunsMS.exe"));
  const ka = filterManifest(manifest.files, "kaentake", false);
  assert.equal(ka.length, 15);
  assert.ok(!ka.some((f) => f.name === "BunsMS.exe"));
  assert.ok(!ka.some((f) => f.hd));
  for (const n of ["Kaentake.exe", "Kaentake.dll", "Custom.wz"]) {
    const e = ka.find((f) => f.name === n);
    assert.ok(e, n + " present");
    assert.ok(e.url, n + " normally hosted");
    assert.ok(!e.manual, n + " not manual-gated");
    assert.match(e.attribution || "", /iw2d/);
  }
}

// ── stampStockIni: byte-identical to current writeServerHostToIni logic ──
{
  const out = stampStockIni(ezorsiaTemplate, "1.2.3.4");
  assert.match(out, /^ServerIP_Address=1\.2\.3\.4$/m);
  // Everything else untouched.
  assert.equal(out.replace(/^ServerIP_Address=.*$/m, "X"), ezorsiaTemplate.replace(/^ServerIP_Address=.*$/m, "X"));
  // Idempotent.
  assert.equal(stampStockIni(out, "1.2.3.4"), out);
}

// ── stampKaentakeIni ──
{
  assert.equal(KAENTAKE_PORT, 8484);
  // Creates [config] when absent.
  assert.equal(stampKaentakeIni("", "10.0.0.1"), "[config]\nhost=10.0.0.1\nport=8484\n");
  // Replaces host, pins port, preserves comments/other keys.
  const ini = "[config]\n; comment\nhost=127.0.0.1\nport=1234\ncustom=yes\n";
  const out = stampKaentakeIni(ini, "10.0.0.1");
  assert.match(out, /^host=10\.0\.0\.1$/m);
  assert.match(out, /^port=8484$/m);
  assert.match(out, /^; comment$/m);
  assert.match(out, /^custom=yes$/m);
  // Inserts host after [config] when missing.
  const out2 = stampKaentakeIni("[config]\nport=8484\n", "10.0.0.2");
  assert.match(out2, /^host=10\.0\.0\.2$/m);
  // Idempotent.
  assert.equal(stampKaentakeIni(out, "10.0.0.1"), out);
}

// ── separationCheck ──
{
  // Equal dirs (case-insensitive) rejected.
  const r = separationCheck({ dir: "C:\\MS", otherDir: "c:/ms", profileId: "kaentake", present: [] });
  assert.equal(r.ok, false);
  // Banned files in kaentake dir = hard error.
  const r2 = separationCheck({
    dir: "C:\\KaentakeMS", otherDir: "C:\\BunsMS", profileId: "kaentake",
    present: ["Kaentake.exe", "dinput8.dll"],
  });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /dinput8\.dll/);
  // Clean kaentake layout passes.
  const r3 = separationCheck({
    dir: "C:\\KaentakeMS", otherDir: "C:\\BunsMS", profileId: "kaentake",
    present: ["Kaentake.exe", "Kaentake.dll", "Custom.wz", "MapleStory.exe"],
  });
  assert.equal(r3.ok, true);
  // Foreign Ezorsia ini in Kaentake dir is rejected, not silently replaced.
  const r4 = separationCheck({
    dir: "C:\\KaentakeMS", otherDir: "C:\\BunsMS", profileId: "kaentake",
    present: [], kaentakeIniText: "[general]\nServerIP_Address=1.2.3.4\n",
  });
  assert.equal(r4.ok, false);
  assert.match(r4.reason, /Ezorsia/);
  // Stock rollback dir must not mix Kaentake runtime files.
  const r5 = separationCheck({
    dir: "C:\\BunsMS", otherDir: "C:\\KaentakeMS", profileId: "stock",
    present: ["BunsMS.exe", "Kaentake.exe"],
  });
  assert.equal(r5.ok, false);
  assert.match(r5.reason, /Kaentake/);
}

// Complete manifests, not the historical patch list, authorize fresh installs.
{
  const file = (name, extra = {}) => ({
    name, profiles: ["kaentake"], size: 123, hash: "a".repeat(64),
    url: `https://example.test/${name}`, ...extra,
  });
  const complete = {
    completeProfiles: ["kaentake"],
    files: ["MapleStory.exe", "Kaentake.exe", "Kaentake.dll", "Custom.wz", "BunsMS.dll"]
      .map((name) => file(name))
      .concat(file("config.ini", { configKind: "kaentake" })),
  };
  assert.equal(requiredClientFiles(complete, "kaentake", false).length, 6);
  assert.equal(requiredClientFiles(complete, "kaentake", false).at(-1).mutable, true);
  assert.throws(() => requiredClientFiles(manifest, "kaentake", false), /complete client manifest/);
  for (const name of ["../outside.dll", "/outside.dll", "C:/outside.dll", "NUL.dll", "dir./file.dll"]) {
    assert.throws(() => requiredClientFiles({ ...complete, files: [...complete.files, file(name)] }, "kaentake", false), /Invalid or colliding/);
  }
  assert.throws(() => requiredClientFiles({ ...complete, files: [...complete.files, file("KAENTAKE.DLL")] }, "kaentake", false), /colliding/);
  assert.throws(() => requiredClientFiles({ ...complete, files: complete.files.filter((entry) => entry.name !== "BunsMS.dll") }, "kaentake", false), /required entry/);
  assert.throws(() => requiredClientFiles({ ...complete, files: [...complete.files, file("other.ini", { mutable: true })] }, "kaentake", false), /ownership/);
  assert.equal(isProfileConfig("kaentake", "[config]\r\nhost=buns.asslorde.com\r\nport=8484\r\nwidth=1366\r\n"), true);
  assert.equal(isProfileConfig("kaentake", "[general]\nServerIP_Address=127.0.0.1\n"), false);
  assert.throws(() => stampStockIni(ezorsiaTemplate, "buns.asslorde.com"), /resolved IPv4/);
}

// ── downloader guard (fallback only): URL-less entries never reach downloadFile ──
{
  const { assertDownloadable } = require("../src/profiles.js");
  assert.throws(() => assertDownloadable({ name: "Kaentake.exe", url: "" }), /no download URL/);
  assert.doesNotThrow(() => assertDownloadable({ name: "Kaentake.exe", url: "https://x/Kaentake.exe" }));
  assert.doesNotThrow(() => assertDownloadable({ name: "Character.wz", url: "https://x/y" }));
}

console.log("profiles: all assertions passed");
