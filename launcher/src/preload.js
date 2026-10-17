const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("buns", {
  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  openSite: (sitePath) => ipcRenderer.invoke("site:open", sitePath),
  fetchConfig: () => ipcRenderer.invoke("site:config"),

  // Game
  findGamePath: () => ipcRenderer.invoke("game:findPath"),
  setGamePath: (p) => ipcRenderer.invoke("game:setPath", p),
  getServerHost: () => ipcRenderer.invoke("server:getHost"),
  getServerHostStored: () => ipcRenderer.invoke("server:getHostStored"),
  setServerHost: (host) => ipcRenderer.invoke("server:setHost", host),
  selectFolder: () => ipcRenderer.invoke("game:selectFolder"),
  launch: () => ipcRenderer.invoke("game:launch"),
  onLaunchStatus: (cb) => ipcRenderer.on("game:launchStatus", (_, data) => cb(data)),

  // Isolated primary Kaentake and existing stock rollback profiles.
  getProfile: () => ipcRenderer.invoke("profile:get"),
  setProfile: (id) => ipcRenderer.invoke("profile:set", id),
  setProfilePath: (id, dir) => ipcRenderer.invoke("profile:setPath", id, dir),
  getProfileDeps: (id) => ipcRenderer.invoke("profile:deps", id),

  // Server
  getStatus: () => ipcRenderer.invoke("server:status"),
  getNews: () => ipcRenderer.invoke("launcher:news"),

  // Settings
  getHD: () => ipcRenderer.invoke("settings:getHD"),
  setHD: (enabled) => ipcRenderer.invoke("settings:setHD", enabled),
  getHDOptions: () => ipcRenderer.invoke("settings:getHDOptions"),
  setHDOptions: (opts) => ipcRenderer.invoke("settings:setHDOptions", opts),

  // Updates
  checkUpdates: () => ipcRenderer.invoke("launcher:checkUpdates"),
  downloadUpdates: (request) => ipcRenderer.invoke("launcher:downloadUpdates", request),
  onDownloadProgress: (cb) => ipcRenderer.on("download:progress", (_, data) => cb(data)),
});
