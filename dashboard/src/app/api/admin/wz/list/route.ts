import { NextResponse } from "next/server";
import { readManifest } from "@/lib/assets";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { manifest, path } = readManifest();
    return NextResponse.json({ version: manifest.version, updatedAt: manifest.updatedAt, releaseId: manifest.releaseId, files: manifest.files, source: manifest.releaseId ? "volume" : "bundled", authority: path }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
