import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Loads the browser probe (plain IIFE, no imports) into a fake DOM so the
// candidate-priority rules are testable in node. Regression cover for: with
// head tracking the radius sweep floods the pool and the 5-cap used to keep
// the shallowest containers, dropping the gazed button so only its parent
// Card could ever lock.

const here = path.dirname(fileURLToPath(import.meta.url));
const probeSrc = fs.readFileSync(path.join(here, "..", "probe.js"), "utf8");

function makeEl({ tag, rect, order, parent = null, id = "", text = "" }) {
  const el = {
    __order: order,
    tagName: tag,
    nodeType: 1,
    id,
    className: "",
    textContent: text,
    outerHTML: `<${tag.toLowerCase()}>${text}</${tag.toLowerCase()}>`,
    parentElement: parent,
    children: [],
    closest: () => null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.w,
      bottom: rect.y + rect.h,
    }),
    compareDocumentPosition: (other) =>
      el.__order < other.__order ? 4 : 2,
  };
  if (parent && Array.isArray(parent.children)) parent.children.push(el);
  return el;
}

function loadProbe({ hits, all }) {
  const body = {};
  const sandbox = {
    document: {
      body,
      elementsFromPoint: () => hits,
      querySelectorAll: () => all,
      addEventListener: () => {},
    },
    window: {
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
      }),
      addEventListener: () => {},
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(probeSrc, sandbox);
  return sandbox.window.__gazeProbe;
}

// Card page: the Learn More button sits 8th in DOM order. The gaze point is
// exactly on it; every pool element is within the head-tracking radius.
function cardPage() {
  const body = {};
  const page = makeEl({ tag: "DIV", rect: { x: 0, y: 0, w: 1200, h: 2000 }, order: 0, parent: body });
  const header = makeEl({ tag: "HEADER", rect: { x: 0, y: 0, w: 1200, h: 80 }, order: 1, parent: page });
  const nav = makeEl({ tag: "NAV", rect: { x: 0, y: 80, w: 200, h: 100 }, order: 2, parent: page });
  const section = makeEl({ tag: "SECTION", rect: { x: 60, y: 60, w: 500, h: 500 }, order: 3, parent: page });
  const card = makeEl({ tag: "DIV", rect: { x: 80, y: 100, w: 400, h: 300 }, order: 4, parent: section });
  const h2 = makeEl({ tag: "H2", rect: { x: 100, y: 120, w: 200, h: 30 }, order: 5, parent: card, text: "Bounce Expression" });
  const p = makeEl({ tag: "P", rect: { x: 100, y: 160, w: 300, h: 30 }, order: 6, parent: card, text: "Create realistic bouncing effects." });
  const button = makeEl({ tag: "BUTTON", rect: { x: 100, y: 200, w: 120, h: 40 }, order: 7, parent: card, id: "learn-more", text: "Learn More" });
  // Browser hit order is deepest-first.
  return { hits: [button, card, section], all: [page, header, nav, section, card, h2, p, button], button };
}

test("radius sweep keeps the exact-hit button and locks it, not the Card", () => {
  const { hits, all } = cardPage();
  const probe = loadProbe({ hits, all });
  const frame = probe.queryElementAt(160, 220, 160);
  assert.ok(frame.candidates.length <= 5, `cap respected, got ${frame.candidates.length}`);
  const ids = frame.candidates.map((c) => c.selector);
  assert.ok(ids.includes("#learn-more"), `button survives truncation: ${ids.join(",")}`);
  assert.equal(frame.lockedTarget?.selector, "#learn-more");
});

test("deep exact stack keeps the gazed element when it exceeds the cap", () => {
  const body = {};
  let parent = body;
  const chain = [];
  for (let i = 0; i < 6; i++) {
    parent = makeEl({ tag: "DIV", rect: { x: 10, y: 10, w: 600, h: 600 }, order: i, parent });
    chain.push(parent);
  }
  const button = makeEl({ tag: "BUTTON", rect: { x: 20, y: 20, w: 100, h: 30 }, order: 6, parent, id: "deep-btn", text: "Go" });
  // Exact stack deepest-first, no radius.
  const probe = loadProbe({ hits: [button, ...chain.slice().reverse()], all: [] });
  const frame = probe.queryElementAt(30, 30, 0);
  assert.ok(frame.candidates.length <= 5);
  assert.ok(
    frame.candidates.some((c) => c.selector === "#deep-btn"),
    "deepest exact hit survives",
  );
  assert.equal(frame.lockedTarget?.selector, "#deep-btn");
});

test("click mode (radius 0) still locks the exact element", () => {
  const { hits, all } = cardPage();
  const probe = loadProbe({ hits, all });
  const frame = probe.queryElementAt(160, 220, 0);
  assert.equal(frame.lockedTarget?.selector, "#learn-more");
});
