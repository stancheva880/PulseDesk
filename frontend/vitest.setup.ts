import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// jsdom doesn't implement these; Radix Select / DropdownMenu and next-themes need them.
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
  if (typeof Element !== 'undefined') {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
    Element.prototype.setPointerCapture = function setPointerCapture() {
      /* noop */
    };
    Element.prototype.releasePointerCapture = function releasePointerCapture() {
      /* noop */
    };
    Element.prototype.scrollIntoView = function scrollIntoView() {
      /* noop */
    };
  }
}

// Node 24 ships an experimental in-memory localStorage that is partial (no
// `removeItem`) and shadows jsdom's. Install a complete in-memory implementation on
// the test globals so storage round-trips deterministically across tests.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const memoryStorage = new MemoryStorage();
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
