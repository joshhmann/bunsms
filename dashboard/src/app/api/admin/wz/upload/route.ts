import { NextResponse } from "next/server";
import { AssetError, readManifest } from "@/lib/assets";
import { stageMultipart } from "@/lib/asset-multipart";
import { publishStagedWzRelease } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";
import { isPrivateRequestAuthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  let publishedReleaseId: string | undefined;
  try {
    if (!await isPrivateRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const upload = await stageMultipart(request);
    if (upload.keys.length !== 1 || upload.expected.length !== 1) throw new AssetError("Exactly one file and its independently expected hash/size are required");
    const item = upload.expected[0];
    const allowed = new Set(readManifest().manifest.files.map((file) => file.name));
    allowed.add("server-wz.tar.gz");
    if (!allowed.has(item.key) || (upload.fields.name && upload.fields.name !== item.key)) throw new AssetError("Untracked or conflicting WZ upload name");
    const operations = upload.fields.operations ? JSON.parse(upload.fields.operations) : [];
    if (!Array.isArray(operations)) throw new AssetError("operations must be an array");
    const result = await publishStagedWzRelease(upload.releaseId, [item], operations);
    publishedReleaseId = result.releaseId;
    if (item.key === "server-wz.tar.gz") {
      const applied = await restartGameServer();
      if (!applied.success) throw new AssetError(applied.error || "Release committed, but game-server apply failed", 502);
    }
    return NextResponse.json({ ok: true, name: item.key, hash: item.hash, size: item.size, version: result.manifest.version, releaseId: result.releaseId, manifestPath: result.manifestPath, assets: result.assets });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), ...(publishedReleaseId ? { releaseId: publishedReleaseId, published: true } : {}) }, { status: error instanceof AssetError ? error.status : 500 });
  }
}
