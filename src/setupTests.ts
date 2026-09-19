import "@testing-library/jest-dom";

// Some jsdom setups expose a broken/partial localStorage. Install a spec-like
// in-memory Storage (non-enumerable methods) on window and globalThis when
// the built-in implementation is unusable.
function buildStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function storageWorks(): boolean {
  try {
    const ls = globalThis.localStorage;
    if (!ls || typeof ls.clear !== "function") return false;
    ls.setItem("__kanbanity_probe__", "1");
    if (ls.getItem("__kanbanity_probe__") !== "1") return false;
    ls.removeItem("__kanbanity_probe__");
    return true;
  } catch {
    return false;
  }
}

if (!storageWorks()) {
  const memory = buildStorage();
  const targets = [globalThis, (globalThis as { window?: Window }).window];
  for (const target of targets) {
    if (!target) continue;
    try {
      Object.defineProperty(target, "localStorage", {
        value: memory,
        configurable: true,
        writable: true,
      });
    } catch {
      // Environment forbids replacement; the app tolerizes storage errors.
    }
  }
}
