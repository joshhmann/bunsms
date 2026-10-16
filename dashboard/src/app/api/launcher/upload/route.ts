import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { resolveAssetPath, storeStagedStream } from "@/lib/assets";

// POST: stage client-asset bytes into a release staging dir
// (multipart form data or JSON with server-filesystem paths).
// Staged bytes are NOT live until verified + promoted via the manifest
// `register` mode (expected-hash check, atomic promotion, version bump).
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const url = new URL(request.url);
  const releaseId = url.searchParams.get("releaseId") || randomUUID().slice(0, 8);

  // JSON mode: stage files already on the server filesystem (seeded/patched dir).
  if (contentType.includes("application/json")) {
    const body = await request.json();

    if (!body.files || !Array.isArray(body.files)) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const results = [];
    for (const file of body.files) {
      if (file.path && existsSync(file.path)) {
        const name = file.name;
        if (!name) {
          return NextResponse.json({ error: "file.name is required" }, { status: 400 });
        }
        try {
          resolveAssetPath(name);
        } catch {
          return NextResponse.json({ error: `Invalid asset key: ${name}` }, { status: 400 });
        }
        const data = readFileSync(file.path);
        const blob = new Blob([new Uint8Array(data)]);
        const staged = await storeStagedStream(
          releaseId,
          name,
          blob.stream() as ReadableStream<Uint8Array>
        );
        results.push({ name, staged });
      }
    }

    return NextResponse.json({ releaseId, results });
  }

  // Multipart mode: direct file upload, streamed chunk-by-chunk to a staging
  // path (never live, partial cleaned on failure).
  try {
    const formData = await request.formData();
    const results = [];

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        const name = value.name || key;
        try {
          resolveAssetPath(name);
        } catch {
          return NextResponse.json({ error: `Invalid asset key: ${name}` }, { status: 400 });
        }
        const staged = await storeStagedStream(
          releaseId,
          name,
          value.stream() as ReadableStream<Uint8Array>
        );
        results.push({ name, staged });
      }
    }

    return NextResponse.json({ releaseId, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
