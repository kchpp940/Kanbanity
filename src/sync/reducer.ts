import type { Board, Card, Label, List, ListTone } from "../types/kanban";
import { evenlySpacedKeys } from "./order";
import type { Op, SyncDocument } from "./ops";
import { compareOps } from "./ops";

interface FieldValue<T> {
  value: T;
  ts: number;
  winner: string;
}

interface ListRecord {
  addTs: number;
  removeTs: number;
  title: FieldValue<string>;
  tone: FieldValue<ListTone>;
  labels: FieldValue<Label[]>;
  key: FieldValue<string>;
}

interface CardRecord {
  addTs: number;
  removeTs: number;
  listId: FieldValue<string>;
  key: FieldValue<string>;
  title: FieldValue<string>;
  content: FieldValue<string | undefined>;
  labels: FieldValue<Label[]>;
  dueDate: FieldValue<string | undefined>;
  priority: FieldValue<"low" | "medium" | "high" | undefined>;
}

export interface ReductionState {
  labels: Map<string, { value: Label; addTs: number; removeTs: number }>;
  lists: Map<string, ListRecord>;
  cards: Map<string, CardRecord>;
  clock: number;
}

function emptyState(clock = 0): ReductionState {
  return { labels: new Map(), lists: new Map(), cards: new Map(), clock };
}

/** LWW per field, with deterministic oid tie-break (ops applied in total
 *  order, so the first writer at an equal timestamp wins). */
function applyWins<T>(field: FieldValue<T>, value: T, op: Op): FieldValue<T> {
  if (
    op.ts > field.ts ||
    (op.ts === field.ts && op.oid < field.winner)
  ) {
    return { value, ts: op.ts, winner: op.oid };
  }
  return field;
}

