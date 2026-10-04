import test from "node:test";
import assert from "node:assert/strict";
import { createDwellTracker } from "./dwell.js";

test("locks after dwell and resets when the target changes", () => {
  const dwell = createDwellTracker(500);
  assert.equal(dwell.update("first", 0).lockedId, null);
  assert.equal(dwell.update("first", 499).lockedId, null);
  assert.equal(dwell.update("first", 500).lockedId, "first");
  assert.equal(dwell.update("second", 501).lockedId, null);
});
