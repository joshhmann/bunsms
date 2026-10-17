import { NextRequest, NextResponse } from "next/server";
import { renderWeaponFromConcept } from "@/lib/wz/sprite-2d";
import { publishRenderedArt, requireItemId } from "@/lib/art";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Render and commit the complete icon, animation frames and origins in one release. */
export async function POST(request: NextRequest) {
  let itemId: number;
  let concept: string;
  try {
    const body = await request.json();
    itemId = requireItemId(body.itemId);
    if (typeof body.concept !== "string" || !body.concept) throw new Error("concept (data URL or base64 PNG) is required");
    concept = body.concept;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  try {
    const conceptPng = Buffer.from(concept.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const rendered = await renderWeaponFromConcept({ conceptPng });
    const result = await publishRenderedArt({ itemId, icon: rendered.iconDataUrl, origins: rendered.origins, frames: rendered.frames });
    return NextResponse.json({ success: true, ...result, message: `Rendered and published ${result.uploaded} files` });
  } catch (err) {
    return NextResponse.json({ error: `Render-concept failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
