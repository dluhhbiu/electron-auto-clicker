# Agent Guidelines for Clicker App

## Project Overview

Electron-based auto-clicker using PowerShell SendInput API. Two processes:

- **Main Process** (`main.js`): Spawns PowerShell scripts, manages IPC
- **Renderer Process** (`index.html`): UI, displays logs, sends commands

**Features**: Mouse-only mode (~30ms/click), hybrid mode (click + 111 keys in 4 SendInput batches with pre-allocated INPUT arrays, ~8700 actions/10sec), and mouse move with click (moves cursor through coordinates and clicks at each point, button disabled until coordinates are added). Menu bar removed. All keys and processes are released on app close.

## Validation Rules (CRITICAL)

Before declaring task complete, ALWAYS run:

```bash
node --check main.js        # Check syntax
npm run lint                # Must pass with no errors
npm run format:check        # Optional format check (read-only)
```

Never mark complete if lint/syntax errors exist. Fix first, then report success. Exception: Non-code tasks (docs, git ops).

**CRITICAL: ESLint Configuration** - NEVER modify `.eslintrc.js` without explicit user permission. Linting rules are project configuration and must not be changed automatically.

---

## Commands

```bash
npm start                   # Run app in dev mode
npm run build-win           # Full build: Windows .exe + runtime (работает из Linux)
npm run rebuild-asar        # Quick rebuild: только перепаковка кода в app.asar
npm run lint                # Check for errors
npm run lint:fix            # Auto-fix errors
npm run format              # Format all files (writes)
npm run format:check        # Check formatting (read-only, used by CI)
npm test                    # Run unit tests (node --test)
```

**Testing**: Pure coordinate logic (renderer UI helpers + main-process IPC
validation via `sanitizeCoordinates`) lives in `lib/coordinates.js` and is
covered by `test/coordinates.test.js` via the built-in `node --test` runner (no
extra deps; CI runs it too). Electron-specific main/renderer flows are still
untested — consider electron-mock / Playwright if expanding coverage.

---

## Windows Build

### Полная сборка (первый раз или после обновления Electron)

```bash
npm run build-win           # Создаёт dist/win-unpacked/ с ClickerApp.exe и runtime
```

Работает из Linux. Ошибка про Wine/иконку в конце — **некритична**, сборка готова. **Wine устанавливать НЕ нужно** — ошибка означает лишь то, что не удалось обновить иконку exe-файла, сам билд полностью рабочий. Создаёт `dist/win-unpacked/ClickerApp.exe` (~213 МБ) с bundled Electron runtime.

### Быстрая пересборка (после изменений в коде)

```bash
npm run rebuild-asar        # Перепаковывает main.js, index.html, lib/ и т.д. в app.asar
```

Используй это после правок кода — не нужна полная пересборка, только обновление `dist/win-unpacked/resources/app.asar`.

**ВАЖНО**: После любых изменений в коде всегда запускай `npm run rebuild-asar` перед тестированием .exe.

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

| Direction     | Channel                         | Purpose                     |
| ------------- | ------------------------------- | --------------------------- |
| Renderer→Main | `start-clicker`                 | Start mouse-only 10s        |
| Renderer→Main | `start-clicker-infinite`        | Start mouse-only until ESC  |
| Renderer→Main | `start-hybrid-clicker`          | Start hybrid 10s            |
| Renderer→Main | `start-hybrid-clicker-infinite` | Start hybrid until ESC      |
| Renderer→Main | `start-moving-mouse`            | Start mouse move with click |
| Renderer→Main | `stop-clicker`                  | Stop active process         |
| Main→Renderer | `log`                           | Main process logs           |
| Main→Renderer | `ps-output`                     | PowerShell stdout           |
| Main→Renderer | `ps-error`                      | PowerShell stderr           |
| Main→Renderer | `clicker-complete`              | Success notification        |
| Main→Renderer | `clicker-error`                 | Error with message          |
| Main→Renderer | `clicker-stopped`               | Stop notification           |

---

## Process Architecture

**Main Process** (`main.js`):

- Handle OS ops via `child_process.spawn()`
- Manage PowerShell scripts in temp directory
- Send logs/messages to the renderer via the `sendToRenderer(channel, ...args)` helper (guards against a destroyed window); avoid calling `mainWindow.webContents.send()` directly

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
ps.on("close", () => {
  try {
    fs.unlinkSync(scriptPath);
  } catch {
    // temp file already gone — no-empty requires a comment, не пустой блок
  }
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
[DllImport("user32.dll", SetLastError = true)]
public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
// SENDINPUT_TYPES constant in main.js defines INPUT/KEYBDINPUT/MOUSEINPUT structs
// Pre-allocated arrays: batch1Press, batch1Release, batch2Press, batch2Release

// Uses SendInput API with pre-allocated INPUT[] arrays (4 small batches):
// batch1Press (mouse+keys), batch1Release, batch2Press (shift+alpha), batch2Release
// Each batch sent via single SendInput call, Sleep(15)/Sleep(10) between batches
// Total: ~8700 actions per 10 seconds (112 actions/cycle: 1 click + 85 keys + shift + 25 alpha)
// NEVER add F1-F12 (0x70-0x7B) — they break the game
// NEVER add R (0x52) — it rotates the cat in Bongo Cat (issue #2)
```

---

## Configuration & Security

**BrowserWindow**: `nodeIntegration: true, contextIsolation: false` for inline scripts

**Security warnings**:

- These settings are for local utility apps only
- Never shell-escape user input
- Validate all IPC data

**Git**: Never commit `dist/`, `node_modules/`, `*.exe`, `*.log`, `*.asar`

**ESLint Configuration**: NEVER modify `.eslintrc.js` without explicit user permission. Linting rules are project configuration and must not be changed automatically.

**CRITICAL: Git operations**: NEVER commit or push without explicit user permission. Always ask before running `git commit` or `git push`.

**CRITICAL: F1-F12 keys**: NEVER add F1-F12 keys (0x70-0x7B) to the hybrid clicker. They break the game (Bongo Cat). This is a hard ban.

**Debugging**: Main process logs go to renderer via `mainWindow.webContents.send("log", msg)`. DevTools: `Ctrl+Shift+I`
