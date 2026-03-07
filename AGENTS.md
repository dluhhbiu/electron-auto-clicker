# Agent Guidelines for Clicker App

## Project Overview

This is an Electron-based auto-clicker application that uses PowerShell scripts via SendInput API for mouse clicks. The app has two processes:

- **Main Process**: Node.js backend (`main.js`) that spawns PowerShell scripts
- **Renderer Process**: UI (`index.html`) that communicates with main via IPC

## Validation Before Task Completion

CRITICAL: Before declaring a task complete, ALWAYS run these validations:

```bash
# 1. Check JS syntax
node --check main.js

# 2. Run ESLint (must pass with no errors)
npm run lint

# 3. Format check (optional, but recommended)
npm run format -- --check
```

**Rules:**
- Never mark task as complete if lint errors exist
- Never mark task as complete if syntax errors exist
- If either fails, fix the issues BEFORE reporting completion
- Only report success AFTER all validations pass

**Exception:** If task doesn't involve code changes (e.g., readme updates, git operations), validation may be skipped.

---

## Build & Development Commands

```bash
# Development
npm start              # Run Electron app in development mode

# Build
npm run build-win      # Build Windows executable (requires Windows/wine)
npx electron-builder --win --dir  # Build without packaging (Linux/WSL)
```

### Testing

⚠️ **No tests configured** - The project currently has no test framework. When adding tests, prefer:

- Main process: Jest with `electron-mock` or similar
- Renderer process: Playwright or Jest with jsdom
- Integration: Custom test scripts that verify PowerShell execution

### Linting

✅ **ESLint + Prettier configured**

Run before committing:
```bash
npm run lint          # Check for errors
npm run lint:fix      # Auto-fix errors
npm run format        # Format all files
```

Rules:
- Use CommonJS (require/module.exports)
- Double quotes for strings
- 2 spaces for indentation
- No nodeIntegration warnings disable
- Allow console.log for debugging IPC communication
- Handle unused variables (prefix with _ if intentional)

## Code Style Guidelines

### Module System

- **CommonJS only** - Use `require()` and `module.exports`
- No ES modules (`import/export`) - `"type": "commonjs"` in package.json

```javascript
const { app, BrowserWindow } = require("electron");
const path = require("path");

module.exports = { something };
```

### Process Architecture

#### Main Process (main.js)

- Handles OS-level operations (child processes, file I/O, API calls)
- Uses `BrowserWindow` for UI
- Manages PowerShell script execution via `child_process.spawn`
- Sends logs to renderer via `mainWindow.webContents.send()`

```javascript
ipcMain.on("channel", (event, data) => {
  mainWindow.webContents.send("log", "message");
  event.reply("response-channel", result);
});
```

#### Renderer Process (index.html script)

- Handles UI interactions and displayslogs
- Uses `ipcRenderer` for communication
- Never execute child processes or file operations here

```javascript
const { ipcRenderer } = require("electron");

ipcRenderer.on("log", (event, message) => {
  console.log(message);
});

ipcRenderer.send("action", data);
```

### IPC Communication Patterns

- Main → Renderer: `mainWindow.webContents.send('channel-name', data)`
- Renderer → Main: `ipcRenderer.send('channel-name', data)`
- Main → Renderer (reply): `event.reply('channel-name', data)`
- Use consistent prefixing for related channels (e.g., `clicker-*`, `log-*`)

### File Operations

- Use `os.tmpdir()` for temporary PowerShell scripts
- Always clean up temp files in process cleanup handlers
- Use `path.join()` for cross-platform path construction

```javascript
const scriptPath = path.join(os.tmpdir(), "script.ps1");
fs.writeFileSync(scriptPath, content);
// ... later in cleanup
try {
  fs.unlinkSync(scriptPath);
} catch (e) {}
```

### Child Process Execution

- Prefer `spawn()` over `exec()` for better control (no shell escaping issues)
- Set `windowsHide: true` to hide PowerShell windows on Windows
- Handle all three events: `close`, `error`, and `data` (stdout/stderr)

```javascript
const ps = spawn("powershell.exe", ["-File", scriptPath], { windowsHide: true });
ps.stdout.on("data", (data) => {
  /* handle output */
});
ps.stderr.on("data", (data) => {
  /* handle errors */
});
ps.on("close", (code) => {
  /* cleanup */
});
ps.on("error", (err) => {
  /* handle spawn failure */
});
```

### Error Handling

- Wrap risky operations in try-catch blocks in IPC handlers
- Never let async errors crash the main process
- Send errors back to renderer for user feedback
- Use error messages that are actionable for users

```javascript
try {
  // risky operation
} catch (err) {
  event.reply("error-channel", err.message);
}
```

### Naming Conventions

- **Files**: `kebab-case` for files, `PascalCase` for classes/scripts
- **Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **IPC channels**: Use action verbs (`start-clicker`, `send-log`, not just `clicker`, `log`)
- **Functions**: Verb-first (`createWindow()`, `spawnPowerShell()`, not `window()`, `ps()`)

### PowerShell Scripts

- Embed PowerShell scripts as template strings in commonjs files
- Use `Add-Type -TypeDefinition @'...'@` heredoc syntax for multi-line code
- Include `Write-Output` statements for logging (captured via stdout)
- Handle exceptions in PowerShell: `try { ... } catch { Write-Output "Error: $_" }`

```javascript
const ps1Code = `
Write-Output "Starting..."
Add-Type -TypeDefinition @'
  $code
'@
`;
```

### BrowserWindow Configuration

- Set `nodeIntegration: true, contextIsolation: false` for inline scripts
- Keep window small (400x300) for utility apps
- Open DevTools in development: `mainWindow.webContents.openDevTools()`

### Git Workflow

- Never commit: `dist/`, `node_modules/`, `*.exe`, `*.log`, `*.asar`
- Commit source files only
- Use concise commit messages with clear intent

### Debugging

- All `console.log()` in main process should send to renderer for visibility
- Use `Ctrl+Shift+I` to open DevTools in production builds
- Include process state in logs (PID, script paths, exit codes)

### Security Notes

- ⚠️ `nodeIntegration: true` and `contextIsolation: false` are security risks
- Only enable for local utility apps, not for internet-connected applications
- Never shell-escape user input in PowerShell scripts
- Validate all data received from IPC before use

## Common Patterns

### Temporary File Pattern with Cleanup

```javascript
const scriptPath = path.join(os.tmpdir(), "script.ps1");
fs.writeFileSync(scriptPath, code);

const ps = spawn("powershell", ["-File", scriptPath]);
ps.on("close", (code) => {
  try {
    fs.unlinkSync(scriptPath);
  } catch (e) {}
  // handle completion
});
```

### Logging Across Processes

```javascript
// Main process
mainWindow.webContents.send("log", "message");

// Renderer process
ipcRenderer.on("log", (event, msg) => console.log(msg));
```
