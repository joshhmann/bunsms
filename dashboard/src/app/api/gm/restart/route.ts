import { NextResponse } from "next/server";
import { isPrivateRequestAuthorized } from "@/lib/auth";
import { restartGameServer } from "@/lib/game-control";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!await isPrivateRequestAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await restartGameServer());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Game apply failed" }, { status: 502 });
  }
}
