import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { isPrivateRequestAuthorized } from "../src/lib/auth";
import { requestGameControl, restartGameServer } from "../src/lib/game-control";

test("Unix game control authenticates the private socket and propagates real transport failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "game-control-"));
  const previous = { socket: process.env.GAME_CONTROL_SOCKET, secret: process.env.GM_API_SECRET, file: process.env.GM_SECRET_FILE };
  const socket = join(root, "control.sock");
  const secretFile = join(root, "secret");
  writeFileSync(secretFile, "isolated-test-credential\n", { mode: 0o600 });
  process.env.GAME_CONTROL_SOCKET = socket;
  process.env.GM_SECRET_FILE = secretFile;
  delete process.env.GM_API_SECRET;
  let status = 200;
  let response: Record<string, unknown> = { success: true };
  let seenPath = "";
  const server = createServer((req, res) => {
    assert.equal(req.headers["x-gm-secret"], "isolated-test-credential");
    seenPath = req.url || "";
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  try {
    server.listen(socket);
    await once(server, "listening");
    assert.deepEqual(await restartGameServer(), { success: true });
    assert.equal(seenPath, "/restart");
    status = 503;
    response = { error: "isolated command failed" };
    await assert.rejects(restartGameServer(), /isolated command failed/);
    status = 200;
    response = { success: false, error: "conversion refused" };
    await assert.rejects(requestGameControl("prepare-nx", { releaseId: "isolated" }), /conversion refused/);
    response = {};
    await assert.rejects(restartGameServer(), /did not acknowledge/);
    const closed = once(server, "close");
    server.close();
    await closed;
    await assert.rejects(restartGameServer());
    assert.equal(await isPrivateRequestAuthorized(new Request("http://private/api/server")), false);
    assert.equal(await isPrivateRequestAuthorized(new Request("http://private/api/server", { headers: { "x-gm-secret": "isolated-test-credential" } })), true);
  } finally {
    server.close();
    for (const [key, value] of Object.entries({ GAME_CONTROL_SOCKET: previous.socket, GM_API_SECRET: previous.secret, GM_SECRET_FILE: previous.file })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
