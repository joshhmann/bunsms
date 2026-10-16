import { NextResponse } from "next/server";
import { AssetError, readManifest } from "@/lib/assets";
import { publishStagedWzRelease } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  let publishedReleaseId: string | undefined;
  try {
    const body = await request.json();
    if (typeof body.releaseId !== "string" || typeof body.name !== "string") throw new AssetError("releaseId and name are required; live-directory registration is not supported");
    const allowed = new Set(readManifest().manifest.files.map((file) => file.name));
    allowed.add("server-wz.tar.gz");
    if (!allowed.has(body.name)) throw new AssetError("Name is not in the launcher/server allowlist");
    if (body.operations !== undefined && !Array.isArray(body.operations)) throw new AssetError("operations must be an array");
    const expected = { key: body.name, hash: body.hash, size: body.size };
    const result = await publishStagedWzRelease(body.releaseId, [expected], body.operations || []);
    publishedReleaseId = result.releaseId;
    if (body.name === "server-wz.tar.gz") {
      const applied = await restartGameServer();
      if (!applied.success) throw new AssetError(applied.error || "Release committed, but game-server apply failed", 502);
    }
    return NextResponse.json({ ok: true, name: body.name, hash: body.hash, size: body.size, version: result.manifest.version, releaseId: result.releaseId, assets: result.assets });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), ...(publishedReleaseId ? { releaseId: publishedReleaseId, published: true } : {}) }, { status: error instanceof AssetError ? error.status : 500 });
  }
}
