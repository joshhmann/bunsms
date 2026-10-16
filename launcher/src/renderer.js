// ── BunsMS Launcher ──

const $ = (id) => document.getElementById(id);

let currentUpdates = null;
let currentInstallLease = null;
let isUpdating = false;
let activeProfile = "kaentake";

// ── Init ──
async function init() {
  setupControls();
  setupServerHost();
  setupProfiles();
  await Promise.all([checkServerStatus(), findGamePath(), loadNews()]);
  await refreshProfileUI();
  await checkForUpdates();
}

// ── Window Controls ──
function setupControls() {
  $("btn-minimize").onclick = () => window.buns.minimize();
  $("btn-close").onclick = () => window.buns.close();
  $("btn-browse").onclick = browseFolder;
  $("btn-play").onclick = handlePlay;

  $("link-register").onclick = () => window.buns.openSite("/");
  $("link-website").onclick = () => window.buns.openSite("/");
  $("link-discord").onclick = () => window.buns.openExternal("https://discord.gg/pApUkuZjNa");

  // HD Mode toggle
  const hdCheckbox = $("hd-checkbox");
  const hdOptions = $("hd-options");
  const hdResolution = $("hd-resolution");
  const hdFullscreen = $("hd-fullscreen");
  const hdSleepTime = $("hd-sleeptime");

  window.buns.getHD().then((enabled) => {
    hdCheckbox.checked = enabled;
    hdOptions.style.display = enabled ? "flex" : "none";
  });
  window.buns.getHDOptions().then((opts) => {
    hdResolution.value = opts.resolution;
    hdFullscreen.checked = opts.fullscreen;
    // Match the closest preset; fall back to 30 if value isn't in the dropdown.
    const presets = Array.from(hdSleepTime.options).map((o) => o.value);
    hdSleepTime.value = presets.includes(String(opts.sleepTime)) ? String(opts.sleepTime) : "30";
  });

  hdCheckbox.onchange = async () => {
    const enabled = hdCheckbox.checked;
    hdOptions.style.display = enabled ? "flex" : "none";
    const result = await window.buns.setHD(enabled);
    if (result.warning) {
      $("update-text").textContent = result.warning;
      $("update-status").className = "update-status error";
    }
    await checkForUpdates();
  };

  const saveHDOptions = async () => {
    await window.buns.setHDOptions({
      resolution: hdResolution.value,
      fullscreen: hdFullscreen.checked,
      sleepTime: parseInt(hdSleepTime.value, 10),
    });
  };
  hdResolution.onchange = saveHDOptions;
  hdFullscreen.onchange = saveHDOptions;
  hdSleepTime.onchange = saveHDOptions;

  // Listen for download progress
  window.buns.onDownloadProgress((data) => {
    const overall = ((data.index + data.percent / 100) / data.total) * 100;
    $("progress-bar").style.width = overall + "%";
    const statusSuffix = data.status ? ` - ${data.status}` : "";
    $("progress-text").textContent = `${data.file} (${data.percent}%)${statusSuffix}`;
    $("btn-play-text").textContent = `UPDATING ${Math.round(overall)}%`;
  });
  window.buns.onLaunchStatus(renderLaunchStatus);
}

// ── Server Status ──
async function checkServerStatus() {
  const dot = $("status-dot");
  const text = $("status-text");
  dot.className = "status-dot checking";

  try {
    const status = await window.buns.getStatus();
    if (status.online) {
      dot.className = "status-dot online";
      text.textContent = status.players > 0
        ? `Backend running - ${status.players} player${status.players !== 1 ? "s" : ""}`
        : "Backend running (game connectivity not measured)";
    } else {
      dot.className = "status-dot offline";
      text.textContent = "Backend unavailable";
    }
  } catch {
    dot.className = "status-dot offline";
    text.textContent = "Cannot reach backend status";
  }

  // Also fetch rates from config (raw YAML structure: worlds[0].exp_rate etc.)
  try {
    const res = await window.buns.fetchConfig();
    if (res.ok) {
      const data = res.data;
      const world = data?.worlds?.[0];
      if (world) {
        $("rate-exp").textContent = (world.exp_rate || "?") + "x";
        $("rate-drop").textContent = (world.drop_rate || "?") + "x";
        $("rate-meso").textContent = (world.meso_rate || "?") + "x";
      }
    }
  } catch {}

  // Refresh every 30s
  setTimeout(checkServerStatus, 30000);
}

// ── Game Path ──
async function findGamePath() {
  const result = await window.buns.findGamePath();
  if (result.found) {
    $("path-display").textContent = result.path;
    $("path-display").title = result.path;
  } else {
    $("path-display").textContent = "Not found - click browse to set";
    $("path-display").style.color = "var(--orange)";
  }
  // Canonical default or explicit stored/profile INI choice; never infer a
  // different destination from the production backend's status endpoint.
  $("server-host").value = await window.buns.getServerHost();
}

