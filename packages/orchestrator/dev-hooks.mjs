// Dev-only module resolution: @mhacks/contracts -> workspace source,
// extensionless .ts imports. Test/probe only, never shipped.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CONTRACTS_INDEX = new URL("../contracts/src/index.ts", import.meta.url)
  .href;

export async function resolve(specifier, context, next) {
  if (specifier === "@mhacks/contracts") {
    return { url: CONTRACTS_INDEX, shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".")) {
      const parentPath = fileURLToPath(context.parentURL);
      const base = path.resolve(path.dirname(parentPath), specifier);
      for (const cand of [`${base}.ts`, path.join(base, "index.ts")]) {
        if (existsSync(cand)) {
          return { url: pathToFileURL(cand).href, shortCircuit: true };
        }
      }
    }
    throw err;
  }
}
