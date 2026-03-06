const { app, BrowserWindow, ipcMain } = require('electron');
const { exec, writeFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;

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
Write-Output "Starting clicker..."
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseClicker {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }
  
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)]
    public MOUSEINPUT mi;
  }
  
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  
  [DllImport("user32.dll")]
  private static extern int GetSystemMetrics(int nIndex);
  
  public const uint INPUT_MOUSE = 0;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const int SM_CXSCREEN = 0;
  public const int SM_CYSCREEN = 1;
  
  public static void Click() {
    POINT cursorPos;
    GetCursorPos(out cursorPos);
    
    int screenWidth = GetSystemMetrics(SM_CXSCREEN);
    int screenHeight = GetSystemMetrics(SM_CYSCREEN);
    
    INPUT[] inputs = new INPUT[2];
    
    inputs[0] = new INPUT();
    inputs[0].type = INPUT_MOUSE;
    inputs[0].u.mi.dx = (cursorPos.X * 65535) / screenWidth;
    inputs[0].u.mi.dy = (cursorPos.Y * 65535) / screenHeight;
    inputs[0].u.mi.dwFlags = MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE;
    
    inputs[1] = new INPUT();
    inputs[1].type = INPUT_MOUSE;
    inputs[1].u.mi.dx = (cursorPos.X * 65535) / screenWidth;
    inputs[1].u.mi.dy = (cursorPos.Y * 65535) / screenHeight;
    inputs[1].u.mi.dwFlags = MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE;
    
    uint result = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@

Write-Output "Clicker class loaded"
$startTime = Get-Date
$count = 0
while ((Get-Date) -lt $startTime.AddSeconds(10)) {
  try {
    [MouseClicker]::Click()
    $count++
    if ($count % 10 -eq 0) {
      Write-Output "Clicked $count times"
    }
  } catch {
    Write-Output "Error: $_"
  }
  Start-Sleep -Milliseconds 10
}
Write-Output "Done. Total clicks: $count"
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
