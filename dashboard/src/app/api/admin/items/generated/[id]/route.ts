import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGeneratedItem, updateGeneration } from "@/lib/gm/generated-items";
import { query } from "@/lib/db";
import { requireItemId, resolveArtPath } from "@/lib/art";
import { ASSET_DIR } from "@/lib/assets";

export const dynamic = "force-dynamic";
// Verified WZ/NX publication and private game-server apply run in the background.
export const maxDuration = 600;

const PUBLISH_POLL_INTERVAL_MS = 3000;
const PUBLISH_POLL_TIMEOUT_MS = 8 * 60_000;
const STATUS_FILE = join(ASSET_DIR, "jobs", "publish-status.json");

interface PublishStatus {
  id?: string;
  status: "idle" | "running" | "done" | "error";
  step?: string;
  error?: string;
  items_published?: number;
  version?: string;
  finishedAt?: string;
  actions?: string[];
}

/**
 * Poll durable shared publication status; game-server application does not
 * require a self-fetch through an origin that may be restarting.
 *
 * `jobId` is matched against `status.id` so a stale `done` file from the
 * previous publish can't short-circuit the wait for the *current* run.
 */
async function waitForPublish(jobId: string): Promise<PublishStatus> {
  const deadline = Date.now() + PUBLISH_POLL_TIMEOUT_MS;
  let last: PublishStatus = { status: "idle" };
  while (Date.now() < deadline) {
    try {
      if (existsSync(STATUS_FILE)) {
        const parsed = JSON.parse(readFileSync(STATUS_FILE, "utf-8")) as PublishStatus;
        if (parsed.id === jobId) {
          last = parsed;
          if (last.status === "done" || last.status === "error") return last;
        }
      }
    } catch {
      // Status file race (mid-write) — ignore and retry.
    }
    await new Promise((r) => setTimeout(r, PUBLISH_POLL_INTERVAL_MS));
  }
  return { ...last, status: "error", error: last.error ?? `Publish did not finish within ${PUBLISH_POLL_TIMEOUT_MS / 1000}s (last step: ${last.step ?? "unknown"})` };
}

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  let generationId: number;
  try { generationId = requireItemId(id); }
  catch { return NextResponse.json({ error: "Invalid generation id" }, { status: 400 }); }
  const item = await getGeneratedItem(generationId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let iconUrl: string | null = null;
  let frames: Record<string, string[]> | null = null;
  let origins: Record<string, Array<{ gripX: number; gripY: number }>> | null = null;

  if (item.item_id) {
    const rows = await query<{ icon_url: string | null; stats: unknown }>(
      "SELECT icon_url, stats FROM custom_items WHERE item_id = ? LIMIT 1",
      [item.item_id]
    );
    if (rows[0]) {
      iconUrl = rows[0].icon_url;
      // mysql2 auto-decodes JSON columns, but older mariadb drivers may return strings.
      const stats =
        typeof rows[0].stats === "string"
          ? JSON.parse(rows[0].stats)
          : (rows[0].stats as Record<string, unknown> | null) ?? {};
      const wf = (stats as any)?._weaponFrames;
      frames = wf?.frames ?? null;
      origins = wf?.origins ?? null;
    }
  }
  try {
    if (item.concept_image_url) resolveArtPath(item.concept_image_url);
    if (item.glb_url) resolveArtPath(item.glb_url);
    if (iconUrl) resolveArtPath(iconUrl);
    for (const urls of Object.values(frames || {})) for (const url of urls) resolveArtPath(url);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), migrationRequired: true }, { status: 409 });
  }

  return NextResponse.json({ item, assets: { iconUrl, frames, origins } });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  let genId: number;
  try { genId = requireItemId(id); }
  catch { return NextResponse.json({ error: "Invalid generation id" }, { status: 400 }); }
  const body = await request.json();
  const action = body.action as "publish" | "reject" | undefined;
  if (action !== "publish" && action !== "reject") {
    return NextResponse.json({ error: "action required ('publish' or 'reject')" }, { status: 400 });
  }

  const item = await getGeneratedItem(genId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "reject") {
    await updateGeneration(genId, { status: "rejected" });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // publish
  if (item.status !== "ready") {
    return NextResponse.json(
      { error: `Can only publish items in 'ready' state (current: ${item.status})` },
      { status: 409 }
    );
  }

  // Forward whichever auth the incoming request carried (browser cookie OR
  // GM x-gm-secret) to the nested publish calls — otherwise middleware 401s
  // our own self-fetch.
  const cookie = request.headers.get("cookie") ?? "";
  const gmSecret = request.headers.get("x-gm-secret") ?? "";
  const authHeaders: Record<string, string> = {};
  if (cookie) authHeaders.cookie = cookie;
  if (gmSecret) authHeaders["x-gm-secret"] = gmSecret;

  const pub = await fetch(new URL("/api/admin/items/publish", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
  });
  if (!pub.ok) {
    const text = await pub.text();
    await updateGeneration(genId, { error: `publish kickoff failed: ${text}` });
    return NextResponse.json({ error: `Publish failed to start: ${text}` }, { status: 502 });
  }
  const kickoff: unknown = await pub.json();
  if (!kickoff || typeof kickoff !== "object" || !("id" in kickoff) || typeof kickoff.id !== "string") {
    return NextResponse.json({ error: "Publication did not return a job identity" }, { status: 502 });
  }
  const jobId = kickoff.id;

  // The publish route is fire-and-forget — poll publish-status.json until the
  // background job actually completes, so callers (esp. the GM tool) get a
  // truthful success/failure signal instead of "started" masquerading as "done".
  const finalStatus = await waitForPublish(jobId);
  if (finalStatus.status === "error") {
    const errMsg = finalStatus.error ?? "publish job reported error with no message";
    await updateGeneration(genId, { error: errMsg });
    return NextResponse.json({ error: `Publish job failed: ${errMsg}`, publishStatus: finalStatus }, { status: 502 });
  }

  await updateGeneration(genId, { status: "published" });
  return NextResponse.json({
    ok: true,
    status: "published",
    items_published: finalStatus.items_published,
    launcherVersion: finalStatus.version,
  });
}
