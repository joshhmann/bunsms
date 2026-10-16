import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { resolveAssetPath, storeAssetStream } from "@/lib/assets";

// POST: stage client-asset bytes into the self-hosted asset dir
// (accepts multipart form data or JSON with server-filesystem paths).
// Replaces the old R2 multipart upload; hashes/sizes are recorded via the
// manifest `register` mode, never trusted from the uploader.
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  // JSON mode: stage files already on the server filesystem (seeded/patched dir).
  if (contentType.includes("application/json")) {
    const body = await request.json();

    if (!body.files || !Array.isArray(body.files)) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const results = [];
    for (const file of body.files) {
      if (file.path && existsSync(file.path)) {
        const name = file.name || basename(file.path);
        try {
          resolveAssetPath(name);
        } catch {
          return NextResponse.json({ error: `Invalid asset name: ${name}` }, { status: 400 });
        }
        const data = readFileSync(file.path);
        const blob = new Blob([new Uint8Array(data)]);
        const staged = await storeAssetStream(name, blob.stream() as ReadableStream<Uint8Array>);
        results.push({ name, ...staged });
      }
    }

    return NextResponse.json({ results });
  }

  // Multipart mode: direct file upload, streamed to disk (no full buffering
  // of 600 MB WZ files in the route handler beyond what formData requires).
  try {
    const formData = await request.formData();
    const results = [];

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        const name = value.name || key;
        try {
          resolveAssetPath(name);
        } catch {
          return NextResponse.json({ error: `Invalid asset name: ${name}` }, { status: 400 });
        }
        const staged = await storeAssetStream(name, value.stream() as ReadableStream<Uint8Array>);
        results.push({ name, ...staged });
      }
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
