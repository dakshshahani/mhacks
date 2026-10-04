// Executor: truth boundary — real commitSha/filesChanged, build-failed
// envelope + revert, retry cap, parent-address forward-compat.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EditRequest } from "@mhacks/contracts";
import type { ElementCandidate } from "@mhacks/contracts";
import { FileGitService } from "../src/git";
import { submitEdit, shouldRetry, type EditRequestWithParent } from "../src/executor";
import { POLICY } from "@mhacks/contracts";

function candidate(over: Partial<ElementCandidate> = {}): ElementCandidate {
  return {
    id: "c0",
    selector: "div.hero",
    componentName: "Hero",
    filePath: "Hero.tsx",
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    outerHTMLSnippet: `<div class="hero">Hello</div>`,
    htmlTruncated: false,
    confidence: 0.9,
    trackedConfidence: 0.9,
    supportedOps: [{ op: "set-color", param: "brand" }],
    ...over,
  };
}

function req(over: Partial<EditRequest> = {}): EditRequest {
  return {
    id: "e-1",
    transcript: "make it brand",
    intent: "style",
    target: candidate(),
    op: { op: "set-color", param: "brand" },
    route: "no-llm",
    riskScore: 0.2,
    ...over,
  };
}

async function makeRoot(): Promise<{ root: string; files: Map<string, string> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-exec-"));
  const files = new Map<string, string>();
  files.set(path.join(root, "Hero.tsx"), `<div className="hero bg-muted">Hello</div>`);
  files.set(path.join(root, "Parent.tsx"), `<main className="flex justify-center"><slot /></main>`);
  await fs.writeFile(path.join(root, "Hero.tsx"), files.get(path.join(root, "Hero.tsx")) as string);
  await fs.writeFile(path.join(root, "Parent.tsx"), files.get(path.join(root, "Parent.tsx")) as string);
  return { root, files };
}

function memIO(root: string) {
  return {
    readFile: (p: string) => fs.readFile(p, "utf8"),
    writeFile: (p: string, t: string) => fs.writeFile(p, t, "utf8").then(() => undefined),
    resolveRoot: (f: string | null) => (f ? path.join(root, f) : root),
  };
}

