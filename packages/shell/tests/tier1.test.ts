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

  it("set-weight swaps font weight without stacking", () => {
    const out = applyTier1Edit(`<p className="font-normal">x</p>`, { op: "set-weight", param: "bold" });
    assert.match(out, /font-bold/);
    assert.doesNotMatch(out, /font-normal/);
    const twice = applyTier1Edit(`<p className="font-semibold">x</p>`, { op: "set-weight", param: "bold" });
    assert.match(twice, /font-bold/);
    assert.doesNotMatch(twice, /font-semibold/);
    assert.ok(isTier1Executable("set-weight", "bold"));
    assert.ok(!isTier1Executable("set-weight", "black"));
  });

  it("set-size swaps text size without stacking", () => {
    const out = applyTier1Edit(`<p className="text-2xl">x</p>`, { op: "set-size", param: "sm" });
    assert.match(out, /text-sm/);
    assert.doesNotMatch(out, /text-2xl/);
    assert.ok(isTier1Executable("set-size", "lg"));
    assert.ok(!isTier1Executable("set-size", "huge"));
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

  it("set-color scopes to the target source line, siblings untouched", () => {
    const file = [
      `<div className="hero bg-muted" data-source="Hero.tsx:1">`,
      `  <h1 className="text-2xl" data-source="Hero.tsx:2">Hello</h1>`,
      `  <button className="rounded-md bg-muted" data-source="Hero.tsx:4">Go</button>`,
      `</div>`,
    ].join("\n");
    const out = applyTier1Edit(file, { op: "set-color", param: "brand" }, { sourceLine: 3 });
    const lines = out.split("\n");
    assert.match(lines[0] as string, /bg-muted/);
    assert.match(lines[1] as string, /text-2xl/);
    assert.match(lines[2] as string, /bg-brand/);
    assert.doesNotMatch(lines[2] as string, /bg-muted/);
  });

  it("swap-text scopes to the target line only", () => {
    const file = `<div>Hello</div>\n<p>Bye</p>`;
    const out = applyTier1Edit(file, { op: "swap-text", param: "Hi" }, { sourceLine: 2 });
    assert.match(out.split("\n")[0] as string, /Hello/);
    assert.match(out.split("\n")[1] as string, /Hi/);
  });

  it("out-of-range or missing line falls back to first match", () => {
    const file = `<div className="a">x</div>`;
    assert.match(
      applyTier1Edit(file, { op: "set-color", param: "brand" }, { sourceLine: 99 }),
      /bg-brand/,
    );
    assert.match(applyTier1Edit(file, { op: "set-color", param: "brand" }), /bg-brand/);
  });

  it("closure mirror: executable iff in catalog", () => {
    assert.equal(isTier1Executable("set-color", "brand"), true);
    assert.equal(isTier1Executable("set-color", "chartreuse"), false);
    assert.equal(isTier1Executable("set-align", "center"), true);
    assert.equal(isTier1Executable("hide", null), true);
    assert.equal(isTier1Executable("swap-text", ""), false);
    assert.equal(isTier1Executable("bogus", "x"), false);
  });

  it("unknown op throws instead of returning undefined (exhaustiveness)", () => {
    assert.throws(
      () => applyTier1Edit(`<div>x</div>`, { op: "nope", param: "x" } as never),
      /unhandled EditOp/,
    );
  });
});
