import { NextResponse } from "next/server";
import { AssetError, publishRelease } from "@/lib/assets";
import { stageMultipart } from "@/lib/asset-multipart";
import { isPrivateRequestAuthorized } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    if (!await isPrivateRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const upload = await stageMultipart(request);
    if (upload.expected.length !== 1 || upload.keys[0] !== "assets/npc/baker-sprite.png") {
      throw new AssetError("Provide the Baker sprite and its independently expected hash/size");
    }
    const result = await publishRelease(upload.releaseId, upload.expected);
    const asset = result.assets[0];
    return NextResponse.json({ success: true, releaseId: result.releaseId, url: asset.url, size: asset.size });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }
}
