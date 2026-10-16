// ── BunsMS Launcher ──

const $ = (id) => document.getElementById(id);

let currentUpdates = null;
let isUpdating = false;
let activeProfile = "stock";

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
        ? `Online - ${status.players} player${status.players !== 1 ? "s" : ""}`
        : "Online";
    } else {
      dot.className = "status-dot offline";
      text.textContent = "Offline";
    }
  } catch {
    dot.className = "status-dot offline";
    text.textContent = "Cannot reach server";
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
  // Load saved server host into the field
  try {
    $("server-host").value = await window.buns.getServerHost();
  } catch {}
}

// ── Profiles (stock default, Kaentake opt-in) ──
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
    if (me.missing && me.missing.length > 0) {
      parts.push(`Copy from stock v83 folder: ${me.missing.join(", ")}`);
    }
    const note = $("kaentake-note-text");
    if (note) note.textContent = parts.length > 0 ? parts.join(" • ") : "Kaentake folder looks good.";
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
    await window.buns.setServerHost("192.168.0.164");
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
  const status = $("update-status");
  const text = $("update-text");
  const icon = $("update-icon") || status.querySelector(".update-icon");

  status.className = "update-status";
  icon.textContent = "\uD83D\uDD0D";
  text.textContent = "Checking for updates...";

  const result = await window.buns.checkUpdates();

  switch (result.status) {
    case "up_to_date":
      status.className = "update-status up-to-date";
      icon.textContent = "\u2705";
      text.textContent = `Up to date (v${result.version || "1.0"})`;
      enablePlay();
      break;

    case "updates_available": {
      status.className = "update-status needs-update";
      icon.textContent = "\u26A0\uFE0F";
      const manual = (result.updates || []).filter((u) => u.reason === "manual_copy_needed" || u.reason === "manual_copy_mismatch" || u.manual);
      const downloadable = (result.updates || []).filter((u) => !(u.reason === "manual_copy_needed" || u.reason === "manual_copy_mismatch" || u.manual));
      if (manual.length > 0 && downloadable.length === 0) {
        // Verify-only: nothing to download, show the copy instructions instead.
        const names = manual.map((u) => u.name).join(", ");
        const note = (manual[0] && manual[0].manualNote) || "Copy from the upstream iw2d/kaentake v3.4.1 release zip; the launcher will hash-verify.";
        text.textContent = `Manual copy needed (${names}): ${note}`;
        currentUpdates = null;
        if (manual.every((u) => u.reason === "manual_copy_mismatch")) disablePlay();
        else enablePlay();
        break;
      }
      const sizeMB = (result.totalSize / 1024 / 1024).toFixed(0);
      text.textContent = `${result.updates.length} file${result.updates.length > 1 ? "s" : ""} to update (${sizeMB} MB)`;
      currentUpdates = downloadable;
      enableUpdate();
      break;
    }

    case "no_path":
      status.className = "update-status error";
      icon.textContent = "\uD83D\uDCC1";
      text.textContent = "Set game folder to check for updates";
      disablePlay();
      break;

    case "error":
      status.className = "update-status error";
      icon.textContent = "\u274C";
      text.textContent = result.error || "Failed to check updates";
      // Still allow play if game exists locally
      enablePlay();
      break;
  }
}

async function handlePlay() {
  if (isUpdating) return;

  // If updates available, download first
  if (currentUpdates && currentUpdates.length > 0) {
    isUpdating = true;
    const btn = $("btn-play");
    btn.className = "btn-play updating";
    $("btn-play-text").textContent = "UPDATING 0%";
    $("progress-container").style.display = "block";

    const result = await window.buns.downloadUpdates(currentUpdates);

    $("progress-container").style.display = "none";
    isUpdating = false;

    if (result.success) {
      currentUpdates = null;
      btn.className = "btn-play";
      $("btn-play-text").textContent = "PLAY";
      $("update-status").className = "update-status up-to-date";
      $("update-text").textContent = "Updated successfully!";
      // Launch after update
      launchGame();
    } else {
      btn.className = "btn-play";
      $("btn-play-text").textContent = "RETRY UPDATE";
      $("update-text").textContent = result.error || "Update failed";
      $("update-status").className = "update-status error";
    }
    return;
  }

  launchGame();
}

async function launchGame() {
  const result = await window.buns.launch();
  if (result.success) {
    $("btn-play-text").textContent = "LAUNCHING...";
    setTimeout(() => {
      $("btn-play-text").textContent = "PLAY";
    }, 3000);
  } else {
    $("btn-play-text").textContent = "PLAY";
    $("update-text").textContent = result.error || "Failed to launch";
    $("update-status").className = "update-status error";
  }
}

function enablePlay() {
  const btn = $("btn-play");
  btn.disabled = false;
  btn.className = "btn-play";
  $("btn-play-text").textContent = "PLAY";
}

function enableUpdate() {
  const btn = $("btn-play");
  btn.disabled = false;
  btn.className = "btn-play updating";
  $("btn-play-text").textContent = "UPDATE & PLAY";
}

function disablePlay() {
  const btn = $("btn-play");
  btn.disabled = true;
  $("btn-play-text").textContent = "SET GAME FOLDER";
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
