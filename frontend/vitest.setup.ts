import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// jsdom doesn't implement matchMedia; next-themes and Radix DropdownMenu need it.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// Node 24 ships an experimental in-memory localStorage that is partial (no
// `removeItem`) and shadows jsdom's. Install a complete in-memory implementation on
// the test globals so storage round-trips deterministically across tests.
const store = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return store.size; },
  clear: () => store.clear(),
  getItem: (key) => store.get(key) ?? null,
  key: (i) => Array.from(store.keys())[i] ?? null,
  removeItem: (key) => { store.delete(key); },
  setItem: (key, value) => { store.set(key, String(value)); },
};
Object.defineProperty(window, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
});

beforeEach(() => {
  memoryStorage.clear();
});
