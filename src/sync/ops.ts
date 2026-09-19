import type { Card, Label, ListTone } from "../types/kanban";

export type Priority = "low" | "medium" | "high";

/** Lamport timestamp: counter compared first, op id as tie breaker. */
export interface Lamport {
  ts: number;
  id: string;
}

export interface CardFields {
  title?: string;
  content?: string;
  labels?: Label[];
  dueDate?: string;
  priority?: Priority;
}

/**
 * Every real business mutation is exactly one of these operations.
 * `checkTs` guards selective undo: the inverse is valid only if the field
 * being reverted has not been changed by a later (concurrent or remote) op.
 */
export type Op =
  | { oid: string; kind: "label-add"; id: string; label: Label; ts: number }
  | { oid: string; kind: "label-remove"; id: string; ts: number }
  | {
      oid: string;
      kind: "list-add";
      id: string;
      title: string;
      tone: ListTone;
      labels: Label[];
      key: string;
      ts: number;
    }
  | { oid: string; kind: "list-remove"; id: string; ts: number }
  | {
      oid: string;
      kind: "list-update";
      id: string;
      fields: { title?: string; tone?: ListTone; labels?: Label[] };
      ts: number;
    }
  | {
      oid: string;
      kind: "list-reorder";
      id: string;
      key: string;
      ts: number;
    }
  | {
      oid: string;
      kind: "card-add";
      id: string;
      listId: string;
      fields: Required<Pick<CardFields, "title">> & CardFields;
      key: string;
      ts: number;
    }
  | { oid: string; kind: "card-remove"; id: string; ts: number }
  | {
      oid: string;
      kind: "card-update";
      id: string;
      fields: CardFields;
      ts: number;
    }
  | {
      oid: string;
      kind: "card-move";
      id: string;
      listId: string;
      key: string;
      /** previous placement, captured for safe undo. */
      fromListId?: string;
      fromKey?: string;
      ts: number;
    };

export interface SyncDocument {
  version: 2;
  /** Highest Lamport counter ever seen by this document lineage. */
  clock: number;
  ops: Op[];
  /** Board metadata not covered by ops (currently just the title). */
  boardTitle: string;
}

export function opTs(op: Op): number {
  return op.ts;
}

/** Total deterministic ordering: timestamp first, then op kind/id tie break. */
export function compareOps(a: Op, b: Op): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.oid !== b.oid) {
    return a.oid < b.oid ? -1 : 1;
  }
  return 0;
}

export type { Card, Label };
