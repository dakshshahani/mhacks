// Dev C: BYOK display-only wrapper (~20 lines, after G3 only if time).
// Billing is mocked — no Stripe, no backend. PM owns the key field UI.

export interface KeyStore {
  saveKey(service: string, key: string): Promise<void>;
  getKey(service: string): Promise<string | null>;
  deleteKey(service: string): Promise<void>;
}

/** In-memory fallback so the browser harness works without Electron. */
export function createMemoryKeyStore(): KeyStore {
  const map = new Map<string, string>();
  return {
    saveKey: (service: string, key: string): Promise<void> => {
      map.set(service, key);
      return Promise.resolve();
    },
    getKey: (service: string): Promise<string | null> => {
      return Promise.resolve(map.get(service) ?? null);
    },
    deleteKey: (service: string): Promise<void> => {
      map.delete(service);
      return Promise.resolve();
    },
  };
}

/** Electron safeStorage surface (injected — this package never imports
 *  electron itself, so the harness and tests stay electron-free). */
export interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
}

/** Opaque ciphertext persistence (userData file in main; never the repo). */
export interface KeyValueBackend {
  read(service: string): Promise<string | null>;
  write(service: string, value: string): Promise<void>;
  delete(service: string): Promise<void>;
}

const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const fromB64 = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

/** Keychain-backed KeyStore: ciphertext at rest, Keychain-held key.
 *  Corrupt entries (keychain reset, foreign machine) read as null, never throw. */
export function createElectronKeyStore(
  protector: ElectronSafeStorage,
  backend: KeyValueBackend,
): KeyStore {
  return {
    saveKey: async (service: string, key: string): Promise<void> => {
      await backend.write(service, toB64(protector.encryptString(key)));
    },
    getKey: async (service: string): Promise<string | null> => {
      const raw = await backend.read(service);
      if (!raw) return null;
      try {
        return protector.decryptString(fromB64(raw));
      } catch {
        return null;
      }
    },
    deleteKey: (service: string): Promise<void> => {
      return backend.delete(service);
    },
  };
}
