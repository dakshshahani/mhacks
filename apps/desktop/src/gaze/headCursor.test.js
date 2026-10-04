import test from "node:test";
import assert from "node:assert/strict";
import { createHeadCursor } from "./headCursor.js";

const viewport = { width: 1000, height: 800 };

test("calibrates at the first face position and maps later movement", () => {
  const cursor = createHeadCursor({ deadzone: 0, verticalGain: 1, horizontalGain: 1, invertX: false });
  assert.deepEqual(cursor.map({ x: 0.5, y: 0.5 }, viewport).point, { x: 500, y: 400 });
  assert.deepEqual(cursor.map({ x: 0.6, y: 0.5 }, viewport).rawPoint, { x: 600, y: 400 });
});

test("recenters and preserves calibration across a detector dropout", () => {
  const cursor = createHeadCursor({ deadzone: 0, verticalGain: 1, horizontalGain: 1, invertX: false });
  cursor.map({ x: 0.5, y: 0.5 }, viewport);
  cursor.map({ x: 0.55, y: 0.5 }, viewport);
  assert.equal(cursor.map(null, viewport), null);
  assert.ok(cursor.map({ x: 0.6, y: 0.5 }, viewport).rawPoint.x > 500);
  assert.deepEqual(cursor.recenter({ x: 0.6, y: 0.5 }, viewport).point, { x: 500, y: 400 });
});
