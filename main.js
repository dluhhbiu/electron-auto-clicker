const { app, BrowserWindow, ipcMain, globalShortcut } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

let mainWindow;
let clickerProcess = null;
let moveProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.maximize();

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function uniqueScriptPath(name) {
  return path.join(os.tmpdir(), `${name}-${Date.now()}.ps1`);
}

function stopMouseMove() {
  if (moveProcess) {
    spawn("taskkill", ["/PID", String(moveProcess.pid), "/T", "/F"]);
    moveProcess = null;
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
      0x25, 0x26, 0x27, 0x28,
      0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
      0xBD, 0xBB,
      0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
      0x6A, 0x6B, 0x6D, 0x6E, 0x6F,
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
      0x4B, 0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54,
      0x55, 0x56, 0x57, 0x58, 0x59, 0x5A,
      0xBA, 0xBF, 0xC0, 0xDB, 0xDC, 0xDD, 0xDE, 0xBC, 0xBE
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
    try { fs.unlinkSync(scriptPath); } catch (_e) { _e; }
  });
}

function registerGlobalEsc() {
  try {
    globalShortcut.register("Escape", () => {
      mainWindow.webContents.send("log", "Global ESC pressed");
      ipcMain.emit("stop-clicker");
    });
  } catch (_e) {
    _e;
  }
}

function unregisterGlobalEsc() {
  try {
    globalShortcut.unregister("Escape");
  } catch (_e) {
    _e;
  }
}

function startMouseMoveIfNeeded(coords) {
  mainWindow.webContents.send(
    "log",
    "startMouseMoveIfNeeded called, coords: " + JSON.stringify(coords)
  );
  if (!coords || coords.length === 0) {
    mainWindow.webContents.send("log", "No coordinates, skipping mouse move");
    return;
  }

  const coordsArray = coords
    .map((c) => `[PSCustomObject]@{X=${c.x};Y=${c.y};Interval=${c.interval}}`)
    .join(",");

  const moveScript = `
try {
  Write-Output "Starting mouse mover with ${coords.length} coordinates..."
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class MouseMover {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);

  public static void MoveTo(int x, int y) {
    SetCursorPos(x, y);
  }
}
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
      [MouseMover]::MoveTo($x, $y)
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
  mainWindow.webContents.send("log", "Mouse move script: " + scriptPath);

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  moveProcess = ps;

  mainWindow.webContents.send("log", "Mouse move started with PID: " + ps.pid);

  ps.stdout.on("data", (data) => {
    mainWindow.webContents.send("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    mainWindow.webContents.send("ps-error", data.toString());
  });

  ps.on("close", () => {
    if (moveProcess === ps) moveProcess = null;
    try {
      fs.unlinkSync(scriptPath);
    } catch (_e) {
      _e;
    }
  });

  ps.on("error", (err) => {
    mainWindow.webContents.send("log", "Mouse move error: " + err);
    if (moveProcess === ps) moveProcess = null;
  });
}

ipcMain.on("start-clicker", (event, data) => {
  mainWindow.webContents.send("log", "IPC start-clicker received, data: " + JSON.stringify(data));
  if (data) startMouseMoveIfNeeded(data.coordinates);

  const powerShellScript = `
try {
  Write-Output "Starting clicker for 10 seconds..."
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class MouseClicker {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  
  private static Random random = new Random();
  
  public static void Click() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(30);
    
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(10);
  }
  
  public static void ClickWithDelay() {
    Click();
    Thread.Sleep(55);
  }
}
'@
  Write-Output "Clicker class loaded successfully"
  $startTime = Get-Date
  $endTime = $startTime.AddSeconds(10)
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
      [MouseClicker]::ClickWithDelay()
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

  mainWindow.webContents.send("log", "Creating temp directory script...");
  const scriptPath = uniqueScriptPath("clicker");
  mainWindow.webContents.send("log", "Script path: " + scriptPath);
  fs.writeFileSync(scriptPath, powerShellScript);
  mainWindow.webContents.send("log", "Script written successfully");

  mainWindow.webContents.send("log", "Starting PowerShell process...");

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  clickerProcess = ps;
  registerGlobalEsc();

  mainWindow.webContents.send("log", "PowerShell process started with PID: " + ps.pid);

  ps.stdout.on("data", (data) => {
    mainWindow.webContents.send("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    mainWindow.webContents.send("ps-error", data.toString());
  });

  ps.on("close", (code) => {
    mainWindow.webContents.send("log", "Clicker closed with code: " + code);
    const wasKilled = clickerProcess !== ps;
    if (clickerProcess === ps) clickerProcess = null;
    stopMouseMove();
    unregisterGlobalEsc();
    try {
      fs.unlinkSync(scriptPath);
    } catch (_e) {
      _e;
    }
    if (wasKilled) {
      event.reply("clicker-stopped");
    } else if (code === 0) {
      event.reply("clicker-complete");
    } else {
      event.reply("clicker-error", `Exit code: ${code}`);
    }
  });

  ps.on("error", (err) => {
    mainWindow.webContents.send("log", "Clicker error: " + err);
    if (clickerProcess === ps) clickerProcess = null;
    event.reply("clicker-error", err.message);
  });
});

