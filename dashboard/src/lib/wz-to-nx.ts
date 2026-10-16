import { lstatSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  ASSET_DIR, beginRelease, stageFile, prepareRelease, commitRelease, readManifest,
  type SourceAsset, type PublishResult, type AssetExpectation,
} from "@/lib/assets";
import { requestGameControl } from "@/lib/game-control";

/** Operations are explicit native-content changes, not an archive-replace hint. */
export interface NxOperation {
  target_wz: string;
  target_image: string;
  op?: "import_image" | "set_subtree";
  target_node?: string;
  source_image?: string;
  source_node?: string;
  source_wz?: string;
}

const NX_NAMES = ["Base", "Character", "Effect", "Etc", "Item", "Map", "Mob", "Morph", "Npc", "Quest", "Reactor", "Skill", "Sound", "String", "TamingMob", "UI"].map((name) => `${name}.nx`);

/** The only visible change is the final common manifest commit. */
export async function publishWzFiles(
  files: SourceAsset[], operations: NxOperation[], options: { baseReleaseId?: string | null } = {},
): Promise<PublishResult> {
  if (!files.length) throw new Error("No WZ publication inputs");
  const releaseId = beginRelease(options);
  for (const file of files) await stageFile(releaseId, file.key, file.path);
  return publishStagedWzRelease(releaseId, files, operations);
}

export async function publishStagedWzRelease(
  releaseId: string, inputs: AssetExpectation[], operations: NxOperation[],
): Promise<PublishResult> {
  const current = readManifest().manifest;
  const convertible = NX_NAMES.filter((name) => name !== "UI.nx").map((name) => name.replace(/\.nx$/, ".wz"));
  for (const input of inputs) {
    const prior = current.assets?.[input.key] || current.files.find((file) => file.name === input.key);
    if (convertible.includes(input.key) && (!prior || prior.hash !== input.hash || prior.size !== input.size)
      && !operations.some((operation) => operation.target_wz === input.key)) {
      throw new Error(`Changed ${input.key} requires explicit approved NX operations`);
    }
  }
  const prepared = await prepareRelease(releaseId, inputs);
  if (!operations.length) return commitRelease(releaseId);
  const response = await requestGameControl("prepare-nx", {
    releaseId, manifest: prepared.manifest, assets: prepared.assets, operations,
  });
  if (!Array.isArray(response.files) || response.files.length !== NX_NAMES.length) {
    throw new Error("NX preparation did not return the complete 16-file cohort");
  }
  const root = realpathSync(ASSET_DIR);
  const candidateRoot = join(root, "nx-candidates", releaseId, "corpus");
  const seen = new Set<string>();
  const expectations: { key: string; hash: string; size: number }[] = [];
  const outputs: unknown[] = response.files;
  for (const value of outputs) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid NX result");
    const { name, relativePath, hash, size } = value as Record<string, unknown>;
    if (typeof name !== "string" || !NX_NAMES.includes(name) || seen.has(name)
      || typeof relativePath !== "string" || relativePath !== `nx-candidates/${releaseId}/corpus/${name}`
      || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)
      || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
      throw new Error("Invalid or incomplete NX result metadata");
    }
    const path = join(root, relativePath);
    const actual = realpathSync(path);
    if (relative(candidateRoot, actual) !== name || !actual.startsWith(candidateRoot + sep) || !lstatSync(path).isFile()) {
      throw new Error("NX candidate escaped its release corpus");
    }
    seen.add(name);
    const key = `nx/${name}`;
    await stageFile(releaseId, key, actual);
    expectations.push({ key, hash, size });
  }
  await prepareRelease(releaseId, expectations);
  return commitRelease(releaseId);
}
