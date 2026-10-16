import { createHash, randomUUID } from "crypto";
import {
  chmodSync, closeSync, constants, createReadStream, createWriteStream,
  existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "fs";
import { copyFile, open } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { spawn } from "child_process";

export const ASSET_BASE_URL = (process.env.ASSET_BASE_URL || "https://buns.asslorde.com").replace(/\/$/, "");
export const ASSET_DIR = resolve(process.env.ASSET_DIR || join(process.env.COSMIC_ROOT || "/cosmic", "client-assets"));
const MANIFEST_PATH = resolve(process.env.LAUNCHER_MANIFEST_PATH || join(process.env.COSMIC_ROOT || "/cosmic", "manifest-writable", "launcher-manifest.json"));
const SEED_PATH = join(process.cwd(), "launcher-manifest.json");

export class AssetError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export interface AssetExpectation { key: string; hash: string; size: number }
export interface SourceAsset extends AssetExpectation { path: string }
interface FileIdentity { dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string }
export interface PublishedAsset extends AssetExpectation { url: string; identity: FileIdentity }
export interface ManifestFile {
  name: string; hash: string; size: number; url: string;
  profiles?: string[]; hd?: boolean; experimental?: boolean; attribution?: string;
}
export interface Manifest {
  version: string; updatedAt: string; files: ManifestFile[]; downloadBase: string;
  releaseId?: string; previousReleaseId?: string | null;
  assets?: Record<string, PublishedAsset>;
}
export interface ManifestRead { manifest: Manifest; path: string }
export interface PreparedRelease {
  releaseId: string; baseReleaseId: string | null;
  assets: PublishedAsset[]; manifest: Manifest;
}
export interface PublishResult extends PreparedRelease { manifestPath: string }
export interface ReleaseOptions { baseReleaseId?: string | null }
interface ReleaseRecord {
  id: string; baseReleaseId: string | null; baseToken: string; base: Manifest;
  state: "open" | "prepared" | "committed" | "failed";
  prepared: Record<string, PublishedAsset>;
}

function sha256(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
export function validateAssetKey(key: string): void {
  if (typeof key !== "string" || !key || key.includes("\\") || key.includes("\0") || key.startsWith("/")) {
    throw new AssetError("Invalid asset key");
  }
  const parts = key.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith(".") || !/^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(p)) ||
      ["objects", "staging", "releases", "manifests", "nx-candidates", "r"].includes(parts[0])) {
    throw new AssetError(`Invalid asset key: ${key}`);
  }
}
function validateReleaseId(id: string): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new AssetError("Invalid release id");
}
function root(): string {
  mkdirSync(ASSET_DIR, { recursive: true });
  return realpathSync(ASSET_DIR);
}
/** Lexical AND existing-parent containment. No API can create a symlink. */
function contained(base: string, key: string): string {
  const target = resolve(base, ...key.split("/"));
  if (!target.startsWith(base + sep)) throw new AssetError("Asset path escapes its root");
  let current = base;
  const parts = key.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) {
        throw new AssetError("Symlinks and non-directory asset parents are forbidden");
      }
    }
  }
  return target;
}
function internalPath(key: string): string { return contained(root(), key); }
function releaseDir(id: string): string { validateReleaseId(id); return internalPath(`staging/${id}`); }
function releaseFile(id: string): string { return join(releaseDir(id), "release.json"); }
function stagedPath(id: string, key: string): string {
  validateAssetKey(key); return contained(join(releaseDir(id), "files"), key);
}
function objectPath(asset: AssetExpectation): string {
  validateExpectation(asset);
  return internalPath(`objects/${asset.hash}/${asset.key}`);
}
export function assetUrl(key: string, hash: string): string {
  validateExpectation({ key, hash, size: 0 });
  return `${ASSET_BASE_URL}/client/r/${hash}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
function identity(path: string): FileIdentity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AssetError("Asset is not a regular file");
  return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}
function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function validateExpectation(value: AssetExpectation): void {
  validateAssetKey(value?.key);
  if (!/^[a-f0-9]{64}$/.test(value.hash) || !Number.isSafeInteger(value.size) || value.size < 0) {
    throw new AssetError(`${value.key}: expected SHA-256 and nonnegative byte size are required`);
  }
}
function expectations(values: AssetExpectation[]): ReadonlyArray<Readonly<AssetExpectation>> {
  if (!Array.isArray(values) || !values.length) throw new AssetError("A non-empty expected asset list is required");
  const seen = new Set<string>();
  return Object.freeze(values.map((value) => {
    const item = { key: value.key, hash: value.hash, size: value.size };
    validateExpectation(item);
    if (seen.has(item.key)) throw new AssetError(`Duplicate asset: ${item.key}`);
    seen.add(item.key);
    return Object.freeze(item);
  }));
}
function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomUUID()}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx", 0o644);
    writeFileSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(tmp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(tmp, { force: true });
  }
}

type PublicationStatusFile = "publish-status.json" | "assets-publish-status.json" | "reactor-publish-status.json";
/** Publication progress shares the persistent private asset mount, never the image filesystem. */
export function writePublicationStatus(file: PublicationStatusFile, value: unknown): void {
  writeJsonAtomic(internalPath(`jobs/${file}`), value);
}
function token(manifest: Manifest): string { return manifest.releaseId || `seed:${sha256(JSON.stringify(manifest))}`; }
export function readManifest(): ManifestRead {
  const path = existsSync(MANIFEST_PATH) ? MANIFEST_PATH : SEED_PATH;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (!Array.isArray(manifest.files)) throw new AssetError("Invalid authoritative manifest", 500);
  return { manifest, path };
}
function readRecord(id: string): ReleaseRecord {
  const path = releaseFile(id);
  if (!existsSync(path)) throw new AssetError("Unknown release", 404);
  return JSON.parse(readFileSync(path, "utf8")) as ReleaseRecord;
}
function assertWritable(record: ReleaseRecord): void {
  if (record.state !== "open" && record.state !== "prepared") throw new AssetError(`Release is ${record.state}`, 409);
}
async function acquireLock(path: string): Promise<() => void> {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a", 0o600);
  try {
    // flock acquires the inherited open-file description. This process retains
    // that description after the helper exits; close/crash releases it in-kernel.
    const child = spawn("flock", ["-n", "-E", "75", "3"], { stdio: ["ignore", "ignore", "ignore", fd] });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new AssetError(code === 75 ? "Publication or staging is already in progress" : "Could not acquire asset authority lock", code === 75 ? 409 : 500));
      });
    });
    return () => closeSync(fd);
  } catch (error) { closeSync(fd); throw error; }
}
async function locked<T>(path: string, work: () => Promise<T>): Promise<T> {
  const unlock = await acquireLock(path);
  try { return await work(); }
  finally { unlock(); }
}
/** Job liveness is the kernel lock, not an age guess or a stale running JSON file. */
export function lockPublicationJob(file: PublicationStatusFile): Promise<() => void> {
  return acquireLock(internalPath(`jobs/${file}.lock`));
}
export function beginRelease(options: ReleaseOptions = {}): string {
  const { manifest } = readManifest();
  const baseReleaseId = manifest.releaseId || null;
  if (options.baseReleaseId !== undefined && options.baseReleaseId !== baseReleaseId) {
    throw new AssetError("Asset authority changed while the candidate was built", 409);
  }
  const id = randomUUID();
  mkdirSync(releaseDir(id), { recursive: true });
  writeJsonAtomic(releaseFile(id), { id, baseReleaseId, baseToken: token(manifest), base: manifest, state: "open", prepared: {} } satisfies ReleaseRecord);
  return id;
}
async function stage(id: string, key: string, write: (temporary: string) => Promise<void>): Promise<void> {
  validateAssetKey(key);
  if (key === "server-wz.version") throw new AssetError("The server marker is generated with its tarball");
  await locked(join(releaseDir(id), ".lock"), async () => {
    const record = readRecord(id); assertWritable(record);
    const dest = stagedPath(id, key);
    if (record.prepared[key] || existsSync(dest)) throw new AssetError(`Candidate ${key} is already frozen or staged`, 409);
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.part-${randomUUID()}`;
    try {
      await write(tmp);
      linkSync(tmp, dest); // exclusive finalization: never overwrite a completed candidate
    } finally { rmSync(tmp, { force: true }); }
  });
}
export async function stageFile(id: string, key: string, path: string): Promise<void> {
  await stage(id, key, (tmp) => copyFile(path, tmp, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE));
}
export async function stageStream(id: string, key: string, stream: Readable | ReadableStream<Uint8Array>): Promise<void> {
  await stage(id, key, async (tmp) => {
    const readable = stream instanceof Readable ? stream : Readable.fromWeb(stream as never);
    await pipeline(readable, createWriteStream(tmp, { flags: "wx" }));
  });
}
export async function hashFileStream(path: string): Promise<{ hash: string; size: number }> {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; }
  return { hash: hash.digest("hex"), size };
}
function retainedObject(expected: AssetExpectation, base: Manifest): PublishedAsset | undefined {
  const matches = (manifest: Manifest) => {
    const asset = manifest.assets?.[expected.key];
    return asset?.hash === expected.hash && asset.size === expected.size ? asset : undefined;
  };
  const current = matches(base);
  if (current) return current;
  const directory = internalPath("manifests");
  if (existsSync(directory)) for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const asset = matches(JSON.parse(readFileSync(join(directory, name), "utf8")) as Manifest);
    if (asset) return asset;
  }
}

