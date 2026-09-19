import { useSyncExternalStore } from "react";
import type { Board } from "../types/kanban";
import { emptyEnvelope, parseEnvelope, type BoardStorage } from "./storage";
import { mergeEntities, reduceOps } from "./reducer";
import type { BoardOp, HistoryEntry, StoreEnvelope } from "./op";
import { buildInverse, buildRedo } from "./history";

export const MAX_LIVE_OPS = 500;

/**
 * Deterministic merge of two envelopes. Union of op ids (deduped, applied
 * once), highest clock, and field-level LWW merge of CRDT entity metadata —
 * so tabs that compacted their logs independently still converge exactly.
 */
export function mergeEnvelopes(
  a: StoreEnvelope,
  b: StoreEnvelope,
  sender: string
): StoreEnvelope {
  const folded = new Set<string>([...a.folded, ...b.folded]);
  const opMap = new Map<string, BoardOp>();
  for (const op of [...a.ops, ...b.ops]) {
    if (folded.has(op.id)) continue;
    const existing = opMap.get(op.id);
    if (!existing || op.clock > existing.clock) opMap.set(op.id, op);
  }
  const clock = Math.max(a.clock, b.clock);
  const boardMeta = pickBoardMeta(a, b);
  const ops = [...opMap.values()];
  // Field-level LWW merge of the two snapshots gives the correct state for
  // edits folded into one side only; then replay every retained op that is
  // newer than the folded field stamps, so ordering ops (which must compose)
  // are recomputed canonically on every tab.
  const merged = mergeEntities(a.entities, b.entities);
  const state = reduceOps(boardMeta, ops, merged);
  const entities = state.entities;
  return rederive({
    format: 2,
    sender,
    clock,
    folded: [...folded],
    ops,
    entities,
    board: boardMeta,
  });
}

function pickBoardMeta(a: StoreEnvelope, b: StoreEnvelope): Board {
  // Board id/title are immutable in this app; prefer whichever has content.
  const candidate = a.board.lists.length >= b.board.lists.length ? a.board : b.board;
  return {
    id: a.board.id ?? b.board.id ?? candidate.id,
    title: a.board.title ?? b.board.title ?? candidate.title,
    lists: [],
    availableLabels: [],
  };
}

/** Re-derive the snapshot board by reducing retained ops over entities. */
function rederive(envelope: StoreEnvelope): StoreEnvelope {
  const state = reduceOps(envelope.board, dedupeOps(envelope.ops), envelope.entities);
  return {
    ...envelope,
    entities: state.entities,
    board: state.board,
    ops: dedupeOps(envelope.ops),
  };
}

function dedupeOps(ops: BoardOp[]): BoardOp[] {
  const seen = new Set<string>();
  const result: BoardOp[] = [];
  for (const op of ops) {
    if (seen.has(op.id)) continue;
    seen.add(op.id);
    result.push(op);
  }
  return result;
}

/** Fold the oldest ops into entity metadata, bounding the live op log. */
export function compactEnvelope(
  envelope: StoreEnvelope,
  sender: string
): StoreEnvelope {
  if (envelope.ops.length <= MAX_LIVE_OPS) return envelope;
  const sorted = dedupeOps(envelope.ops).sort(compareOps);
  const foldCount = sorted.length - MAX_LIVE_OPS;
  const folding = sorted.slice(0, foldCount);
  const remaining = sorted.slice(foldCount);
  const state = reduceOps(envelope.board, folding, envelope.entities);
  return {
    format: 2,
    sender,
    clock: envelope.clock,
    folded: [...new Set([...envelope.folded, ...folding.map((op) => op.id)])],
    ops: remaining,
    entities: state.entities,
    board: state.board,
  };
}

function compareOps(a: BoardOp, b: BoardOp): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  return a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0;
}

function createTabId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export interface EngineOptions {
  storage: BoardStorage;
  fallback: Board;
  tabId?: string;
}

export class BoardEngine {
  private envelope: StoreEnvelope;
  private readonly storage: BoardStorage;
  private readonly fallback: Board;
  private readonly tabId: string;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(options: EngineOptions) {
    this.storage = options.storage;
    this.fallback = options.fallback;
    this.tabId = options.tabId ?? createTabId();
    const loaded =
      parseEnvelope(this.storage.getItem("kanbanity-board"), this.fallback) ??
      emptyEnvelope(this.fallback);
    this.envelope = compactEnvelope(rederive(loaded), this.tabId);
    this.persist();
    this.unsubscribe = this.storage.subscribe((raw) => {
      this.onRemote(raw);
    });
  }

