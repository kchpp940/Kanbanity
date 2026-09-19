import { keyForIndex } from "./order";
import type { Op, SyncDocument } from "./ops";
import {
  applyOp,
  project,
  reduceOps,
  seedDocument,
  type ReductionState,
} from "./reducer";
import {
  loadRaw,
  saveRaw,
  STORAGE_KEY,
  type StorageLike,
  type SyncHost,
  type StorageEventLike,
} from "./storage";
import type { Board, Label, ListTone } from "../types/kanban";

let tabCounter = 0;
function createTabId(): string {
  tabCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `t${Date.now().toString(36)}-${tabCounter}-${random}`;
}

export interface CommitResult {
  changed: boolean;
}

interface PreSnapshot {
  list?: {
    title: string;
    tone: ListTone;
    labels: Label[];
    key: string;
  };
  card?: {
    listId: string;
    key: string;
    title: string;
    content: string | undefined;
    labels: Label[];
    dueDate: string | undefined;
    priority: "low" | "medium" | "high" | undefined;
  };
}

interface ActionRecord {
  ops: Op[];
  pre: Map<string, PreSnapshot>;
  label: string;
}

type HistoryEntry = ActionRecord;

export interface EngineSnapshot {
  board: Board;
  canUndo: boolean;
  canRedo: boolean;
}

export type EngineListener = (snapshot: EngineSnapshot) => void;

export interface CardEdit {
  title?: string;
  content?: string;
  labels?: Label[];
  dueDate?: string;
  priority?: "low" | "medium" | "high";
}

function sameLabels(a: Label[] = [], b: Label[] = []): boolean {
  if (a.length !== b.length) return false;
  const idsB = new Set(b.map((label) => label.id));
  return a.every((label) => idsB.has(label.id));
}

