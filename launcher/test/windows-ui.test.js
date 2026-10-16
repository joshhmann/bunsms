"use strict";
// Windows-only real installed Electron UI smoke. CDP controls the launcher UI;
// it never attaches a debugger to MapleStory/Kaentake or bypasses native guards.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  assert.equal(process.platform, "win32", "This smoke must exercise an actual Windows installation");
  const [executable, output] = process.argv.slice(2);
  assert.ok(executable && output, "Usage: node windows-ui.test.js <installed-exe> <evidence-dir>");
  fs.mkdirSync(output, { recursive: true });
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const report = { startedUtc: new Date().toISOString(), executable, status: "not-completed", fullNativeGameplay: "PENDING; this check verifies installed launcher UI only" };
  const child = spawn(executable, [`--remote-debugging-port=${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let processError, diagnostics = "", connection;
  child.on("error", (error) => { processError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (bytes) => { diagnostics = (diagnostics + bytes.toString()).slice(-16384); });
  try {
    const deadline = Date.now() + 60000;
    let target;
    while (Date.now() < deadline) {
      if (processError) throw processError;
      if (child.exitCode !== null) throw new Error(`Installed launcher exited before UI capture: ${child.exitCode}`);
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = targets.find((entry) => entry.type === "page" && entry.url.startsWith("file:"));
        if (target) break;
      } catch {}
      await delay(200);
    }
    assert.ok(target, "Actual installed launcher did not create its renderer page");
    connection = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { connection.addEventListener("open", resolve, { once: true }); connection.addEventListener("error", reject, { once: true }); });
    const pending = new Map(), exceptions = [];
    let sequence = 0;
    connection.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timeout); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Installed UI command timed out: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timeout });
      connection.send(JSON.stringify({ id, method, params }));
    });
    await command("Runtime.enable");
    const evaluate = async (expression) => {
      const value = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    let profile;
    while (Date.now() < deadline) {
      profile = await evaluate("typeof window.buns === 'object' ? window.buns.getProfile() : null");
      if (profile) break;
      await delay(100);
    }
    assert.ok(profile, "Packaged preload bridge is unavailable");
    assert.equal(profile.active, "kaentake", "A fresh RC install must prefer Kaentake");
    const host = await evaluate("window.buns.getServerHost()");
    assert.equal(host, "buns.asslorde.com", "The canonical default must not silently select a QA/LAN host");
    const title = await evaluate("document.title");
    assert.match(title, /Testing RC 1\.1\.0-rc\.1/);
    const body = await evaluate("document.body.innerText");
    assert.match(body, /Not a production rollout/);
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(output, "installed-launcher.png"), Buffer.from(screenshot.data, "base64"));
    assert.equal(exceptions.length, 0, "Installed renderer raised an uncaught exception");
    Object.assign(report, { status: "installed-ui-observed", profile, host, title, rendererExceptions: exceptions, actualScreenshot: "installed-launcher.png" });
    await evaluate("window.buns.close()").catch(() => {});
  } catch (error) {
    report.status = "failed"; report.error = error.stack;
    throw error;
  } finally {
    if (connection) connection.close();
    if (child.exitCode === null) { await delay(1000); if (child.exitCode === null) child.kill(); }
    report.finishedUtc = new Date().toISOString();
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "electron.log"), diagnostics);
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
