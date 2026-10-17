import { NextResponse } from "next/server";
import { execute, query } from "@/lib/db";
import { ASSET_DIR, AssetError, hashFileStream, lockPublicationJob, readManifest, resolveAssetPath, writePublicationStatus } from "@/lib/assets";
import type { SourceAsset } from "@/lib/assets";
import { publishWzFiles } from "@/lib/wz-to-nx";
import type { NxOperation } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";
import { upsertServerStrings } from "@/lib/wz/server-strings";
import {
  parseWzFile,
  saveWzFile,
  addImgToCharacterWz,
  addStringsToStringWz,
  addNpcToWz,
  addNpcToStringWz,
  addEtcBucketToItemWz,
  addEtcStringsToStringWz,
  generateNpcXml,
} from "@/lib/wz";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import {
  copyFileSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

export const dynamic = "force-dynamic";
export const maxDuration = 600;


const STATUS_FILE = join(ASSET_DIR, "jobs", "assets-publish-status.json");

// All custom ETCs share one bucket (4090xxx → 0409.img). Empty in v83 stock,
// so we rebuild it from scratch every publish; that keeps string-pool offsets
// inside the bucket self-contained and avoids relocating any pre-existing data.
const ETC_BUCKET_NAME = "0409.img";

interface PublishStatus {
  id: string;
  status: "running" | "done" | "error";
  step: string;
  actions: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
  assets_published?: number;
  version?: string;
  releaseId?: string;
}

function writeStatus(s: PublishStatus) {
  writePublicationStatus("assets-publish-status.json", s);
}

function readStatus(): PublishStatus | null {
  try {
    if (!existsSync(STATUS_FILE)) return null;
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function copyFromAssets(fileKey: string, outputPath: string): Promise<void> {
  const src = resolveAssetPath(fileKey);
  mkdirSync(dirname(outputPath), { recursive: true });
  copyFileSync(src, outputPath);
}

async function readAssetBuffer(fileKey: string): Promise<Buffer> {
  const src = resolveAssetPath(fileKey);
  return readFileSync(src);
}

interface AssetRow {
  id: number;
  asset_type: "hair" | "face" | "npc" | "etc";
  in_game_id: number;
  file_key: string;
  name: string | null;
  attrs: any;
  status: "ready" | "published" | "rejected";
}

interface NpcAttrs {
  dialogue?: string;
  script?: string;
}
interface EtcAttrs {
  desc?: string;
  slotMax?: number;
  price?: number;
  quest?: number;
}

function parseAttrs(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}


/** Build the server-side Item.wz/Etc/<bucket>.img.xml from the full custom ETC list. */
function generateEtcBucketXml(
  bucketName: string,
  items: Array<{ itemId: number; slotMax?: number; price?: number; quest?: number }>
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(`<imgdir name="${bucketName}">`);
  for (const item of items) {
    lines.push(`  <imgdir name="${String(item.itemId).padStart(8, "0")}">`);
    lines.push(`    <imgdir name="info">`);
    lines.push(`      <int name="slotMax" value="${item.slotMax ?? 100}"/>`);
    lines.push(`      <int name="price" value="${item.price ?? 0}"/>`);
    if (item.quest) {
      lines.push(`      <int name="quest" value="${item.quest}"/>`);
    }
    lines.push(`    </imgdir>`);
    lines.push(`  </imgdir>`);
  }
  lines.push(`</imgdir>`);
  return lines.join("\n") + "\n";
}

// ---------- Main publish job ----------

async function runPublishJob(jobId: string) {
  const workDir = join(tmpdir(), `assets-publish-${jobId}`);
  const status: PublishStatus = {
    id: jobId,
    status: "running",
    step: "Starting...",
    actions: [],
    startedAt: new Date().toISOString(),
  };

  function update(step: string, action?: string) {
    status.step = step;
    if (action) status.actions.push(action);
    writeStatus(status);
  }

  try {
    const baseReleaseId = readManifest().manifest.releaseId ?? null;
    const files: SourceAsset[] = [];
    const operations: NxOperation[] = [];
    update("Fetching ready assets from database...");
    const ready = (await query<AssetRow>(
      "SELECT id, asset_type, in_game_id, file_key, name, attrs, status FROM custom_assets WHERE status = 'ready' ORDER BY asset_type, in_game_id"
    )) as AssetRow[];

    if (ready.length === 0) {
      status.status = "error";
      status.error = "No ready assets to publish";
      status.finishedAt = new Date().toISOString();
      writeStatus(status);
      return;
    }
    update("Fetched assets", `Found ${ready.length} ready asset(s)`);

    const hairFace = ready.filter(
      (a) => a.asset_type === "hair" || a.asset_type === "face"
    );
    const npcs = ready.filter((a) => a.asset_type === "npc");
    const etcs = ready.filter((a) => a.asset_type === "etc");

    // For ETC, the bucket gets rebuilt from scratch — pull every previously
    // published custom ETC plus the ready ones so nothing disappears.
    const allEtcs =
      etcs.length > 0
        ? ((await query<AssetRow>(
            "SELECT id, asset_type, in_game_id, file_key, name, attrs, status FROM custom_assets WHERE asset_type = 'etc' AND status IN ('ready','published') ORDER BY in_game_id"
          )) as AssetRow[])
        : [];

    const needCharacterWz = hairFace.length > 0;
    const needNpcWz = npcs.length > 0;
    const needItemWz = etcs.length > 0;
    const namedAssets = ready.filter((a) => a.name && a.name.trim().length > 0);
    const needStringWz = namedAssets.length > 0;
    const needServerTar = npcs.length > 0 || etcs.length > 0;

    mkdirSync(workDir, { recursive: true });

    // ---------- Server-side WZ tar (NPC + ETC only) ----------
    if (needServerTar) {
      update("Downloading server WZ tarball...");
      const tarPath = join(workDir, "server-wz.tar.gz");
      await copyFromAssets("server-wz.tar.gz", tarPath);
      update(
        "Downloaded server tar",
        `Downloaded server-wz.tar.gz (${(statSync(tarPath).size / 1024 / 1024).toFixed(1)}MB)`
      );

      update("Extracting server WZ...");
      execSync(`tar xzf "${tarPath}" -C "${workDir}"`, { timeout: 300000 });
      const wzRoot = join(workDir, "wz");
      if (!existsSync(wzRoot)) {
        throw new Error("Extracted tar does not contain wz/ directory");
      }
      update("Extracted", "Extracted server-wz.tar.gz");

      // ETC: rebuild server bucket XML from full custom-etc list.
      if (etcs.length > 0) {
        const etcBucketDir = join(wzRoot, "Item.wz", "Etc");
        if (!existsSync(etcBucketDir)) {
          mkdirSync(etcBucketDir, { recursive: true });
        }
        const etcBucketXmlItems = allEtcs.map((a) => {
          const at = parseAttrs(a.attrs) as EtcAttrs;
          return {
            itemId: a.in_game_id,
            slotMax: at.slotMax,
            price: at.price,
            quest: at.quest,
          };
        });
        const etcBucketXml = generateEtcBucketXml(
          ETC_BUCKET_NAME,
          etcBucketXmlItems
        );
        writeFileSync(
          join(etcBucketDir, `${ETC_BUCKET_NAME}.xml`),
          etcBucketXml,
          "utf-8"
        );
        update(
          "Wrote ETC bucket XML",
          `Wrote Item.wz/Etc/${ETC_BUCKET_NAME}.xml (${allEtcs.length} item(s))`
        );

        upsertServerStrings(join(wzRoot, "String.wz", "Etc.img.xml"), "Etc.img", etcs.filter((asset) => asset.name).map((asset) => ({
          section: ["Etc"], id: String(asset.in_game_id),
          fields: [{ name: "name", value: asset.name! }, { name: "desc", value: (parseAttrs(asset.attrs) as EtcAttrs).desc || "" }],
        })));
        update("Patched ETC server strings", `Updated String.wz/Etc.img.xml`);
      }

      // NPC: write per-id XML files + patch String.wz/Npc.img.xml.
      if (npcs.length > 0) {
        const npcWzDir = join(wzRoot, "Npc.wz");
        if (!existsSync(npcWzDir)) mkdirSync(npcWzDir, { recursive: true });

        for (const a of npcs) {
          const at = parseAttrs(a.attrs) as NpcAttrs;
          const pngBuf = await readAssetBuffer(a.file_key);
          const xml = generateNpcXml(
            a.in_game_id,
            a.name || "",
            pngBuf,
            at.script
          );
          const padded = String(a.in_game_id).padStart(7, "0");
          writeFileSync(join(npcWzDir, `${padded}.img.xml`), xml, "utf-8");
          update(
            `Wrote NPC ${a.in_game_id}`,
            `Wrote Npc.wz/${padded}.img.xml${at.script ? ` (script=${at.script})` : ""}`
          );
        }

        upsertServerStrings(join(wzRoot, "String.wz", "Npc.img.xml"), "Npc.img", npcs.filter((asset) => asset.name).map((asset) => {
          const attributes = parseAttrs(asset.attrs) as NpcAttrs;
          const fields = [{ name: "name", value: asset.name! }];
          if (attributes.dialogue) fields.push({ name: "n0", value: attributes.dialogue });
          return { section: [], id: String(asset.in_game_id), fields };
        }));
        update("Patched NPC server strings", `Updated String.wz/Npc.img.xml`);
      }

      update("Repacking server WZ...");
      const newTarPath = join(workDir, "server-wz-new.tar.gz");
      const packDirs = existsSync(join(workDir, "scripts")) ? "wz/ scripts/" : "wz/";
      execSync(
        `cd "${workDir}" && COPYFILE_DISABLE=1 tar czf "${newTarPath}" --exclude='.DS_Store' --exclude='._*' ${packDirs}`,
        { timeout: 300000 }
      );
      const tarExpectation = await hashFileStream(newTarPath);
      update(
        "Repacked",
        `Repacked server-wz.tar.gz (${(tarExpectation.size / 1024 / 1024).toFixed(1)}MB)`
      );

      files.push({ key: "server-wz.tar.gz", path: newTarPath, ...tarExpectation });
    }

    // ---------- Client-side WZ patches ----------


    // Character.wz (hair/face .img injection).
    if (needCharacterWz) {
      update("Downloading Character.wz (~200MB)...");
      const charWzPath = join(workDir, "Character.wz");
      await copyFromAssets("Character.wz", charWzPath);
      update(
        "Downloaded Character.wz",
        `Downloaded Character.wz (${(statSync(charWzPath).size / 1024 / 1024).toFixed(0)}MB)`
      );

      const charWz = parseWzFile(charWzPath);
      for (const a of hairFace) {
        const imgData = await readAssetBuffer(a.file_key);
        addImgToCharacterWz(charWz, {
          dirName: a.asset_type === "hair" ? "Hair" : "Face",
          id: a.in_game_id,
          imgData,
        });
        update(
          `Injected ${a.asset_type} ${a.in_game_id}`,
          `Added ${a.asset_type === "hair" ? "Hair" : "Face"}/${String(a.in_game_id).padStart(8, "0")}.img${a.name ? ` (${a.name})` : ""} (${imgData.length} bytes)`
        );
      }
      const charWzOut = join(workDir, "Character-patched.wz");
      saveWzFile(charWz, charWzOut);

      files.push({ key: "Character.wz", path: charWzOut, ...await hashFileStream(charWzOut) });
      for (const a of hairFace) operations.push({
        op: "import_image", target_wz: "Character.wz",
        target_image: `${a.asset_type === "hair" ? "Hair" : "Face"}/${String(a.in_game_id).padStart(8, "0")}.img`,
      });
    }

    // Npc.wz (custom NPC sprite .imgs).
    if (needNpcWz) {
      update("Downloading Npc.wz...");
      const npcWzPath = join(workDir, "Npc.wz");
      await copyFromAssets("Npc.wz", npcWzPath);
      update(
        "Downloaded Npc.wz",
        `Downloaded Npc.wz (${(statSync(npcWzPath).size / 1024 / 1024).toFixed(0)}MB)`
      );

      const npcWz = parseWzFile(npcWzPath);
      for (const a of npcs) {
        const at = parseAttrs(a.attrs) as NpcAttrs;
        const pngBuf = await readAssetBuffer(a.file_key);
        addNpcToWz(npcWz, a.in_game_id, pngBuf, at.script);
        update(
          `Injected NPC ${a.in_game_id}`,
          `Added ${String(a.in_game_id).padStart(7, "0")}.img${a.name ? ` (${a.name})` : ""}${at.script ? ` (script=${at.script})` : ""}`
        );
      }
      const npcWzOut = join(workDir, "Npc-patched.wz");
      saveWzFile(npcWz, npcWzOut);

      files.push({ key: "Npc.wz", path: npcWzOut, ...await hashFileStream(npcWzOut) });
      for (const a of npcs) operations.push({
        op: "import_image", target_wz: "Npc.wz",
        target_image: `${String(a.in_game_id).padStart(7, "0")}.img`,
      });
    }

    // Item.wz (rebuild custom ETC bucket from full list).
    if (needItemWz) {
      update("Downloading Item.wz...");
      const itemWzPath = join(workDir, "Item.wz");
      await copyFromAssets("Item.wz", itemWzPath);
      update(
        "Downloaded Item.wz",
        `Downloaded Item.wz (${(statSync(itemWzPath).size / 1024 / 1024).toFixed(0)}MB)`
      );

      // Fetch icons for every custom ETC (already-published + new) so the
      // rebuilt bucket has all icons baked in.
      const bucketItems: Array<{
        itemId: number;
        iconPng?: Buffer;
        slotMax?: number;
        price?: number;
        quest?: number;
      }> = [];
      for (const a of allEtcs) {
        const at = parseAttrs(a.attrs) as EtcAttrs;
        const iconPng = await readAssetBuffer(a.file_key);
        bucketItems.push({
          itemId: a.in_game_id,
          iconPng,
          slotMax: at.slotMax,
          price: at.price,
          quest: at.quest,
        });
      }

      const itemWz = parseWzFile(itemWzPath);
      addEtcBucketToItemWz(itemWz, ETC_BUCKET_NAME, bucketItems);
      const itemWzOut = join(workDir, "Item-patched.wz");
      saveWzFile(itemWz, itemWzOut);
      update(
        "Patched Item.wz",
        `Rebuilt Etc/${ETC_BUCKET_NAME} with ${bucketItems.length} item(s)`
      );

      files.push({ key: "Item.wz", path: itemWzOut, ...await hashFileStream(itemWzOut) });
      for (const a of allEtcs) operations.push({
        op: "set_subtree", target_wz: "Item.wz",
        target_image: `Etc/${ETC_BUCKET_NAME}`,
        target_node: String(a.in_game_id).padStart(8, "0"),
      });
    }

    // String.wz (names for any named asset, all four types).
    if (needStringWz) {
      update("Downloading String.wz...");
      const strWzPath = join(workDir, "String.wz");
      await copyFromAssets("String.wz", strWzPath);
      update(
        "Downloaded String.wz",
        `Downloaded String.wz (${(statSync(strWzPath).size / 1024 / 1024).toFixed(0)}MB)`
      );

      const strWz = parseWzFile(strWzPath);

      const namedHairFace = hairFace.filter((a) => a.name);
      if (namedHairFace.length > 0) {
        addStringsToStringWz(
          strWz,
          namedHairFace.map((a) => ({
            itemId: a.in_game_id,
            name: a.name!,
            desc: "",
            sectionName: a.asset_type === "hair" ? "Hair" : "Face",
          }))
        );
        update(
          "Patched String.wz/Eqp",
          `Added ${namedHairFace.length} hair/face name(s)`
        );
      }

      const namedNpcs = npcs.filter((a) => a.name);
      for (const a of namedNpcs) {
        const at = parseAttrs(a.attrs) as NpcAttrs;
        addNpcToStringWz(strWz, a.in_game_id, a.name!, at.dialogue);
      }
      if (namedNpcs.length > 0) {
        update(
          "Patched String.wz/Npc",
          `Added ${namedNpcs.length} NPC name(s)`
        );
      }

      const namedEtcs = etcs.filter((a) => a.name);
      if (namedEtcs.length > 0) {
        addEtcStringsToStringWz(
          strWz,
          namedEtcs.map((a) => {
            const at = parseAttrs(a.attrs) as EtcAttrs;
            return {
              itemId: a.in_game_id,
              name: a.name!,
              desc: at.desc || "",
            };
          })
        );
        update(
          "Patched String.wz/Etc",
          `Added ${namedEtcs.length} ETC name(s)`
        );
      }

      const strWzOut = join(workDir, "String-patched.wz");
      saveWzFile(strWz, strWzOut);

      files.push({ key: "String.wz", path: strWzOut, ...await hashFileStream(strWzOut) });
      for (const a of namedAssets) {
        const target_image = a.asset_type === "npc" ? "Npc.img" : a.asset_type === "etc" ? "Etc.img" : "Eqp.img";
        const target_node = a.asset_type === "npc" ? String(a.in_game_id)
          : a.asset_type === "etc" ? `Etc/${a.in_game_id}`
          : `Eqp/${a.asset_type === "hair" ? "Hair" : "Face"}/${a.in_game_id}`;
        operations.push({ op: "set_subtree", target_wz: "String.wz", target_image, target_node });
      }
    }

    update("Preparing browser NX and committing release...");
    const released = await publishWzFiles(files, operations, { baseReleaseId });
    status.releaseId = released.releaseId;
    const version = released.manifest.version;
    update("Release committed", `Committed release ${released.releaseId}`);
    if (needServerTar) {
      update("Applying server release...");
      const applied = await restartGameServer();
      if (!applied.success) throw new Error(applied.error || "Server apply failed");
      update("Server applied", `Applied release ${released.releaseId}`);
    }

    update("Marking assets as published...");
    const ids = ready.map((a) => a.id);
    if (ids.length > 0) {
      await execute(
        `UPDATE custom_assets SET status = 'published', published_at = NOW() WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
        ids
      );
    }


    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}

    status.status = "done";
    status.step = "Complete";
    status.finishedAt = new Date().toISOString();
    status.assets_published = ready.length;
    status.version = version;
    writeStatus(status);
  } catch (err: any) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
    status.status = "error";
    status.error = err.message;
    status.step = "Failed";
    status.finishedAt = new Date().toISOString();
    writeStatus(status);
  }
}

export async function POST() {
  const jobId = randomUUID().slice(0, 8);
  let unlock: (() => void) | undefined;
  try {
    unlock = await lockPublicationJob("assets-publish-status.json");
    writeStatus({ id: jobId, status: "running", step: "Starting...", actions: [], startedAt: new Date().toISOString() });
  } catch (error) {
    unlock?.();
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }
  runPublishJob(jobId).catch((err) => {
    console.error("Assets publish job crashed:", err);
  }).finally(unlock);

  return NextResponse.json({ started: true, id: jobId });
}

export async function GET() {
  const status = readStatus();
  if (!status) {
    return NextResponse.json({ status: "idle" });
  }
  return NextResponse.json(status);
}
