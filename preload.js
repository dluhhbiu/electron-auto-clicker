const { contextBridge, ipcRenderer } = require("electron");
const CoordLib = require("./lib/coordinates.js");
const KeysLib = require("./lib/hybrid-keys.js");

const subscribe = (channel) => (callback) =>
  ipcRenderer.on(channel, (_event, ...args) => callback(...args));

contextBridge.exposeInMainWorld("electronAPI", {
  startClicker: (payload) => ipcRenderer.send("start-clicker", payload),
  startClickerInfinite: (payload) => ipcRenderer.send("start-clicker-infinite", payload),
  startHybridClicker: (payload) => ipcRenderer.send("start-hybrid-clicker", payload),
  startHybridClickerInfinite: (payload) =>
    ipcRenderer.send("start-hybrid-clicker-infinite", payload),
  startMovingMouse: (payload) => ipcRenderer.send("start-moving-mouse", payload),
  stopClicker: () => ipcRenderer.send("stop-clicker"),
  captureMouseClick: () => ipcRenderer.send("capture-mouse-click"),

  onMouseClickCaptured: subscribe("mouse-click-captured"),
  onMouseClickError: subscribe("mouse-click-error"),
  onClickerComplete: subscribe("clicker-complete"),
  onClickerStopped: subscribe("clicker-stopped"),
  onClickerError: subscribe("clicker-error"),
  onLog: subscribe("log"),
  onPsOutput: subscribe("ps-output"),
  onPsError: subscribe("ps-error"),

  coordLib: {
    addCoordinate: CoordLib.addCoordinate,
    replaceCoordinate: CoordLib.replaceCoordinate,
    removeCoordinate: CoordLib.removeCoordinate,
    updateInterval: CoordLib.updateInterval,
    isValidInterval: CoordLib.isValidInterval,
    getCoords: CoordLib.getCoords,
  },
  keysLib: {
    ALL_KEYS: KeysLib.ALL_KEYS,
    KEY_NAMES: KeysLib.KEY_NAMES,
    DEFAULT_EXCLUDED_CODES: KeysLib.DEFAULT_EXCLUDED_CODES,
  },
});
