const { spawn, spawnSync } = require("child_process");
let electronModule;
try {
  electronModule = require("electron");
} catch (err) {
  if (err && err.code === "MODULE_NOT_FOUND") {
    console.error("Electron module is missing. Run `npm install` and then `npm start`.");
    process.exit(1);
  }
  throw err;
}

if (typeof electronModule === "string") {
  const result = spawnSync(electronModule, [__filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.error) {
    console.error(`Failed to launch Electron: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

const { app, BrowserWindow, ipcMain, globalShortcut, Menu, screen } = electronModule;
const path = require("path");
const fs = require("fs");
const os = require("os");
const { sanitizeCoordinates } = require("./lib/coordinates.js");
const { HYBRID_KEYS, HYBRID_ALPHA_KEYS } = require("./lib/hybrid-keys.js");

let mainWindow;
let clickerProcess = null;
let moveProcess = null;
let captureProcess = null;
const WINDOW_MOVE_DEBOUNCE_MS = 120;

// Safe send to the renderer: the window may already be destroyed when a
// PowerShell process exits during shutdown, so guard every send.
function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// Format a JS array of byte values as a C# byte[] initializer body.
function toCSharpBytes(bytes) {
  return bytes.map((b) => "0x" + b.toString(16).toUpperCase().padStart(2, "0")).join(", ");
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const initialDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const initialWorkArea = initialDisplay.workArea;

  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "assets", "icon.ico"),
    x: initialWorkArea.x,
    y: initialWorkArea.y,
    width: initialWorkArea.width,
    height: initialWorkArea.height,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.maximize();

  let currentDisplayId = initialDisplay.id;
  let moveTimer = null;

  function fitWindowToDisplay(display) {
    const wasMaximized = mainWindow.isMaximized();
    if (wasMaximized) {
      mainWindow.unmaximize();
    }
    mainWindow.setBounds(display.workArea);
    if (wasMaximized) {
      mainWindow.maximize();
    }
  }

  function syncWindowToCurrentDisplay() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const center = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(center);
    if (display.id === currentDisplayId) return;
    currentDisplayId = display.id;
    fitWindowToDisplay(display);
  }

  const handleDisplayMetricsChanged = (_event, display) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (display.id !== currentDisplayId) return;
    fitWindowToDisplay(display);
  };

  const handleDisplayRemoved = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const center = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(center);
    currentDisplayId = display.id;
    fitWindowToDisplay(display);
  };

  mainWindow.on("move", () => {
    if (moveTimer) {
      clearTimeout(moveTimer);
    }
    moveTimer = setTimeout(() => {
      moveTimer = null;
      syncWindowToCurrentDisplay();
    }, WINDOW_MOVE_DEBOUNCE_MS);
  });

  screen.on("display-metrics-changed", handleDisplayMetricsChanged);
  screen.on("display-removed", handleDisplayRemoved);

  mainWindow.on("closed", () => {
    if (moveTimer) {
      clearTimeout(moveTimer);
      moveTimer = null;
    }
    screen.off("display-metrics-changed", handleDisplayMetricsChanged);
    screen.off("display-removed", handleDisplayRemoved);
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    releaseAllKeys();
    stopMouseMove();
    stopCaptureProcess();
    if (clickerProcess) {
      spawn("taskkill", ["/PID", String(clickerProcess.pid), "/T", "/F"]);
      clickerProcess = null;
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Date.now() alone can collide when two scripts are requested within the same
// millisecond (e.g. rapid capture requests), so add a monotonic counter.
let scriptSeq = 0;
function uniqueScriptPath(name) {
  scriptSeq++;
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${scriptSeq}.ps1`);
}

function stopMouseMove() {
  if (moveProcess) {
    spawn("taskkill", ["/PID", String(moveProcess.pid), "/T", "/F"]);
    moveProcess = null;
  }
}

function stopCaptureProcess() {
  if (captureProcess) {
    spawn("taskkill", ["/PID", String(captureProcess.pid), "/T", "/F"]);
    captureProcess = null;
  }
}

function releaseAllKeys() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class KeyReleaser {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;

  public static void ReleaseAll() {
    // Release mouse button
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

    // Release Shift
    keybd_event(0x10, 0, KEYEVENTF_KEYUP, 0);

    // Release all keys used by hybrid clicker
    byte[] keys = new byte[] {
      ${toCSharpBytes(HYBRID_KEYS)}
    };
    for (int i = 0; i < keys.Length; i++)
      keybd_event(keys[i], 0, KEYEVENTF_KEYUP, 0);
  }
}
'@
[KeyReleaser]::ReleaseAll()
`;
  const scriptPath = uniqueScriptPath("key-release");
  fs.writeFileSync(scriptPath, script);
  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  ps.on("close", () => {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // temp file already gone — nothing to clean up
    }
  });
}

function registerGlobalEsc() {
  try {
    globalShortcut.register("Escape", () => {
      sendToRenderer("log", "Global ESC pressed");
      ipcMain.emit("stop-clicker");
    });
  } catch {
    // shortcut not registered — safe to ignore
  }
}

function unregisterGlobalEsc() {
  try {
    globalShortcut.unregister("Escape");
  } catch {
    // shortcut not registered — safe to ignore
  }
}

// Common C# SendInput type definitions for hybrid clicker
const SENDINPUT_TYPES = `
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData;
    public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags;
    public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint uMsg; public ushort wParamL; public ushort wParamH;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  public static readonly int inputSize = Marshal.SizeOf(typeof(INPUT));
`;

// Shared C# HybridClicker class (used by both timed and infinite modes).
// Exposes Smash() for one cycle and RunTimed(seconds) for the timed loop.
const HYBRID_CLICKER_CLASS = `using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public class HybridClicker {
${SENDINPUT_TYPES}

  private static readonly byte[] keys = new byte[] {
    ${toCSharpBytes(HYBRID_KEYS)}
  };

  private static readonly byte[] alphaKeys = new byte[] {
    ${toCSharpBytes(HYBRID_ALPHA_KEYS)}
  };

  private static readonly INPUT[] batch1Press;
  private static readonly INPUT[] batch1Release;
  private static readonly INPUT[] batch2Press;
  private static readonly INPUT[] batch2Release;
  private static readonly int actionsPerCycle;

  static HybridClicker() {
    actionsPerCycle = 1 + keys.Length + 1 + alphaKeys.Length;

    batch1Press = new INPUT[1 + keys.Length];
    batch1Press[0].type = 0;
    batch1Press[0].u.mi.dwFlags = 0x0002;
    for (int i = 0; i < keys.Length; i++) {
      batch1Press[1 + i].type = 1;
      batch1Press[1 + i].u.ki.wVk = keys[i];
    }

    batch1Release = new INPUT[1 + keys.Length];
    batch1Release[0].type = 0;
    batch1Release[0].u.mi.dwFlags = 0x0004;
    for (int i = 0; i < keys.Length; i++) {
      batch1Release[1 + i].type = 1;
      batch1Release[1 + i].u.ki.wVk = keys[i];
      batch1Release[1 + i].u.ki.dwFlags = 0x0002;
    }

    batch2Press = new INPUT[1 + alphaKeys.Length];
    batch2Press[0].type = 1;
    batch2Press[0].u.ki.wVk = 0x10;
    for (int i = 0; i < alphaKeys.Length; i++) {
      batch2Press[1 + i].type = 1;
      batch2Press[1 + i].u.ki.wVk = alphaKeys[i];
    }

    batch2Release = new INPUT[alphaKeys.Length + 1];
    for (int i = 0; i < alphaKeys.Length; i++) {
      batch2Release[i].type = 1;
      batch2Release[i].u.ki.wVk = alphaKeys[i];
      batch2Release[i].u.ki.dwFlags = 0x0002;
    }
    batch2Release[alphaKeys.Length].type = 1;
    batch2Release[alphaKeys.Length].u.ki.wVk = 0x10;
    batch2Release[alphaKeys.Length].u.ki.dwFlags = 0x0002;
  }

  public static void Smash() {
    SendInput((uint)batch1Press.Length, batch1Press, inputSize);
    Thread.Sleep(15);
    SendInput((uint)batch1Release.Length, batch1Release, inputSize);
    Thread.Sleep(10);
    SendInput((uint)batch2Press.Length, batch2Press, inputSize);
    Thread.Sleep(15);
    SendInput((uint)batch2Release.Length, batch2Release, inputSize);
    Thread.Sleep(10);
  }

  public static string RunTimed(int seconds) {
    Stopwatch sw = Stopwatch.StartNew();
    long cycles = 0;
    long targetMs = seconds * 1000L;
    while (sw.ElapsedMilliseconds < targetMs) {
      Smash();
      cycles++;
    }
    sw.Stop();
    long totalActions = cycles * actionsPerCycle;
    return "Done. Cycles: " + cycles + ", Total actions: " + totalActions + " in " + sw.ElapsedMilliseconds + "ms";
  }
}`;

// Shared C# MouseClicker class for mouse-only modes.
const MOUSE_CLICKER_CLASS = `using System;
using System.Runtime.InteropServices;
using System.Threading;

public class MouseClicker {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;

  public static void Click() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(20);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(10);
  }
}`;

// Duration of the timed clicker modes, in seconds.
const CLICK_DURATION_SECONDS = 10;

// ── PowerShell script templates ──

const MOUSE_TIMED_SCRIPT = `
try {
  Write-Output "Starting clicker for ${CLICK_DURATION_SECONDS} seconds..."
  Add-Type -TypeDefinition @'
${MOUSE_CLICKER_CLASS}
'@
  Write-Output "Clicker class loaded successfully"
  $startTime = Get-Date
  $endTime = $startTime.AddSeconds(${CLICK_DURATION_SECONDS})
  Write-Output "Start time: $startTime"
  Write-Output "End time: $endTime"
  $count = 0
  while ($true) {
    $currentTime = Get-Date
    if ($currentTime -ge $endTime) {
      Write-Output "Time limit reached"
      break
    }
    try {
      [MouseClicker]::Click()
      $count++
      if ($count % 10 -eq 0) {
        Write-Output "Clicked $count times at $currentTime"
      }
    } catch {
      Write-Output "Click error: $_"
      Write-Output "Stack: $($_.ScriptStackTrace)"
    }
  }
  Write-Output "Done. Total clicks: $count"
} catch {
  Write-Output "Fatal error: $_"
  Write-Output "Stack: $($_.ScriptStackTrace)"
}
`;

const MOUSE_INFINITE_SCRIPT = `
try {
  Write-Output "Starting infinite clicker (ESC to stop)..."
  Add-Type -TypeDefinition @'
${MOUSE_CLICKER_CLASS}
'@
  Write-Output "Clicker class loaded successfully"
  $count = 0
  while ($true) {
    try {
      [MouseClicker]::Click()
      $count++
      if ($count % 10 -eq 0) {
        Write-Output "Clicked $count times"
      }
    } catch {
      Write-Output "Click error: $_"
      Write-Output "Stack: $($_.ScriptStackTrace)"
    }
  }
} catch {
  Write-Output "Fatal error: $_"
  Write-Output "Stack: $($_.ScriptStackTrace)"
}
`;

const HYBRID_TIMED_SCRIPT = `
try {
  Add-Type -TypeDefinition @'
${HYBRID_CLICKER_CLASS}
'@
  Write-Output ([HybridClicker]::RunTimed(${CLICK_DURATION_SECONDS}))
} catch {
  Write-Output "Fatal error: $_"
  Write-Output "Stack: $($_.ScriptStackTrace)"
}
`;

const HYBRID_INFINITE_SCRIPT = `
try {
  Add-Type -TypeDefinition @'
${HYBRID_CLICKER_CLASS}
'@
  while ($true) {
    [HybridClicker]::Smash()
  }
} catch {
  Write-Output "Fatal error: $_"
  Write-Output "Stack: $($_.ScriptStackTrace)"
}
`;

// Spawn a clicker PowerShell script and wire up the common lifecycle:
// stdout/stderr forwarding, temp-file cleanup, ESC handling and renderer replies.
// reportExitCode: when true, a non-zero exit is reported as clicker-error
// (timed modes); infinite modes only ever complete or get stopped.
function runClickerScript({ name, script, event, reportExitCode }) {
  const scriptPath = uniqueScriptPath(name);
  fs.writeFileSync(scriptPath, script);

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  clickerProcess = ps;
  registerGlobalEsc();

  sendToRenderer("log", `${name} started with PID: ${ps.pid}`);

  ps.stdout.on("data", (data) => {
    sendToRenderer("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    sendToRenderer("ps-error", data.toString());
  });

  // A failed spawn emits "error" and then "close" as well, so both handlers can
  // fire for one process. The cleanup steps are idempotent; replyOnce makes
  // sure the renderer sees exactly one final clicker-* reply.
  let replied = false;
  const replyOnce = (channel, ...args) => {
    if (replied) return;
    replied = true;
    event.reply(channel, ...args);
  };

  ps.on("close", (code) => {
    sendToRenderer("log", `${name} closed with code: ${code}`);
    const wasKilled = clickerProcess !== ps;
    if (clickerProcess === ps) clickerProcess = null;
    stopMouseMove();
    unregisterGlobalEsc();
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // temp file already gone — nothing to clean up
    }
    if (wasKilled) {
      replyOnce("clicker-stopped");
    } else if (!reportExitCode || code === 0) {
      replyOnce("clicker-complete");
    } else {
      replyOnce("clicker-error", `Exit code: ${code}`);
    }
  });

  ps.on("error", (err) => {
    sendToRenderer("log", `${name} error: ${err}`);
    if (clickerProcess === ps) clickerProcess = null;
    stopMouseMove();
    unregisterGlobalEsc();
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // temp file already gone — nothing to clean up
    }
    replyOnce("clicker-error", err.message);
  });
}

// Guard against starting a second action while one is already running.
// Buttons are disabled in the renderer, but defend on the main side too so a
// stray IPC message can't orphan the running PowerShell process.
function isClickerBusy(channel) {
  if (clickerProcess || moveProcess) {
    sendToRenderer("log", `Already running, ignoring ${channel}`);
    return true;
  }
  return false;
}

// Returns true if a mouse-move process was actually spawned, false otherwise.
// onClose (optional) is invoked when that process exits — used by the move-only
// mode to signal completion without polling.
function startMouseMoveIfNeeded(coords, withClick = false, onClose = null) {
  sendToRenderer("log", "startMouseMoveIfNeeded called, coords: " + JSON.stringify(coords));

  // Validate IPC data (including a non-array payload) so nothing but plain
  // in-range integers is ever interpolated into the PowerShell script.
  const sanitized = sanitizeCoordinates(coords);
  if (sanitized.length === 0) {
    sendToRenderer("log", "No valid coordinates, skipping mouse move");
    return false;
  }

  const coordsArray = sanitized
    .map((c) => `[PSCustomObject]@{X=${c.x};Y=${c.y};Interval=${c.interval}}`)
    .join(",");

  const clickerClass = withClick
    ? `
public class MouseClicker {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;

  public static void Click() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(20);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(10);
  }
}`
    : "";

  const clickCall = withClick ? `\n      [MouseClicker]::Click()` : "";

  const moveScript = `
