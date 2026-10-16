import { NextResponse } from "next/server";
import {
  ASSET_BASE_URL,
  ASSET_DIR,
  assetUrl,
  bumpPatch,
  hashFileStream,
  readManifest,
  acquirePublishLock,
  promoteStagedFile,
  releasePublishLock,
  resolveAssetPath,
  resolveStagingPath,
  verifyStagedBytes,
  writeManifestAtomic,
} from "@/lib/assets";
import type { ManifestRead } from "@/lib/assets";
import { dispatchWzToNx } from "@/lib/wz-to-nx";
import { parseWzFile, saveWzFile, addNpcToStringWz } from "@/lib/wz/patcher";
import { addNpcToWz, generateNpcXml, processNpcSprite } from "@/lib/wz/npc-builder";
import { execute, query } from "@/lib/db";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

const NPC_ID = 9900200;
const NPC_NAME = "The Baker";

async function copyFromAssets(fileKey: string, outputPath: string): Promise<void> {
  const src = join(ASSET_DIR, fileKey);
  if (!existsSync(src)) throw new Error(`Asset not staged: ${fileKey} (missing in ${ASSET_DIR})`);
  writeFileSync(outputPath, readFileSync(src));
}

export async function POST() {
  const actions: string[] = [];
  const { randomUUID } = await import("crypto");
  const releaseId = randomUUID().slice(0, 8);

  try {
    // 1. Load the sprite PNG
    const spritePath = join("/tmp", "baker-sprite.png");
    if (!existsSync(spritePath)) {
      return NextResponse.json(
        { error: "Baker sprite not found at /tmp/baker-sprite.png. Upload it first." },
        { status: 400 },
      );
    }
    const rawPng = readFileSync(spritePath);
    const processedPng = processNpcSprite(rawPng, 80);
    actions.push("Processed sprite PNG");

    // 2. Patch Npc.wz
    const tmpDir = join(tmpdir(), `baker-publish-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const npcWzPath = join(tmpDir, "Npc.wz");
    await copyFromAssets("Npc.wz", npcWzPath);
    actions.push("Loaded Npc.wz from asset dir");

    const npcWz = parseWzFile(npcWzPath);
    addNpcToWz(npcWz, NPC_ID, processedPng);
    const patchedNpcPath = join(tmpDir, "Npc-patched.wz");
    saveWzFile(npcWz, patchedNpcPath);
    actions.push("Patched Npc.wz with Baker sprite");

    mkdirSync(dirname(resolveStagingPath(releaseId, "Npc.wz")), { recursive: true });
    writeFileSync(resolveStagingPath(releaseId, "Npc.wz"), readFileSync(patchedNpcPath));
    const npcStaged = await hashFileStream(patchedNpcPath);
    actions.push("Staged patched Npc.wz into asset dir");

    // 3. Patch String.wz (add NPC name)
    const stringWzPath = join(tmpDir, "String.wz");
    await copyFromAssets("String.wz", stringWzPath);
    actions.push("Loaded String.wz from asset dir");

    const stringWz = parseWzFile(stringWzPath);
    addNpcToStringWz(stringWz, NPC_ID, NPC_NAME, "I sense great potential in you...");
    const patchedStringPath = join(tmpDir, "String-patched.wz");
    saveWzFile(stringWz, patchedStringPath);
    actions.push("Patched String.wz with Baker name");

    mkdirSync(dirname(resolveStagingPath(releaseId, "String.wz")), { recursive: true });
    writeFileSync(resolveStagingPath(releaseId, "String.wz"), readFileSync(patchedStringPath));
    const stringStaged = await hashFileStream(patchedStringPath);
    actions.push("Staged patched String.wz into asset dir");

    // 3.5. Verify staged bytes, promote atomically, then dispatch NX.
    // Wrong hash leaves live bytes AND manifest unchanged.
    acquirePublishLock();
    try {
      await verifyStagedBytes(resolveStagingPath(releaseId, "Npc.wz"), npcStaged);
      await verifyStagedBytes(resolveStagingPath(releaseId, "String.wz"), stringStaged);
      actions.push("Verified staged bytes match expected hashes");
      promoteStagedFile(releaseId, "Npc.wz");
      promoteStagedFile(releaseId, "String.wz");
      actions.push("Promoted Npc.wz + String.wz to live");
    } finally {
      releasePublishLock();
    }
    dispatchWzToNx(["Npc.wz", "String.wz"]).catch(() => {});
    actions.push("Dispatched wz-to-nx for Npc.wz, String.wz");

    // 4. Write server XML
    const serverRoot = process.env.WZ_ROOT || "/cosmic/wz";
    const npcXmlDir = join(serverRoot, "Npc.wz");
    mkdirSync(npcXmlDir, { recursive: true });
    const xml = generateNpcXml(NPC_ID, NPC_NAME, processedPng);
    writeFileSync(join(npcXmlDir, `${String(NPC_ID).padStart(7, "0")}.img.xml`), xml, "utf-8");
    actions.push("Wrote server NPC XML");

    // 5. Bump launcher manifest via single authority (atomic write).
    try {
      const { manifest }: ManifestRead = readManifest();

      const npcFile = manifest.files?.find((f) => f.name === "Npc.wz");
      if (npcFile) {
        npcFile.hash = npcStaged.hash;
        npcFile.size = npcStaged.size;
        npcFile.url = assetUrl("Npc.wz");
      }
      const strFile = manifest.files?.find((f) => f.name === "String.wz");
      if (strFile) {
        strFile.hash = stringStaged.hash;
        strFile.size = stringStaged.size;
        strFile.url = assetUrl("String.wz");
      }

      manifest.version = bumpPatch(manifest.version);
      manifest.updatedAt = new Date().toISOString();
      manifest.downloadBase = `${ASSET_BASE_URL}/client/`;
      writeManifestAtomic(manifest);
      actions.push(`Bumped manifest to v${manifest.version}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      actions.push(`Manifest bump failed: ${message}`);
    }

    // 6. Spawn NPC on Henesys if not already there
    try {
      const existing = await query(
        "SELECT id FROM plife WHERE life = ? AND type = 'n' AND map = 100000000",
        [NPC_ID],
      );
      if (existing.length === 0) {
        // Henesys center area — near other NPCs
        await execute(
          "INSERT INTO plife (world, map, life, type, cy, f, fh, rx0, rx1, x, y, hide, mobtime) VALUES (0, 100000000, ?, 'n', 0, 0, 24, -200, 200, 55, 0, 0, -1)",
          [NPC_ID],
        );
        actions.push("Spawned Baker NPC on Henesys");
      } else {
        actions.push("Baker already spawned on Henesys");
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      actions.push(`plife insert failed: ${message}`);
    }

    // 7. Game-server restart is owner-operated (LXC topology has no Fly
    // Machines API). Publish stops here.
    actions.push("Restart skipped: game-server restart is manual on this topology.");

    return NextResponse.json({ success: true, actions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Baker publish error:", err);
    return NextResponse.json({ error: message, actions }, { status: 500 });
  }
}
