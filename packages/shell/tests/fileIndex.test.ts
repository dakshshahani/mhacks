// fileIndex: componentName -> ranked file candidates (convention search).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findComponentFiles, findMarkupFiles, findTextFiles } from "../src/fileIndex";

async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mhacks-idx-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, text);
  }
  return root;
}

describe("fileIndex", () => {
  it("basename match outranks definition match, deterministic order", async () => {
    const root = await makeTree({
      "src/a.tsx": `export function GoButton() { return <button/>; }`,
      "src/GoButton.tsx": `export function GoButton() { return <button/>; }`,
      "src/b.tsx": `import { GoButton } from "./a"; export const x = <GoButton/>;`,
      "node_modules/pkg/GoButton.tsx": `export function GoButton() {}`,
      ".next/cache/x.tsx": `export function GoButton() {}`,
    });
    const out = await findComponentFiles(root, "GoButton");
    assert.deepEqual(
      out.map((m) => m.path).sort(),
      ["src/GoButton.tsx", "src/a.tsx"].sort(),
    );
    assert.equal(out[0]?.path, path.join("src", "GoButton.tsx"));
    assert.equal(out[0]?.score, 2);
    // node_modules + .next never surface.
    assert.ok(out.every((m) => !m.path.includes("node_modules") && !m.path.includes(".next")));
  });

  it("usage alone is not a definition", async () => {
    const root = await makeTree({
      "src/page.tsx": `import { Card } from "./ui"; export const P = () => <Card/>;`,
    });
    assert.deepEqual(await findComponentFiles(root, "Card"), []);
  });

  it("empty/oversize names and regex-hostile input are safe", async () => {
    const root = await makeTree({ "src/A.tsx": `export const A = 1;` });
    assert.deepEqual(await findComponentFiles(root, ""), []);
    assert.deepEqual(await findComponentFiles(root, "   "), []);
    assert.deepEqual(await findComponentFiles(root, "a("), []);
    assert.deepEqual(await findComponentFiles(root, "x".repeat(200)), []);
  });

  it("findTextFiles locates the usage file by literal text", async () => {
    const root = await makeTree({
      "src/ui/card.tsx": `export function CardTitle(p) { return <div {...p} />; }`,
      "src/app/login.tsx": `import { CardTitle } from "../ui/card"; export const L = () => <CardTitle>Finance Planner</CardTitle>;`,
    });
    assert.deepEqual(await findTextFiles(root, "Finance Planner"), ["src/app/login.tsx"]);
    assert.deepEqual(await findTextFiles(root, "missing text"), []);
    assert.deepEqual(await findTextFiles(root, "x"), []);
  });

  it("findMarkupFiles ranks files by rendered class/text evidence", async () => {
    const root = await makeTree({
      "src/page.tsx": `export const Page = () => <button className="bg-blue-500 px-4">Launch</button>;`,
      "src/styles.tsx": `export const styles = "bg-blue-500";`,
      "src/other.tsx": `export const Other = () => <div>Launch</div>;`,
      "src/static.html": `<button class="bg-blue-500 px-4">Launch</button>`,
    });
    assert.deepEqual(
      await findMarkupFiles(root, ["bg-blue-500", "px-4", "Launch"]),
      ["src/page.tsx", "src/static.html"],
    );
    assert.deepEqual(await findMarkupFiles(root, ["x"]), []);
  });
});
