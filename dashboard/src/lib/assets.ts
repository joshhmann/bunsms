// Self-hosted asset authority — single source of truth for client file
// serving, staged publishing, and manifest read/write.
//
// All asset bytes live under ASSET_DIR on persistent host storage, served
// publicly under ASSET_BASE_URL/client/<key>. Publishing is staged:
// candidate bytes land under releases/<id>/, are verified against EXPECTED
// hashes, then promoted atomically (per-file rename + manifest write) under
// a per-publish lock. Live bytes are never overwritten in place, so manifest
// rollback restores the previous manifest AND its bytes still exist.
import { createHash } from "crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { Readable } from "stream";
import { dirname, join, normalize, sep } from "path";
import { pipeline } from "stream/promises";

/** Public base the launcher fetches bytes from (no trailing slash). */
export const ASSET_BASE_URL =
  process.env.ASSET_BASE_URL || "https://buns.asslorde.com";

/** Local directory holding live servable objects + staged releases. */
export const ASSET_DIR =
  process.env.ASSET_DIR || join(process.env.COSMIC_ROOT || "/cosmic", "client-assets");

export function assetUrl(key: string): string {
  return `${ASSET_BASE_URL}/client/${key}`;
}

/**
 * Resolve an asset key to a live path. Keys are relative, forward-slash
 * paths (flat client names like `Map.wz`, or nested art like
 * `assets/hair/00060000.img` and `server-wz.tar.gz`). Absolute paths,
 * backslashes, `..` segments, and empty segments are rejected.
 */
export function resolveAssetPath(key: string): string {
  if (!key || key.includes("\\") || key.startsWith("/") || key.includes("..")) {
    throw new Error(`Invalid asset key: ${key}`);
  }
  const parts = key.split("/");
  if (parts.some((p) => !p)) {
    throw new Error(`Invalid asset key: ${key}`);
  }
  const full = normalize(join(ASSET_DIR, ...parts));
  if (full !== join(ASSET_DIR, ...parts) || !full.startsWith(ASSET_DIR + sep)) {
    throw new Error(`Invalid asset key: ${key}`);
  }
  return full;
}

