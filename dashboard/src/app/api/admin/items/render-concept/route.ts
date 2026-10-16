import { NextRequest, NextResponse } from "next/server";
import { renderWeaponFromConcept } from "@/lib/wz/sprite-2d";
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { ASSET_BASE_URL, ASSET_DIR } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/items/render-concept
 *
 * Runs the 2D sprite pipeline server-side from a concept image and stages
 * the resulting icon + animation frames into the self-hosted asset dir.
 * Same response shape as /api/admin/items/render-weapon so the admin UI
 * can treat them interchangeably.
 *
 * Body: { itemId: number, concept: "data:image/png;base64,..." }
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
    const { itemId, concept } = await request.json();
    if (!itemId || !concept) {
      return NextResponse.json(
        { error: "itemId and concept (data URL or base64 PNG) are required" },
        { status: 400 }
      );
    }

    const conceptPng = Buffer.from(concept.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const rendered = await renderWeaponFromConcept({ conceptPng });

    const frameUrls: Record<string, string[]> = {};
    let iconUrl: string | null = null;
    const uploadResults: string[] = [];

    if (rendered.iconDataUrl) {
      const iconBuf = Buffer.from(rendered.iconDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
      iconUrl = stageRenderFile(`custom-items/${itemId}/icon.png`, iconBuf);
      uploadResults.push("icon.png");
    }

    for (const [animName, dataUrls] of Object.entries(rendered.frames)) {
      frameUrls[animName] = [];
      for (let i = 0; i < dataUrls.length; i++) {
        const pngBuf = Buffer.from(dataUrls[i].replace(/^data:image\/\w+;base64,/, ""), "base64");
        frameUrls[animName].push(stageRenderFile(`custom-items/${itemId}/${animName}/${i}.png`, pngBuf));
        uploadResults.push(`${animName}/${i}.png`);
      }
    }

    stageRenderFile(
      `custom-items/${itemId}/origins.json`,
      Buffer.from(JSON.stringify(rendered.origins))
    );

    return NextResponse.json({
      success: true,
      origins: rendered.origins,
      frames: frameUrls,
      iconUrl,
      uploaded: uploadResults.length,
      message: `Rendered + staged ${uploadResults.length} files`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Render-concept failed: ${message}` },
      { status: 500 }
    );
  }
}
