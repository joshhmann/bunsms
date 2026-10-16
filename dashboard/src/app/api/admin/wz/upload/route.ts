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
  acquirePublishLock,
  assetUrl,
  bumpPatch,
  hashFileStream,
  promoteStagedFile,
  readManifest,
  releasePublishLock,
  resolveAssetPath,
  resolveStagingPath,
  verifyStagedBytes,
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
  const url = new URL(request.url);
  const releaseId = url.searchParams.get("releaseId") || randomUUID().slice(0, 8);

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
  try {
    resolveAssetPath(name);
  } catch {
    return NextResponse.json({ error: `Invalid asset key: ${name}` }, { status: 400 });
  }
  if (!existsSync(resolveAssetPath(name)) && !manifestEntry && !isServerTarball) {
    return NextResponse.json({ error: `${name} is not a known asset` }, { status: 400 });
  }

  // Stream the upload to a temp file (chunk-by-chunk, no full buffering),
  // then move it into the release staging dir. NOTHING goes live here:
  // promotion happens below after expected-hash verification under the
  // publish lock. Partial temp cleaned on failure.
  const tempPath = join(tmpdir(), `wz-upload-${randomUUID()}.bin`);
  try {
    const readable = Readable.fromWeb(file.stream() as never);
    await pipeline(readable, createWriteStream(tempPath));
    const staged = resolveStagingPath(releaseId, name);
    mkdirSync(dirname(staged), { recursive: true });
    renameSync(tempPath, staged);
    const { hash, size } = await hashFileStream(staged);

    // Promote staged bytes to live under the publish lock after verifying
    // the staged bytes hash to what we just measured (self-consistency:
    // guards against a concurrent writer swapping the staging file).
    acquirePublishLock();
    try {
      await verifyStagedBytes(staged, { hash, size });
      const promoted = promoteStagedFile(releaseId, name);
      if (isServerTarball) {
        writeFileSync(
          resolveAssetPath("server-wz.version"),
          new Date().toISOString()
        );
      } else if (manifestEntry) {
        manifestEntry.hash = promoted.hash;
        manifestEntry.size = promoted.size;
        manifestEntry.url = assetUrl(name);
        manifest.version = bumpPatch(manifest.version);
        manifest.updatedAt = new Date().toISOString();
        manifest.downloadBase = `${process.env.ASSET_BASE_URL || "https://buns.asslorde.com"}/client/`;
      }
      const manifestPath = writeManifestAtomic(manifest);

      // WZ → NX only for *.wz files; dlls / config / exe stay launcher-only.
      if (name.toLowerCase().endsWith(".wz")) {
        dispatchWzToNx([name]).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        name,
        hash: promoted.hash,
        size: promoted.size,
        version: manifest.version,
        manifestPath,
        releaseId,
      });
    } finally {
      releasePublishLock();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {}
  }
}
