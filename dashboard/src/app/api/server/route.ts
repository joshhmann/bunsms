import { NextRequest, NextResponse } from "next/server";
import { createConnection, Socket } from "net";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { query } from "@/lib/db";
import { PATHS } from "@/lib/cosmic";

const GAME_HOST = process.env.GAME_SERVER_HOST || "192.168.0.157";
const LOGIN_PORT = 8484;
// Operator-configured CLIENT-advertised host: what launchers should connect
// to. Deliberately separate from GAME_HOST (the internal TCP health target,
// often a Docker DNS name like `server` that is useless to clients). Unset =
// field omitted (never advertise Docker DNS); LAN/VPN truth until external
// reachability is measured.
const CLIENT_HOST = process.env.GAME_CLIENT_HOST || "";

/** Check if the game server is reachable by TCP connecting to the login port */
function tcpCheck(host: string, port: number, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket();
    sock.setTimeout(timeout);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

export async function GET() {
  try {
    const online = await tcpCheck(GAME_HOST, LOGIN_PORT);
    let gmModel = "moonshotai/kimi-k2.5";
    let rates = { exp: 1, drop: 1, meso: 1 };

    // Read rates from actual game config (source of truth)
    try {
      const content = readFileSync(PATHS.config, "utf-8");
      const config = parseYaml(content);
      const world = config?.worlds?.[0];
      if (world) {
        rates = {
          exp: world.exp_rate || 1,
          drop: world.drop_rate || 1,
          meso: world.meso_rate || 1,
        };
      }
    } catch {}

    // Read GM model and player stats from DB
    let players = 0;
    let accounts = 0;
    let characters = 0;
    let maxLevel = 0;
    try {
      const [row] = await query("SELECT model FROM gm_schedule WHERE id = 1");
      const r = row as any;
      if (r?.model) gmModel = r.model;
    } catch {}
    try {
      const [s] = await query("SELECT COUNT(*) as cnt FROM accounts");
      accounts = (s as any)?.cnt || 0;
    } catch {}
    try {
      const [c] = await query("SELECT COUNT(*) as cnt FROM accounts WHERE loggedin > 0");
      players = (c as any)?.cnt || 0;
    } catch {}
    try {
      const [t] = await query("SELECT COUNT(*) as cnt FROM characters");
      characters = (t as any)?.cnt || 0;
    } catch {}
    try {
      const [m] = await query("SELECT COALESCE(MAX(level),0) as max FROM characters");
      maxLevel = (m as any)?.max || 0;
    } catch {}

    const body: Record<string, unknown> = {
      status: online ? "running" : "stopped",
      gmModel,
      rates,
      players,
      accounts,
      characters,
      maxLevel,
    };
    // `status` proves in-compose reachability ONLY — not public reachability.
    // gameHost/gamePort are present only when the operator configured an
    // explicit client-advertised endpoint (GAME_CLIENT_HOST). Launchers prefer
    // stored-config, then these fields, then measured LAN fallback.
    if (CLIENT_HOST) {
      body.gameHost = CLIENT_HOST;
      body.gamePort = LOGIN_PORT;
    }
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({
      status: "stopped",
    });
  }
}

export async function POST(request: NextRequest) {
  // No programmatic server control on this topology (LXC, no Fly Machines
  // API). Restarts are owner-operated on the host.
  return NextResponse.json(
    { error: "Server control is manual on this topology (LXC). Restart the game server on the host." },
    { status: 501 },
  );
}
