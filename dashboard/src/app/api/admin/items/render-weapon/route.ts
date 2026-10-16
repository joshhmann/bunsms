import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { ASSET_BASE_URL, ASSET_DIR } from "@/lib/assets";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/items/render-weapon
 *
 * Receives pre-rendered weapon frames (from client-side Three.js) and stages
 * them into the self-hosted asset dir.
 * Body: { itemId, icon (base64), origins, frames: { animName: [base64, ...] } }
 * Returns: { origins, frames: { animName: [url, ...] }, iconUrl }
 */
function stageRenderFile(key: string, buf: Buffer): string {
  const dest = join(ASSET_DIR, key);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp.${process.pid}`;
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
  return `${ASSET_BASE_URL}/client/${key}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { itemId, icon, origins, frames } = body;

    if (!itemId || !frames || !origins) {
      return NextResponse.json(
        { error: "itemId, origins, and frames are required" },
        { status: 400 }
      );
    }

    const frameUrls: Record<string, string[]> = {};
    let iconUrl: string | null = null;
    const uploadResults: string[] = [];

    // Stage icon
    if (icon) {
      const iconBuf = Buffer.from(icon.replace(/^data:image\/png;base64,/, ""), "base64");
      iconUrl = stageRenderFile(`custom-items/${itemId}/icon.png`, iconBuf);
      uploadResults.push("Staged icon.png");
    }

    // Stage animation frames
    for (const [animName, dataUrls] of Object.entries(frames as Record<string, string[]>)) {
      frameUrls[animName] = [];

      for (let i = 0; i < dataUrls.length; i++) {
        const dataUrl = dataUrls[i];
        const pngBuf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
        frameUrls[animName].push(stageRenderFile(`custom-items/${itemId}/${animName}/${i}.png`, pngBuf));
        uploadResults.push(`Staged ${animName}/${i}.png`);
      }
    }

    // Stage origins.json
    stageRenderFile(`custom-items/${itemId}/origins.json`, Buffer.from(JSON.stringify(origins)));

    return NextResponse.json({
      success: true,
      origins,
      frames: frameUrls,
      iconUrl,
      uploaded: uploadResults.length,
      message: `Staged ${uploadResults.length} files into asset dir`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Stage failed: ${message}` },
      { status: 500 }
    );
  }
}
