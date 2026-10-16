import { request as httpRequest, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { privateApiSecret } from "@/lib/auth";


/** No TCP fallback: this socket is mounted only into the private dashboard. */
export async function requestGameControl(action: "restart" | "prepare-nx", payload?: unknown): Promise<Record<string, unknown>> {
  const socketPath = process.env.GAME_CONTROL_SOCKET;
  if (!socketPath) throw new Error("GAME_CONTROL_SOCKET is not configured");
  const body = JSON.stringify(payload ?? {});
  const secret = privateApiSecret();
  const req = httpRequest({
    socketPath, path: `/${action}`, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "x-gm-secret": secret },
  });
  req.setTimeout(action === "prepare-nx" ? 2 * 60 * 60 * 1000 : 240_000, () => req.destroy(new Error("Private game control timed out")));
  const received = once(req, "response");
  req.end(body);
  const [message] = await received;
  // node:events loses the known http response event type.
  const res = message as IncomingMessage;
  req.on("error", (error) => res.destroy(error));
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of res) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Private control returned a non-binary response");
    length += chunk.length;
    if (length > 1024 * 1024) {
      res.destroy();
      throw new Error("Private control response exceeds limit");
    }
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Private control returned invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Private control returned invalid response");
  }
  const result = value as Record<string, unknown>;
  if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || result.success === false || result.error) {
    throw new Error(typeof result.error === "string" ? result.error : `Private control failed (${res.statusCode})`);
  }
  return result;
}

export async function restartGameServer(): Promise<{ success: boolean; error?: string }> {
  const result = await requestGameControl("restart");
  if (result.success !== true) throw new Error("Game apply did not acknowledge success");
  return { success: true };
}
