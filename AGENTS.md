# Agent Guidelines for Clicker App

## Project Overview

Electron-based auto-clicker using PowerShell SendInput API. Two processes:

- **Main Process** (`main.js`): Spawns PowerShell scripts, manages IPC
- **Renderer Process** (`index.html`): UI, displays logs, sends commands

**Features**: Mouse-only mode (~70ms/click) and hybrid mode (click + 4 arrow keys simultaneously).

## Validation Rules (CRITICAL)

Before declaring task complete, ALWAYS run:

```bash
node --check main.js        # Check syntax
npm run lint                # Must pass with no errors
npm run format -- --check   # Optional format check
```

Never mark complete if lint/syntax errors exist. Fix first, then report success. Exception: Non-code tasks (docs, git ops).

---

## Commands

```bash
npm start                   # Run app in dev mode
npm run build-win           # Build Windows .exe (requires Windows)
npm run lint                # Check for errors
npm run lint:fix            # Auto-fix errors
npm run format              # Format all files
```

**Testing**: Not configured. Add Jest + electron-mock for main process, Playwright for renderer.

---

## Windows Build

**On Windows**:

```bash
npm run build-win           # Build portable .exe in dist/
```

Creates `dist/win-unpacked/ClikerApp.exe` with bundled Electron runtime.

**Electron Builder config** (`package.json`):

```json
{
  "build": {
    "appId": "com.clicker.app",
    "productName": "ClickerApp",
    "win": {
      "target": "portable"
    }
  }
}
```

**Cross-platform build (Linux to Windows)**: NOT SUPPORTED - requires Wine. Users must build on Windows.

**Quick rebuild during development** (code changes only):

```bash
mkdir -p temp_pack && cp main.js index.html package.json .eslintrc.js temp_pack/ && npx asar pack temp_pack dist/win-unpacked/resources/app.asar && rm -rf temp_pack
```

---

## Code Style

**Module System**: CommonJS (require/module.exports), `"type": "commonjs"` in package.json

```javascript
const { app, BrowserWindow } = require("electron");
const path = require("path");
```

**Formatting** (ESLint + Prettier):

- Double quotes, 2-space indentation, trailing commas (es5)
- No console warnings, unused vars prefix with `_`
- Max line width: 100

**Naming**:

- Files: `kebab-case`, Classes: `PascalCase`
- Variables: `camelCase`, Constants: `UPPER_SNAKE_CASE`
- Functions: verb-first (`createWindow()`, `spawnPowerShell()`)
- IPC channels: action verbs (`start-clicker`, not `clicker`)

---

## IPC Communication

**Patterns**:

- Main→Renderer: `mainWindow.webContents.send('channel', data)`
- Renderer→Main: `ipcRenderer.send('channel', data)`
- Reply: `event.reply('channel', data)`

**Available channels**:

| Direction     | Channel                         | Purpose                    |
| ------------- | ------------------------------- | -------------------------- |
| Renderer→Main | `start-clicker`                 | Start mouse-only 10s       |
| Renderer→Main | `start-clicker-infinite`        | Start mouse-only until ESC |
| Renderer→Main | `start-hybrid-clicker`          | Start hybrid 10s           |
| Renderer→Main | `start-hybrid-clicker-infinite` | Start hybrid until ESC     |
| Renderer→Main | `stop-clicker`                  | Stop active process        |
| Main→Renderer | `log`                           | Main process logs          |
| Main→Renderer | `ps-output`                     | PowerShell stdout          |
| Main→Renderer | `ps-error`                      | PowerShell stderr          |
| Main→Renderer | `clicker-complete`              | Success notification       |
| Main→Renderer | `clicker-error`                 | Error with message         |
| Main→Renderer | `clicker-stopped`               | Stop notification          |

---

## Process Architecture

**Main Process** (`main.js`):

- Handle OS ops via `child_process.spawn()`
- Manage PowerShell scripts in temp directory
- Send logs via `mainWindow.webContents.send()`

**Renderer Process** (inline script in `index.html`):

- Handle UI interactions via `ipcRenderer`
- Display logs, never run child processes

---

## File & Process Management

**Temporary files**: Use `os.tmpdir()`, clean up in `close` handler

```javascript
const scriptPath = path.join(os.tmpdir(), "script.ps1");
fs.writeFileSync(scriptPath, code);
const ps = spawn("powershell", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
  windowsHide: true,
});
ps.on("close", (code) => {
  try {
    fs.unlinkSync(scriptPath);
  } catch (e) {}
});
```

**Child process**: Prefer `spawn()` over `exec()`, handle all events: `close`, `error`, `stdout`, `stderr`

**Error handling**: Wrap risky IPC ops in try-catch, send errors to renderer

```javascript
try {
  // risky operation
} catch (err) {
  event.reply("clicker-error", err.message);
}
```

---

## PowerShell Scripts

Embed as template strings, use heredoc for multi-line C#, include `Write-Output` for logging.

**Hybrid clicker pattern** (C# inside PowerShell):

```csharp
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
public const uint KEYEVENTF_KEYUP = 0x0002;
public const byte VK_UP = 0x26;
public const byte VK_DOWN = 0x28;
public const byte VK_LEFT = 0x25;
public const byte VK_RIGHT = 0x27;

// Press all 4 arrow keys simultaneously
keybd_event(VK_UP, 0, 0, 0);
keybd_event(VK_DOWN, 0, 0, 0);
keybd_event(VK_LEFT, 0, 0, 0);
keybd_event(VK_RIGHT, 0, 0, 0);
Thread.Sleep(30);
// Release all
keybd_event(VK_UP, 0, KEYEVENTF_KEYUP, 0);
//... repeat for other keys
```

---

## Configuration & Security

**BrowserWindow**: `nodeIntegration: true, contextIsolation: false` for inline scripts

**Security warnings**:

- These settings are for local utility apps only
- Never shell-escape user input
- Validate all IPC data

**Git**: Never commit `dist/`, `node_modules/`, `*.exe`, `*.log`, `*.asar`

**CRITICAL: Git operations**: NEVER commit or push without explicit user permission. Always ask before running `git commit` or `git push`.

**Debugging**: Main process logs go to renderer via `mainWindow.webContents.send("log", msg)`. DevTools: `Ctrl+Shift+I`
