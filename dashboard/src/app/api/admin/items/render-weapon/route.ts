import { NextRequest, NextResponse } from "next/server";
import { publishRenderedArt, requireItemId, validateAnimationKeys } from "@/lib/art";

export const dynamic = "force-dynamic";

/** Publish the complete pre-rendered icon, animation frames and origins atomically. */
export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
    body.itemId = requireItemId(body.itemId);
    validateAnimationKeys(body.frames);
    if (!body.origins || typeof body.origins !== "object") throw new Error("origins is required");
    if (body.icon != null && typeof body.icon !== "string") throw new Error("icon must be a base64 PNG");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  try {
    const result = await publishRenderedArt(body);
    return NextResponse.json({ success: true, ...result, message: `Published ${result.uploaded} files` });
  } catch (err) {
    return NextResponse.json({ error: `Publication failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