async function freezeAndVerify(id: string, expected: AssetExpectation, base: Manifest): Promise<PublishedAsset> {
  const source = stagedPath(id, expected.key);
  if (!existsSync(source)) throw new AssetError(`${expected.key} is not staged`);
  identity(source); // rejects a symlink before moving anything
  const frozen = contained(join(releaseDir(id), "frozen", randomUUID()), expected.key);
  mkdirSync(dirname(frozen), { recursive: true });
  renameSync(source, frozen); // later replacement of the old name cannot affect this identity
  const handle = await open(frozen, constants.O_RDONLY | constants.O_NOFOLLOW);
  let digest: string;
  try {
    const before = identity(frozen);
    if (before.size !== String(expected.size)) throw new AssetError(`Size mismatch for ${expected.key}`);
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); size += chunk.length; }
    digest = hash.digest("hex");
    if (size !== expected.size || digest !== expected.hash || !sameIdentity(before, identity(frozen))) {
      throw new AssetError(`Hash or file identity mismatch for ${expected.key}`);
    }
  } finally { await handle.close(); }
  chmodSync(frozen, 0o444);
  const dest = objectPath(expected);
  mkdirSync(dirname(dest), { recursive: true });
  try { linkSync(frozen, dest); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = lstatSync(dest);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== expected.size || (existing.mode & 0o222)) {
      throw new AssetError("An immutable object was modified", 409);
    }
    const retained = retainedObject(expected, base);
    if (retained) assertObject(retained);
    else {
      // An object from another prepared, never-committed release has no retained
      // identity yet. Verify that exceptional collision rather than bless its path.
      const before = identity(dest);
      const actual = await hashFileStream(dest);
      if (actual.hash !== expected.hash || actual.size !== expected.size || !sameIdentity(before, identity(dest))) {
        throw new AssetError("Uncommitted immutable object does not match its digest", 409);
      }
    }
  }
  rmSync(frozen);
  return { ...expected, url: assetUrl(expected.key, digest!), identity: identity(dest) };
}
function candidate(record: ReleaseRecord): Manifest {
  const assets = { ...(record.base.assets || {}), ...record.prepared };
  let launcherChanged = false;
  const files = record.base.files.map((file) => {
    const asset = assets[file.name];
    if (!asset) throw new AssetError(`Bootstrap must verify every launcher entry; missing ${file.name}`, 409);
    if (!record.baseReleaseId && (file.hash !== asset.hash || file.size !== asset.size)) {
      throw new AssetError(`Bootstrap must preserve the approved seed bytes for ${file.name}`, 409);
    }
    if (file.hash !== asset.hash || file.size !== asset.size) launcherChanged = true;
    return { ...file, hash: asset.hash, size: asset.size, url: asset.url };
  });
  return {
    ...record.base, releaseId: record.id, previousReleaseId: record.baseReleaseId,
    version: launcherChanged ? bumpPatch(record.base.version) : record.base.version,
    updatedAt: launcherChanged ? new Date().toISOString() : record.base.updatedAt,
    downloadBase: `${ASSET_BASE_URL}/client/`, files, assets,
  };
}
export async function prepareRelease(id: string, values: AssetExpectation[]): Promise<PreparedRelease> {
  const expected = expectations(values); // defensive frozen copy BEFORE the first await
  return locked(join(releaseDir(id), ".lock"), async () => {
    const record = readRecord(id); assertWritable(record);
    if (token(readManifest().manifest) !== record.baseToken) throw new AssetError("Asset authority changed; rebuild the candidate", 409);
    const list: AssetExpectation[] = expected.map((item) => ({ ...item }));
    if (list.some((item) => item.key === "server-wz.version")) throw new AssetError("The server marker is generated with its tarball");
    const tar = list.find((item) => item.key === "server-wz.tar.gz");
    if (tar) {
      if (record.prepared["server-wz.version"]) throw new AssetError("Server tarball is already frozen", 409);
      const data = Buffer.from(JSON.stringify({ releaseId: id, key: tar.key, hash: tar.hash, size: tar.size, url: assetUrl(tar.key, tar.hash) }));
      const marker = stagedPath(id, "server-wz.version");
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, data, { flag: "wx" });
      list.push({ key: "server-wz.version", hash: sha256(data), size: data.length });
    }
    try {
      for (const item of list) {
        if (record.prepared[item.key]) throw new AssetError(`${item.key} was already verified and frozen`, 409);
        record.prepared[item.key] = await freezeAndVerify(id, item, record.base);
      }
      record.state = "prepared";
      const manifest = candidate(record);
      writeJsonAtomic(releaseFile(id), record);
      return { releaseId: id, baseReleaseId: record.baseReleaseId, assets: Object.values(record.prepared), manifest };
    } catch (error) {
      record.state = "failed"; writeJsonAtomic(releaseFile(id), record);
      throw error;
    }
  });
}
function assertObject(asset: PublishedAsset): void {
  const path = objectPath(asset);
  if (asset.url !== assetUrl(asset.key, asset.hash)) throw new AssetError("Retained asset URL is not canonical", 409);
  if (!asset.identity || !sameIdentity(asset.identity, identity(path)) || (lstatSync(path).mode & 0o222)) {
    throw new AssetError(`Retained object changed: ${asset.key}`, 409);
  }
}
export function resolveAssetPath(key: string): string {
  validateAssetKey(key);
  const asset = readManifest().manifest.assets?.[key];
  if (!asset) throw new AssetError(`No committed asset: ${key}`, 404);
  assertObject(asset);
  return objectPath(asset);
}
export function resolveRevisionPath(key: string, hash: string): string {
  const path = objectPath({ key, hash, size: 0 });
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o222)) {
    throw new AssetError("Revision is not an immutable regular asset", 404);
  }
  return path;
}
export function readRelease(id: string): Manifest {
  validateReleaseId(id);
  const path = internalPath(`manifests/${id}.json`);
  if (!existsSync(path)) throw new AssetError("Unknown retained release", 404);
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}
export async function commitRelease(id: string): Promise<PublishResult> {
  return locked(internalPath(".publish-lock"), () => locked(join(releaseDir(id), ".lock"), async () => {
    const record = readRecord(id);
    if (record.state !== "prepared") throw new AssetError(`Release is ${record.state}`, 409);
    const { manifest: current } = readManifest();
    if (token(current) !== record.baseToken) throw new AssetError("Asset authority changed; rebuild the candidate", 409);
    const manifest = candidate(record);
    for (const asset of Object.values(manifest.assets!)) assertObject(asset);
    const retained = internalPath(`manifests/${id}.json`);
    if (existsSync(retained)) throw new AssetError("Release was already committed", 409);
    writeJsonAtomic(retained, manifest);
    chmodSync(retained, 0o444);
    record.state = "committed";
    writeJsonAtomic(releaseFile(id), record);
    try { writeJsonAtomic(MANIFEST_PATH, manifest); }
    catch (error) {
      rmSync(retained, { force: true });
      record.state = "failed";
      writeJsonAtomic(releaseFile(id), record);
      throw error;
    }
    // The manifest rename is the only visibility change; all artifact and record writes precede it.
    return { releaseId: id, baseReleaseId: record.baseReleaseId, manifest, manifestPath: MANIFEST_PATH, assets: Object.values(record.prepared) };
  }));
}
export async function publishRelease(id: string, values: AssetExpectation[]): Promise<PublishResult> {
  await prepareRelease(id, values);
  return commitRelease(id);
}
export async function publishFiles(files: SourceAsset[], options: ReleaseOptions = {}): Promise<PublishResult> {
  const expected = expectations(files);
  const sources = files.map((file, i) => ({ ...expected[i], path: file.path }));
  const id = beginRelease(options);
  for (const file of sources) await stageFile(id, file.key, file.path);
  return publishRelease(id, expected as AssetExpectation[]);
}
export async function publishBuffers(files: Array<{ key: string; data: Buffer }>, options: ReleaseOptions = {}): Promise<PublishResult> {
  const id = beginRelease(options);
  const expected: AssetExpectation[] = [];
  for (const file of files) {
    const item = { key: file.key, hash: sha256(file.data), size: file.data.length };
    validateExpectation(item);
    await stageStream(id, file.key, Readable.from([file.data]));
    expected.push(item);
  }
  return publishRelease(id, expected);
}
export async function rollbackRelease(id: string): Promise<PublishResult> {
  return locked(internalPath(".publish-lock"), async () => {
    const manifest = readRelease(id);
    if (!manifest.assets || !manifest.releaseId) throw new AssetError("Release has no immutable asset authority");
    for (const asset of Object.values(manifest.assets)) assertObject(asset);
    for (const file of manifest.files) {
      const asset = manifest.assets[file.name];
      if (!asset || file.hash !== asset.hash || file.size !== asset.size || file.url !== asset.url) {
        throw new AssetError("Retained manifest does not match its objects", 409);
      }
    }
    writeJsonAtomic(MANIFEST_PATH, manifest);
    return { releaseId: id, baseReleaseId: manifest.previousReleaseId || null, manifest, manifestPath: MANIFEST_PATH, assets: Object.values(manifest.assets) };
  });
}
export function bumpPatch(version: string): string {
  const parts = (version || "1.0.0").split(".");
  parts[2] = String(parseInt(parts[2] || "0", 10) + 1);
  return parts.join(".");
}
