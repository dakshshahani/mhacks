import test from "node:test";
import assert from "node:assert/strict";
import { createEmaSmoother } from "./smoothing.js";

test("smooths normal movement and clamps a large jump", () => {
  const smoother = createEmaSmoother(0.5, 100);
  assert.deepEqual(smoother.update({ x: 10, y: 20 }), { x: 10, y: 20 });
  assert.deepEqual(smoother.update({ x: 20, y: 40 }), { x: 15, y: 30 });
  assert.deepEqual(smoother.update({ x: 1015, y: 30 }), { x: 65, y: 30 });
});
