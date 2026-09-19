import { BoardEngine } from "../engine";
import type { Board } from "../../types/kanban";
import type { BoardStorage } from "../storage";

type Listener = (raw: string | null) => void;

/** Shared in-memory storage mirroring localStorage cross-tab semantics. */
export class MemoryBus {
  private value: string | null = null;
  private listeners = new Map<string, Set<Listener>>();

  storage(tabId: string): BoardStorage {
    return {
      getItem: () => this.value,
      setItem: (_key, next) => {
        this.value = next;
        for (const [id, listeners] of this.listeners) {
          if (id === tabId) continue;
          for (const listener of listeners) listener(next);
        }
      },
      subscribe: (handler) => {
        let set = this.listeners.get(tabId);
        if (!set) {
          set = new Set();
          this.listeners.set(tabId, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    };
  }
}

/** Bus where remote events are held back until delivered deterministically. */
export class ControllableBus {
  private value: string | null = null;
  private queues = new Map<
    string,
    { handler: Listener; pending: string[] }
  >();

  storage(tabId: string): BoardStorage {
    return {
      getItem: () => this.value,
      setItem: (_key, next) => {
        this.value = next;
        for (const [id, entry] of this.queues) {
          if (id === tabId) continue;
          entry.pending.push(next);
        }
      },
      subscribe: (handler) => {
        this.queues.set(tabId, { handler, pending: [] });
        return () => {
          this.queues.delete(tabId);
        };
      },
    };
  }

  deliver(tabId: string, transform?: (raws: string[]) => string[]) {
    const entry = this.queues.get(tabId);
    if (!entry) return;
    let raws = entry.pending.splice(0);
    if (transform) raws = transform(raws);
    for (const raw of raws) entry.handler(raw);
  }

  deliverAll(transform?: (raws: string[]) => string[]) {
    for (const tabId of [...this.queues.keys()]) {
      this.deliver(tabId, transform);
    }
  }

  pending(tabId: string): number {
    return this.queues.get(tabId)?.pending.length ?? 0;
  }
}

export function createTabs(
  fallback: Board,
  count: number,
  bus: MemoryBus | ControllableBus,
  idPrefix = "tab"
): BoardEngine[] {
  const engines: BoardEngine[] = [];
  for (let index = 0; index < count; index++) {
    const tabId = idPrefix + "-" + index;
    engines.push(
      new BoardEngine({ storage: bus.storage(tabId), fallback, tabId })
    );
  }
  return engines;
}
