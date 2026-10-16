// Self-hosted asset authority — single source of truth for client file
// serving, manifest read/write, and publish verification.
//
// Replaces dashboard/src/lib/r2.ts (Cloudflare R2, SigV4). All asset bytes
// live under ASSET_DIR on persistent host storage, served publicly under
// ASSET_BASE_URL/client/<name>. No network, no credentials, no stubs.
import { createHash } from "crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { Readable } from "stream";
import { basename, dirname, join } from "path";
import { pipeline } from "stream/promises";

/** Public base the launcher fetches bytes from (no trailing slash). */
export const ASSET_BASE_URL =
  process.env.ASSET_BASE_URL || "https://buns.asslorde.com";

/** Local directory holding one file per servable object (object name = file name). */
export const ASSET_DIR =
  process.env.ASSET_DIR || join(process.env.COSMIC_ROOT || "/cosmic", "client-assets");

/** Manifest object-name mapping: manifest `name` -> stored object file name. */
const OBJECT_ALIASES: Record<string, string> = {
  // Canonical renames: stored object matches manifest name.
  // Legacy R2 objects were `AugurMS.exe` / `ezorsia-config.ini`.
  "BunsMS.exe": "BunsMS.exe",
  "config.ini": "config.ini",
};

export function objectName(manifestName: string): string {
  return OBJECT_ALIASES[manifestName] ?? manifestName;
}

export function assetUrl(manifestName: string): string {
  return `${ASSET_BASE_URL}/client/${objectName(manifestName)}`;
}

/** Reject path traversal / absolute / nested names. Returns object file or throws. */
export function resolveAssetPath(name: string): string {
  const base = basename(name);
  if (!base || base !== name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid asset name: ${name}`);
  }
  return join(ASSET_DIR, objectName(base));
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

/** Stage a finished local file into the asset dir (atomic tmp + rename). */
export function stageAssetFile(name: string, srcPath: string): string {
  const dest = resolveAssetPath(name);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp.${process.pid}`;
  const data = readFileSync(srcPath);
  writeFileSync(tmp, data);
  renameSync(tmp, dest);
  return dest;
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

/** Verify staged bytes against expected hash/size; fail-closed. */
export async function verifyStagedBytes(
  filePath: string,
  expected: { hash: string; size: number }
): Promise<void> {
  const stat = statSync(filePath);
  if (stat.size !== expected.size) {
    throw new Error(`Size mismatch for ${basename(filePath)}: got ${stat.size}, expected ${expected.size}`);
  }
  const { hash } = await hashFileStream(filePath);
  if (hash !== expected.hash) {
    throw new Error(`Hash mismatch for ${basename(filePath)}`);
  }
}

/** Persist an uploaded stream to the asset dir (atomic: tmp + rename). */
export async function storeAssetStream(
  name: string,
  webStream: ReadableStream<Uint8Array>
): Promise<{ hash: string; size: number }> {
  const dest = resolveAssetPath(name);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp.${process.pid}`;
  const readable = Readable.fromWeb(webStream as never);
  await pipeline(readable, createWriteStream(tmp));
  const { hash, size } = await hashFileStream(tmp);
  renameSync(tmp, dest);
  return { hash, size };
}

/** Bump patch version (1.0.5 -> 1.0.6). URL-only edits must NOT call this. */
export function bumpPatch(version: string): string {
  const parts = (version || "1.0.0").split(".");
  parts[2] = String(parseInt(parts[2] || "0", 10) + 1);
  return parts.join(".");
}
