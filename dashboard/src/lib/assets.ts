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
  configKind?: "kaentake"; mutable?: boolean;
}
export type CatalogFile = Omit<ManifestFile, "url">;
export interface Manifest {
  version: string; updatedAt: string; files: ManifestFile[]; downloadBase: string;
  releaseId?: string; previousReleaseId?: string | null;
  nxReleaseId?: string;
  assets?: Record<string, PublishedAsset>;
  completeProfiles?: string[];
  provenance?: { url: string; sha256: string };
}
export interface ManifestRead { manifest: Manifest; path: string }
export interface PreparedRelease {
  releaseId: string; baseReleaseId: string | null;
  assets: PublishedAsset[]; manifest: Manifest;
}
export interface PublishResult extends PreparedRelease { manifestPath: string }
export interface ReleaseCertification { completeProfiles: string[]; provenance: AssetExpectation }
export interface ReleaseOptions { baseReleaseId?: string | null; catalog?: CatalogFile[]; certification?: ReleaseCertification }
export interface NxConsumerProof {
  success: true; releaseId: string;
  files: Array<{ name: string; sha256: string; size: number }>;
  reportSha256: string; readerJsSha256: string; readerWasmSha256: string;
}
export const NX_ARCHIVE_NAMES = ["Base", "Character", "Effect", "Etc", "Item", "Map", "Mob", "Morph", "Npc", "Quest", "Reactor", "Skill", "Sound", "String", "TamingMob", "UI"].map((name) => `${name}.nx`);
interface ReleaseRecord {
  id: string; createdAt: string; baseReleaseId: string | null; baseToken: string; base: Manifest;
  state: "open" | "prepared" | "sealed" | "committed" | "failed";
  prepared: Record<string, PublishedAsset>;
  catalog?: CatalogFile[];
  certification?: ReleaseCertification;
  requiresNxVerification?: boolean;
  nxVerification?: NxConsumerProof;
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
function freezeCatalog(values: CatalogFile[]): CatalogFile[] {
  if (!Array.isArray(values) || !values.length) throw new AssetError("A non-empty approved file catalog is required");
  const names = new Set<string>();
  return values.map((value) => {
    if (!value || typeof value !== "object") throw new AssetError("Invalid approved catalog entry");
    validateExpectation({ key: value.name, hash: value.hash, size: value.size });
    if (names.has(value.name.toLowerCase())) throw new AssetError(`Duplicate catalog entry: ${value.name}`);
    names.add(value.name.toLowerCase());
    if (value.profiles !== undefined && !Array.isArray(value.profiles)) throw new AssetError("Catalog profiles must be an array");
    const profiles = value.profiles === undefined ? undefined : [...value.profiles];
    if (profiles && (!profiles.length || profiles.some((profile) => profile !== "stock" && profile !== "kaentake") || new Set(profiles).size !== profiles.length)) throw new AssetError(`Invalid profiles for ${value.name}`);
    if (["Kaentake.exe", "Kaentake.dll", "Custom.wz", "BunsMS.dll"].includes(value.name) && (profiles?.length !== 1 || profiles[0] !== "kaentake")) throw new AssetError("Kaentake-exclusive files must stay out of the stock profile");
    if (value.hd !== undefined && typeof value.hd !== "boolean") throw new AssetError("Invalid catalog HD flag");
    if (value.experimental !== undefined && typeof value.experimental !== "boolean") throw new AssetError("Invalid catalog experimental flag");
    if (value.attribution !== undefined && typeof value.attribution !== "string") throw new AssetError("Invalid catalog attribution");
    if (value.mutable !== undefined && typeof value.mutable !== "boolean") throw new AssetError("Invalid catalog mutable flag");
    if (value.configKind !== undefined && (value.configKind !== "kaentake" || value.name !== "config.ini"
        || profiles?.length !== 1 || profiles[0] !== "kaentake")) throw new AssetError("Only the Kaentake config.ini may declare configKind");
    if (value.mutable === true && value.configKind !== "kaentake") throw new AssetError("Only the declared Kaentake config may remain mutable");
    return { name: value.name, hash: value.hash, size: value.size, ...(profiles ? { profiles } : {}), ...(value.hd !== undefined ? { hd: value.hd } : {}), ...(value.experimental !== undefined ? { experimental: value.experimental } : {}), ...(value.attribution !== undefined ? { attribution: value.attribution } : {}), ...(value.configKind ? { configKind: value.configKind } : {}), ...(value.mutable !== undefined ? { mutable: value.mutable } : {}) };
  });
}
/** Writers use their frozen complete catalog, never the filtered public profile. */
export function releaseFileNames(id: string): Set<string> {
  const record = readRecord(id);
  return new Set([...(record.catalog || record.base.files).map((file) => file.name), "server-wz.tar.gz", "server-wz-baseline.tar.gz", ...(record.certification ? [record.certification.provenance.key] : [])]);
}

export function beginRelease(options: ReleaseOptions = {}): string {
  const { manifest } = readManifest();
  const baseReleaseId = manifest.releaseId || null;
  if (options.baseReleaseId !== undefined && options.baseReleaseId !== baseReleaseId) {
    throw new AssetError("Asset authority changed while the candidate was built", 409);
  }
  const catalog = options.catalog === undefined ? undefined : freezeCatalog(options.catalog);
  if (catalog && !baseReleaseId) throw new AssetError("First bootstrap and retain the approved existing seed before replacing its catalog", 409);
  let certification: ReleaseCertification | undefined;
  if (options.certification) {
    if (!catalog || !Array.isArray(options.certification.completeProfiles) || !options.certification.completeProfiles.length
        || new Set(options.certification.completeProfiles).size !== options.certification.completeProfiles.length
        || options.certification.completeProfiles.some((profile) => profile !== "stock" && profile !== "kaentake")) {
      throw new AssetError("Certification requires a complete approved catalog and explicit unique profiles");
    }
    validateExpectation(options.certification.provenance);
    if (options.certification.provenance.size > 4 * 1024 * 1024) throw new AssetError("Launcher provenance must be bounded JSON metadata");
    certification = { completeProfiles: [...options.certification.completeProfiles], provenance: { ...options.certification.provenance } };
  }
  const id = randomUUID();
  mkdirSync(releaseDir(id), { recursive: true });
  writeJsonAtomic(releaseFile(id), { id, createdAt: new Date().toISOString(), baseReleaseId, baseToken: token(manifest), base: manifest, state: "open", prepared: {}, ...(catalog ? { catalog } : {}), ...(certification ? { certification } : {}) } satisfies ReleaseRecord);
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
  const catalog = record.catalog || record.base.files;
  if (record.catalog) {
    const names = new Set(catalog.map((file) => file.name));
    for (const file of record.base.files) if (!names.has(file.name)) delete assets[file.name];
  }
  let launcherChanged = !!record.catalog;
  const files = catalog.map((file) => {
    const asset = assets[file.name];
    if (!asset) throw new AssetError(`Every catalog entry must be verified; missing ${file.name}`, 409);
    if ((!record.baseReleaseId || record.catalog) && (file.hash !== asset.hash || file.size !== asset.size)) {
      throw new AssetError(`Approved catalog bytes do not match ${file.name}`, 409);
    }
    if (file.hash !== asset.hash || file.size !== asset.size) launcherChanged = true;
    return { ...file, hash: asset.hash, size: asset.size, url: asset.url };
  });
  if (record.catalog) {
    const metadata = (entries: CatalogFile[]) => entries.map((file) => [file.name, file.hash, file.size, file.profiles || ["stock"], !!file.hd, !!file.experimental, file.attribution || "", file.configKind || "", !!file.mutable]);
    launcherChanged = JSON.stringify(metadata(files)) !== JSON.stringify(metadata(record.base.files));
  }
  const nxReleaseId = NX_ARCHIVE_NAMES.every((name) => record.prepared[`nx/${name}`]) ? record.id : record.base.nxReleaseId;
  let certification = record.base.provenance ? { completeProfiles: record.base.completeProfiles, provenance: record.base.provenance } : {};
  if (record.catalog && !record.certification) certification = {};
  if (record.certification) {
    const expected = record.certification.provenance;
    const asset = assets[expected.key];
    if (!asset || asset.hash !== expected.hash || asset.size !== expected.size) throw new AssetError("Certified provenance must be independently verified with the complete catalog", 409);
    const proof = JSON.parse(readFileSync(objectPath(asset), "utf8")) as { files?: Array<{ name: string; size: number; sha256: string }> };
    if (!Array.isArray(proof?.files) || proof.files.some((file) => !file || typeof file.name !== "string")) {
      throw new AssetError("Launcher provenance does not contain a valid catalog", 409);
    }
    const proofFiles = new Map(proof.files.map((file) => [file.name.toLowerCase(), file]));
    if (proof.files.length !== files.length || proofFiles.size !== files.length
        || files.some((file) => {
          const row = proofFiles.get(file.name.toLowerCase());
          return !row || row.size !== file.size || row.sha256 !== file.hash;
        })) throw new AssetError("Launcher provenance does not describe the exact complete catalog", 409);
    certification = { completeProfiles: record.certification.completeProfiles, provenance: { url: asset.url, sha256: asset.hash } };
  }
  return {
    ...record.base, completeProfiles: undefined, provenance: undefined, ...certification,
    releaseId: record.id, previousReleaseId: record.baseReleaseId, nxReleaseId,
    version: launcherChanged ? bumpPatch(record.base.version) : record.base.version,
    updatedAt: launcherChanged ? record.createdAt : record.base.updatedAt,
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
    if (!record.catalog && !record.certification && record.base.provenance && record.base.completeProfiles?.length
        && list.some((item) => record.base.files.some((file) => file.name === item.key && (file.hash !== item.hash || file.size !== item.size)))) {
      // Every existing producer gets a fresh complete byte fingerprint. Never
      // carry an old certified provenance URL across changed launcher bytes.
      const updates = new Map(list.map((item) => [item.key, item]));
      const data = Buffer.from(JSON.stringify({ generatedFromReleaseId: record.baseReleaseId,
        files: record.base.files.map((file) => {
          const update = updates.get(file.name);
          return { name: file.name, size: update?.size ?? file.size, sha256: update?.hash ?? file.hash };
        }) }));
      const proof = { key: "release-provenance.json", hash: sha256(data), size: data.length };
      const path = stagedPath(id, proof.key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data, { flag: "wx" });
      list.push(proof);
      record.certification = { completeProfiles: [...record.base.completeProfiles], provenance: proof };
    }
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

/** A sealed prepared view is immutable metadata, but is not the current authority. */
export function readSealedRelease(id: string): PreparedRelease & { requiresNxVerification: boolean } {
  const record = readRecord(id);
  if (record.state !== "sealed") throw new AssetError(`Release is ${record.state}, not sealed`, 409);
  const manifest = candidate(record);
  for (const asset of Object.values(manifest.assets!)) assertObject(asset);
  return { releaseId: id, baseReleaseId: record.baseReleaseId, manifest, assets: Object.values(record.prepared), requiresNxVerification: record.requiresNxVerification === true };
}
export function readReleaseView(id: string): Manifest {
  validateReleaseId(id);
  return existsSync(internalPath(`manifests/${id}.json`)) ? readRelease(id) : readSealedRelease(id).manifest;
}
export async function sealRelease(id: string, requiresNxVerification = false): Promise<PreparedRelease> {
  return locked(join(releaseDir(id), ".lock"), async () => {
    const record = readRecord(id);
    if (record.state !== "prepared") throw new AssetError(`Release is ${record.state}`, 409);
    if (token(readManifest().manifest) !== record.baseToken) throw new AssetError("Asset authority changed; rebuild the candidate", 409);
    const manifest = candidate(record);
    for (const asset of Object.values(manifest.assets!)) assertObject(asset);
    if (requiresNxVerification && NX_ARCHIVE_NAMES.some((name) => !record.prepared[`nx/${name}`])) {
      throw new AssetError("A sealed NX candidate must prepare the entire 16-file cohort", 409);
    }
    record.requiresNxVerification = requiresNxVerification;
    record.state = "sealed";
    writeJsonAtomic(releaseFile(id), record);
    return { releaseId: id, baseReleaseId: record.baseReleaseId, manifest, assets: Object.values(record.prepared) };
  });
}
export async function acceptNxConsumerProof(id: string, value: unknown): Promise<void> {
  await locked(join(releaseDir(id), ".lock"), async () => {
    const record = readRecord(id);
    if (record.state !== "sealed" || !record.requiresNxVerification) throw new AssetError("Release is not awaiting NX verification", 409);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AssetError("NX consumer returned no proof", 502);
    const proof = value as NxConsumerProof;
    if (proof.success !== true || proof.releaseId !== id || !Array.isArray(proof.files) || proof.files.length !== NX_ARCHIVE_NAMES.length ||
      ![proof.reportSha256, proof.readerJsSha256, proof.readerWasmSha256].every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) {
      throw new AssetError("NX consumer proof is incomplete or belongs to another release", 502);
    }
    const manifest = candidate(record);
    const seen = new Set<string>();
    for (const file of proof.files) {
      const expected = manifest.assets?.[`nx/${file.name}`];
      if (!NX_ARCHIVE_NAMES.includes(file.name) || seen.has(file.name) || !expected || file.sha256 !== expected.hash || file.size !== expected.size) {
        throw new AssetError("NX consumer proof does not match the sealed cohort", 502);
      }
      seen.add(file.name);
    }
    record.nxVerification = structuredClone(proof);
    writeJsonAtomic(releaseFile(id), record);
  });
}
export async function commitRelease(id: string): Promise<PublishResult> {
  return locked(internalPath(".publish-lock"), () => locked(join(releaseDir(id), ".lock"), async () => {
    const record = readRecord(id);
    if (record.state !== "prepared" && record.state !== "sealed") throw new AssetError(`Release is ${record.state}`, 409);
    if (record.requiresNxVerification && !record.nxVerification) throw new AssetError("The sealed cohort has no actual WASM/HTTP consumer proof", 409);
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
