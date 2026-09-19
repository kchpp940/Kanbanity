import type { Board, Card, Label, List, ListTone } from "../types/kanban";
import type { EntityStore } from "./records";

/**
 * Every real business mutation is represented as a single, append-only,
 * deterministic operation. Operations are replicated to every tab and
 * reduced against the same base state, which guarantees convergence
 * regardless of delivery order.
 */

export type CardPatch = Partial<
  Pick<Card, "title" | "content" | "labels" | "dueDate" | "priority">
>;

export interface OpBase {
  /** Globally unique, stable id; makes delivery idempotent. */
  id: string;
  /** Monotonically increasing lamport clock captured at submit time. */
  clock: number;
  /** Deterministic tie-breaker (unique per tab/session). */
  origin: string;
}

export interface AddListOp extends OpBase {
  type: "addList";
  listId: string;
  list: Omit<List, "cards">;
  cards: Card[];
}

export interface EditListOp extends OpBase {
  type: "editList";
  listId: string;
  patch: Partial<Pick<List, "title" | "tone" | "labels">>;
  /** Optional expected current values, used by undo to avoid clobbering. */
  expect?: Partial<Pick<List, "title" | "tone" | "labels">>;
}

export interface DeleteListOp extends OpBase {
  type: "deleteList";
  listId: string;
}

export interface ReorderListsOp extends OpBase {
  type: "reorderLists";
  /** Full canonical order of list ids at submit time. */
  order: string[];
  /** Id of the list moved; used by inverse ops. */
  listId: string;
}

export interface AddCardOp extends OpBase {
  type: "addCard";
  listId: string;
  card: Card;
}

export interface EditCardOp extends OpBase {
  type: "editCard";
  listId: string;
  cardId: string;
  patch: CardPatch;
  expect?: CardPatch;
  /** Set when the card was observed deleted; ghost is tied to this delete. */
  basedOnDelete?: string;
}

export interface DeleteCardOp extends OpBase {
  type: "deleteCard";
  listId: string;
  cardId: string;
}

export interface MoveCardOp extends OpBase {
  type: "moveCard";
  cardId: string;
  /** Insert after this card id within toListId; null = start of list. */
  afterId: string | null;
  toListId: string;
  /** Pre-move placement, used to build the exact inverse op. */
  originListId: string;
  originAfter: string | null;
}

export interface AddLabelOp extends OpBase {
  type: "addLabel";
  label: Label;
}

export interface RemoveLabelOp extends OpBase {
  type: "removeLabel";
  labelId: string;
}

export interface RestoreListOp extends OpBase {
  type: "restoreList";
  listId: string;
  /** Only applies if the latest delete of this list has this op id. */
  deleteOpId: string;
  insertAfter: string | null;
}

export interface RestoreCardOp extends OpBase {
  type: "restoreCard";
  cardId: string;
  deleteOpId: string;
  listId: string;
  afterId: string | null;
}

export type BoardOp =
  | AddListOp
  | EditListOp
  | DeleteListOp
  | ReorderListsOp
  | AddCardOp
  | EditCardOp
  | DeleteCardOp
  | MoveCardOp
  | AddLabelOp
  | RemoveLabelOp
  | RestoreListOp
  | RestoreCardOp;

/** Persisted envelope. Business state and sync metadata live in one key,
 *  written in a single setItem call (no partial writes possible). */
export interface StoreEnvelope {
  format: 2;
  clock: number;
  /** Origin of the tab that last wrote this envelope. */
  sender: string;
  /** Ids of every op folded into the snapshot (incl. pre-compaction). */
  folded: string[];
  /** Ops newer than the snapshot. */
  ops: BoardOp[];
  /** Live board state, derived from folded ops at compaction time. */
  board: Board;
  /** CRDT entity metadata used to merge independently compacted tabs. */
  entities: EntityStore;
}

/** Human-facing kind of a local action, used to build inverse ops. */
export type HistoryKind =
  | "addList"
  | "editList"
  | "deleteList"
  | "reorderLists"
  | "addCard"
  | "editCard"
  | "deleteCard"
  | "moveCard"
  | "addLabel";

export interface HistoryEntry {
  kind: HistoryKind;
  /** The committed local op this entry can undo. */
  op: BoardOp;
}

export type { ListTone };
