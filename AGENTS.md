# Agent Guidelines for Clicker App

## Project Overview

Electron-based auto-clicker using PowerShell SendInput API. Two processes:

- **Main Process** (`main.js`): Spawns PowerShell scripts, manages IPC
- **Renderer Process** (`index.html`): UI, displays logs, sends commands

**Features**: Mouse-only mode (~30ms/click), hybrid mode (click + configurable key set, 84 keys by default, in 4 SendInput batches with pre-allocated INPUT arrays), and mouse move with click (moves cursor through coordinates and clicks at each point, button disabled until coordinates are added). The renderer has a "Keys in cycle" toggle grid: every key can be enabled/disabled (defaults: F and R off — they break Bongo Cat), the choice persists in localStorage and is sent per-run via the `excludedKeys` IPC field; the grid locks and collapses while a run is active (changes apply from the next run). Menu bar removed. All keys and processes are released on app close.

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
extra deps; CI runs it too). The hybrid clicker key set lives in
`lib/hybrid-keys.js`; `test/hybrid-keys.test.js` asserts no key from
`FORBIDDEN_KEYS` can creep back into it. Electron-specific main/renderer flows are still
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
// Default: 110 actions/cycle (1 click + 84 keys + shift + 24 alpha) — varies with
// the user's exclusion list. Scripts are built per run by buildHybrid*Script():
// the effective set comes from effectiveKeys(excludedKeys) in lib/hybrid-keys.js.
// Key universe = ALL_KEYS (86 codes) = HYBRID_KEYS (84, the default set) + F + R.
// F and R are excluded by DEFAULT (they break Bongo Cat, issues #2/#7) but the
// user may re-enable them via the toggle grid — their presence in ALL_KEYS is
// deliberate. HYBRID_KEYS itself must still never contain a FORBIDDEN_KEYS
// entry, asserted by test/hybrid-keys.test.js:
// NEVER add F1-F12 (0x70-0x7B) — they break the game (hard ban, see below)
```

---

## Configuration & Security

**BrowserWindow**: `nodeIntegration: false, contextIsolation: true`, with `preload.js`
exposing a narrow `window.electronAPI` (via `contextBridge`) for IPC and the
`lib/coordinates.js` / `lib/hybrid-keys.js` helpers. The renderer must never call
`require()` or touch `ipcRenderer` directly.

**Security warnings**:

- Never shell-escape user input
- Validate all IPC data
- Keep `window.electronAPI` narrowly scoped: expose only the specific operations the
  UI needs, never raw `ipcRenderer` or `require`

**Git**: Never commit `dist/`, `node_modules/`, `*.exe`, `*.log`, `*.asar`

**ESLint Configuration**: NEVER modify `.eslintrc.js` without explicit user permission. Linting rules are project configuration and must not be changed automatically.

**CRITICAL: Git operations**: NEVER commit or push without explicit user permission. Always ask before running `git commit` or `git push`.

**CRITICAL: F1-F12 keys**: NEVER add F1-F12 keys (0x70-0x7B) to the hybrid clicker. They break the game (Bongo Cat). This is a hard ban. They are outside ALL_KEYS on purpose — keep it that way.

**F/R keys**: F (0x46) and R (0x52) are NOT hard-banned anymore — they are default-excluded (Bongo Cat issues #2/#7) and user-toggleable via the "Keys in cycle" grid. Keep them out of `HYBRID_KEYS` (the default set) and out of `DEFAULT_EXCLUDED_CODES`' complement — i.e. the default behavior must always exclude them.

**Debugging**: Main process logs go to renderer via `mainWindow.webContents.send("log", msg)`. DevTools: `Ctrl+Shift+I`
