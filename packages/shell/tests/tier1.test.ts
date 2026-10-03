// Tier-1 renderer: each EditOp produces the correct class/text change.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyTier1Edit, isTier1Executable } from "../src/tier1";

const HERO = `<div className="hero p-4"><h1 className="text-2xl">Hello</h1><button className="rounded-md bg-muted">Go</button></div>`;

describe("tier1 renderer", () => {
  it("set-color swaps token class", () => {
    const out = applyTier1Edit(HERO, { op: "set-color", param: "brand" });
    assert.match(out, /bg-brand/);
  });

  it("set-radius swaps rounded class", () => {
    const out = applyTier1Edit(`<button className="rounded-md bg-muted">Go</button>`, { op: "set-radius", param: "full" });
    assert.match(out, /rounded-full/);
    assert.doesNotMatch(out, /rounded-md/);
  });

  it("set-spacing swaps padding/gap group", () => {
    const out = applyTier1Edit(HERO, { op: "set-spacing", param: "loose" });
    assert.match(out, /p-8/);
    assert.match(out, /gap-8/);
  });

  it("set-align swaps text-align", () => {
    const out = applyTier1Edit(`<p className="text-left">x</p>`, { op: "set-align", param: "center" });
    assert.match(out, /text-center/);
    assert.doesNotMatch(out, /text-left/);
  });

  it("hide adds hidden once", () => {
    const once = applyTier1Edit(`<div className="hero">x</div>`, { op: "hide", param: null });
    assert.match(once, /hidden/);
    const twice = applyTier1Edit(once, { op: "hide", param: null });
    assert.equal(twice.match(/hidden/g)?.length, 1);
  });

  it("swap-text replaces inner text", () => {
    const out = applyTier1Edit(`<h1 className="t">Hello</h1>`, { op: "swap-text", param: "New headline" });
    assert.match(out, /New headline/);
    assert.doesNotMatch(out, /Hello/);
  });

  it("closure mirror: executable iff in catalog", () => {
    assert.equal(isTier1Executable("set-color", "brand"), true);
    assert.equal(isTier1Executable("set-color", "chartreuse"), false);
    assert.equal(isTier1Executable("set-align", "center"), true);
    assert.equal(isTier1Executable("hide", null), true);
    assert.equal(isTier1Executable("swap-text", ""), false);
    assert.equal(isTier1Executable("bogus", "x"), false);
  });
});
