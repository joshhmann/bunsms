import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@/lib/db";

// GET: Fetch a single reactor with its drops
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const reactorId = parseInt(id);
  if (isNaN(reactorId))
    return NextResponse.json({ error: "Invalid reactor ID" }, { status: 400 });

  try {
    const [reactor] = await query<any>(
      `SELECT * FROM custom_reactors WHERE reactor_id = ?`,
      [reactorId]
    );
    if (!reactor)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const drops = await query<any>(
      `SELECT reactordropid, itemid, chance, questid FROM reactordrops WHERE reactorid = ?`,
      [reactorId]
    );

    return NextResponse.json({ ...reactor, drops });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT: Update a reactor's settings and drops
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const reactorId = parseInt(id);
  if (isNaN(reactorId))
    return NextResponse.json({ error: "Invalid reactor ID" }, { status: 400 });

  try {
    const body = await request.json();
    const {
      name,
      event_type,
      hits_to_break,
      animation_style,
      script_template,
      hit_delay,
      break_delay,
      trigger_item_id,
      trigger_item_qty,
      timeout_ms,
      drops,
    } = body;

    // Update reactor row
    await execute(
      `UPDATE custom_reactors SET
        name = ?, event_type = ?, hits_to_break = ?, animation_style = ?,
        script_template = ?, hit_delay = ?, break_delay = ?,
        trigger_item_id = ?, trigger_item_qty = ?, timeout_ms = ?, published = 0
       WHERE reactor_id = ?`,
      [
        name,
        event_type ?? 0,
        hits_to_break ?? 3,
        animation_style ?? "breakable",
        script_template ?? "drop_items",
        hit_delay ?? 120,
        break_delay ?? 150,
        trigger_item_id ?? null,
        trigger_item_qty ?? 1,
        timeout_ms ?? null,
        reactorId,
      ]
    );

    // Update drops: delete all existing, re-insert
    if (Array.isArray(drops)) {
      await execute("DELETE FROM reactordrops WHERE reactorid = ?", [reactorId]);
      for (const drop of drops) {
        if (!drop.itemid) continue;
        const pct = Math.max(1, Math.min(drop.chance ?? 100, 100));
        const chance = Math.max(1, Math.round(100 / pct));
        const questId = drop.questid ?? -1;
        await execute(
          "INSERT INTO reactordrops (reactorid, itemid, chance, questid) VALUES (?, ?, ?, ?)",
          [reactorId, drop.itemid, chance, questId]
        );
      }
    }

    // Server XML/scripts are rebuilt by the common verified publication job.

    return NextResponse.json({ success: true, reactorId, published: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

