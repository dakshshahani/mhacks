// Electron KeyStore: round-trip through a stub protector + map backend,
// corrupt ciphertext reads as null (keychain reset must never throw).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElectronKeyStore, type KeyValueBackend } from "../src/safeStorage";

function stubProtector() {
  // Mirrors safeStorage semantics: decrypt throws on tampered input
  // (authenticated encryption), which the store maps to null.
  const PREFIX = [0xde, 0xad];
  const xor = (s: string) => s.split("").map((c) => c.charCodeAt(0) ^ 0x5a);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Uint8Array.from([...PREFIX, ...xor(s)]),
    decryptString: (b: Uint8Array) => {
      if (b[0] !== 0xde || b[1] !== 0xad) throw new Error("auth failed");
      return Array.from(b.slice(2))
        .map((n) => String.fromCharCode(n ^ 0x5a))
        .join("");
    },
  };
}

function mapBackend(): KeyValueBackend & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    read: (s: string) => Promise.resolve(raw.get(s) ?? null),
    write: (s: string, v: string) => {
      raw.set(s, v);
      return Promise.resolve();
    },
    delete: (s: string) => {
      raw.delete(s);
      return Promise.resolve();
    },
  };
}

describe("createElectronKeyStore", () => {
  it("round-trips a key and stores ciphertext only", async () => {
    const backend = mapBackend();
    const store = createElectronKeyStore(stubProtector(), backend);
    await store.saveKey("elevenlabs", "sk-secret");
    assert.notEqual(backend.raw.get("elevenlabs"), "sk-secret");
    assert.equal(await store.getKey("elevenlabs"), "sk-secret");
  });

  it("missing key reads null; delete removes", async () => {
    const store = createElectronKeyStore(stubProtector(), mapBackend());
    assert.equal(await store.getKey("nope"), null);
    await store.saveKey("k", "v");
    await store.deleteKey("k");
    assert.equal(await store.getKey("k"), null);
  });

  it("corrupt ciphertext reads null instead of throwing", async () => {
    const backend = mapBackend();
    const store = createElectronKeyStore(stubProtector(), backend);
    await store.saveKey("k", "v");
    backend.raw.set("k", "!!!not-base64!!!");
    assert.equal(await store.getKey("k"), null);
  });
});
