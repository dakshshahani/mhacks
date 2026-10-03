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
