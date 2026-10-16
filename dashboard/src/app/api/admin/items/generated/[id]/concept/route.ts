import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { getGeneratedItem } from "@/lib/gm/generated-items";
import { requireItemId, resolveArtPath } from "@/lib/art";

export const dynamic = "force-dynamic";

/** Serve only explicitly committed concept bytes; legacy references require migration. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let generationId: number;
  try { generationId = requireItemId(id); }
  catch { return NextResponse.json({ error: "Invalid generation id" }, { status: 400 }); }
  const item = await getGeneratedItem(generationId);
  if (!item?.concept_image_url) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  try {
    const bytes = await readFile(resolveArtPath(item.concept_image_url));
    return new NextResponse(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