export function applyOp(state: ReductionState, op: Op): void {
  if (op.ts > state.clock) state.clock = op.ts;

  switch (op.kind) {
    case "label-add": {
      const existing = state.labels.get(op.id);
      if (!existing) {
        state.labels.set(op.id, { value: op.label, addTs: op.ts, removeTs: -1 });
      } else if (op.ts > existing.addTs) {
        existing.addTs = op.ts;
      }
      return;
    }
    case "label-remove": {
      const existing = state.labels.get(op.id);
      if (existing && op.ts > existing.removeTs) existing.removeTs = op.ts;
      return;
    }
    case "list-add": {
      const existing = state.lists.get(op.id);
      if (!existing) {
        state.lists.set(op.id, {
          addTs: op.ts,
          removeTs: -1,
          title: { value: op.title, ts: op.ts, winner: op.oid },
          tone: { value: op.tone, ts: op.ts, winner: op.oid },
          labels: { value: op.labels, ts: op.ts, winner: op.oid },
          key: { value: op.key, ts: op.ts, winner: op.oid },
        });
      } else {
        if (existing.addTs > existing.removeTs && op.ts < existing.addTs) {
          return;
        }
        existing.addTs = Math.max(existing.addTs, op.ts);
        existing.removeTs = -1;
        existing.title = applyWins(existing.title, op.title, op);
        existing.tone = applyWins(existing.tone, op.tone, op);
        existing.labels = applyWins(existing.labels, op.labels, op);
        existing.key = applyWins(existing.key, op.key, op);
      }
      return;
    }
    case "list-remove": {
      const list = state.lists.get(op.id);
      if (list && op.ts > list.removeTs) list.removeTs = op.ts;
      return;
    }
    case "list-update": {
      const list = state.lists.get(op.id);
      if (!list || op.ts < list.addTs || op.ts <= list.removeTs) return;
      if (op.fields.title !== undefined) {
        list.title = applyWins(list.title, op.fields.title, op);
      }
      if (op.fields.tone !== undefined) {
        list.tone = applyWins(list.tone, op.fields.tone, op);
      }
      if (op.fields.labels !== undefined) {
        list.labels = applyWins(list.labels, op.fields.labels, op);
      }
      return;
    }
    case "list-reorder": {
      const list = state.lists.get(op.id);
      if (!list || op.ts < list.addTs || op.ts <= list.removeTs) return;
      list.key = applyWins(list.key, op.key, op);
      return;
    }
    case "card-add": {
      const existing = state.cards.get(op.id);
      if (!existing) {
        state.cards.set(op.id, {
          addTs: op.ts,
          removeTs: -1,
          listId: { value: op.listId, ts: op.ts, winner: op.oid },
          key: { value: op.key, ts: op.ts, winner: op.oid },
          title: { value: op.fields.title, ts: op.ts, winner: op.oid },
          content: { value: op.fields.content, ts: op.ts, winner: op.oid },
          labels: { value: op.fields.labels ?? [], ts: op.ts, winner: op.oid },
          dueDate: { value: op.fields.dueDate, ts: op.ts, winner: op.oid },
          priority: { value: op.fields.priority, ts: op.ts, winner: op.oid },
        });
      } else {
        // Re-creation (also used as the inverse of a delete): card-add
        // explicitly revives the identity. Only a genuine user/undo action
        // produces this op, so a stale late delivery can never resurrect.
        if (existing.addTs > existing.removeTs && op.ts < existing.addTs) {
          return;
        }
        existing.addTs = Math.max(existing.addTs, op.ts);
        existing.removeTs = -1;
        // Restore at the placement chosen by the restore action itself.
        existing.listId = { value: op.listId, ts: op.ts, winner: op.oid };
        existing.key = { value: op.key, ts: op.ts, winner: op.oid };
        if (op.fields.title !== undefined) {
          existing.title = applyWins(existing.title, op.fields.title, op);
        }
        if ("content" in op.fields) {
          existing.content = applyWins(existing.content, op.fields.content, op);
        }
        if (op.fields.labels !== undefined) {
          existing.labels = applyWins(existing.labels, op.fields.labels ?? [], op);
        }
        if ("dueDate" in op.fields) {
          existing.dueDate = applyWins(existing.dueDate, op.fields.dueDate, op);
        }
        if ("priority" in op.fields) {
          existing.priority = applyWins(existing.priority, op.fields.priority, op);
        }
      }
      return;
    }
    case "card-remove": {
      const card = state.cards.get(op.id);
      if (card && op.ts > card.removeTs) card.removeTs = op.ts;
      return;
    }
    case "card-update": {
      const card = state.cards.get(op.id);
      if (!card || op.ts < card.addTs) return;
      // Field updates are applied even when the card is currently deleted:
      // they never resurrect it (projection filters removed cards), but a
      // later explicit restore keeps the newest field values.
      const fields = op.fields;
      if (fields.title !== undefined) {
        card.title = applyWins(card.title, fields.title, op);
      }
      if ("content" in fields) {
        card.content = applyWins(card.content, fields.content, op);
      }
      if (fields.labels !== undefined) {
        card.labels = applyWins(card.labels, fields.labels, op);
      }
      if ("dueDate" in fields) {
        card.dueDate = applyWins(card.dueDate, fields.dueDate, op);
      }
      if ("priority" in fields) {
        card.priority = applyWins(card.priority, fields.priority, op);
      }
      return;
    }
    case "card-move": {
      const card = state.cards.get(op.id);
      if (!card || op.ts < card.addTs || op.ts <= card.removeTs) return;
      const destination = state.lists.get(op.listId);
      // A move into a list that does not exist in the final state is
      // discarded: the card keeps its previous placement and is never lost.
      if (!destination || destination.addTs <= destination.removeTs) {
        return;
      }
      card.listId = applyWins(card.listId, op.listId, op);
      card.key = applyWins(card.key, op.key, op);
      return;
    }
  }
}

/** Deterministic projection of all ops into a Board. */
export function reduceOps(
  ops: readonly Op[],
  boardTitle: string,
  boardId = "board-1"
): { board: Board; state: ReductionState } {
  const state = emptyState();
  const sorted = [...ops].sort(compareOps);
  for (const op of sorted) {
    applyOp(state, op);
  }
  return { board: project(state, boardTitle, boardId), state };
}

