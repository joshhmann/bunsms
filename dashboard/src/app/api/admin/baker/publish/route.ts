import { NextResponse } from "next/server";
import { hashFileStream, readManifest, resolveAssetPath } from "@/lib/assets";
import { publishWzFiles } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";
import { upsertServerStrings } from "@/lib/wz/server-strings";
import { execFileSync } from "child_process";
import { parseWzFile, saveWzFile, addNpcToStringWz } from "@/lib/wz/patcher";
import { addNpcToWz, generateNpcXml, processNpcSprite } from "@/lib/wz/npc-builder";
import { execute, query } from "@/lib/db";
import { copyFileSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const NPC_ID = 9900200;
const NPC_NAME = "The Baker";

async function copyFromAssets(fileKey: string, outputPath: string): Promise<void> {
  copyFileSync(resolveAssetPath(fileKey), outputPath);
}

export async function POST() {
  const actions: string[] = [];
  let releaseId: string | undefined;
  const tmpDir = join(tmpdir(), `baker-publish-${randomUUID()}`);

  try {
    const baseReleaseId = readManifest().manifest.releaseId ?? null;
    // 1. Load the sprite PNG
    const spritePath = resolveAssetPath("assets/npc/baker-sprite.png");
    const rawPng = readFileSync(spritePath);
    const processedPng = processNpcSprite(rawPng, 80);
    actions.push("Processed sprite PNG");

    // 2. Patch Npc.wz
    mkdirSync(tmpDir, { recursive: true });

    const npcWzPath = join(tmpDir, "Npc.wz");
    await copyFromAssets("Npc.wz", npcWzPath);
    actions.push("Loaded Npc.wz from asset dir");

    const npcWz = parseWzFile(npcWzPath);
    addNpcToWz(npcWz, NPC_ID, processedPng);
    const patchedNpcPath = join(tmpDir, "Npc-patched.wz");
    saveWzFile(npcWz, patchedNpcPath);
    actions.push("Patched Npc.wz with Baker sprite");


    // 3. Patch String.wz (add NPC name)
    const stringWzPath = join(tmpDir, "String.wz");
    await copyFromAssets("String.wz", stringWzPath);
    actions.push("Loaded String.wz from asset dir");

    const stringWz = parseWzFile(stringWzPath);
    addNpcToStringWz(stringWz, NPC_ID, NPC_NAME, "I sense great potential in you...");
    const patchedStringPath = join(tmpDir, "String-patched.wz");
    saveWzFile(stringWz, patchedStringPath);
    actions.push("Patched String.wz with Baker name");

    // Server XML is patched only in the candidate tar, never in the live tree.
    const tarPath = join(tmpDir, "server-wz.tar.gz");
    await copyFromAssets("server-wz.tar.gz", tarPath);
    execFileSync("tar", ["xzf", tarPath, "-C", tmpDir], { timeout: 300000 });
    const npcXmlDir = join(tmpDir, "wz", "Npc.wz");
    mkdirSync(npcXmlDir, { recursive: true });
    const xml = generateNpcXml(NPC_ID, NPC_NAME, processedPng);
    writeFileSync(join(npcXmlDir, `${String(NPC_ID).padStart(7, "0")}.img.xml`), xml, "utf-8");
    upsertServerStrings(join(tmpDir, "wz", "String.wz", "Npc.img.xml"), "Npc.img", [{
      section: [], id: String(NPC_ID),
      fields: [{ name: "name", value: NPC_NAME }, { name: "n0", value: "I sense great potential in you..." }],
    }]);
    const newTarPath = join(tmpDir, "server-wz-new.tar.gz");
    const packDirs = ["wz"];
    if (existsSync(join(tmpDir, "scripts"))) packDirs.push("scripts");
    execFileSync("tar", ["czf", newTarPath, "-C", tmpDir, ...packDirs], { timeout: 300000 });
    const released = await publishWzFiles([
      { key: "Npc.wz", path: patchedNpcPath, ...await hashFileStream(patchedNpcPath) },
      { key: "String.wz", path: patchedStringPath, ...await hashFileStream(patchedStringPath) },
      { key: "server-wz.tar.gz", path: newTarPath, ...await hashFileStream(newTarPath) },
    ], [
      { op: "import_image", target_wz: "Npc.wz", target_image: `${NPC_ID}.img` },
      { op: "set_subtree", target_wz: "String.wz", target_image: "Npc.img", target_node: String(NPC_ID) },
    ], { baseReleaseId });
    releaseId = released.releaseId;
    actions.push(`Committed release ${releaseId}`);

    // 6. Spawn NPC on Henesys if not already there
    {
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
    }

    const applied = await restartGameServer();
    if (!applied.success) throw new Error(applied.error || "Server apply failed");
    actions.push(`Applied server release ${releaseId}`);
    return NextResponse.json({ success: true, releaseId, actions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Baker publish error:", err);
    return NextResponse.json({ error: message, releaseId, actions }, { status: 500 });
  }
  finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