function randomId(prefix: string, tabId: string, counter: number): string {
  return `${prefix}-${tabId}-${counter}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export class SyncEngine {
  private document: SyncDocument;
  private state: ReductionState;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<EngineListener>();
  private tabId = createTabId();
  private opCounter = 0;
  private storage: StorageLike;
  private host: SyncHost | null;
  private key: string;
  private boundHandleStorage: (event: StorageEventLike) => void;
  private cachedSnapshot: EngineSnapshot | null = null;

  private constructor(
    document: SyncDocument,
    storage: StorageLike,
    host: SyncHost | null,
    key: string
  ) {
    this.document = document;
    this.storage = storage;
    this.host = host;
    this.key = key;
    this.state = reduceOps(document.ops, document.boardTitle).state;
    this.boundHandleStorage = (event) => this.handleStorage(event);
    this.host?.addEventListener("storage", this.boundHandleStorage);
    this.persist();
  }

  static create(
    fallbackBoard: Board,
    host?: SyncHost | null,
    options?: { storage?: StorageLike; key?: string }
  ): SyncEngine {
    const storage =
      options?.storage ?? (host as StorageLike | null) ?? null;
    const key = options?.key ?? STORAGE_KEY;
    if (!storage) {
      return SyncEngine.memoryOnly(fallbackBoard);
    }
    const loaded = loadRaw(storage, key);
    if (loaded.kind === "document") {
      return new SyncEngine(loaded.document, storage, host ?? null, key);
    }
    if (loaded.kind === "legacy") {
      return new SyncEngine(
        seedDocument(loaded.board, 0),
        storage,
        host ?? null,
        key
      );
    }
    return new SyncEngine(
      seedDocument(fallbackBoard, 0),
      storage,
      host ?? null,
      key
    );
  }

  private static memoryOnly(fallbackBoard: Board): SyncEngine {
    const memory: StorageLike = {
      getItem: () => null,
      setItem: () => undefined,
    };
    return new SyncEngine(
      seedDocument(fallbackBoard, 0),
      memory,
      null,
      STORAGE_KEY
    );
  }

  dispose(): void {
    this.host?.removeEventListener("storage", this.boundHandleStorage);
    this.listeners.clear();
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): EngineSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        board: project(this.state, this.document.boardTitle),
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
      };
    }
    return this.cachedSnapshot;
  }

  private emit(): void {
    this.cachedSnapshot = null;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  // Cross-tab synchronization -------------------------------------

  ingestRaw(raw: string | null): boolean {
    if (raw === null) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as Partial<SyncDocument>).version !== 2 ||
      !Array.isArray((parsed as Partial<SyncDocument>).ops)
    ) {
      return false;
    }
    return this.merge(parsed as SyncDocument);
  }

  /** Union merge; duplicate and out-of-order deliveries are harmless. */
  merge(remote: SyncDocument): boolean {
    const localOids = new Set(this.document.ops.map((op) => op.oid));
    const newOps = remote.ops.filter((op) => !localOids.has(op.oid));
    if (newOps.length === 0) return false;
    for (const op of newOps) applyOp(this.state, op);
    this.document = {
      version: 2,
      clock: Math.max(
        this.document.clock,
        remote.clock ?? 0,
        this.state.clock
      ),
      ops: [...this.document.ops, ...newOps],
      boardTitle: this.document.boardTitle,
    };
    // Remote ops never become this tab's own undoable history.
    this.emit();
    return true;
  }

  private handleStorage(event: StorageEventLike): void {
    if (event.key !== null && event.key !== this.key) return;
    this.ingestRaw(event.newValue);
  }

  // Local commits --------------------------------------------------

  private allocateOid(): string {
    this.opCounter += 1;
    return `${this.opCounter.toString(36)}.${this.tabId}`;
  }

  private refreshFromStorage(): void {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return;
    }
    if (raw !== null) this.ingestRaw(raw);
  }

  private commit(
    label: string,
    build: (ctx: { ts: number; makeOid: () => string }) => Op[] | null,
    capturePre?: (ops: Op[]) => Map<string, PreSnapshot>
  ): CommitResult {
    // A waking stale tab re-syncs first, so its action is applied on top
    // of every committed remote op rather than overwriting an old snapshot.
    this.refreshFromStorage();
    const clock = Math.max(this.document.clock, this.state.clock) + 1;
    const ops = build({ ts: clock, makeOid: () => this.allocateOid() });
    if (!ops || ops.length === 0) return { changed: false };
    this.document.clock = clock;
    const pre = capturePre ? capturePre(ops) : new Map<string, PreSnapshot>();
    for (const op of ops) {
      if (op.ts !== clock) {
        throw new Error("commit ops must share the action timestamp");
      }
      applyOp(this.state, op);
    }
    this.document = {
      ...this.document,
      clock: Math.max(this.document.clock, this.state.clock),
      ops: [...this.document.ops, ...ops],
    };
    this.undoStack.push({ ops, pre, label });
    this.redoStack = [];
    this.persist();
    this.emit();
    return { changed: true };
  }

  private persist(): void {
    try {
      saveRaw(this.storage, this.document, this.key);
    } catch {
      // Storage failures must not break the running session.
    }
  }

  // Board queries --------------------------------------------------

  private liveListEntries() {
    return [...this.state.lists.entries()]
      .filter(([, record]) => record.addTs > record.removeTs)
      .map(([id, record]) => ({ id, record }))
      .sort((a, b) => {
        if (a.record.key.value !== b.record.key.value) {
          return a.record.key.value < b.record.key.value ? -1 : 1;
        }
        if (a.record.addTs !== b.record.addTs) {
          return a.record.addTs - b.record.addTs;
        }
        return a.id < b.id ? -1 : 1;
      });
  }

  private boardListKeys(): string[] {
    return this.liveListEntries().map((entry) => entry.record.key.value);
  }

  private cardKeys(listId: string): string[] {
    const entries: { id: string; key: string }[] = [];
    for (const [id, card] of this.state.cards) {
      if (card.addTs <= card.removeTs) continue;
      if (card.listId.value !== listId) continue;
      entries.push({ id, key: card.key.value });
    }
    entries.sort((a, b) =>
      a.key === b.key ? (a.id < b.id ? -1 : 1) : a.key < b.key ? -1 : 1
    );
    return entries.map((entry) => entry.key);
  }

  // Business actions -----------------------------------------------

  addList(
    title: string,
    firstCardTitle?: string,
    tone: ListTone = "blue",
    labels: Label[] = []
  ): CommitResult {
    const trimmed = title.trim();
    if (!trimmed) return { changed: false };
    const cardTitle = firstCardTitle?.trim() || undefined;
    const listId = randomId("list", this.tabId, ++this.opCounter);
    const cardId = cardTitle
      ? randomId("card", this.tabId, ++this.opCounter)
      : null;
    return this.commit("add-list", ({ ts, makeOid }) => {
      const key = keyForIndex(
        this.boardListKeys(),
        this.boardListKeys().length
      );
      const ops: Op[] = [
        {
          oid: makeOid(),
          kind: "list-add",
          id: listId,
          title: trimmed,
          tone,
          labels,
          key,
          ts,
        },
      ];
      if (cardId) {
        ops.push({
          oid: makeOid(),
          kind: "card-add",
          id: cardId,
          listId,
          fields: { title: cardTitle!, content: undefined, labels: [] },
          key: keyForIndex([], 0),
          ts,
        });
      }
      return ops;
    });
  }

  updateList(
    listId: string,
    data: { title: string; tone: ListTone; labels: Label[] }
  ): CommitResult {
    const record = this.state.lists.get(listId);
    if (!record || record.addTs <= record.removeTs) {
      return { changed: false };
    }
    const fields: { title?: string; tone?: ListTone; labels?: Label[] } = {};
    const trimmedTitle = data.title.trim();
    if (trimmedTitle && trimmedTitle !== record.title.value) {
      fields.title = trimmedTitle;
    }
    if (data.tone !== record.tone.value) fields.tone = data.tone;
    if (!sameLabels(data.labels, record.labels.value)) {
      fields.labels = data.labels;
    }
    if (Object.keys(fields).length === 0) return { changed: false };
    return this.commit(
      "update-list",
      ({ ts, makeOid }) => [
        { oid: makeOid(), kind: "list-update", id: listId, fields, ts },
      ],
      () =>
        new Map([
          [
            listId,
            {
              list: {
                title: record.title.value,
                tone: record.tone.value,
                labels: record.labels.value,
                key: record.key.value,
              },
            },
          ],
        ])
    );
  }

  deleteList(listId: string): CommitResult {
    const record = this.state.lists.get(listId);
    if (!record || record.addTs <= record.removeTs) {
      return { changed: false };
    }
    return this.commit(
      "delete-list",
      ({ ts, makeOid }) => [
        { oid: makeOid(), kind: "list-remove", id: listId, ts },
      ],
      () =>
        new Map([
          [
            listId,
            {
              list: {
                title: record.title.value,
                tone: record.tone.value,
                labels: record.labels.value,
                key: record.key.value,
              },
            },
          ],
        ])
    );
  }

  reorderList(oldIndex: number, newIndex: number): CommitResult {
    const live = this.liveListEntries();
    if (
      oldIndex === newIndex ||
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= live.length ||
      newIndex >= live.length
    ) {
      return { changed: false };
    }
    const moved = live[oldIndex];
    const reordered = [...live];
    reordered.splice(oldIndex, 1);
    const remainingKeys = reordered.map((item) => item.record.key.value);
    const insertIndex = Math.min(newIndex, remainingKeys.length);
    const key = keyForIndex(remainingKeys, insertIndex);
    if (key === moved.record.key.value) return { changed: false };
    return this.commit(
      "reorder-list",
      ({ ts, makeOid }) => [
        { oid: makeOid(), kind: "list-reorder", id: moved.id, key, ts },
      ],
      () =>
        new Map([
          [
            moved.id,
            {
              list: {
                title: moved.record.title.value,
                tone: moved.record.tone.value,
                labels: moved.record.labels.value,
                key: moved.record.key.value,
              },
            },
          ],
        ])
    );
  }

  addCard(
    listId: string,
    data: {
      title: string;
      content?: string;
      labels: Label[];
      dueDate?: string;
      priority?: "low" | "medium" | "high";
    }
  ): CommitResult {
    const list = this.state.lists.get(listId);
    const trimmed = data.title.trim();
    if (!trimmed || !list || list.addTs <= list.removeTs) {
      return { changed: false };
    }
    const cardId = randomId("card", this.tabId, ++this.opCounter);
    return this.commit("add-card", ({ ts, makeOid }) => {
      const keys = this.cardKeys(listId);
      return [
        {
          oid: makeOid(),
          kind: "card-add",
          id: cardId,
          listId,
          fields: {
            title: trimmed,
            content: data.content?.trim() || undefined,
            labels: data.labels,
            dueDate: data.dueDate || undefined,
            priority: data.priority,
          },
          key: keyForIndex(keys, keys.length),
          ts,
        },
      ];
    });
  }

  updateCard(listId: string, cardId: string, edit: CardEdit): CommitResult {
    const card = this.state.cards.get(cardId);
    if (!card || card.addTs <= card.removeTs) return { changed: false };
    if (card.listId.value !== listId) {
      // Card moved (or list changed): still allow updating by card id,
      // but guard against stale list scoping by using the current list.
    }
      const fields: CardEdit = {};
    if (edit.title !== undefined) {
      const trimmed = edit.title.trim();
      if (trimmed && trimmed !== card.title.value) fields.title = trimmed;
    }
    // Presence-based optional fields: the editor always submits the full
    // form, so content/dueDate/priority keys are included whenever they are
    // present in the edit, making "clear the value" a real recorded change.
    if ("content" in edit) {
      fields.content = edit.content?.trim() || undefined;
    }
    if ("dueDate" in edit) {
      fields.dueDate = edit.dueDate || undefined;
    }
    if ("priority" in edit) {
      fields.priority = edit.priority;
    }
    if (edit.labels !== undefined && !sameLabels(edit.labels, card.labels.value)) {
      fields.labels = edit.labels;
    }
    if (Object.keys(fields).length === 0) return { changed: false };
    return this.commit(
      "update-card",
      ({ ts, makeOid }) => [
        { oid: makeOid(), kind: "card-update", id: cardId, fields, ts },
      ],
      () =>
        new Map([
          [
            cardId,
            {
              card: {
                listId: card.listId.value,
                key: card.key.value,
                title: card.title.value,
                content: card.content.value,
                labels: card.labels.value,
                dueDate: card.dueDate.value,
                priority: card.priority.value,
              },
            },
          ],
        ])
    );
  }

  deleteCard(listId: string, cardId: string): CommitResult {
    const card = this.state.cards.get(cardId);
    if (!card || card.addTs <= card.removeTs) return { changed: false };
    if (card.listId.value !== listId) {
      return { changed: false };
    }
    return this.commit(
      "delete-card",
      ({ ts, makeOid }) => [
        { oid: makeOid(), kind: "card-remove", id: cardId, ts },
      ],
      () =>
        new Map([
          [
            cardId,
            {
              card: {
                listId: card.listId.value,
                key: card.key.value,
                title: card.title.value,
                content: card.content.value,
                labels: card.labels.value,
                dueDate: card.dueDate.value,
                priority: card.priority.value,
              },
            },
          ],
        ])
    );
  }

  addLabel(label: { name: string; color: string }): CommitResult {
    const name = label.name.trim();
    if (!name) return { changed: false };
    const labelId = randomId("label", this.tabId, ++this.opCounter);
    return this.commit("add-label", ({ ts, makeOid }) => [
      {
        oid: makeOid(),
        kind: "label-add",
        id: labelId,
        label: { id: labelId, name, color: label.color },
        ts,
      },
    ]);
  }

  /**
   * Move a card. `overId` is either a card id or a list id (matching the
   * dnd-kit usage). Cancelled drags, missing targets and same-position
   * drops produce no op and no history entry.
   */
  moveCard(
    activeCardId: string,
    overId: string,
    overType: "Card" | "List"
  ): CommitResult {
    const card = this.state.cards.get(activeCardId);
    if (!card || card.addTs <= card.removeTs) return { changed: false };

    let destinationListId: string;
    let overCardId: string | null = null;
    if (overType === "List") {
      const list = this.state.lists.get(overId);
      if (!list || list.addTs <= list.removeTs) return { changed: false };
      destinationListId = overId;
    } else {
      const overCard = this.state.cards.get(overId);
      if (!overCard || overCard.addTs <= overCard.removeTs) {
        return { changed: false };
      }
      destinationListId = overCard.listId.value;
      overCardId = overId;
    }

    const destination = this.state.lists.get(destinationListId);
    if (!destination || destination.addTs <= destination.removeTs) {
      return { changed: false };
    }

    // Current ordered ids within source and destination (live cards only).
    const orderedIn = (listId: string) => {
      const entries: { id: string; key: string }[] = [];
      for (const [id, record] of this.state.cards) {
        if (record.addTs <= record.removeTs) continue;
        if (record.listId.value !== listId) continue;
        entries.push({ id, key: record.key.value });
      }
      entries.sort((a, b) =>
        a.key === b.key
          ? a.id < b.id
            ? -1
            : 1
          : a.key < b.key
          ? -1
          : 1
      );
      return entries;
    };

    const sourceListId = card.listId.value;
    const sourceEntries = orderedIn(sourceListId);
    const sameList = sourceListId === destinationListId;
    const destEntries = sameList
      ? sourceEntries
      : orderedIn(destinationListId);

    let targetIndex: number;
    if (overCardId === null) {
      targetIndex = destEntries.length; // dropped on list body: end
    } else {
      targetIndex = destEntries.findIndex((entry) => entry.id === overCardId);
      if (targetIndex === -1) targetIndex = destEntries.length;
    }

    if (sameList) {
      const currentIndex = sourceEntries.findIndex(
        (entry) => entry.id === activeCardId
      );
      if (currentIndex === -1 || targetIndex === currentIndex) {
        return { changed: false };
      }
      const without = sourceEntries.filter(
        (entry) => entry.id !== activeCardId
      );
      // dnd-kit gives the id under the pointer; moving to that index
      // matches arrayMove semantics used in the original UI.
      const insertIndex = Math.min(targetIndex, without.length);
      const keys = without.map((entry) => entry.key);
      const key = keyForIndex(keys, insertIndex);
      if (key === card.key.value) return { changed: false };
      return this.commit(
        "move-card",
        ({ ts, makeOid }) => [
          {
            oid: makeOid(),
            kind: "card-move",
            id: activeCardId,
            listId: sourceListId,
            key,
            ts,
          },
        ],
        () =>
          new Map([
            [
              activeCardId,
              {
                card: {
                  listId: card.listId.value,
                  key: card.key.value,
                  title: card.title.value,
                  content: card.content.value,
                  labels: card.labels.value,
                  dueDate: card.dueDate.value,
                  priority: card.priority.value,
                },
              },
            ],
          ])
      );
    }

    // Cross-list move.
    const insertIndex = Math.min(targetIndex, destEntries.length);
    const key = keyForIndex(
      destEntries.map((entry) => entry.key),
      insertIndex
    );
    return this.commit(
      "move-card",
      ({ ts, makeOid }) => [
        {
          oid: makeOid(),
          kind: "card-move",
          id: activeCardId,
          listId: destinationListId,
          key,
          fromListId: sourceListId,
          fromKey: card.key.value,
          ts,
        },
      ],
      () =>
        new Map([
          [
            activeCardId,
            {
              card: {
                listId: card.listId.value,
                key: card.key.value,
                title: card.title.value,
                content: card.content.value,
                labels: card.labels.value,
                dueDate: card.dueDate.value,
                priority: card.priority.value,
              },
            },
          ],
        ])
    );
  }

  // Undo / redo ----------------------------------------------------

  private applyInverseGroup(record: ActionRecord): {
    inverse: ActionRecord | null;
    changed: boolean;
  } {
    this.refreshFromStorage();
    const ts = Math.max(this.document.clock, this.state.clock) + 1;
    const inverses: Op[] = [];
    const inversePre = new Map<string, PreSnapshot>();
    // Inverses apply in reverse order within the action group.
    for (let i = record.ops.length - 1; i >= 0; i -= 1) {
      const inverse = this.invert(
        record.ops[i],
        record.pre,
        ts,
        () => this.allocateOid(),
        inversePre
      );
      if (inverse) {
        // Apply immediately so later inverses in the same group observe the
        // state produced by earlier ones (e.g. list restored before its card).
        applyOp(this.state, inverse);
        inverses.push(inverse);
      }
    }
    if (inverses.length === 0) return { inverse: null, changed: false };
    this.document = {
      ...this.document,
      clock: Math.max(this.document.clock, this.state.clock, ts),
      ops: [...this.document.ops, ...inverses],
    };
    this.persist();
    this.emit();
    return {
      inverse: { ops: inverses, pre: inversePre, label: record.label },
      changed: true,
    };
  }

  undo(): CommitResult {
    while (this.undoStack.length > 0) {
      const entry = this.undoStack.pop()!;
      const { inverse, changed } = this.applyInverseGroup(entry);
      if (changed) {
        this.redoStack.push(inverse!);
        this.cachedSnapshot = null;
        this.emit();
        return { changed: true };
      }
      // Fully invalidated by remote changes: drop silently and try next.
    }
    this.emit();
    return { changed: false };
  }

  redo(): CommitResult {
    while (this.redoStack.length > 0) {
      const entry = this.redoStack.pop()!;
      const { inverse, changed } = this.applyInverseGroup(entry);
      if (changed) {
        this.undoStack.push(inverse!);
        this.cachedSnapshot = null;
        this.emit();
        return { changed: true };
      }
    }
    this.emit();
    return { changed: false };
  }

  /**
   * Build a safe inverse for one op using the pre-action snapshot. Returns
   * null when the inverse no longer applies (target deleted, a guarded field
   * was changed concurrently, placement moved). Guards are conservative:
   * invalidated undos never resurrect objects, overwrite newer state, or break
   * list structure; unrelated remote edits are always left intact.
   */
  private invert(
    op: Op,
    pre: Map<string, PreSnapshot>,
    ts: number,
    makeOid: () => string,
    inversePre: Map<string, PreSnapshot>
  ): Op | null {
    const oid = makeOid();
    switch (op.kind) {
      case "label-add": {
        const label = this.state.labels.get(op.id);
        if (!label || label.addTs <= label.removeTs) return null;
        if (label.addTs !== op.ts) return null;
        return { oid, kind: "label-remove", id: op.id, ts };
      }
      case "label-remove": {
        const label = this.state.labels.get(op.id);
        if (!label || label.addTs > label.removeTs) return null;
        return {
          oid,
          kind: "label-add",
          id: op.id,
          label: label.value,
          ts,
        };
      }
      case "list-add": {
        const list = this.state.lists.get(op.id);
        if (!list || list.addTs <= list.removeTs) return null;
        if (list.addTs !== op.ts) return null;
        return { oid, kind: "list-remove", id: op.id, ts };
      }
      case "list-remove": {
        const list = this.state.lists.get(op.id);
        if (!list || list.addTs > list.removeTs) return null;
        const keys = this.boardListKeys();
        const key = keyForIndex(keys, keys.length);
        return {
          oid,
          kind: "list-add",
          id: op.id,
          title: list.title.value,
          tone: list.tone.value,
          labels: list.labels.value,
          key,
          ts,
        };
      }
      case "list-update": {
        const list = this.state.lists.get(op.id);
        const before = pre.get(op.id)?.list;
        if (!list || list.addTs <= list.removeTs || !before) return null;
        const fields: {
          title?: string;
          tone?: ListTone;
          labels?: Label[];
        } = {};
        // Selective: revert only fields this action won and that nobody else
        // has written since (including remote tabs).
        if (op.fields.title !== undefined && list.title.ts === op.ts) {
          fields.title = before.title;
        }
        if (op.fields.tone !== undefined && list.tone.ts === op.ts) {
          fields.tone = before.tone;
        }
        if (op.fields.labels !== undefined && list.labels.ts === op.ts) {
          fields.labels = before.labels;
        }
        if (Object.keys(fields).length === 0) return null;
        inversePre.set(op.id, {
          list: {
            title: list.title.value,
            tone: list.tone.value,
            labels: list.labels.value,
            key: list.key.value,
          },
        });
        return { oid, kind: "list-update", id: op.id, fields, ts };
      }
      case "list-reorder": {
        const list = this.state.lists.get(op.id);
        const before = pre.get(op.id)?.list;
        if (!list || list.addTs <= list.removeTs || !before) return null;
        // Only revert if this tab's reorder is still the winning placement.
        if (list.key.ts !== op.ts) return null;
        if (list.key.value !== op.key) return null;
        inversePre.set(op.id, {
          list: {
            title: list.title.value,
            tone: list.tone.value,
            labels: list.labels.value,
            key: list.key.value,
          },
        });
        return {
          oid,
          kind: "list-reorder",
          id: op.id,
          key: before.key,
          ts,
        };
      }
      case "card-add": {
        const card = this.state.cards.get(op.id);
        if (!card || card.addTs <= card.removeTs) return null;
        if (card.addTs !== op.ts) return null;
        return { oid, kind: "card-remove", id: op.id, ts };
      }
      case "card-remove": {
        const card = this.state.cards.get(op.id);
        if (!card || card.addTs > card.removeTs) return null;
        // Restore into the last known list if it still exists; otherwise the
        // card cannot be safely placed and the undo is skipped.
        const listId = card.listId.value;
        const list = this.state.lists.get(listId);
        if (!list || list.addTs <= list.removeTs) return null;
        const keys = this.cardKeys(listId);
        inversePre.set(op.id, {
          card: {
            listId: card.listId.value,
            key: card.key.value,
            title: card.title.value,
            content: card.content.value,
            labels: card.labels.value,
            dueDate: card.dueDate.value,
            priority: card.priority.value,
          },
        });
        return {
          oid,
          kind: "card-add",
          id: op.id,
          listId,
          fields: {
            title: card.title.value,
            content: card.content.value,
            labels: card.labels.value,
            dueDate: card.dueDate.value,
            priority: card.priority.value,
          },
          key: keyForIndex(keys, keys.length),
          ts,
        };
      }
      case "card-update": {
        const card = this.state.cards.get(op.id);
        const before = pre.get(op.id)?.card;
        if (!card || card.addTs <= card.removeTs || !before) return null;
        const fields: CardEdit = {};
        if (op.fields.title !== undefined && card.title.ts === op.ts) {
          fields.title = before.title;
        }
        if ("content" in op.fields && card.content.ts === op.ts) {
          fields.content = before.content;
        }
        if (op.fields.labels !== undefined && card.labels.ts === op.ts) {
          fields.labels = before.labels;
        }
        if ("dueDate" in op.fields && card.dueDate.ts === op.ts) {
          fields.dueDate = before.dueDate;
        }
        if ("priority" in op.fields && card.priority.ts === op.ts) {
          fields.priority = before.priority;
        }
        if (Object.keys(fields).length === 0) return null;
        inversePre.set(op.id, {
          card: {
            listId: card.listId.value,
            key: card.key.value,
            title: card.title.value,
            content: card.content.value,
            labels: card.labels.value,
            dueDate: card.dueDate.value,
            priority: card.priority.value,
          },
        });
        return { oid, kind: "card-update", id: op.id, fields, ts };
      }
      case "card-move": {
        const card = this.state.cards.get(op.id);
        const before = pre.get(op.id)?.card;
        if (!card || card.addTs <= card.removeTs || !before) return null;
        // Undo only when this move is still the winner for both placement
        // fields and the original list still exists.
        if (card.listId.ts !== op.ts || card.key.ts !== op.ts) return null;
        if (card.listId.value !== op.listId || card.key.value !== op.key) {
          return null;
        }
        const origin = this.state.lists.get(before.listId);
        if (!origin || origin.addTs <= origin.removeTs) return null;
        inversePre.set(op.id, {
          card: {
            listId: card.listId.value,
            key: card.key.value,
            title: card.title.value,
            content: card.content.value,
            labels: card.labels.value,
            dueDate: card.dueDate.value,
            priority: card.priority.value,
          },
        });
        return {
          oid,
          kind: "card-move",
          id: op.id,
          listId: before.listId,
          key: before.key,
          ts,
        };
      }
    }
  }
}