try {
  Write-Output "Starting mouse mover with ${sanitized.length} coordinates..."
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class MouseMover {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);

  public static void MoveTo(int x, int y) {
    SetCursorPos(x, y);
  }
}
${clickerClass}
'@

  Write-Output "Mouse mover class loaded successfully"
  $coordinates = @(${coordsArray})
  $index = 0
  while ($true) {
    try {
      $coord = $coordinates[$index]
      $x = $coord.X
      $y = $coord.Y
      $interval = $coord.Interval
      Write-Output "Moving to: X=$x, Y=$y"
      [MouseMover]::MoveTo($x, $y)${clickCall}
      Start-Sleep -Milliseconds $interval
      $index++
      if ($index -ge $coordinates.Length) {
        $index = 0
      }
    } catch {
      Write-Output "Move error: $_"
    }
  }
} catch {
  Write-Output "Fatal error: $_"
}
`;

  const scriptPath = uniqueScriptPath("mouse-move");
  fs.writeFileSync(scriptPath, moveScript);
  sendToRenderer("log", "Mouse move script: " + scriptPath);

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  moveProcess = ps;

  sendToRenderer("log", "Mouse move started with PID: " + ps.pid);

  ps.stdout.on("data", (data) => {
    sendToRenderer("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    sendToRenderer("ps-error", data.toString());
  });

  // Shared by "close" and "error": a spawn failure emits "error" without a
  // matching "close", and both can fire for runtime errors — settle only once
  // so onClose (completion reply) is never skipped or duplicated.
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (moveProcess === ps) moveProcess = null;
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // temp file already gone — nothing to clean up
    }
    if (onClose) onClose();
  };

  ps.on("close", settle);

  ps.on("error", (err) => {
    sendToRenderer("log", "Mouse move error: " + err);
    settle();
  });

  return true;
}

ipcMain.on("start-moving-mouse", (event, data) => {
  if (isClickerBusy("start-moving-mouse")) return;
  sendToRenderer("log", "Start moving mouse requested");

  const finish = () => {
    unregisterGlobalEsc();
    event.reply("clicker-complete");
  };

  // The mover runs an infinite loop, so completion only happens when the
  // process is killed (ESC / stop). Signal via the process close event.
  // Register the global shortcut only after a successful start: if the spawn
  // throws, Escape must not stay grabbed with nothing running.
  const started = startMouseMoveIfNeeded(data && data.coordinates, true, finish);
  if (!started) {
    event.reply("clicker-complete");
    return;
  }
  registerGlobalEsc();
});

ipcMain.on("start-clicker", (event, data) => {
  if (isClickerBusy("start-clicker")) return;
  sendToRenderer("log", "IPC start-clicker received, data: " + JSON.stringify(data));
  if (data) startMouseMoveIfNeeded(data.coordinates);
  runClickerScript({ name: "clicker", script: MOUSE_TIMED_SCRIPT, event, reportExitCode: true });
});

ipcMain.on("start-clicker-infinite", (event, data) => {
  if (isClickerBusy("start-clicker-infinite")) return;
  sendToRenderer("log", "IPC start-clicker-infinite received");
  if (data) startMouseMoveIfNeeded(data.coordinates);
  runClickerScript({
    name: "clicker-infinite",
    script: MOUSE_INFINITE_SCRIPT,
    event,
    reportExitCode: false,
  });
});

ipcMain.on("stop-clicker", () => {
  sendToRenderer("log", "Stop clicker requested");
  const hadClicker = !!clickerProcess;
  if (clickerProcess) {
    sendToRenderer("log", "Killing clicker PID: " + clickerProcess.pid);
    spawn("taskkill", ["/PID", String(clickerProcess.pid), "/T", "/F"]);
    clickerProcess = null;
    releaseAllKeys();
  }
  if (moveProcess) {
    sendToRenderer("log", "Killing move PID: " + moveProcess.pid);
    spawn("taskkill", ["/PID", String(moveProcess.pid), "/T", "/F"]);
    moveProcess = null;
  }
  if (!hadClicker) {
    sendToRenderer("clicker-stopped");
  }
});

ipcMain.on("start-hybrid-clicker", (event, data) => {
  if (isClickerBusy("start-hybrid-clicker")) return;
  sendToRenderer("log", "IPC start-hybrid-clicker received");
  if (data) startMouseMoveIfNeeded(data.coordinates);
  runClickerScript({
    name: "hybrid-clicker",
    script: HYBRID_TIMED_SCRIPT,
    event,
    reportExitCode: true,
  });
});

ipcMain.on("start-hybrid-clicker-infinite", (event, data) => {
  if (isClickerBusy("start-hybrid-clicker-infinite")) return;
  sendToRenderer("log", "IPC start-hybrid-clicker-infinite received");
  if (data) startMouseMoveIfNeeded(data.coordinates);
  runClickerScript({
    name: "hybrid-clicker-infinite",
    script: HYBRID_INFINITE_SCRIPT,
    event,
    reportExitCode: false,
  });
});

ipcMain.on("capture-mouse-click", (event) => {
  // Only one capture poller at a time: a new request (e.g. another "Change
  // position" click) supersedes the previous one, which would otherwise keep
  // polling until the next physical click and reply a second time.
  stopCaptureProcess();
  sendToRenderer("log", "Waiting for mouse click to capture coordinates...");

  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ClickCapture {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  public const int VK_LBUTTON = 0x01;
  public const int VK_ESCAPE = 0x1B;
}
'@

Write-Output "READY"
$wasPressed = ([ClickCapture]::GetAsyncKeyState([ClickCapture]::VK_LBUTTON) -band 0x8000) -ne 0
while ($true) {
  $lbDown = ([ClickCapture]::GetAsyncKeyState([ClickCapture]::VK_LBUTTON) -band 0x8000) -ne 0
  $escDown = ([ClickCapture]::GetAsyncKeyState([ClickCapture]::VK_ESCAPE) -band 0x8000) -ne 0
  if ($escDown) {
    Write-Output "CANCELLED"
    break
  }
  if ($lbDown -and -not $wasPressed) {
    $point = New-Object ClickCapture+POINT
    [ClickCapture]::GetCursorPos([ref]$point) | Out-Null
    Write-Output "COORDS:$($point.X),$($point.Y)"
    break
  }
  $wasPressed = $lbDown
  Start-Sleep -Milliseconds 10
}`;

  const scriptPath = uniqueScriptPath("capture-click");
  fs.writeFileSync(scriptPath, script);

  let output = "";
  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  captureProcess = ps;
  let replied = false;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (captureProcess === ps) captureProcess = null;
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // temp file already gone — nothing to clean up
    }
  };

  ps.stdout.on("data", (data) => {
    output += data.toString();
    sendToRenderer("ps-output", data.toString());
    const coordMatch = output.match(/COORDS:([+-]?\d+),([+-]?\d+)/);
    if (coordMatch) {
      replied = true;
      event.reply("mouse-click-captured", {
        x: parseInt(coordMatch[1], 10),
        y: parseInt(coordMatch[2], 10),
      });
      ps.kill();
      return;
    }
    if (output.includes("CANCELLED")) {
      replied = true;
      event.reply("mouse-click-error", "Cancelled");
      ps.kill();
    }
  });

  ps.stderr.on("data", (data) => {
    sendToRenderer("ps-error", data.toString());
  });

  ps.on("close", (code) => {
    cleanup();
    if (!replied) {
      event.reply("mouse-click-error", `Capture ended unexpectedly (code: ${code ?? "unknown"})`);
    }
  });

  ps.on("error", (err) => {
    cleanup();
    if (replied) return;
    replied = true;
    event.reply("mouse-click-error", err.message);
  });
});
