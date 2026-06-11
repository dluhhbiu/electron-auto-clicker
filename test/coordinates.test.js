const test = require("node:test");
const assert = require("node:assert/strict");
const coord = require("../lib/coordinates.js");

test("parseInterval parses integers and rejects non-numbers", () => {
  assert.equal(coord.parseInterval("5000"), 5000);
  assert.equal(coord.parseInterval(250), 250);
  assert.equal(coord.parseInterval("abc"), null);
  assert.equal(coord.parseInterval(""), null);
});

test("isValidInterval enforces the minimum", () => {
  assert.equal(coord.isValidInterval("5000"), true);
  assert.equal(coord.isValidInterval("10"), true);
  assert.equal(coord.isValidInterval("9"), false);
  assert.equal(coord.isValidInterval("abc"), false);
  assert.equal(coord.isValidInterval(""), false);
});

test("addCoordinate appends and uses the provided interval", () => {
  const next = coord.addCoordinate([], { x: 100, y: 200, interval: "3000" });
  assert.deepEqual(next, [{ x: 100, y: 200, interval: 3000 }]);
});

test("addCoordinate falls back to the default interval", () => {
  assert.equal(
    coord.addCoordinate([], { x: 1, y: 2, interval: "" })[0].interval,
    coord.DEFAULT_INTERVAL
  );
  // matches the old `parseInt() || 5000`: 0 is treated as falsy → default
  assert.equal(
    coord.addCoordinate([], { x: 1, y: 2, interval: 0 })[0].interval,
    coord.DEFAULT_INTERVAL
  );
});

test("addCoordinate does not mutate the input array", () => {
  const original = [{ x: 1, y: 1, interval: 1000 }];
  coord.addCoordinate(original, { x: 2, y: 2, interval: 2000 });
  assert.equal(original.length, 1);
});

test("replaceCoordinate keeps the existing interval", () => {
  const coords = [{ x: 1, y: 1, interval: 1000 }];
  const next = coord.replaceCoordinate(coords, 0, { x: 9, y: 9 });
  assert.deepEqual(next, [{ x: 9, y: 9, interval: 1000 }]);
});

test("replaceCoordinate ignores out-of-range indexes", () => {
  const coords = [{ x: 1, y: 1, interval: 1000 }];
  assert.equal(coord.replaceCoordinate(coords, 5, { x: 9, y: 9 }), coords);
  assert.equal(coord.replaceCoordinate(coords, -1, { x: 9, y: 9 }), coords);
});

test("removeCoordinate removes by index without mutating", () => {
  const coords = [
    { x: 1, y: 1, interval: 1000 },
    { x: 2, y: 2, interval: 2000 },
  ];
  const next = coord.removeCoordinate(coords, 0);
  assert.deepEqual(next, [{ x: 2, y: 2, interval: 2000 }]);
  assert.equal(coords.length, 2);
});

test("updateInterval applies valid intervals and rejects invalid ones", () => {
  const coords = [{ x: 1, y: 1, interval: 1000 }];
  assert.equal(coord.updateInterval(coords, 0, "2500")[0].interval, 2500);
  // invalid (< MIN_INTERVAL) → unchanged list returned
  assert.equal(coord.updateInterval(coords, 0, "5"), coords);
  assert.equal(coord.updateInterval(coords, 0, "abc"), coords);
});

test("getCoords returns the array or null when empty", () => {
  assert.equal(coord.getCoords([]), null);
  const coords = [{ x: 1, y: 1, interval: 1000 }];
  assert.equal(coord.getCoords(coords), coords);
});

// ── characterization tests: intentionally preserved legacy behavior ──

test("parseInterval truncates float strings like the old parseInt", () => {
  assert.equal(coord.parseInterval("10.5"), 10);
});

test("addCoordinate preserves legacy quirks for exotic numeric strings", () => {
  // `parseInt("1e3") || 5000` → 1: below MIN_INTERVAL but truthy, kept as-is
  assert.equal(coord.addCoordinate([], { x: 1, y: 2, interval: "1e3" })[0].interval, 1);
  // negative values are truthy too — min="10" on the input does not block typing
  assert.equal(coord.addCoordinate([], { x: 1, y: 2, interval: "-5" })[0].interval, -5);
});

// ── sanitizeCoordinates: main-process IPC validation ──

test("sanitizeCoordinates returns [] for non-array payloads", () => {
  assert.deepEqual(coord.sanitizeCoordinates(null), []);
  assert.deepEqual(coord.sanitizeCoordinates(undefined), []);
  assert.deepEqual(coord.sanitizeCoordinates("abc"), []);
  assert.deepEqual(coord.sanitizeCoordinates({ length: 1 }), []);
  assert.deepEqual(coord.sanitizeCoordinates(5), []);
});

test("sanitizeCoordinates truncates values to plain integers", () => {
  assert.deepEqual(coord.sanitizeCoordinates([{ x: "10.7", y: 20.2, interval: "5000" }]), [
    { x: 10, y: 20, interval: 5000 },
  ]);
});

test("sanitizeCoordinates drops non-numeric and malformed entries", () => {
  const input = [
    { x: "abc", y: 1, interval: 100 },
    { x: 1, y: {}, interval: 100 },
    { x: 1, y: 1 },
    null,
    "junk",
    { x: 5, y: 6, interval: 700 },
  ];
  assert.deepEqual(coord.sanitizeCoordinates(input), [{ x: 5, y: 6, interval: 700 }]);
});

test("sanitizeCoordinates clamps coordinates to the int32 range", () => {
  const [c] = coord.sanitizeCoordinates([{ x: 1e21, y: -1e21, interval: 100 }]);
  assert.deepEqual(c, { x: 2147483647, y: -2147483648, interval: 100 });
});

test("sanitizeCoordinates clamps the interval to [MIN_INTERVAL, int32 max]", () => {
  // Start-Sleep -Milliseconds binds to Int32 and rejects negatives: out-of-range
  // values would otherwise error on every loop iteration with no sleep at all.
  // The floor is MIN_INTERVAL (not 0) so a stray sub-minimum value (the UI
  // minimum is 10) can never turn the mover into a zero-sleep busy loop.
  const [c] = coord.sanitizeCoordinates([{ x: 1, y: 2, interval: 1e21 }]);
  assert.equal(c.interval, 2147483647);
  const [n] = coord.sanitizeCoordinates([{ x: 1, y: 2, interval: -5 }]);
  assert.equal(n.interval, coord.MIN_INTERVAL);
  const [z] = coord.sanitizeCoordinates([{ x: 1, y: 2, interval: 0 }]);
  assert.equal(z.interval, coord.MIN_INTERVAL);
});