ipcMain.on("start-clicker-infinite", (event, data) => {
  mainWindow.webContents.send("log", "IPC start-clicker-infinite received");
  if (data) startMouseMoveIfNeeded(data.coordinates);

  const powerShellScript = `
try {
 Write-Output "Starting infinite clicker (ESC to stop)..."
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class MouseClicker {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  
  private static Random random = new Random();  
  public static void Click() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(30);
    
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(10);
  }
  
  public static void ClickWithDelay() {
    Click();
    Thread.Sleep(55);
  }
}
'@

  Write-Output "Clicker class loaded successfully"
  $count = 0
  while ($true) {
    try {
      [MouseClicker]::ClickWithDelay()
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

  mainWindow.webContents.send("log", "Creating temp directory script...");
  const scriptPath = uniqueScriptPath("clicker-infinite");
  mainWindow.webContents.send("log", "Script path: " + scriptPath);
  fs.writeFileSync(scriptPath, powerShellScript);
  mainWindow.webContents.send("log", "Script written successfully");

  mainWindow.webContents.send("log", "Starting PowerShell process...");

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  clickerProcess = ps;
  registerGlobalEsc();

  mainWindow.webContents.send("log", "PowerShell process started with PID: " + ps.pid);

  ps.stdout.on("data", (data) => {
    mainWindow.webContents.send("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    mainWindow.webContents.send("ps-error", data.toString());
  });

  ps.on("close", (code) => {
    mainWindow.webContents.send("log", "Clicker-infinite closed with code: " + code);
    const wasKilled = clickerProcess !== ps;
    if (clickerProcess === ps) clickerProcess = null;
    stopMouseMove();
    unregisterGlobalEsc();
    try {
      fs.unlinkSync(scriptPath);
    } catch (_e) {
      _e;
    }
    if (wasKilled) {
      event.reply("clicker-stopped");
    } else {
      event.reply("clicker-complete");
    }
  });

  ps.on("error", (err) => {
    mainWindow.webContents.send("log", "Clicker-infinite error: " + err);
    if (clickerProcess === ps) clickerProcess = null;
    event.reply("clicker-error", err.message);
  });
});

ipcMain.on("stop-clicker", () => {
  mainWindow.webContents.send("log", "Stop clicker requested");
  const hadClicker = !!clickerProcess;
  if (clickerProcess) {
    mainWindow.webContents.send("log", "Killing clicker PID: " + clickerProcess.pid);
    spawn("taskkill", ["/PID", String(clickerProcess.pid), "/T", "/F"]);
    clickerProcess = null;
    releaseAllKeys();
  }
  if (moveProcess) {
    mainWindow.webContents.send("log", "Killing move PID: " + moveProcess.pid);
    spawn("taskkill", ["/PID", String(moveProcess.pid), "/T", "/F"]);
    moveProcess = null;
  }
  if (!hadClicker) {
    mainWindow.webContents.send("clicker-stopped");
  }
});

ipcMain.on("start-hybrid-clicker", (event, data) => {
  mainWindow.webContents.send("log", "IPC start-hybrid-clicker received");
  if (data) startMouseMoveIfNeeded(data.coordinates);

  const powerShellScript = `
try {
  Write-Output "Starting hybrid clicker (click + keyboard) for 10 seconds..."
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class HybridClicker {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  public const uint KEYEVENTF_KEYUP = 0x0002;

  private static readonly byte[] keys = new byte[] {
    0x25, 0x26, 0x27, 0x28,
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0xBD, 0xBB,
    0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6A, 0x6B, 0x6D, 0x6E, 0x6F,
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
    0x4B, 0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54,
    0x55, 0x56, 0x57, 0x58, 0x59, 0x5A,
    0xBA, 0xBF, 0xC0, 0xDB, 0xDC, 0xDD, 0xDE, 0xBC, 0xBE
  };

  public static int KeyCount { get { return keys.Length; } }

  public static void Click() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(30);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(10);
  }

  public const byte VK_SHIFT = 0x10;

  private static readonly byte[] alphaKeys = new byte[] {
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
    0x4B, 0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54,
    0x55, 0x56, 0x57, 0x58, 0x59, 0x5A
  };

  public static void HybridClick() {
    Click();
    // Lowercase + digits + other keys (no Shift)
    for (int i = 0; i < keys.Length; i++)
      keybd_event(keys[i], 0, 0, 0);
    Thread.Sleep(30);
    for (int i = 0; i < keys.Length; i++)
      keybd_event(keys[i], 0, KEYEVENTF_KEYUP, 0);
    Thread.Sleep(10);
    // Uppercase (with Shift)
    keybd_event(VK_SHIFT, 0, 0, 0);
    for (int i = 0; i < alphaKeys.Length; i++)
      keybd_event(alphaKeys[i], 0, 0, 0);
    Thread.Sleep(30);
    for (int i = 0; i < alphaKeys.Length; i++)
      keybd_event(alphaKeys[i], 0, KEYEVENTF_KEYUP, 0);
    keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
    Thread.Sleep(10);
  }

  public static void HybridClickWithDelay() {
    HybridClick();
    Thread.Sleep(55);
  }
}
'@
  Write-Output "Hybrid clicker class loaded successfully"
  $startTime = Get-Date
  $endTime = $startTime.AddSeconds(10)
  Write-Output "Start time: $startTime"
  Write-Output "End time: $endTime"
  $count = 0
  $clickCount = 0
  $keyCount = 0
  while ($true) {
    $currentTime = Get-Date
    if ($currentTime -ge $endTime) {
      Write-Output "Time limit reached"
      break
    }
    try {
      [HybridClicker]::HybridClickWithDelay()
      $count += 94
      $clickCount++
      $keyCount += 93
      if ($count % 10 -eq 0) {
        Write-Output "Mouse clicks: $clickCount, Key presses: $keyCount at $currentTime"
      }
    } catch {
      Write-Output "Click error: $_"
      Write-Output "Stack: $($_.ScriptStackTrace)"
    }
  }
  Write-Output "Done. Total actions: $count (clicks: $clickCount, keys: $keyCount)"
} catch {
  Write-Output "Fatal error: $_"
  Write-Output "Stack: $($_.ScriptStackTrace)"
}
`;

  mainWindow.webContents.send("log", "Creating temp directory script...");
  const scriptPath = uniqueScriptPath("hybrid-clicker");
  mainWindow.webContents.send("log", "Script path: " + scriptPath);
  fs.writeFileSync(scriptPath, powerShellScript);
  mainWindow.webContents.send("log", "Script written successfully");

  mainWindow.webContents.send("log", "Starting PowerShell process...");

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  clickerProcess = ps;
  registerGlobalEsc();

  mainWindow.webContents.send("log", "PowerShell process started with PID: " + ps.pid);

  ps.stdout.on("data", (data) => {
    mainWindow.webContents.send("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    mainWindow.webContents.send("ps-error", data.toString());
  });

  ps.on("close", (code) => {
    mainWindow.webContents.send("log", "Hybrid clicker closed with code: " + code);
    const wasKilled = clickerProcess !== ps;
    if (clickerProcess === ps) clickerProcess = null;
    stopMouseMove();
    unregisterGlobalEsc();
    try {
      fs.unlinkSync(scriptPath);
    } catch (_e) {
      _e;
    }
    if (wasKilled) {
      event.reply("clicker-stopped");
    } else if (code === 0) {
      event.reply("clicker-complete");
    } else {
      event.reply("clicker-error", `Exit code: ${code}`);
    }
  });

  ps.on("error", (err) => {
    mainWindow.webContents.send("log", "Hybrid clicker error: " + err);
    if (clickerProcess === ps) clickerProcess = null;
    event.reply("clicker-error", err.message);
  });
});

ipcMain.on("start-hybrid-clicker-infinite", (event, data) => {
  mainWindow.webContents.send("log", "IPC start-hybrid-clicker-infinite received");
  if (data) startMouseMoveIfNeeded(data.coordinates);

  const powerShellScript = `
try {
  Write-Output "Starting infinite hybrid clicker (ESC to stop)..."
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class HybridClicker {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
  public const uint MOUSEEVENTF_LEFTUP = 0x04;
  public const uint KEYEVENTF_KEYUP = 0x0002;

  private static readonly byte[] keys = new byte[] {
    0x25, 0x26, 0x27, 0x28,
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0xBD, 0xBB,
    0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6A, 0x6B, 0x6D, 0x6E, 0x6F,
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
    0x4B, 0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54,
    0x55, 0x56, 0x57, 0x58, 0x59, 0x5A,
    0xBA, 0xBF, 0xC0, 0xDB, 0xDC, 0xDD, 0xDE, 0xBC, 0xBE
  };

  public static int KeyCount { get { return keys.Length; } }

  public static void Click() {
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(30);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(10);
  }

  public const byte VK_SHIFT = 0x10;

  private static readonly byte[] alphaKeys = new byte[] {
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A,
    0x4B, 0x4C, 0x4D, 0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54,
    0x55, 0x56, 0x57, 0x58, 0x59, 0x5A
  };

  public static void HybridClick() {
    Click();
    // Lowercase + digits + other keys (no Shift)
    for (int i = 0; i < keys.Length; i++)
      keybd_event(keys[i], 0, 0, 0);
    Thread.Sleep(30);
    for (int i = 0; i < keys.Length; i++)
      keybd_event(keys[i], 0, KEYEVENTF_KEYUP, 0);
    Thread.Sleep(10);
    // Uppercase (with Shift)
    keybd_event(VK_SHIFT, 0, 0, 0);
    for (int i = 0; i < alphaKeys.Length; i++)
      keybd_event(alphaKeys[i], 0, 0, 0);
    Thread.Sleep(30);
    for (int i = 0; i < alphaKeys.Length; i++)
      keybd_event(alphaKeys[i], 0, KEYEVENTF_KEYUP, 0);
    keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
    Thread.Sleep(10);
  }

  public static void HybridClickWithDelay() {
    HybridClick();
    Thread.Sleep(55);
  }
}
'@

  Write-Output "Hybrid clicker class loaded successfully"
  $count = 0
  $clickCount = 0
  $keyCount = 0
  while ($true) {
    try {
      [HybridClicker]::HybridClickWithDelay()
      $count += 94
      $clickCount++
      $keyCount += 93
      if ($count % 10 -eq 0) {
        Write-Output "Mouse clicks: $clickCount, Key presses: $keyCount"
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

  mainWindow.webContents.send("log", "Creating temp directory script...");
  const scriptPath = uniqueScriptPath("hybrid-clicker-infinite");
  mainWindow.webContents.send("log", "Script path: " + scriptPath);
  fs.writeFileSync(scriptPath, powerShellScript);
  mainWindow.webContents.send("log", "Script written successfully");

  mainWindow.webContents.send("log", "Starting PowerShell process...");

  const ps = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    windowsHide: true,
  });
  clickerProcess = ps;
  registerGlobalEsc();

  mainWindow.webContents.send("log", "PowerShell process started with PID: " + ps.pid);

  ps.stdout.on("data", (data) => {
    mainWindow.webContents.send("ps-output", data.toString());
  });

  ps.stderr.on("data", (data) => {
    mainWindow.webContents.send("ps-error", data.toString());
  });

  ps.on("close", (code) => {
    mainWindow.webContents.send("log", "Hybrid-infinite closed with code: " + code);
    const wasKilled = clickerProcess !== ps;
    if (clickerProcess === ps) clickerProcess = null;
    stopMouseMove();
    unregisterGlobalEsc();
    try {
      fs.unlinkSync(scriptPath);
    } catch (_e) {
      _e;
    }
    if (wasKilled) {
      event.reply("clicker-stopped");
    } else {
      event.reply("clicker-complete");
    }
  });

  ps.on("error", (err) => {
    mainWindow.webContents.send("log", "Hybrid-infinite error: " + err);
    if (clickerProcess === ps) clickerProcess = null;
    event.reply("clicker-error", err.message);
  });
});

ipcMain.on("get-window-position", (event) => {
  const position = mainWindow.getPosition();
  event.reply("window-position", position);
});

ipcMain.on("capture-mouse-click", (event) => {
  mainWindow.webContents.send("log", "Waiting for mouse click to capture coordinates...");

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

  ps.stdout.on("data", (data) => {
    output += data.toString();
    mainWindow.webContents.send("ps-output", data.toString());
    const coordMatch = output.match(/COORDS:(\d+),(\d+)/);
    if (coordMatch) {
      event.reply("mouse-click-captured", {
        x: parseInt(coordMatch[1]),
        y: parseInt(coordMatch[2]),
      });
      ps.kill();
    }
    if (output.includes("CANCELLED")) {
      event.reply("mouse-click-error", "Отменено");
      ps.kill();
    }
  });

  ps.stderr.on("data", (data) => {
    mainWindow.webContents.send("ps-error", data.toString());
  });

  ps.on("close", () => {
    try {
      fs.unlinkSync(scriptPath);
    } catch (_e) {
      _e;
    }
  });

  ps.on("error", (err) => {
    event.reply("mouse-click-error", err.message);
  });
});
