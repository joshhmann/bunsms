import { NextResponse } from "next/server";
import { existsSync, statSync, createReadStream } from "fs";
import { Readable } from "stream";
import { resolveAssetPath } from "@/lib/assets";

// GET /api/launcher/download/[name] — serve one client asset with
// Range/resume support the Electron launcher depends on:
//   Range: bytes=N-  -> 206 + Content-Range (append path in downloadFile)
//   no Range          -> 200 full body
//   unsatisfiable     -> 416 (launcher treats as failure, retries from zero)
//   HEAD              -> headers only (dashboard ETag revalidation)
// Malformed/traversal names -> 400/404, never a filesystem escape.
export const dynamic = "force-dynamic";

function parseRange(header: string | null, size: number): { start: number; end: number } | null | "unsatisfiable" {
  if (!header || !header.startsWith("bytes=")) return null;
  const spec = header.slice(6).split(",")[0].trim();
  // Suffix range: bytes=-N (last N bytes).
  if (spec.startsWith("-")) {
    const n = parseInt(spec.slice(1), 10);
    if (!Number.isFinite(n) || n <= 0) return "unsatisfiable";
    if (size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const [s, e] = spec.split("-");
  const start = parseInt(s, 10);
  if (!Number.isFinite(start) || start < 0) return "unsatisfiable";
  if (start >= size) return "unsatisfiable";
  const end = e === "" || e === undefined ? size - 1 : parseInt(e, 10);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

function streamToResponse(
  filePath: string,
  start: number,
  end: number
): Response {
  const nodeStream = createReadStream(filePath, { start, end });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream as BodyInit, { status: 206 });
}

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  let filePath: string;
  try {
    filePath = resolveAssetPath(decodeURIComponent(name));
  } catch {
    return NextResponse.json({ error: "Invalid asset name" }, { status: 400 });
  }
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const size = statSync(filePath).size;
  const etag = `"${size.toString(16)}-${statSync(filePath).mtimeMs.toString(16)}"`;
  const baseHeaders: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": "application/octet-stream",
    "ETag": etag,
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }
  if (range) {
    const res = streamToResponse(filePath, range.start, range.end);
    const headers = new Headers(baseHeaders);
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(res.body, { status: 206, headers });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  const headers = new Headers(baseHeaders);
  headers.set("Content-Length", String(size));
  return new Response(webStream as BodyInit, { status: 200, headers });
}

export async function HEAD(request: Request, ctx: { params: Promise<{ name: string }> }) {
  return GET(request, ctx);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" },
  });
}
