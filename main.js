const { app, BrowserWindow, ipcMain } = require('electron');
const { exec, writeFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let currentProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('start-clicker', (event) => {
  mainWindow.webContents.send('log', 'IPC start-clicker received');
  
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
    mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0, 0, 0, 0);
    Thread.Sleep(random.Next(5, 10));
    
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(random.Next(20, 35));
    
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(random.Next(5, 10));
  }
  
  public static void ClickWithDelay() {
    Click();
    Thread.Sleep(random.Next(45, 65));
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

  const { spawn } = require('child_process');
  const os = require('os');
  
  mainWindow.webContents.send('log', 'Creating temp directory script...');
  const scriptPath = path.join(os.tmpdir(), 'clicker.ps1');
  mainWindow.webContents.send('log', 'Script path: ' + scriptPath);
  fs.writeFileSync(scriptPath, powerShellScript);
  mainWindow.webContents.send('log', 'Script written successfully');

  mainWindow.webContents.send('log', 'Starting PowerShell process...');
  
  const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
  
  mainWindow.webContents.send('log', 'PowerShell process started with PID: ' + ps.pid);
  
  ps.stdout.on('data', (data) => {
    mainWindow.webContents.send('ps-output', data.toString());
  });
  
  ps.stderr.on('data', (data) => {
    mainWindow.webContents.send('ps-error', data.toString());
  });
  
  ps.on('close', (code) => {
    mainWindow.webContents.send('log', 'PowerShell process closed with code: ' + code);
    try {
      fs.unlinkSync(scriptPath);
      mainWindow.webContents.send('log', 'Temp script deleted');
    } catch (e) {
      mainWindow.webContents.send('log', 'Error deleting temp script: ' + e.message);
    }
    mainWindow.webContents.send('log', 'Sending reply...');
    if (code === 0) {
      event.reply('clicker-complete');
    } else {
      event.reply('clicker-error', `Exit code: ${code}`);
    }
  });
  
  ps.on('error', (err) => {
    mainWindow.webContents.send('log', 'PowerShell process error: ' + err);
    event.reply('clicker-error', err.message);
  });
});

ipcMain.on('start-clicker-infinite', (event) => {
  mainWindow.webContents.send('log', 'IPC start-clicker-infinite received');
  
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
    mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0, 0, 0, 0);
    Thread.Sleep(random.Next(5, 10));
    
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Thread.Sleep(random.Next(20, 35));
    
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Thread.Sleep(random.Next(5, 10));
  }
  
  public static void ClickWithDelay() {
    Click();
    Thread.Sleep(random.Next(45, 65));
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

  const { spawn } = require('child_process');
  const os = require('os');
  
  mainWindow.webContents.send('log', 'Creating temp directory script...');
  const scriptPath = path.join(os.tmpdir(), 'clicker-infinite.ps1');
  mainWindow.webContents.send('log', 'Script path: ' + scriptPath);
  fs.writeFileSync(scriptPath, powerShellScript);
  mainWindow.webContents.send('log', 'Script written successfully');

  mainWindow.webContents.send('log', 'Starting PowerShell process...');
  
  const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
  currentProcess = ps;
  
  mainWindow.webContents.send('log', 'PowerShell process started with PID: ' + ps.pid);
  
  ps.stdout.on('data', (data) => {
    mainWindow.webContents.send('ps-output', data.toString());
  });
  
  ps.stderr.on('data', (data) => {
    mainWindow.webContents.send('ps-error', data.toString());
  });
  
  ps.on('close', (code) => {
    mainWindow.webContents.send('log', 'PowerShell process closed with code: ' + code);
    if (currentProcess === ps) {
      currentProcess = null;
    }
    try {
      fs.unlinkSync(scriptPath);
      mainWindow.webContents.send('log', 'Temp script deleted');
    } catch (e) {
      mainWindow.webContents.send('log', 'Error deleting temp script: ' + e.message);
    }
    mainWindow.webContents.send('log', 'Sending reply...');
    event.reply('clicker-complete');
  });
  
  ps.on('error', (err) => {
    mainWindow.webContents.send('log', 'PowerShell process error: ' + err);
    if (currentProcess === ps) {
      currentProcess = null;
    }
    event.reply('clicker-error', err.message);
  });
});

ipcMain.on('stop-clicker', () => {
  mainWindow.webContents.send('log', 'Stop clicker requested');
  if (currentProcess) {
    mainWindow.webContents.send('log', 'Killing PowerShell process PID: ' + currentProcess.pid);
    currentProcess.kill('SIGTERM');
    currentProcess = null;
    mainWindow.webContents.send('clicker-stopped');
  } else {
    mainWindow.webContents.send('log', 'No active process to stop');
    mainWindow.webContents.send('clicker-stopped');
  }
});
