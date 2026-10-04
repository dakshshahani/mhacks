// Shared Electron runtime access. The .ts main entry loads through Node's
// default ESM loader (with type stripping), where bare `import … from
// "electron"` resolves to the path-shim instead of the API. require() takes
// Electron's patched CJS path and returns the real API. Import this helper,
// never "electron" directly (preload.cjs is exempt: sandboxed preload only
// guarantees require("electron")).
import { createRequire } from "node:module";

export const electron = createRequire(import.meta.url)("electron") as typeof import("electron");
