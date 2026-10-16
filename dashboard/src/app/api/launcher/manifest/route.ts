import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  assetUrl,
  bumpPatch,
  hashFileStream,
  readManifest,
  resolveAssetPath,
  writeManifestAtomic,
} from "@/lib/assets";
import type { Manifest, ManifestFile } from "@/lib/assets";

// Single manifest authority. GET supports ?profile=stock|kaentake server-side
// filtering (old launchers send no param and get the full set; stock remains
// the default and Kaentake files are never mixed into stock results).
// POST modes: full replace, generateFrom (local dir), urls-only, register
// (hash/size record for out-of-band synced bytes).
export const dynamic = "force-dynamic";

const VALID_PROFILES: Record<string, true> = { stock: true, kaentake: true };

export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile");
    const { manifest } = readManifest();
    if (profile && !VALID_PROFILES[profile]) {
      return NextResponse.json({ error: `Unknown profile: ${profile}` }, { status: 400 });
    }
    const files = !profile
      ? manifest.files
      : manifest.files.filter((f) => (f.profiles ?? ["stock"]).includes(profile));
    const out: Manifest = { ...manifest, files };
    return NextResponse.json(out, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Update the manifest (called by GM AI or admin)
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Full manifest replacement (escape hatch + rollback restores).
    if (body.manifest) {
      const manifest = body.manifest as Manifest;
      manifest.updatedAt = new Date().toISOString();
      writeManifestAtomic(manifest);
      return NextResponse.json({ success: true, manifest });
    }

    // Generate manifest from a local directory of client files.
    if (body.generateFrom) {
      const clientDir = body.generateFrom as string;
      if (!existsSync(clientDir)) {
        return NextResponse.json({ error: "Directory not found" }, { status: 400 });
      }

      const { manifest: current } = readManifest();
      const seen: Record<string, true> = {};
      const files: ManifestFile[] = [];
      for (const tracked of current.files) {
        const filePath = join(clientDir, tracked.name);
        if (existsSync(filePath)) {
          const size = statSync(filePath).size;
          const hash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
          files.push({ ...tracked, hash, size, url: assetUrl(tracked.name) });
          seen[tracked.name] = true;
        }
      }
      // Preserve entries not present on disk (e.g. not-yet-synced) unchanged.
      for (const rest of current.files) {
        if (!seen[rest.name]) files.push(rest);
      }

      const manifest: Manifest = {
        version: body.version || bumpPatch(current.version),
        updatedAt: new Date().toISOString(),
        files,
        downloadBase: `${process.env.ASSET_BASE_URL || "https://buns.asslorde.com"}/client/`,
      };

      writeManifestAtomic(manifest);
      return NextResponse.json({ success: true, manifest });
    }

    // Update download URLs only (e.g. cutover flip). Never bumps version:
    // URL-only edits trigger zero re-downloads (launcher keys on size+hash).
    if (body.urls) {
      const { manifest } = readManifest();
      for (const file of manifest.files) {
        if (body.urls[file.name]) {
          file.url = body.urls[file.name];
        }
      }
      manifest.updatedAt = new Date().toISOString();
      if (body.version) manifest.version = body.version;
      writeManifestAtomic(manifest);
      return NextResponse.json({ success: true, manifest });
    }

    // Register: record hash/size for bytes already synced to the asset dir
    // (out-of-band rsync/scp flow). Re-hashes landed bytes fail-closed.
    if (body.register) {
      const { manifest } = readManifest();
      const results: Array<{ name: string; hash: string; size: number }> = [];
      for (const item of body.register as Array<{ name: string }>) {
        const entry = manifest.files.find((f) => f.name === item.name);
        if (!entry) {
          return NextResponse.json({ error: `${item.name} is not in the launcher manifest` }, { status: 400 });
        }
        const filePath = resolveAssetPath(item.name);
        if (!existsSync(filePath)) {
          return NextResponse.json(
            { error: `${item.name} not found in asset dir — sync bytes first` },
            { status: 400 }
          );
        }
        const size = statSync(filePath).size;
        const { hash } = await hashFileStream(filePath);
        entry.hash = hash;
        entry.size = size;
        entry.url = assetUrl(entry.name);
        results.push({ name: entry.name, hash, size });
      }
      manifest.version = bumpPatch(manifest.version);
      manifest.updatedAt = new Date().toISOString();
      writeManifestAtomic(manifest);
      return NextResponse.json({ success: true, manifest, results, version: manifest.version });
    }

    return NextResponse.json({ error: "Provide manifest, generateFrom, urls, or register" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
