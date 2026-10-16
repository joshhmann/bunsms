import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AssetError, beginRelease, readManifest, readReleaseView, releaseFileNames, rollbackRelease } from "@/lib/assets";
import { prepareStagedWzRelease, publishSealedWzRelease, publishStagedWzRelease } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";
import type { Manifest, PublishResult } from "@/lib/assets";

export const dynamic = "force-dynamic";
const PROFILES: Record<string, true> = { stock: true, kaentake: true };

export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile") || "stock";
    if (!PROFILES[profile]) throw new AssetError(`Unknown profile: ${profile}`);
    const retainedId = request.nextUrl.searchParams.get("releaseId");
    const current = readManifest();
    const manifest = retainedId ? readReleaseView(retainedId) : current.manifest;
    return NextResponse.json({
      version: manifest.version, updatedAt: manifest.updatedAt,
      downloadBase: manifest.downloadBase, releaseId: manifest.releaseId,
      completeProfiles: manifest.completeProfiles, provenance: manifest.provenance,
      files: manifest.files.filter((file) => (file.profiles || ["stock"]).includes(profile)),
    }, { headers: {
      "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
      "X-Manifest-Authority": `${current.manifest.releaseId ? "volume" : "bundled-bootstrap-seed"}:${current.path}`,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }
}

async function applyChangedServer(previous: Manifest, result: PublishResult): Promise<void> {
  const next = result.manifest.assets?.["server-wz.tar.gz"];
  if (!previous.releaseId || !next || previous.assets?.["server-wz.tar.gz"]?.hash === next.hash) return;
  const applied = await restartGameServer();
  if (!applied.success) throw new AssetError(applied.error || "Release committed, but game-server apply failed", 502);
}

// Private session/GM-secret-authenticated mutations; Caddy never forwards public writes.
export async function POST(request: Request) {
  let publishedReleaseId: string | undefined;
  try {
    const body = await request.json();
    if (body.stage === true) {
      const releaseId = beginRelease({ ...(body.baseReleaseId !== undefined ? { baseReleaseId: body.baseReleaseId } : {}), ...(body.catalog !== undefined ? { catalog: body.catalog } : {}), ...(body.certification !== undefined ? { certification: body.certification } : {}), ...(body.version !== undefined ? { version: body.version } : {}) });
      return NextResponse.json({ success: true, releaseId });
    }
    if (typeof body.rollback === "string") {
      const previous = readManifest().manifest;
      const result = await rollbackRelease(body.rollback);
      publishedReleaseId = result.releaseId;
      await applyChangedServer(previous, result);
      return NextResponse.json({ success: true, ...result });
    }
    if (body.publish === true && typeof body.releaseId === "string") {
      const previous = readManifest().manifest;
      const result = await publishSealedWzRelease(body.releaseId);
      publishedReleaseId = result.releaseId;
      await applyChangedServer(previous, result);
      return NextResponse.json({ success: true, version: result.manifest.version, ...result });
    }
    if (typeof body.releaseId !== "string" || !Array.isArray(body.register) || !body.register.length) {
      throw new AssetError("Provide stage, a retained rollback id, or releaseId and expected register metadata");
    }
    const allowed = releaseFileNames(body.releaseId);
    const expected = body.register.map((item: { name: string; hash: string; size: number }) => {
      if (!item || !allowed.has(item.name)) throw new AssetError("Every registered name must be in the complete launcher/server allowlist");
      return { key: item.name, hash: item.hash, size: item.size };
    });
    if (body.operations !== undefined && !Array.isArray(body.operations)) throw new AssetError("operations must be an array");
    const target = body.target || "native";
    if (target !== "native" && target !== "native-and-browser") throw new AssetError("Unknown publication target");
    if (body.prepareOnly === true) {
      const prepared = await prepareStagedWzRelease(body.releaseId, expected, body.operations || [], target);
      return NextResponse.json({ success: true, published: false, sealed: true, nxBaseUrl: `/nx/r/${prepared.releaseId}`, ...prepared });
    }
    const previous = readManifest().manifest;
    const result = await publishStagedWzRelease(body.releaseId, expected, body.operations || [], target);
    publishedReleaseId = result.releaseId;
    await applyChangedServer(previous, result);
    return NextResponse.json({ success: true, version: result.manifest.version, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), ...(publishedReleaseId ? { releaseId: publishedReleaseId, published: true } : {}) }, { status: error instanceof AssetError ? error.status : 500 });
  }
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  } });
}
