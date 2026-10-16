import { NextRequest, NextResponse } from "next/server";
import { execute, query } from "@/lib/db";
import { generateReactorFrames } from "@/lib/wz/reactor-animator";
import type { AnimationStyle, } from "@/lib/wz/reactor-animator";
import { validateItemIds } from "@/lib/item-lookup";
import { generateImage } from "@/lib/openrouter/image";
import { publishBuffers } from "@/lib/assets";

const CUSTOM_REACTOR_ID_MIN = 9900000;
const CUSTOM_REACTOR_ID_MAX = 9999999;

async function getNextReactorId(): Promise<number> {
  const rows = await query<{ reactor_id: number }>(
    "SELECT reactor_id FROM custom_reactors"
  );
  const used = new Set(rows.map((r) => r.reactor_id));
  for (let id = CUSTOM_REACTOR_ID_MIN; id <= CUSTOM_REACTOR_ID_MAX; id++) {
    if (!used.has(id)) return id;
  }
  throw new Error("No free reactor IDs");
}


async function generateSprite(description: string, model?: string): Promise<Buffer> {
  const prompt = `Generate a single small pixel-art game sprite of: ${description}.
Style: 16-bit RPG pixel art, MapleStory-style, tiny breakable object sprite (32-80 pixels),
white or solid color background, no text, no UI elements, centered in frame,
clean pixel edges, vibrant colors, suitable for a 2D side-scrolling game.
The object should look like a breakable/interactable map object (chest, box, crystal, ore, egg, plant, etc).
Single object only, no duplicates, no scene, just the object.`;

  return generateImage({ prompt, model });
}

/**
 * POST /api/gm/reactors
 *
 * Create a custom reactor with an AI-generated sprite.
 * Body: { name, description, animationStyle?, hitsToBreak?, scriptTemplate?, drops? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      animationStyle = "breakable",
      hitsToBreak = 3,
      scriptTemplate = "drop_items",
      drops,
      model,
    } = body;

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });

    // Validate drops item IDs before doing anything expensive
    if (Array.isArray(drops) && drops.length > 0) {
      const itemIds = drops.map((d: any) => d.itemId).filter(Boolean);
      const invalid = validateItemIds(itemIds);
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid item IDs: ${invalid.join(", ")}. Use search_items or get_item to find valid IDs.` },
          { status: 400 }
        );
      }
    }

    // 1. Generate sprite via OpenRouter
    const pngBuf = await generateSprite(description, model);

    // 2. Process through reactor animation pipeline (handles white bg removal + downscale)
    const frames = generateReactorFrames(pngBuf, animationStyle as AnimationStyle);

    // 3. Get next free ID
    const reactorId = await getNextReactorId();

    const idleKey = `reactors/${reactorId}/idle.png`;
    const art = await publishBuffers([{ key: idleKey, data: pngBuf }]);
    const idlePngUrl = art.assets.find((asset) => asset.key === idleKey)!.url;

    // Server XML/scripts and native/browser data are produced together by the
    // publication job below; never write an uncommitted game overlay here.
    const boundedHits = Math.min(Math.max(hitsToBreak, 1), 5);

    // 7. Save to DB
    await execute(
      `INSERT INTO custom_reactors
       (reactor_id, name, event_type, hits_to_break, animation_style, script_template,
        idle_png_url, trigger_item_id, trigger_item_qty, timeout_ms, hit_delay, break_delay)
       VALUES (?, ?, 0, ?, ?, ?, ?, NULL, 1, NULL, 120, 150)`,
      [reactorId, name, boundedHits, animationStyle, scriptTemplate, idlePngUrl]
    );

    // 8. Configure drops
    if (Array.isArray(drops)) {
      for (const drop of drops) {
        if (!drop.itemId) continue;
        const pct = Math.max(1, Math.min(drop.chance ?? 100, 100));
        const chance = Math.max(1, Math.round(100 / pct));
        await execute(
          "INSERT INTO reactordrops (reactorid, itemid, chance, questid) VALUES (?, ?, ?, -1)",
          [reactorId, drop.itemId, chance]
        );
      }
    }

    // A started background job is not a published/applied reactor.
    const cookie = request.headers.get("cookie") ?? "";
    const gmSecret = request.headers.get("x-gm-secret") ?? "";
    const authHeaders: Record<string, string> = {};
    if (cookie) authHeaders.cookie = cookie;
    if (gmSecret) authHeaders["x-gm-secret"] = gmSecret;
    const publishRes = await fetch(
      new URL("/api/admin/reactors/publish", request.url).toString(),
      { method: "POST", headers: authHeaders }
    );
    const publishData = await publishRes.json();
    if (!publishRes.ok || publishData.error || !["started", "done"].includes(publishData.status)) {
      return NextResponse.json({
        error: publishData.error || "Reactor publish did not start",
        created: true, published: false, reactorId,
      }, { status: 502 });
    }
    const publishNote = publishData.status === "done"
      ? "Release committed and server apply acknowledged."
      : "Publication job started; the reactor is not yet published. Inspect the job for commit and server-apply acknowledgement.";

    return NextResponse.json({
      success: true,
      reactorId,
      name,
      spriteSize: `${frames.width}x${frames.height}`,
      hitFrames: frames.hit.length,
      breakFrames: frames.break.length,
      publishNote,
      publishStatus: publishData.status,
      publishJobId: publishData.id,
      message: `Custom reactor ${reactorId} "${name}" created with AI sprite. ${publishNote} Use add_map_reactor to place it on a map.`,
    });
  } catch (err: any) {
    console.error("GM reactor creation error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create reactor" },
      { status: 500 }
    );
  }
}
