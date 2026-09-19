import "@testing-library/jest-dom";

// jsdom can expose a Storage object without its methods in some Node
// configurations; provide an in-memory localStorage for tests.
if (typeof window !== "undefined") {
  const hasWorkingStorage = (() => {
    try {
      const probe = "__kanbanity_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  })();

  if (!hasWorkingStorage) {
    class MemoryStorage implements Storage {
      private store = new Map<string, string>();
      get length(): number {
        return this.store.size;
      }
      clear(): void {
        this.store.clear();
      }
      getItem(key: string): string | null {
        return this.store.has(key) ? (this.store.get(key) as string) : null;
      }
      key(index: number): string | null {
        return [...this.store.keys()][index] ?? null;
      }
      removeItem(key: string): void {
        this.store.delete(key);
      }
      setItem(key: string, value: string): void {
        this.store.set(key, String(value));
      }
    }
    const memoryStorage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage,
    });
  }
}
