import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dispatchWzToNx } from "@/lib/wz-to-nx";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  ASSET_DIR,
  assetUrl,
  bumpPatch,
  hashFileStream,
  readManifest,
  resolveAssetPath,
  writeManifestAtomic,
} from "@/lib/assets";
import type { ManifestRead } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// 1 GB cap. Map.wz is the heaviest at ~640 MB, so this leaves headroom but
// catches accidental uploads of, e.g., a full disk image.
const MAX_BYTES = 1024 * 1024 * 1024;

const SERVER_TARBALL = "server-wz.tar.gz";

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Body must be multipart/form-data" },
      { status: 400 }
    );
  }

  const name = String(form.get("name") || "").trim();
  const file = form.get("file");
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} bytes, max ${MAX_BYTES})` },
      { status: 413 }
    );
  }

  let manifestData: ManifestRead;
  try {
    manifestData = readManifest();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to read launcher manifest: ${message}` },
      { status: 500 }
    );
  }
  const { manifest } = manifestData;

  const isServerTarball = name === SERVER_TARBALL;
  const manifestEntry = manifest.files.find((f) => f.name === name);

  if (!isServerTarball && !manifestEntry) {
    return NextResponse.json(
      {
        error: `${name} is not in the launcher manifest. Allowed: ${manifest.files
          .map((f) => f.name)
          .concat(SERVER_TARBALL)
          .join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (!isServerTarball) {
    try {
      resolveAssetPath(name);
    } catch {
      return NextResponse.json({ error: `Invalid asset name: ${name}` }, { status: 400 });
    }
  }

  // Stream the upload to a temp file so we don't buffer it all in memory.
  const tempPath = join(tmpdir(), `wz-upload-${randomUUID()}.bin`);
  try {
    const readable = Readable.fromWeb(file.stream() as never);
    await pipeline(readable, createWriteStream(tempPath));
    const { hash, size } = await hashFileStream(tempPath);

    let newVersion: string | undefined;

    if (isServerTarball) {
      // Stage the tarball into the asset dir next to client files so the
      // game-server path has no R2 dependency; no game-server restart here
      // (restarts are owner-operated, never triggered by publish).
      mkdirSync(ASSET_DIR, { recursive: true });
      const dest = join(ASSET_DIR, SERVER_TARBALL);
      const staged = `${dest}.tmp.${process.pid}`;
      const { renameSync } = await import("fs");
      renameSync(tempPath, staged);
      renameSync(staged, dest);
      writeFileSync(join(ASSET_DIR, "server-wz.version"), new Date().toISOString());
    } else if (manifestEntry) {
      const dest = resolveAssetPath(name);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(tempPath, dest);
      manifestEntry.hash = hash;
      manifestEntry.size = size;
      manifestEntry.url = assetUrl(name);
      manifest.version = bumpPatch(manifest.version);
      manifest.updatedAt = new Date().toISOString();
      newVersion = manifest.version;

      const manifestPath = writeManifestAtomic(manifest);

      // WZ → NX only for *.wz files; dlls / config / exe stay launcher-only.
      if (name.toLowerCase().endsWith(".wz")) {
        dispatchWzToNx([name]).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        name,
        hash,
        size,
        version: newVersion,
        manifestPath,
      });
    }

    return NextResponse.json({ ok: true, name, hash, size, version: newVersion });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {}
  }
}