function resolveLabels(record: Label[] | undefined, live: Set<string>): Label[] {
  if (!record) return [];
  const seen = new Set<string>();
  const result: Label[] = [];
  for (const label of record) {
    if (!live.has(label.id) || seen.has(label.id)) continue;
    seen.add(label.id);
    result.push(label);
  }
  return result;
}

export function project(
  state: ReductionState,
  boardTitle: string,
  boardId = "board-1"
): Board {
  const liveLabels = new Set<string>();
  const availableLabels: Label[] = [];
  for (const [id, record] of state.labels) {
    if (record.addTs > record.removeTs) {
      liveLabels.add(id);
      availableLabels.push(record.value);
    }
  }

  const liveLists = new Map<string, ListRecord>();
  for (const [id, record] of state.lists) {
    if (record.addTs > record.removeTs) liveLists.set(id, record);
  }

  const lists: List[] = [...liveLists.entries()]
    .map(([id, record]) => ({ id, record }))
    .sort((a, b) => {
      if (a.record.key.value !== b.record.key.value) {
        return a.record.key.value < b.record.key.value ? -1 : 1;
      }
      return a.record.addTs !== b.record.addTs
        ? a.record.addTs - b.record.addTs
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map(({ id, record }) => ({
      id,
      title: record.title.value,
      tone: record.tone.value,
      labels: resolveLabels(record.labels.value, liveLabels),
      cards: sortCards(state, id, liveLists, liveLabels),
    }));

  return { id: boardId, title: boardTitle, lists, availableLabels };
}

function sortCards(
  state: ReductionState,
  listId: string,
  liveLists: Map<string, ListRecord>,
  liveLabels: Set<string>
): Card[] {
  const result: Card[] = [];
  for (const [id, card] of state.cards) {
    if (card.addTs <= card.removeTs) continue;
    if (card.listId.value !== listId) continue;
    if (!liveLists.has(card.listId.value)) continue;
    result.push({
      id,
      title: card.title.value,
      content: card.content.value,
      labels: resolveLabels(card.labels.value, liveLabels),
      dueDate: card.dueDate.value,
      priority: card.priority.value,
    });
  }
  result.sort((a, b) => {
    const ra = state.cards.get(a.id)!;
    const rb = state.cards.get(b.id)!;
    if (ra.key.value !== rb.key.value) {
      return ra.key.value < rb.key.value ? -1 : 1;
    }
    // Deterministic conflict rule for concurrent moves that produced the
    // same fractional key: lower card id wins, then add timestamp.
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return ra.addTs - rb.addTs;
  });
  return result;
}

/** Build the seed op set for a fresh install or legacy migration. */
export function seedOps(board: Board, baseTs = 0): Op[] {
  const ops: Op[] = [];
  const listKeys = evenlySpacedKeys(board.lists.length);
  board.lists.forEach((list, listIndex) => {
    ops.push({
      oid: `seed:list-add:${list.id}`,
      kind: "list-add",
      id: list.id,
      title: list.title,
      tone: list.tone ?? "blue",
      labels: list.labels ?? [],
      key: listKeys[listIndex],
      ts: baseTs,
    });
    const cardKeys = evenlySpacedKeys(list.cards.length);
    list.cards.forEach((card, cardIndex) => {
      ops.push({
        oid: `seed:card-add:${card.id}`,
        kind: "card-add",
        id: card.id,
        listId: list.id,
        fields: {
          title: card.title,
          content: card.content,
          labels: card.labels ?? [],
          dueDate: card.dueDate,
          priority: card.priority,
        },
        key: cardKeys[cardIndex],
        ts: baseTs,
      });
    });
  });
  for (const label of board.availableLabels) {
    ops.push({
      oid: `seed:label-add:${label.id}`,
      kind: "label-add",
      id: label.id,
      label,
      ts: baseTs,
    });
  }
  return ops;
}

export function seedDocument(board: Board, baseTs = 0): SyncDocument {
  const ops = seedOps(board, baseTs);
  return { version: 2, clock: baseTs, ops, boardTitle: board.title };
}
