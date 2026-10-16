import { NextResponse } from "next/server";
import { query, execute } from "@/lib/db";
import { ASSET_DIR, AssetError, hashFileStream, lockPublicationJob, readManifest, resolveAssetPath, writePublicationStatus } from "@/lib/assets";
import { publishWzFiles } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";
import { resolveArtPath } from "@/lib/art";
import { parseWzFile, saveWzFile, addReactorToWz } from "@/lib/wz";
import { generateReactorFrames } from "@/lib/wz/reactor-animator";
import { generateReactorXml, generateReactorScript } from "@/lib/wz/reactor-builder";
import type { AnimationStyle } from "@/lib/wz/reactor-animator";
import type { ScriptTemplate } from "@/lib/wz/reactor-builder";

import { execSync } from "child_process";
import { randomUUID } from "crypto";
import {
  writeFileSync,
  copyFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  statSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function copyFromAssets(fileKey: string, outputPath: string): Promise<void> {
  copyFileSync(resolveAssetPath(fileKey), outputPath);
}


const STATUS_FILE = join(ASSET_DIR, "jobs", "reactor-publish-status.json");

interface PublishStatus {
  id: string;
  status: "running" | "done" | "error";
  step: string;
  actions: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
  releaseId?: string;
}

function writeStatus(s: PublishStatus) {
  writePublicationStatus("reactor-publish-status.json", s);
}

function readStatus(): PublishStatus | null {
  try {
    if (!existsSync(STATUS_FILE)) return null;
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8"));
  } catch { return null; }
}

async function downloadPng(url: string): Promise<Buffer> {
  return readFileSync(resolveArtPath(url));
}

async function runPublishJob(jobId: string) {
  const workDir = join(tmpdir(), `reactor-publish-${jobId}`);
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
    // 1. Fetch custom reactors
    update("Fetching custom reactors...");
    const rows = await query<any>(
      "SELECT * FROM custom_reactors ORDER BY reactor_id"
    );
    if (rows.length === 0) {
      status.status = "error";
      status.error = "No custom reactors to publish";
      status.finishedAt = new Date().toISOString();
      writeStatus(status);
      return;
    }
    update("Fetched reactors", `Found ${rows.length} custom reactor(s)`);

    // 2. Download server-wz.tar.gz
    update("Downloading server WZ files...");
    mkdirSync(workDir, { recursive: true });
    const tarPath = join(workDir, "server-wz.tar.gz");
    copyFileSync(resolveAssetPath("server-wz.tar.gz"), tarPath);
    update("Loaded", `Loaded server-wz.tar.gz (${(statSync(tarPath).size / 1024 / 1024).toFixed(1)}MB)`);

    // 3. Extract
    update("Extracting...");
    execSync(`tar xzf "${tarPath}" -C "${workDir}"`, { timeout: 300000 });
    const wzRoot = join(workDir, "wz");
    if (!existsSync(wzRoot)) throw new Error("Extracted tar missing wz/ directory");
    update("Extracted");

    // 4. For each reactor: generate frames, write XML + script
    const reactorWzDir = join(wzRoot, "Reactor.wz");
    if (!existsSync(reactorWzDir)) mkdirSync(reactorWzDir, { recursive: true });

    const scriptsDir = join(workDir, "scripts", "reactor");
    if (!existsSync(scriptsDir)) {
      // scripts might be at root level, check both
      const altScriptsDir = join(wzRoot.replace("/wz", ""), "scripts", "reactor");
      if (existsSync(altScriptsDir)) {
        // scripts are outside wz/
      }
    }

    const processedIds: number[] = [];
    const sprites = new Map<number, Buffer>();
    for (const row of rows) {
      const reactorId = row.reactor_id;
      update(`Processing reactor ${reactorId} (${row.name})...`);

      // Read the verified committed idle PNG.
      let idlePng: Buffer;
      if (row.idle_png_url) {
        idlePng = await downloadPng(row.idle_png_url);
      } else {
        update(`Skipping ${reactorId}`, `Reactor ${reactorId} has no idle PNG — skipped`);
        continue;
      }
      processedIds.push(reactorId);
      sprites.set(reactorId, idlePng);

      // Generate animation frames
      const frames = generateReactorFrames(idlePng, row.animation_style as AnimationStyle);

      // Build definition
      const def = {
        reactorId,
        name: row.name,
        eventType: row.event_type,
        hitsToBreak: row.hits_to_break,
        idlePng: idlePng,
        hitFrames: frames.hit,
        breakFrames: frames.break,
        hitDelay: row.hit_delay ?? 120,
        breakDelay: row.break_delay ?? 150,
        triggerItemId: row.trigger_item_id ?? undefined,
        triggerItemQty: row.trigger_item_qty ?? 1,
        timeout: row.timeout_ms ?? undefined,
      };

      // Write server XML
      const xml = generateReactorXml(def);
      const xmlPath = join(reactorWzDir, `${String(reactorId).padStart(7, "0")}.img.xml`);
      writeFileSync(xmlPath, xml, "utf-8");

      // Write script
      const script = generateReactorScript(row.script_template as ScriptTemplate);
      // Scripts go in scripts/reactor/ at the same level as wz/
      const scriptBaseDir = join(workDir, "scripts", "reactor");
      mkdirSync(scriptBaseDir, { recursive: true });
      writeFileSync(join(scriptBaseDir, `${reactorId}.js`), script, "utf-8");

      update(`Published ${row.name}`, `Reactor ${reactorId}: XML + script written`);
    }

    // 5. Repack tar (include scripts/ if we added any)
    update("Repacking server WZ...");
    const newTarPath = join(workDir, "server-wz-new.tar.gz");
    // Pack both wz/ and scripts/ directories
    const packDirs = ["wz/"];
    if (existsSync(join(workDir, "scripts"))) packDirs.push("scripts/");
    execSync(
      `cd "${workDir}" && COPYFILE_DISABLE=1 tar czf "${newTarPath}" --exclude='.DS_Store' --exclude='._*' ${packDirs.join(" ")}`,
      { timeout: 300000 }
    );
    const tarExpectation = await hashFileStream(newTarPath);
    update("Repacked", `Repacked (${(tarExpectation.size / 1024 / 1024).toFixed(1)}MB)`);
    if (!processedIds.length) throw new Error("No reactors have publishable sprites");
        update("Loading committed Reactor.wz (~54MB)...");
        const reactorWzPath = join(workDir, "Reactor.wz");
        await copyFromAssets("Reactor.wz", reactorWzPath);
        update("Downloaded Reactor.wz", `Downloaded (${(statSync(reactorWzPath).size / 1024 / 1024).toFixed(0)}MB)`);

        update("Patching Reactor.wz with custom reactors...");
        const reactorWz = parseWzFile(reactorWzPath);

        for (const row of rows.filter((row) => processedIds.includes(row.reactor_id))) {
          const idlePng = sprites.get(row.reactor_id)!;

          const frames = generateReactorFrames(idlePng, row.animation_style as AnimationStyle);
          addReactorToWz(reactorWz, {
            reactorId: row.reactor_id,
            name: row.name,
            eventType: row.event_type,
            hitsToBreak: row.hits_to_break,
            idlePng: frames.idle,
            hitFrames: frames.hit,
            breakFrames: frames.break,
            hitDelay: row.hit_delay ?? 120,
            breakDelay: row.break_delay ?? 150,
            triggerItemId: row.trigger_item_id ?? undefined,
            triggerItemQty: row.trigger_item_qty ?? 1,
            timeout: row.timeout_ms ?? undefined,
          });
        }

        const patchedPath = join(workDir, "Reactor-patched.wz");
        saveWzFile(reactorWz, patchedPath);
        update("Patched Reactor.wz", `Patched with ${rows.length} custom reactor(s)`);

    const released = await publishWzFiles([
      { key: "server-wz.tar.gz", path: newTarPath, ...tarExpectation },
      { key: "Reactor.wz", path: patchedPath, ...await hashFileStream(patchedPath) },
    ], processedIds.map((id) => ({
      op: "import_image" as const, target_wz: "Reactor.wz",
      target_image: `${String(id).padStart(7, "0")}.img`,
    })), { baseReleaseId });
    status.releaseId = released.releaseId;
    update("Applying server release", `Committed release ${released.releaseId}`);
    const applied = await restartGameServer();
    if (!applied.success) throw new Error(applied.error || "Server apply failed");
    await execute(
      `UPDATE custom_reactors SET published = 1 WHERE reactor_id IN (${processedIds.map(() => "?").join(",")})`,
      processedIds,
    );

    status.status = "done";
    status.step = "Complete";
    status.finishedAt = new Date().toISOString();
    status.actions.push(`Published ${processedIds.length} reactor(s); release ${released.releaseId} committed and server applied.`);
    writeStatus(status);

    // Cleanup
    rmSync(workDir, { recursive: true, force: true });
  } catch (err: any) {
    status.status = "error";
    status.error = err.message;
    status.finishedAt = new Date().toISOString();
    writeStatus(status);
    rmSync(workDir, { recursive: true, force: true });
  }
}

// POST: Start publish job
export async function POST() {
  const jobId = randomUUID();
  let unlock: (() => void) | undefined;
  try {
    unlock = await lockPublicationJob("reactor-publish-status.json");
    writeStatus({ id: jobId, status: "running", step: "Starting...", actions: [], startedAt: new Date().toISOString() });
  } catch (error) {
    unlock?.();
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }
  runPublishJob(jobId).catch((error) => console.error("Reactor publication failed:", error)).finally(unlock);

  return NextResponse.json({ status: "started", id: jobId });
}

// GET: Check publish status
export async function GET() {
  const status = readStatus();
  return NextResponse.json(status || { status: "idle" });
}
