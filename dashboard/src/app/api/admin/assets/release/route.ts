import { NextResponse } from "next/server";
import { readManifest } from "@/lib/assets";

export const dynamic = "force-dynamic";
// Private middleware-authenticated writer view; never use the public stock-filtered view as an allowlist.
export async function GET() {
  const { manifest } = readManifest();
  return NextResponse.json({
    manifest,
    allowlist: [...new Set([...manifest.files.map((file) => file.name), ...Object.keys(manifest.assets || {}), "server-wz.tar.gz", "server-wz-baseline.tar.gz"])],
  }, { headers: { "Cache-Control": "no-store" } });
}
