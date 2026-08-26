const test = require("node:test");
const assert = require("node:assert/strict");
const keys = require("../lib/hybrid-keys.js");

test("no forbidden key is in the hybrid key set", () => {
  for (const forbidden of keys.FORBIDDEN_KEYS) {
    assert.equal(
      keys.HYBRID_KEYS.includes(forbidden.code),
      false,
      `${forbidden.name} (0x${forbidden.code.toString(16)}) must stay out: ${forbidden.reason}`
    );
  }
});

test("F is forbidden — it flips the cat in Bongo Cat (issue #7)", () => {
  const f = keys.FORBIDDEN_KEYS.find((k) => k.code === 0x46);
  assert.ok(f, "0x46 must be listed in FORBIDDEN_KEYS");
  assert.equal(keys.HYBRID_KEYS.includes(0x46), false);
  assert.equal(keys.HYBRID_ALPHA_KEYS.includes(0x46), false);
});

test("R is still forbidden — it rotates the cat (issue #2)", () => {
  assert.ok(keys.FORBIDDEN_KEYS.some((k) => k.code === 0x52));
  assert.equal(keys.HYBRID_KEYS.includes(0x52), false);
});

test("F1-F12 are still forbidden", () => {
  for (let code = 0x70; code <= 0x7b; code++) {
    assert.ok(
      keys.FORBIDDEN_KEYS.some((k) => k.code === code),
      `0x${code.toString(16)} must be listed in FORBIDDEN_KEYS`
    );
    assert.equal(keys.HYBRID_KEYS.includes(code), false);
  }
});

test("the hybrid key set has no duplicates", () => {
  assert.equal(new Set(keys.HYBRID_KEYS).size, keys.HYBRID_KEYS.length);
});

test("every key fits in the byte keybd_event/SendInput expects", () => {
  for (const code of keys.HYBRID_KEYS) {
    assert.ok(
      Number.isInteger(code) && code > 0x00 && code <= 0xff,
      `0x${code.toString(16)} is not a valid virtual-key byte`
    );
  }
});

test("alpha keys are exactly the A-Z entries of the hybrid set", () => {
  assert.deepEqual(
    keys.HYBRID_ALPHA_KEYS,
    keys.HYBRID_KEYS.filter((k) => k >= 0x41 && k <= 0x5a)
  );
  // A-Z minus R and F
  assert.equal(keys.HYBRID_ALPHA_KEYS.length, 24);
});
