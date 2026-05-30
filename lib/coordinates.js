// Pure coordinate/interval logic for the renderer, extracted so it can be unit
// tested without a DOM. Loaded in the renderer via require() (nodeIntegration is
// enabled) and in tests via require() from test/.

const DEFAULT_INTERVAL = 5000;
const MIN_INTERVAL = 10;

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
// provided value is not a usable number (matches the old `parseInt() || 5000`).
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
};
