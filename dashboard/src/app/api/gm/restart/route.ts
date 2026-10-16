import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/gm/restart — Manual game-server restart trigger.
// This topology (LXC, no Fly Machines API) has no programmatic restart:
// restarts are owner-operated on the host. This endpoint reports that
// instead of calling a dead Fly API (which would throw a confusing error).
export async function GET() {
  return NextResponse.json(
    {
      action: "manual",
      message:
        "Game-server restart is manual on this topology (LXC, no Fly Machines API). Restart the game server on the host to pick up changes.",
    },
    { status: 501 }
  );
}
