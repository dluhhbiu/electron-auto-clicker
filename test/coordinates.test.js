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