// ── Isolated client profiles ──
function setupProfiles() {
  $("profile-stock").onclick = () => switchProfile("stock");
  $("profile-kaentake").onclick = () => switchProfile("kaentake");
}

async function switchProfile(id) {
  if (id === activeProfile) return;
  const res = await window.buns.setProfile(id);
  if (!res.success) {
    $("update-text").textContent = res.error || "Failed to switch profile";
    $("update-status").className = "update-status error";
    return;
  }
  activeProfile = id;
  currentUpdates = null;
  await refreshProfileUI();
  await findGamePath();
  await checkForUpdates();
}

async function refreshProfileUI() {
  let info = null;
  try {
    info = await window.buns.getProfile();
    activeProfile = info.active || "stock";
  } catch { return; }
  const me = (info.profiles || []).find((p) => p.id === activeProfile);
  $("profile-stock").disabled = activeProfile === "stock";
  $("profile-kaentake").disabled = activeProfile === "kaentake";
  const kaentake = activeProfile === "kaentake";
  $("hd-section").style.display = kaentake ? "none" : "";
  $("kaentake-note").style.display = kaentake ? "" : "none";
  $("path-label").textContent = kaentake ? "Install Location (Kaentake — isolated folder)" : "Install Location";
  const status = $("profile-status");
  if (!me || !me.path) {
    status.style.display = "";
    status.textContent = kaentake
      ? "Choose an isolated folder for Kaentake (never your BunsMS folder)."
      : "Set game folder to check for updates";
    return;
  }
  const parts = [];
  if (me.separation && me.separation !== "ok") parts.push(me.separation.reason || me.separation.warning);
  else if (me.separation && me.separation.warning) parts.push(me.separation.warning);
  if (kaentake) {
    parts.push(me.exeFound ? "Kaentake.exe found" : "Kaentake.exe missing");
    if (me.depsError) parts.push(me.depsError);
    else if (me.missing?.length) parts.push(`Required files to install/repair: ${me.missing.length}`);
    else if (!me.depsOk) parts.push("Complete client verification pending.");
    const note = $("kaentake-note-text");
    if (note) note.textContent = parts.length ? parts.join(" • ") : "Complete client files verified; game acceptance is separate.";
    status.style.display = "none";
  } else {
    if (parts.length > 0) {
      status.style.display = "";
      status.textContent = parts.join(" • ");
    } else {
      status.style.display = "none";
    }
  }
}

async function setupServerHost() {
  const field = $("server-host");
  field.addEventListener("change", async () => {
    const res = await window.buns.setServerHost(field.value);
    if (!res.success) {
      field.value = await window.buns.getServerHost();
    } else {
      field.value = res.host;
    }
  });
  $("btn-server-default").onclick = async () => {
    await window.buns.setServerHost("buns.asslorde.com");
    field.value = await window.buns.getServerHost();
  };
}

async function browseFolder() {
  const selected = await window.buns.selectFolder();
  // selectFolder returns the path, or { error } when the separation guard rejects it.
  if (selected && typeof selected === "object" && selected.error) {
    $("update-text").textContent = selected.error;
    $("update-status").className = "update-status error";
    await refreshProfileUI();
    return;
  }
  const path = typeof selected === "string" ? selected : null;
  if (path) {
    $("path-display").textContent = path;
    $("path-display").title = path;
    $("path-display").style.color = "";
    await refreshProfileUI();
    await checkForUpdates();
  }
}

// ── Updates ──
async function checkForUpdates() {
  const requestedProfile = activeProfile;
  const status = $("update-status");
  const text = $("update-text");
  const icon = $("update-icon") || status.querySelector(".update-icon");
  currentUpdates = null;
  currentInstallLease = null;
  $("btn-play").disabled = true;
  $("btn-play-text").textContent = "CHECKING FILES...";
  status.className = "update-status";
  icon.textContent = "\uD83D\uDD0D";
  text.textContent = "Verifying the complete client manifest and files...";
  const result = await window.buns.checkUpdates();
  if (requestedProfile !== activeProfile) return;
  switch (result.status) {
    case "up_to_date":
      status.className = "update-status up-to-date";
      icon.textContent = "\u2705";
      text.textContent = `Complete client files verified (v${result.version || "1.0"}).`;
      enablePlay();
      break;
    case "updates_available": {
      status.className = "update-status needs-update";
      icon.textContent = "\u26A0\uFE0F";
      const sizeMB = (result.totalSize / 1024 / 1024).toFixed(0);
      text.textContent = `${result.updates.length} required file(s) to install/repair (${sizeMB} MB)`;
      currentUpdates = result.updates;
      currentInstallLease = { profile: result.profile, leaseId: result.leaseId };
      enableUpdate();
      break;
    }
    case "no_path":
      status.className = "update-status error";
      icon.textContent = "\uD83D\uDCC1";
      text.textContent = "Choose an isolated client folder.";
      disablePlay("SELECT FOLDER");
      break;
    default:
      status.className = "update-status error";
      icon.textContent = "\u274C";
      text.textContent = result.error || "Complete client verification failed.";
      enableRecheck();
      break;
  }
  await refreshProfileUI();
}

