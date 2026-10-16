import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import {
  acquirePublishLock,
  assetUrl,
  bumpPatch,
  hashFileStream,
  promoteStagedFile,
  readManifest,
  releasePublishLock,
  resolveStagingPath,
  verifyStagedBytes,
  writeManifestAtomic,
} from "@/lib/assets";
import type { Manifest } from "@/lib/assets";
import { existsSync } from "fs";

// Single manifest authority. GET supports ?profile=stock|kaentake server-side
// filtering (absent profile defaults to stock; old launchers send no param and
// must never receive the Kaentake triple).
//
// POST is authenticated (middleware: session JWT or x-gm-secret; the public
// /api/launcher/ prefix is GET/HEAD-only). Modes:
//   stage    — begin a release, returns { releaseId } for upload targeting.
//   register — verify staged bytes against EXPECTED hashes, promote atomically
//              (per-file rename with previous-bytes retained), bump version.
//              Wrong hash/size leaves live bytes AND manifest unchanged.
//   urls     — URL-only rewrite (no byte change, never bumps version).
//   manifest — rollback restore of a previous self-hosted manifest (bytes for
//              that manifest are retained under releases/, never deleted).
// The old generateFrom (arbitrary local-dir read + full replace) is removed:
// every byte change goes through staged expected-hash verification.
export const dynamic = "force-dynamic";

const VALID_PROFILES: Record<string, true> = { stock: true, kaentake: true };

export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile");
    const { manifest } = readManifest();
    if (profile && !VALID_PROFILES[profile]) {
      return NextResponse.json({ error: `Unknown profile: ${profile}` }, { status: 400 });
    }
    // Absent profile defaults to stock (old launchers send no param):
    // the Kaentake triple is never served to a client that didn't ask.
    const effective = profile ?? "stock";
    const files = manifest.files.filter((f) => (f.profiles ?? ["stock"]).includes(effective));
    const out: Manifest = { ...manifest, files };
    return NextResponse.json(out, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface RegisterItem {
  name: string;
  hash: string;
  size: number;
}

// POST: Update the manifest (called by GM AI or admin, authenticated)
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Stage: mint a release id. Uploads target it via /api/launcher/upload.
    if (body.stage) {
      const releaseId = randomUUID().slice(0, 8);
      return NextResponse.json({ success: true, releaseId });
    }

    // Register: verify staged bytes against EXPECTED hashes, then promote.
    if (body.register) {
      const releaseId = String(body.releaseId || "");
      if (!releaseId) {
        return NextResponse.json({ error: "releaseId is required" }, { status: 400 });
      }
      const items = body.register as RegisterItem[];
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: "register must be a non-empty array" }, { status: 400 });
      }
      try {
        acquirePublishLock();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: message }, { status: 409 });
      }
      const { manifest } = readManifest();
      try {
        // Phase 1: verify ALL staged bytes against expected hashes first.
        // Any mismatch aborts with live bytes and manifest untouched.
        for (const item of items) {
          const entry = manifest.files.find((f) => f.name === item.name);
          if (!entry) {
            return NextResponse.json({ error: `${item.name} is not in the launcher manifest` }, { status: 400 });
          }
          if (!item.hash || !item.size) {
            return NextResponse.json(
              { error: `${item.name}: expected hash and size are required` },
              { status: 400 }
            );
          }
          const staged = resolveStagingPath(releaseId, item.name);
          if (!existsSync(staged)) {
            return NextResponse.json(
              { error: `${item.name} not staged under releases/${releaseId} — upload first` },
              { status: 400 }
            );
          }
          await verifyStagedBytes(staged, { hash: item.hash, size: item.size });
        }
        // Phase 2: promote verified bytes + record manifest entries.
        const results: Array<{ name: string; hash: string; size: number }> = [];
        for (const item of items) {
          const { hash, size } = promoteStagedFile(releaseId, item.name);
          const entry = manifest.files.find((f) => f.name === item.name)!;
          entry.hash = hash;
          entry.size = size;
          entry.url = assetUrl(entry.name);
          results.push({ name: entry.name, hash, size });
        }
        manifest.version = bumpPatch(manifest.version);
        manifest.updatedAt = new Date().toISOString();
        manifest.downloadBase = `${process.env.ASSET_BASE_URL || "https://buns.asslorde.com"}/client/`;
        const manifestPath = writeManifestAtomic(manifest);
        return NextResponse.json({ success: true, manifest, results, version: manifest.version, manifestPath });
      } finally {
        releasePublishLock();
      }
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

    // Rollback: restore a previous self-hosted manifest verbatim (version and
    // all). Previous bytes are retained under releases/, so the restored
    // manifest's hashes keep serving. No byte verification is needed because
    // nothing is promoted — this only re-points the manifest.
    if (body.manifest) {
      const manifest = body.manifest as Manifest;
      if (!manifest || !Array.isArray(manifest.files)) {
        return NextResponse.json({ error: "manifest must include a files array" }, { status: 400 });
      }
      manifest.updatedAt = new Date().toISOString();
      writeManifestAtomic(manifest);
      return NextResponse.json({ success: true, manifest });
    }

    return NextResponse.json({ error: "Provide stage, register, urls, or manifest (rollback)" }, { status: 400 });
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
