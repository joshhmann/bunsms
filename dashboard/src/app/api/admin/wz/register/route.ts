import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dispatchWzToNx } from "@/lib/wz-to-nx";
import { existsSync } from "fs";
import { join } from "path";
import {
  ASSET_DIR,
  assetUrl,
  bumpPatch,
  hashFileStream,
  readManifest,
  resolveAssetPath,
  writeManifestAtomic,
} from "@/lib/assets";

// Companion to /api/admin/wz/upload. When a file is too large to push
// through the dashboard, the operator syncs bytes out-of-band
// (rsync/scp to the asset dir) and calls this route to (a) verify the
// landed bytes, (b) record hash + size in the launcher manifest,
// (c) dispatch wz-to-nx, (d) for server-wz.tar.gz, drop a version marker.
// No game-server restart is triggered here (owner-operated, never automatic).

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const SERVER_TARBALL = "server-wz.tar.gz";

export async function POST(request: NextRequest) {
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON" },
      { status: 400 }
    );
  }

  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  let manifestData;
  try {
    manifestData = readManifest();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to read manifest: ${message}` },
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
    const filePath = isServerTarball
      ? join(ASSET_DIR, SERVER_TARBALL)
      : resolveAssetPath(name);
    if (!existsSync(filePath)) {
      throw new Error(
        `${name} not found in asset dir — sync bytes first (rsync/scp)`
      );
    }
    const { size, hash } = await hashFileStream(filePath);

    let newVersion: string | undefined;

    if (!isServerTarball && manifestEntry) {
      manifestEntry.hash = hash;
      manifestEntry.size = size;
      manifestEntry.url = assetUrl(name);
      manifest.version = bumpPatch(manifest.version);
      manifest.updatedAt = new Date().toISOString();
      newVersion = manifest.version;
      writeManifestAtomic(manifest);

      if (name.toLowerCase().endsWith(".wz")) {
        dispatchWzToNx([name]).catch(() => {});
      }
    }

    return NextResponse.json({
      ok: true,
      name,
      hash,
      size,
      version: newVersion,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
