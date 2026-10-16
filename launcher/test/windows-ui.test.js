"use strict";
// Windows-only real installed or official unpacked Electron UI smoke.
// it never attaches a debugger to MapleStory/Kaentake or bypasses native guards.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  assert.equal(process.platform, "win32", "This smoke must exercise an actual Windows launcher");
  const [executable, output, uiLayer = "installed", gameDirectory = "", expectedHost = "buns.asslorde.com"] = process.argv.slice(2);
  assert.ok(executable && output, "Usage: node windows-ui.test.js <exe> <evidence-dir> [installed|unpacked] [fresh-game-dir] [expected-host]");
  assert.ok(["installed", "unpacked"].includes(uiLayer), "Unknown launcher UI layer");
  fs.mkdirSync(output, { recursive: true });
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const report = { startedUtc: new Date().toISOString(), executable, uiLayer, status: "not-completed", fullNativeGameplay: `PENDING; this check verifies ${uiLayer} launcher UI only` };
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
    // Observe the real renderer startup promise before executing its script.
    // This debugger is attached ONLY to Electron, never to the native game.
    const scriptUrls = new Map();
    let startupWrapped = false;
    let breakpoint = null;
    connection.addEventListener("message", async ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Debugger.scriptParsed") scriptUrls.set(message.params.scriptId, message.params.url);
      if (message.method !== "Debugger.paused") return;
      if (!breakpoint || !(message.params.hitBreakpoints || []).includes(breakpoint.breakpointId)) return;
      const ownedBreakpoint = breakpoint;
      breakpoint = null; // Only this pause owns evaluation/resume, even across async replies.
      report.startupPause = { utc: new Date().toISOString(), reason: message.params.reason, hitBreakpoints: message.params.hitBreakpoints };
      try {
        const frame = message.params.callFrames[0];
        if (!startupWrapped && (scriptUrls.get(frame.location.scriptId) || "").endsWith("/renderer.js")) {
          await command("Debugger.removeBreakpoint", { breakpointId: ownedBreakpoint.breakpointId });
          const wrapped = await command("Debugger.evaluateOnCallFrame", {
            callFrameId: frame.callFrameId,
            expression: `(() => {
              let finish;
              globalThis.__bunsActualStartup = new Promise(resolve => { finish = resolve; });
              const actualInit = init;
              init = function(...args) {
                const startedUtc = new Date().toISOString();
                return actualInit.apply(this, args).then(value => {
                  finish({ status: "resolved", startedUtc, finishedUtc: new Date().toISOString() });
                  return value;
                }, error => {
                  finish({ status: "rejected", startedUtc, finishedUtc: new Date().toISOString(), error: String(error), stack: error.stack });
                  throw error;
                });
              };
            })()`
          });
          if (wrapped.exceptionDetails) report.startupObserverError = wrapped.exceptionDetails;
          else startupWrapped = true;
        }
      } catch (error) { report.startupObserverError = String(error); }
      finally { await command("Debugger.resume").catch(() => {}); }
    });
    await command("Debugger.enable");
    breakpoint = await command("Debugger.setBreakpointByUrl", { lineNumber: 422, urlRegex: "/renderer\\.js$" });
    await command("Page.reload", { ignoreCache: true });
    while (!startupWrapped && Date.now() < deadline) await delay(50);
    if (!startupWrapped) throw new Error("Actual renderer startup observation could not be established");
    report.actualStartup = await evaluate("globalThis.__bunsActualStartup");
    if (breakpoint) await command("Debugger.removeBreakpoint", { breakpointId: breakpoint.breakpointId });
    await command("Debugger.disable");
    let profile;
    while (Date.now() < deadline) {
      profile = await evaluate("typeof window.buns === 'object' ? window.buns.getProfile() : null");
      if (profile) break;
      await delay(100);
    }
    assert.ok(profile, "Packaged preload bridge is unavailable");
    assert.equal(profile.active, "kaentake", "A fresh RC install must prefer Kaentake");
    const host = await evaluate("window.buns.getServerHost()");
    assert.equal(host, expectedHost, "The actual stored/default host must match the expected consumer choice");
    const title = await evaluate("document.title");
    Object.assign(report, { profile, host, title });
    report.networkIpc = await evaluate(`Promise.all([
      ["status", () => window.buns.getStatus()],
      ["news", () => window.buns.getNews()],
      ["rates", () => window.buns.fetchConfig()]
    ].map(async ([name, call]) => {
      const startedUtc = new Date().toISOString(), start = Date.now();
      try { const result = await call(); return { name, startedUtc, finishedUtc: new Date().toISOString(), durationMs: Date.now() - start, result }; }
      catch (error) { return { name, startedUtc, finishedUtc: new Date().toISOString(), durationMs: Date.now() - start, error: String(error) }; }
    }))`);
    report.filePreflight = await evaluate("window.buns.checkUpdates()");
    if (gameDirectory) {
      const directory = path.resolve(gameDirectory);
      fs.mkdirSync(directory, { recursive: true });
      assert.equal(fs.readdirSync(directory).length, 0, "Full GUI install must start in an empty owned directory");
      const click = async (id) => {
        const box = await evaluate(`(() => { const element = document.getElementById(${JSON.stringify(id)}); const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
        await command("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 });
        await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
      };
      const ui = () => evaluate(`({ path: document.getElementById("path-display").title,
        buttonDisabled: document.getElementById("btn-play").disabled,
        updateClass: document.getElementById("update-status").className,
        updateText: document.getElementById("update-text").textContent,
        events: globalThis.__bunsConsumerEvents })`);
      const snapshot = async (name) => {
        const image = await command("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(output, name), Buffer.from(image.data, "base64"));
      };
      report.fullInstall = { directory, startedUtc: new Date().toISOString(), status: "not-completed",
        scope: "Actual installed UI folder picker/download/preflight/OS start only; NOT account/world/addon acceptance" };
      try {
        await evaluate(`globalThis.__bunsConsumerEvents = { downloads: {}, downloadEventCount: 0, launches: [] };
          window.buns.onDownloadProgress(data => { const events = globalThis.__bunsConsumerEvents; events.downloadEventCount++; events.downloads[data.file] = { utc: new Date().toISOString(), ...data }; });
          window.buns.onLaunchStatus(data => { globalThis.__bunsConsumerEvents.launches.push({ utc: new Date().toISOString(), ...data }); });`);
        await click("server-host");
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
        await command("Input.insertText", { text: "127.0.0.1" });
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", windowsVirtualKeyCode: 9 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", windowsVirtualKeyCode: 9 });
        await click("btn-browse");
        await new Promise((resolve, reject) => {
          const picker = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
            path.join(__dirname, "windows-folder-picker.ps1"), "-OwnerProcessId", String(child.pid),
            "-Directory", directory, "-EvidenceDirectory", path.resolve(output, "native-dialog")],
          { stdio: ["ignore", "pipe", "pipe"] });
          let log = "";
          picker.stdout.on("data", data => { log += data; });
          picker.stderr.on("data", data => { log += data; });
          picker.on("error", reject);
          picker.on("close", code => {
            fs.writeFileSync(path.join(output, "folder-picker.log"), log);
            code === 0 ? resolve() : reject(new Error(`Actual native folder picker failed: ${code}`));
          });
        });
        const selectionDeadline = Date.now() + 120000;
        let selected;
        while (Date.now() < selectionDeadline) {
          selected = await ui();
          if (selected.path && path.resolve(selected.path).toLowerCase() === directory.toLowerCase() && !selected.buttonDisabled) break;
          await delay(250);
        }
        report.fullInstall.afterSelection = selected;
        assert.equal(path.resolve(selected.path || "").toLowerCase(), directory.toLowerCase(), "Native picker did not persist the actual chosen profile directory");
        assert.equal(await evaluate("window.buns.getServerHost()"), "127.0.0.1", "Explicit QA host entered through UI was not preserved");
        await snapshot("installed-selected-folder.png");
        assert.ok(!selected.buttonDisabled, `Chosen fresh folder did not settle into an actionable GUI state: ${JSON.stringify(selected)}`);
        await click("btn-play");
        const transferDeadline = Date.now() + 45 * 60 * 1000;
        let state;
        while (Date.now() < transferDeadline) {
          state = await ui();
          if (state.events.launches.some(event => event.state === "process-started" || event.state === "error")) break;
          if (!state.buttonDisabled && state.updateClass.split(" ").includes("error")) throw new Error(`Actual GUI transfer/launch failed: ${state.updateText}`);
          if (child.exitCode !== null) throw new Error(`Installed launcher exited during real transfer: ${child.exitCode}`);
          await delay(1000);
        }
        report.fullInstall.consumerState = state;
        const started = state?.events.launches.find(event => event.state === "process-started");
        assert.ok(started && Number.isInteger(started.pid) && started.pid > 0, "Real GUI did not receive an actual OS process-start receipt");
        assert.ok(state.events.downloadEventCount > 0, "No actual production downloader progress was observed");
        // This read-only final inspection occurs AFTER the GUI-owned lease/transfer,
        // never between GUI manifest inspection and its one-use download.
        report.fullInstall.finalPreflight = await evaluate("window.buns.checkUpdates()");
        assert.equal(report.fullInstall.finalPreflight.status, "up_to_date", "Actual complete managed files did not pass production preflight");
        report.fullInstall.osStart = started;
        report.fullInstall.status = "gui-full-transfer-preflight-os-start-observed";
      } catch (error) {
        report.fullInstall.status = "failed";
        report.fullInstall.error = error.stack;
        report.fullInstall.errorUi = await ui().catch(error => ({ observationError: String(error) }));
        await snapshot("installed-operation-failure.png").catch(() => {});
        throw error;
      } finally { report.fullInstall.finishedUtc = new Date().toISOString(); }
    }
    report.renderedAtCapture = await evaluate("document.body.innerText");
    report.screenshotCapturedUtc = new Date().toISOString();
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    const screenshotName = `${uiLayer}-launcher.png`;
    fs.writeFileSync(path.join(output, screenshotName), Buffer.from(screenshot.data, "base64"));
    assert.equal(exceptions.length, 0, "Installed renderer raised an uncaught exception");
    Object.assign(report, { status: `${uiLayer}-ui-observed`, profile, host, title, rendererExceptions: exceptions, actualScreenshot: screenshotName });
    await evaluate("window.buns.close()").catch(() => {});
  } catch (error) {
    report.status = "failed"; report.error = error.stack;
    throw error;
  } finally {
    if (connection) connection.close();
    if (child.exitCode === null) { await delay(1000); if (child.exitCode === null) child.kill(); }
    if (gameDirectory) {
      const quote = value => `'${String(value).replaceAll("'", "''")}'`;
      const cleanup = `$root=${quote(path.resolve(gameDirectory))}; $since=[datetime]${quote(report.startedUtc)};
        $allowed=@((Join-Path $root 'Kaentake.exe'),(Join-Path $root 'MapleStory.exe'));
        $rows=@(); foreach($p in Get-CimInstance Win32_Process -Filter "Name='Kaentake.exe' OR Name='MapleStory.exe'" -Property ProcessId,ExecutablePath,CreationDate) {
          if($p.ExecutablePath -in $allowed -and $p.CreationDate.ToUniversalTime() -ge $since.ToUniversalTime()) {
            $row=[ordered]@{id=$p.ProcessId;path=$p.ExecutablePath;createdUtc=$p.CreationDate.ToUniversalTime().ToString('O');controlled=$false};
            try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $row.controlled=$true } catch { $row.error=$_.Exception.Message };
            $rows += [pscustomobject]$row
          }
        }; ConvertTo-Json -InputObject @($rows) -Depth 5`;
      await new Promise(resolve => {
        const cleaner = spawn("powershell.exe", ["-NoProfile", "-Command", cleanup], { stdio: ["ignore", "pipe", "pipe"] });
        let receipt = "";
        cleaner.stdout.on("data", data => { receipt += data; });
        cleaner.stderr.on("data", data => { receipt += data; });
        cleaner.on("error", error => { report.nativeCleanupError = String(error); resolve(); });
        cleaner.on("close", code => { report.nativeCleanup = { exitCode: code, receipt, scope: "Only exact owned fresh-directory executables created after this smoke began" }; resolve(); });
      });
    }
    report.finishedUtc = new Date().toISOString();
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "electron.log"), diagnostics);
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
