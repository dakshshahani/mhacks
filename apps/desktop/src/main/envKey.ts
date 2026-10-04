// BYOK key resolution (main-side). Order: environment first (dev: repo
// .env via launcher, CI, shells), then a user-fillable file for packaged
// installs (no .env ships in the .app):
//   ~/Library/Application Support/@mhacks/desktop/.env
// containing exactly:
//   ELEVENLABS_API_KEY=sk-...
// (Restart the app after creating/editing it. Never commit it anywhere —
// userData stays outside every repo by design.)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { electron } from "./electron";

const { app } = electron;

let fileCache: Record<string, string> | null = null;

function readKeyFile(): Record<string, string> {
  if (fileCache !== null) return fileCache;
  fileCache = {};
  let text: string;
  try {
    text = readFileSync(join(app.getPath("userData"), ".env"), "utf8");
  } catch {
    return fileCache; // Absent: env-only install.
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    fileCache[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return fileCache;
}

/** ElevenLabs key for the Scribe fallback, env-then-file. */
export function getElevenLabsKey(): string {
  const fromEnv = process.env.ELEVENLABS_API_KEY ?? "";
  if (fromEnv.length > 0) return fromEnv;
  return readKeyFile()["ELEVENLABS_API_KEY"] ?? "";
}