async function handlePlay() {
  if (isUpdating) return;
  const selectedProfile = activeProfile;
  if (currentUpdates?.length) {
    isUpdating = true;
    const btn = $("btn-play");
    btn.disabled = true;
    btn.className = "btn-play updating";
    $("btn-play-text").textContent = "INSTALLING 0%";
    $("progress-container").style.display = "block";
    let result;
    try { result = await window.buns.downloadUpdates({ ...currentInstallLease, updates: currentUpdates }); }
    catch (error) { result = { success: false, error: error.message }; }
    $("progress-container").style.display = "none";
    isUpdating = false;
    currentUpdates = null;
    currentInstallLease = null;
    if (!result.success) {
      $("update-text").textContent = result.error || "Complete client installation failed.";
      $("update-status").className = "update-status error";
      enableRecheck();
      return;
    }
    await refreshProfileUI();
    if (selectedProfile !== activeProfile) return checkForUpdates();
    $("update-text").textContent = `Complete client files verified (${result.verifiedFiles} files).`;
    $("update-status").className = "update-status up-to-date";
  }
  await launchGame();
}

async function launchGame() {
  $("btn-play").disabled = true;
  $("btn-play-text").textContent = "VERIFYING / STARTING...";
  let result;
  try { result = await window.buns.launch(); }
  catch (error) { result = { success: false, error: error.message }; }
  if (result.success) {
    // Actual process lifecycle events own the status text, not a fake timer.
    enablePlay();
  } else {
    $("update-text").textContent = result.error || "Client process did not start.";
    $("update-status").className = "update-status error";
    enableRecheck();
  }
}

function renderLaunchStatus(data) {
  const label = data.runner === "wine" ? "Wine host" : `${data.profile} launcher`;
  if (data.state === "process-started") {
    $("update-status").className = "update-status";
    $("update-text").textContent = `${label} process started (PID ${data.pid}); login/world is not yet verified.`;
  } else if (data.state === "error") {
    $("update-status").className = "update-status error";
    $("update-text").textContent = data.error;
  } else if (data.state === "exited") {
    $("update-status").className = data.code === 0 && !data.signal ? "update-status" : "update-status error";
    $("update-text").textContent = `${data.profile} launcher process exited (${data.code ?? data.signal}).${data.error ? ` ${data.error}` : ""}`;
  }
}

function enablePlay() {
  const btn = $("btn-play");
  btn.disabled = false;
  btn.className = "btn-play";
  btn.onclick = handlePlay;
  $("btn-play-text").textContent = "PLAY";
}

function enableUpdate() {
  const btn = $("btn-play");
  btn.disabled = false;
  btn.className = "btn-play updating";
  btn.onclick = handlePlay;
  $("btn-play-text").textContent = "UPDATE & PLAY";
}

function disablePlay(label = "CLIENT NOT READY") {
  const btn = $("btn-play");
  btn.disabled = true;
  $("btn-play-text").textContent = label;
}

function enableRecheck() {
  const btn = $("btn-play");
  btn.disabled = false;
  btn.className = "btn-play";
  btn.onclick = checkForUpdates;
  $("btn-play-text").textContent = "CHECK FILES";
}

// ── News ──
async function loadNews() {
  const list = $("news-list");

  try {
    const data = await window.buns.getNews();
    const news = data?.news || [];

    if (news.length === 0) {
      list.innerHTML = `<div class="news-item news-loading">No recent activity</div>`;
      return;
    }

    list.innerHTML = news.map((item) => {
      const typeClass = {
        rates: "news-type-rates",
        event: "news-type-event",
        drops: "news-type-drops",
        update: "news-type-update",
      }[item.type] || "news-type-update";

      const date = new Date(item.date);
      const ago = timeAgo(date);

      return `
        <div class="news-item">
          <div class="news-item-header">
            <span class="news-item-type ${typeClass}">${item.type || "update"}</span>
            <span class="news-item-date">${ago}</span>
          </div>
          <div class="news-item-text">${item.text}</div>
        </div>
      `;
    }).join("");
  } catch {
    list.innerHTML = `<div class="news-item news-loading">Could not load news</div>`;
  }
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  return Math.floor(seconds / 86400) + "d ago";
}

// ── Start ──
init();
