// Pure coordinate/interval logic, extracted so it can be unit tested without a
// DOM or Electron. Loaded in the renderer via require() (nodeIntegration is
// enabled), in the main process for IPC validation, and in tests from test/.

const DEFAULT_INTERVAL = 5000;
const MIN_INTERVAL = 10;
// SetCursorPos takes int32; Start-Sleep -Milliseconds binds to a non-negative
// Int32 — anything outside these ranges makes the PowerShell loop error forever.
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

// Parse an interval value; returns an integer, or null when not a number.
function parseInterval(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

// Whether an interval value is acceptable (numeric and >= MIN_INTERVAL).
function isValidInterval(value) {
  const n = parseInterval(value);
  return n !== null && n >= MIN_INTERVAL;
}

// Append a captured point. Interval falls back to DEFAULT_INTERVAL when the
// provided value is not a usable number. Mirrors the old `parseInt() || 5000`,
// except parseInt now gets an explicit radix 10, so hex strings like "0x1F" no
// longer parse — unreachable through the number input anyway.
function addCoordinate(coords, point) {
  const interval = parseInterval(point.interval) || DEFAULT_INTERVAL;
  return coords.concat([{ x: point.x, y: point.y, interval }]);
}

// Replace the position of an existing coordinate, keeping its interval.
function replaceCoordinate(coords, index, point) {
  if (index < 0 || index >= coords.length) return coords;
  const next = coords.slice();
  next[index] = { x: point.x, y: point.y, interval: next[index].interval };
  return next;
}

// Remove a coordinate by index.
function removeCoordinate(coords, index) {
  if (index < 0 || index >= coords.length) return coords;
  const next = coords.slice();
  next.splice(index, 1);
  return next;
}

// Update the interval of a coordinate. Returns the list unchanged when the
// interval is invalid (the caller surfaces the validation message).
function updateInterval(coords, index, value) {
  if (!isValidInterval(value)) return coords;
  if (index < 0 || index >= coords.length) return coords;
  const next = coords.slice();
  next[index] = { ...next[index], interval: parseInterval(value) };
  return next;
}

// Payload for the main process: the array, or null when empty.
function getCoords(coords) {
  return coords.length > 0 ? coords : null;
}

// Validate a coordinates payload received over IPC in the main process: only
// plain in-range integers may ever be interpolated into a PowerShell script.
// Non-array payloads yield [], malformed entries are dropped, surviving values
// are truncated and clamped into the ranges the generated script can handle.
function sanitizeCoordinates(coords) {
  if (!Array.isArray(coords)) return [];
  return coords
    .filter((c) => typeof c === "object" && c !== null)
    .map((c) => ({
      x: Math.trunc(Number(c.x)),
      y: Math.trunc(Number(c.y)),
      interval: Math.trunc(Number(c.interval)),
    }))
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.interval))
    .map((c) => ({
      x: Math.min(Math.max(c.x, INT32_MIN), INT32_MAX),
      y: Math.min(Math.max(c.y, INT32_MIN), INT32_MAX),
      // floor at MIN_INTERVAL, not 0: a stray sub-minimum interval must not
      // turn the PowerShell move loop into a zero-sleep busy loop
      interval: Math.min(Math.max(c.interval, MIN_INTERVAL), INT32_MAX),
    }));
}

module.exports = {
  DEFAULT_INTERVAL,
  MIN_INTERVAL,
  parseInterval,
  isValidInterval,
  addCoordinate,
  replaceCoordinate,
  removeCoordinate,
  updateInterval,
  getCoords,
  sanitizeCoordinates,
};
