// Main-side BYOK key store (E7). Electron safeStorage encrypts with the OS
// keychain; the ciphertext map lives in userData (never the project dir,
// never resourcesPath). Falls back to memory when encryption is unavailable
// (fresh VM / first run) — callers see the same KeyStore either way.

import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createElectronKeyStore,
  createMemoryKeyStore,
  type KeyStore,
} from "@mhacks/shell";

// See app.ts: electron must come through the patched require, not ESM import.
const { app, safeStorage } = createRequire(import.meta.url)(
  "electron",
) as typeof import("electron");

function userDataBackend(): {
  read: (service: string) => Promise<string | null>;
  write: (service: string, value: string) => Promise<void>;
  delete: (service: string) => Promise<void>;
} {
  const file = join(app.getPath("userData"), "keys", "byok.json");
  async function readAll(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    } catch {
      // Missing or corrupt — start empty rather than crashing the shell.
    }
    return {};
  }
  return {
    read: async (service) => (await readAll())[service] ?? null,
    write: async (service, value) => {
      const all = await readAll();
      all[service] = value;
      await mkdir(join(app.getPath("userData"), "keys"), { recursive: true });
      await writeFile(file, JSON.stringify(all), "utf8");
    },
    delete: async (service) => {
      const all = await readAll();
      delete all[service];
      await writeFile(file, JSON.stringify(all), "utf8");
    },
  };
}

export async function createKeyStore(): Promise<KeyStore> {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[electron] safeStorage unavailable — BYOK keys are memory-only this session");
    return createMemoryKeyStore();
  }
  console.log("[electron] key store: safeStorage (keychain) backed");
  return createElectronKeyStore(safeStorage, userDataBackend());
}
