import type { Card, Label, List } from "../types/kanban";

export interface Stamp {
  clock: number;
  origin: string;
}
export interface DelStamp extends Stamp {
  opId: string;
}

export interface ListRec {
  add: Stamp;
  edit: Stamp;
  del?: DelStamp;
  /** Entity payload as of add or latest edit. */
  snapshot: Omit<List, "cards">;
  /** Latest card-order vector known for this list. */
  order?: Stamp & { cards: string[] };
}

export interface CardRec {
  add: Stamp;
  edit: Stamp;
  move: Stamp;
  listId: string;
  del?: DelStamp;
  snapshot: Card;
  /** Edits observed while the card was deleted; folded in on restore. */
  /** Edits seen while deleted, keyed by the delete op they were based on. */
  ghost?: Record<string, Stamp & { patch: import("./op").CardPatch }>;
}

export interface LabelRec {
  add: Stamp;
  del?: Stamp;
  snapshot: Label;
}

/** Persistent CRDT metadata. Survives log compaction and makes snapshots
 *  from independently compacted tabs mergeable. */
export interface EntityStore {
  listOrder: (Stamp & { order: string[] }) | null;
  lists: Record<string, ListRec>;
  cards: Record<string, CardRec>;
  labels: Record<string, LabelRec>;
}

export function emptyEntityStore(): EntityStore {
  return { listOrder: null, lists: {}, cards: {}, labels: {} };
}

export function stampGt(a: Stamp, b: Stamp): boolean {
  return a.clock !== b.clock ? a.clock > b.clock : a.origin > b.origin;
}