  destroy() {
    this.unsubscribe();
    this.listeners.clear();
  }

  getBoard(): Board {
    return this.envelope.board;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Delete op id for a currently deleted card, if known (test/diagnostic). */
  deletedCardOp(cardId: string): string | undefined {
    return this.envelope.entities.cards[cardId]?.del?.opId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Commit one atomic local action. Returning null means the action made no
   * real change (cancel, drop back on origin, missing target): no history
   * entry and no replicated op are produced.
   */
  commit(
    build: (context: CommitContext) => CommitResult | null
  ): boolean {
    const result = build({
      board: this.envelope.board,
      clock: this.envelope.clock + 1,
      origin: this.tabId,
      makeId: () => this.makeOpId(),
    });
    if (!result) return false;
    this.appendLocal(result.op, result.history ?? null);
    return true;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const inverse = buildInverse(
      entry,
      this.envelope.board,
      this.deleteMap("lists"),
      this.deleteMap("cards"),
      { id: this.makeOpId(), clock: this.envelope.clock + 1, origin: this.tabId }
    );
    if (!inverse) {
      this.emit();
      return false;
    }
    this.appendLocal(inverse, null);
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const forward = buildRedo(
      entry,
      this.envelope.board,
      this.deleteMap("lists"),
      this.deleteMap("cards"),
      { id: this.makeOpId(), clock: this.envelope.clock + 1, origin: this.tabId }
    );
    if (!forward) {
      this.emit();
      return false;
    }
    this.appendLocal(forward, null);
    this.undoStack.push(entry);
    return true;
  }

  private deleteMap(kind: "lists" | "cards"): Map<string, string> {
    const result = new Map<string, string>();
    const store = kind === "lists" ? this.envelope.entities.lists : this.envelope.entities.cards;
    for (const [id, rec] of Object.entries(store)) {
      if (rec.del) result.set(id, rec.del.opId);
    }
    return result;
  }

  private appendLocal(op: BoardOp, historyKind: HistoryEntry["kind"] | null) {
    const next: StoreEnvelope = {
      ...this.envelope,
      sender: this.tabId,
      clock: op.clock,
      ops: dedupeOps([...this.envelope.ops, op]),
    };
    this.envelope = compactEnvelope(rederive(next), this.tabId);
    if (historyKind) {
      this.undoStack.push({ kind: historyKind, op });
      this.redoStack = [];
    }
    this.persist();
    this.emit();
  }

  private onRemote(raw: string | null) {
    const remote = parseEnvelope(raw, this.fallback);
    if (!remote || remote.sender === this.tabId) return;
    const merged = compactEnvelope(
      rederive(mergeEnvelopes(this.envelope, remote, this.tabId)),
      this.tabId
    );
    if (this.sameLog(merged)) return;
    this.envelope = merged;
    this.emit();
  }

  private sameLog(other: StoreEnvelope): boolean {
    if (other.clock !== this.envelope.clock) return false;
    if (other.folded.length !== this.envelope.folded.length) return false;
    const folded = new Set(this.envelope.folded);
    if (other.folded.some((id) => !folded.has(id))) return false;
    if (other.ops.length !== this.envelope.ops.length) return false;
    const ids = new Set(this.envelope.ops.map((op) => op.id));
    return other.ops.every((op) => ids.has(op.id));
  }

  private persist() {
    try {
      this.storage.setItem("kanbanity-board", JSON.stringify(this.envelope));
    } catch {
      // Storage full/unavailable: in-memory state still works for the tab.
    }
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private makeOpId(): string {
    return "op-" + this.tabId + "-" + Math.random().toString(36).slice(2, 9);
  }
}

export interface CommitContext {
  board: Board;
  clock: number;
  origin: string;
  makeId: () => string;
}

export interface CommitResult {
  op: BoardOp;
  history?: HistoryEntry["kind"];
}

export function useEngineBoard(engine: BoardEngine): Board {
  return useSyncExternalStore(engine.subscribe, () => engine.getBoard());
}