/** Resolve a staged-release path (releases/<id>/<key>), same key rules. */
export function resolveStagingPath(releaseId: string, key: string): string {
  if (!releaseId || /[^A-Za-z0-9_-]/.test(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }
  const live = resolveAssetPath(key);
  const rel = live.slice(ASSET_DIR.length);
  return join(ASSET_DIR, "releases", releaseId + rel);
}

export interface ManifestFile {
  name: string;
  hash: string;
  size: number;
  url: string;
  profiles?: string[];
  hd?: boolean;
  experimental?: boolean;
  attribution?: string;
}

export interface Manifest {
  version: string;
  updatedAt: string;
  files: ManifestFile[];
  downloadBase: string;
}

export interface ManifestRead {
  manifest: Manifest;
  path: string;
}

function manifestPaths(): { volume: string; bundled: string } {
  // Writable dir mount wins (shared, survives redeploys); legacy single-file
  // /cosmic/launcher-manifest.json is read-only fallback for continuity.
  const writable = join(process.env.COSMIC_ROOT || "/cosmic", "manifest-writable", "launcher-manifest.json");
  if (existsSync(writable)) return { volume: writable, bundled: join(process.cwd(), "launcher-manifest.json") };
  const volume = join(process.env.COSMIC_ROOT || "/cosmic", "launcher-manifest.json");
  const bundled = join(process.cwd(), "launcher-manifest.json");
  return { volume, bundled };
}

/** Single authority read: volume wins, bundled fallback (same rule as before). */
export function readManifest(): ManifestRead {
  const { volume, bundled } = manifestPaths();
  const path = existsSync(volume) ? volume : bundled;
  const manifest = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  return { manifest, path };
}

/** Atomic manifest write: tmp + rename so readers never see a torn file. */
export function writeManifestAtomic(manifest: Manifest): string {
  const { volume } = manifestPaths();
  mkdirSync(dirname(volume), { recursive: true });
  const tmp = `${volume}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, volume);
  return volume;
}

/** Take the inter-process publish lock (mkdir is atomic). Throws if held. */
export function acquirePublishLock(): void {
  const dir = join(ASSET_DIR, ".publish-lock");
  mkdirSync(ASSET_DIR, { recursive: true });
  try {
    mkdirSync(dir);
  } catch {
    throw new Error("A publish is already running (lock held)");
  }
  writeFileSync(join(dir, "pid"), String(process.pid));
}

/** Release the inter-process publish lock. */
export function releasePublishLock(): void {
  try {
    const dir = join(ASSET_DIR, ".publish-lock");
    rmSync(join(dir, "pid"), { force: true });
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

/**
 * Promote one staged file to live, retaining the previous live bytes under
 * releases/prev-<releaseId>/ so manifest rollback restores working bytes.
 * Staged bytes MUST already be verified against expected hashes by the caller.
 */
export function promoteStagedFile(releaseId: string, key: string): { hash: string; size: number } {
  const staged = resolveStagingPath(releaseId, key);
  if (!existsSync(staged)) {
    throw new Error(`Staged file missing: releases/${releaseId}/${key}`);
  }
  const dest = resolveAssetPath(key);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    const backup = resolveStagingPath(`prev-${releaseId}`, key);
    mkdirSync(dirname(backup), { recursive: true });
    const data = readFileSync(dest);
    writeFileSync(backup, data);
  }
  const { hash, size } = hashFileSyncNow(staged);
  renameSync(staged, dest);
  return { hash, size };
}

function hashFileSyncNow(filePath: string): { hash: string; size: number } {
  const data = readFileSync(filePath);
  return { hash: createHash("sha256").update(data).digest("hex"), size: data.length };
}

/** Stream-hash a file without buffering it. */
export function hashFileStream(filePath: string): Promise<{ hash: string; size: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ hash: string; size: number }>();
  const hash = createHash("sha256");
  let size = 0;
  const stream = createReadStream(filePath);
  stream.on("data", (d: string | Buffer) => {
    hash.update(d);
    size += d.length;
  });
  stream.on("end", () => resolve({ hash: hash.digest("hex"), size }));
  stream.on("error", reject);
  return promise;
}

/** Verify bytes against expected hash/size; fail-closed, live untouched. */
export async function verifyStagedBytes(
  filePath: string,
  expected: { hash: string; size: number }
): Promise<void> {
  const stat = statSync(filePath);
  if (stat.size !== expected.size) {
    throw new Error(`Size mismatch for ${filePath}: got ${stat.size}, expected ${expected.size}`);
  }
  const { hash } = await hashFileStream(filePath);
  if (hash !== expected.hash) {
    throw new Error(`Hash mismatch for ${filePath}`);
  }
}

/**
 * Persist an uploaded stream to a STAGING path (never live). Callers promote
 * via promoteStagedFile after expected-hash verification. Cleans the partial
 * file on failure. Streams chunk-by-chunk (no full buffering).
 */
export async function storeStagedStream(
  releaseId: string,
  key: string,
  webStream: ReadableStream<Uint8Array>
): Promise<string> {
  const dest = resolveStagingPath(releaseId, key);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${process.pid}`;
  try {
    const readable = Readable.fromWeb(webStream as never);
    await pipeline(readable, createWriteStream(tmp));
    renameSync(tmp, dest);
    return dest;
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
}

/** Bump patch version (1.0.5 -> 1.0.6). URL-only edits must NOT call this. */
export function bumpPatch(version: string): string {
  const parts = (version || "1.0.0").split(".");
  parts[2] = String(parseInt(parts[2] || "0", 10) + 1);
  return parts.join(".");
}