describe("executor", () => {
  it("valid Tier-1 request -> applied with real sha/filesChanged, hotReloaded honest", async () => {
    const { root } = await makeRoot();
    const git = new FileGitService(root);
    const res = await submitEdit(req(), {
      git,
      ...memIO(root),
      didReload: () => true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.status, "applied");
    assert.deepEqual(res.value.filesChanged, ["Hero.tsx"]);
    assert.ok(res.value.commitSha.length > 0);
    assert.equal(res.value.hotReloaded, true);
    const text = await fs.readFile(path.join(root, "Hero.tsx"), "utf8");
    assert.match(text, /bg-brand/);
  });

  it("missing filePath -> build-failed envelope, never a wrong file", async () => {
    const { root } = await makeRoot();
    const git = new FileGitService(root);
    const res = await submitEdit(req({ target: candidate({ filePath: null }) }), {
      git,
      ...memIO(root),
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "build-failed");
  });

  it("broken edit -> build-failed envelope + worktree reverted", async () => {
    const { root } = await makeRoot();
    const git = new FileGitService(root);
    let calls = 0;
    const res = await submitEdit(
      req({ op: null, route: "small", target: candidate() }),
      {
        git,
        ...memIO(root),
        generateDiff: () => {
          calls += 1;
          return Promise.resolve(`<div className="broken">x</div>`);
        },
        buildGate: {
          check: () => Promise.resolve({ ok: false as const, message: "tsc: syntax error" }),
        },
      },
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "build-failed");
    assert.match(res.message, /retry-exhausted/);
    assert.equal(calls, POLICY.MAX_RETRIES + 1);
    const text = await fs.readFile(path.join(root, "Hero.tsx"), "utf8");
    assert.match(text, /bg-muted/); // reverted to original
  });

  it("retry cap helper mirrors POLICY.MAX_RETRIES=3", () => {
    assert.equal(POLICY.MAX_RETRIES, 3);
    assert.equal(shouldRetry(0), true);
    assert.equal(shouldRetry(2), true);
    assert.equal(shouldRetry(3), false);
  });

  it("parent address is resolved at apply time (forward-compat §5.4b)", async () => {    const { root } = await makeRoot();
    const git = new FileGitService(root);
    let seenParent: string | null = null;
    const res = await submitEdit(
      { ...req({ route: "small" }), parent: { componentName: "Layout", filePath: "Parent.tsx" } } as EditRequestWithParent,
      {
        git,
        ...memIO(root),
        readParentSection: (addr) => {
          assert.equal(addr.filePath, "Parent.tsx");
          return fs.readFile(path.join(root, addr.filePath as string), "utf8");
        },
        generateDiff: (_r, ctx) => {
          seenParent = ctx.parentSection;
          return Promise.resolve(`<div className="hero bg-accent">Hello</div>`);
        },
      },
    );
    assert.equal(res.ok, true);
    assert.match(String(seenParent), /justify-center/);
  });

  it("filePath escape attempts -> build-failed envelope, nothing written outside root", async () => {
    const { root } = await makeRoot();
    const git = new FileGitService(root);
    for (const evil of ["../evil.ts", "/abs/evil.ts", "a/../../evil.ts", "sub/../../../evil.ts"]) {
      const res = await submitEdit(req({ target: candidate({ filePath: evil }) }), {
        git,
        ...memIO(root),
      });
      assert.equal(res.ok, false, evil);
      if (res.ok) continue;
      assert.equal(res.code, "build-failed", evil);
      assert.match(res.message, /suspicious filePath/, evil);
    }
    assert.equal(await fs.stat(path.join(root, "evil.ts")).then(() => true).catch(() => false), false);
    assert.equal(await fs.stat(path.join(os.tmpdir(), "evil.ts")).then(() => true).catch(() => false), false);
  });

  it("truncated model output -> error-fed retry, then retry-exhausted, file intact", async () => {    const { root } = await makeRoot();
    const big = `<div>\n${"x".repeat(1000)}\n</div>`;
    await fs.writeFile(path.join(root, "Hero.tsx"), big);
    const git = new FileGitService(root);
    let calls = 0;
    let seenError = "";
    const res = await submitEdit(req({ op: null, route: "small", intent: "style" }), {
      git,
      ...memIO(root),
      generateDiff: (_r, ctx) => {
        calls += 1;
        seenError = ctx.lastError ?? "";
        return Promise.resolve("<div>truncated…</div>");
      },
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "build-failed");
    assert.match(res.message, /retry-exhausted/);
    assert.equal(calls, POLICY.MAX_RETRIES + 1);
    assert.match(seenError, /suspiciously short/); // retry carried the truncation context
    assert.equal(await fs.readFile(path.join(root, "Hero.tsx"), "utf8"), big);
  });

  it("identical model output -> no commit, retry-exhausted, file intact", async () => {
    const { root } = await makeRoot();
    const before = await fs.readFile(path.join(root, "Hero.tsx"), "utf8");
    const git = new FileGitService(root);
    let calls = 0;
    const res = await submitEdit(req({ op: null, route: "small", intent: "content" }), {
      git,
      ...memIO(root),
      generateDiff: () => {
        calls += 1;
        return Promise.resolve(before); // model miss: byte-identical rewrite
      },
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.code, "build-failed");
    assert.match(res.message, /retry-exhausted/);
    assert.equal(calls, POLICY.MAX_RETRIES + 1);
    const labels = (await git.history()).map((s) => s.label);
    assert.ok(labels.every((l) => !l.startsWith("edit "))); // pre-edit baseline only, no edit committed
  });
});
