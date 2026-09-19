import type { StorageLike, SyncHost, StorageEventLike } from "./storage";

type StorageListener = (event: StorageEventLike) => void;

export interface QueuedEvent {
  target: FakeTab;
  event: StorageEventLike;
}

/**
 * Controllable in-memory multi-tab environment. All tabs share one store.
 * Writes from a tab never notify that tab (like real `storage` events). When
 * `autoFlush` is true events are delivered immediately; otherwise they queue
 * and tests call `flush()` with optional reordering/duplication, which is how
 * stale tabs, delayed, duplicated and reordered deliveries are simulated.
 */
export class TabHarness {
  private store = new Map<string, string>();
  private tabs: FakeTab[] = [];
  private pending: QueuedEvent[] = [];
  autoFlush = true;

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  createTab(): FakeTab {
    const tab = new FakeTab(this);
    this.tabs.push(tab);
    return tab;
  }

  notifyWrite(source: FakeTab, key: string, newValue: string): void {
    for (const target of this.tabs) {
      if (target === source) continue;
      const item = { target, event: { key, newValue } };
      if (this.autoFlush) target.dispatch(item.event);
      else this.pending.push(item);
    }
  }

  flush(transform?: (events: QueuedEvent[]) => QueuedEvent[]): void {
    const events = transform ? transform(this.pending) : this.pending;
    this.pending = [];
    for (const { target, event } of events) target.dispatch(event);
  }

  dispatchTo(tab: FakeTab, event: StorageEventLike): void {
    tab.dispatch(event);
  }

  get rawValue(): string | null {
    return this.getItem("kanbanity-board");
  }
}

export class FakeTab implements SyncHost, StorageLike {
  private listeners = new Set<StorageListener>();
  private readonly harness: TabHarness;
  readonly localStorage: StorageLike;

  constructor(harness: TabHarness) {
    this.harness = harness;
    this.localStorage = this;
  }

  getItem(key: string): string | null {
    return this.harness.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.harness.setItem(key, value);
    this.harness.notifyWrite(this, key, value);
  }

  addEventListener(_type: "storage", listener: StorageListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "storage", listener: StorageListener): void {
    this.listeners.delete(listener);
  }

  dispatch(event: StorageEventLike): void {
    for (const listener of this.listeners) listener(event);
  }
}
