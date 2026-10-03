// Preview + speech + BYOK: envelopes, state machine, sponsor badge.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PreviewHost, GAZE_OVERLAY_ATTR } from "../src/preview";
import { SpeechService, SPEECH_SPONSOR } from "../src/speech";
import { createMemoryKeyStore } from "../src/safeStorage";
import type { GazeFrame } from "@mhacks/contracts";

const FRAME: GazeFrame = {
  candidates: [
    {
      id: "c0",
      selector: "h1",
      componentName: "Hero",
      filePath: "Hero.tsx",
      boundingRect: { x: 10, y: 10, width: 200, height: 40 },
      outerHTMLSnippet: "<h1>Hi</h1>",
      htmlTruncated: false,
      confidence: 0.9,
      trackedConfidence: 0.95,
      supportedOps: [],
    },
  ],
  lockedTarget: null,
  capturedAt: 1,
};

describe("preview host", () => {
  it("cold start -> not-ready; crashing probe -> wv-gone; live probe passes through", async () => {
    assert.equal(GAZE_OVERLAY_ATTR, "data-gaze-overlay");
    const host = new PreviewHost();
    const cold = await host.queryElementAt(5, 5);
    assert.equal(cold.ok, false);
    if (cold.ok) return;
    assert.equal(cold.code, "not-ready");

    host.setProbe(() => Promise.resolve(FRAME), true);
    const ok = await host.queryElementAt(5, 5);
    assert.equal(ok.ok, true);

    host.setProbe(() => Promise.reject(new Error("gone")), true);
    const gone = await host.queryElementAt(5, 5);
    assert.equal(gone.ok, false);
    if (gone.ok) return;
    assert.equal(gone.code, "wv-gone");
  });

  it("frame survives JSON serialization (contract §6.2)", async () => {
    const host = new PreviewHost();
    host.setProbe(() => Promise.resolve(FRAME), true);
    const res = await host.queryElementAt(1, 2);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(JSON.parse(JSON.stringify(res.value)).candidates[0].id, "c0");
  });
});

describe("speech service", () => {
  it("hotkey toggles listening; final emits once; processing follows", () => {
    const svc = new SpeechService([{ kind: "web-speech", isAvailable: () => true }]);
    const states: string[] = [];
    const texts: string[] = [];
    svc.onState((s) => states.push(s));
    svc.onTranscript((e) => texts.push(`${e.text}:${e.isFinal}`));
    const started = svc.start();
    assert.equal(started.ok, true);
    assert.equal(svc.currentState, "listening");
    svc.pushTranscript("make it", false);
    svc.pushTranscript("make it blue", true);
    svc.pushTranscript("make it blue", true); // mic echo: deduped
    assert.deepEqual(texts, ["make it:false", "make it blue:true"]);
    assert.ok(states.includes("processing"));
    svc.stop();
    assert.equal(svc.currentState, "off");
  });

  it("scribe fallback used when web-speech unavailable; none -> start fails", () => {
    const svc = new SpeechService([
      { kind: "web-speech", isAvailable: () => false },
      { kind: "scribe", isAvailable: () => true },
    ]);
    assert.equal(svc.activeKind, "scribe");
    assert.equal(svc.start().ok, true);
    const dead = new SpeechService([{ kind: "web-speech", isAvailable: () => false }]);
    assert.equal(dead.start().ok, false);
  });

  it("sponsor badge disclosed on mic chip", () => {
    assert.equal(SPEECH_SPONSOR, "elevenlabs-trial");
  });
});

describe("BYOK key store", () => {
  it("save/get/delete round-trip in memory", async () => {
    const store = createMemoryKeyStore();
    assert.equal(await store.getKey("gemini"), null);
    await store.saveKey("gemini", "k-123");
    assert.equal(await store.getKey("gemini"), "k-123");
    await store.deleteKey("gemini");
    assert.equal(await store.getKey("gemini"), null);
  });
});
