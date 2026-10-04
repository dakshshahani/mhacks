// Scaffold caller tests: parser allowlists the fixed file set (drops junk,
// traversal, dupes; fails closed on incompleteness) and the round trip sends
// an OpenAI-style chat request carrying the design system prompt.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateScaffold, parseScaffoldFiles, scaffoldConfig } from "../src/scaffold";

const FULL = `### FILE: package.json
\`\`\`json
{"name": "x"}
\`\`\`
### FILE: server.mjs
\`\`\`js
console.log("hi")
\`\`\`
### FILE: index.html
\`\`\`html
<html></html>
\`\`\`
### FILE: styles.css
\`\`\`css
body {}
\`\`\`
### FILE: main.js
\`\`\`js
"use strict"
\`\`\`
`;

describe("parseScaffoldFiles", () => {
  it("accepts the complete five-file set in any order", () => {
    const files = parseScaffoldFiles(FULL);
    assert.ok(files);
    assert.deepEqual(
      files.map((f) => f.path),
      ["package.json", "server.mjs", "index.html", "styles.css", "main.js"],
    );
    assert.match(files[0]?.content ?? "", /"name"/);
  });

  it("fails closed on missing files and traversal; drops junk paths", () => {
    assert.strictEqual(parseScaffoldFiles("hello world"), null);
    const withJunk = parseScaffoldFiles(`${FULL}### FILE: evil.sh\n\`\`\`\nrm -rf\n\`\`\`\n`);
    assert.ok(withJunk && withJunk.length === 5);
    assert.ok(withJunk.every((f) => f.path !== "evil.sh"));
    const withTraversal = FULL.replace("### FILE: main.js", "### FILE: ../main.js");
    assert.strictEqual(parseScaffoldFiles(withTraversal), null);
    const missing = FULL.split("### FILE: styles.css")[0] ?? "";
    assert.strictEqual(parseScaffoldFiles(missing), null);
  });

  it("rejects a five-file set with index.html severed mid-tag (max_tokens cut)", () => {
    const cut = FULL.replace("<html></html>", "<html><body><p>cut off mid-");
    assert.strictEqual(parseScaffoldFiles(cut), null);
  });
});

describe("generateScaffold", () => {
  it("returns null without a key and for tiny briefs", async () => {
    const seen: string[] = [];
    const transport = async () => {
      seen.push("called");
      return { ok: true, status: 200, json: async () => ({}) };
    };
    // No GLM_API_KEY in test env (repo convention: keys from process.env).
    assert.ok(process.env["GLM_API_KEY"] === undefined);
    assert.equal(await generateScaffold("a portfolio site", "x", { transport }), null);
    assert.deepEqual(seen, []);
    assert.equal(await generateScaffold("  ", "x", { transport }), null);
  });

  it("posts system + user messages to {base}/chat/completions", async () => {
    process.env["GLM_API_KEY"] = "test-key";
    process.env["GLM_BASE_URL"] = "https://example.test/v1";
    process.env["GLM_MODEL"] = "glm-test-flash";
    try {
      let url = "";
      let body = "";
      let auth: string | undefined;
      const transport = async (
        u: string,
        init: { headers: Record<string, string>; body: string },
      ) => {
        url = u;
        body = init.body;
        auth = init.headers["Authorization"];
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: FULL } }] }) };
      };
      const cfg = scaffoldConfig();
      assert.equal(cfg.baseUrl, "https://example.test/v1");
      assert.equal(cfg.model, "glm-test-flash");
      const files = await generateScaffold("a bakery site", "bakery", { transport });
      assert.equal(url, "https://example.test/v1/chat/completions");
      assert.equal(auth, "Bearer test-key");
      const parsed = JSON.parse(body) as {
        model: string;
        reasoning_effort: string;
        messages: Array<{ role: string; content: string }>;
      };
      assert.equal(parsed.model, "glm-test-flash");
      assert.equal(parsed.reasoning_effort, "low");
      const [system, user] = parsed.messages;
      assert.ok(system && user);
      assert.equal(system.role, "system");
      assert.match(system.content, /design read/i);
      assert.match(user.content, /bakery site/);
      assert.ok(files && files.length === 5);
    } finally {
      delete process.env["GLM_API_KEY"];
      delete process.env["GLM_BASE_URL"];
      delete process.env["GLM_MODEL"];
    }
  });

  it("returns null on provider error envelopes and HTTP failures", async () => {
    process.env["GLM_API_KEY"] = "test-key";
    try {
      const errTransport = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ error: { message: "bad key" } }),
      });
      assert.equal(await generateScaffold("a site", "s", { transport: errTransport }), null);
      const httpTransport = async () => ({
        ok: false,
        status: 429,
        json: async () => ({}),
      });
      assert.equal(await generateScaffold("a site", "s", { transport: httpTransport }), null);
    } finally {
      delete process.env["GLM_API_KEY"];
    }
  });
});
