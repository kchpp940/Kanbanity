import type { Board, Card, List } from "../types/kanban";
import type { BoardOp, CardPatch, MoveCardOp } from "./op";
import {
  emptyEntityStore,
  stampGt,
  type CardRec,
  type EntityStore,
  type LabelRec,
  type ListRec,
  type Stamp,
} from "./records";

/**
 * Reduction state. Entity records are the persistent CRDT layer; the board is
 * re-derived from them plus the live ops. Ghost maps buffer edits/moves that
 * target currently deleted cards. A later restore folds them back in, while
 * a plain delete is never resurrected by a late edit/move.
 */
export interface ReduceState {
  board: Board;
  entities: EntityStore;
  lastListDelete: Map<string, string>;
  lastCardDelete: Map<string, string>;
  listSnapshots: Map<string, List>;
  cardSnapshots: Map<string, Card>;
  ghostMoves: Map<string, { listId: string; afterId: string | null }>;
}

export function stamp(op: { clock: number; origin: string }): Stamp {
  return { clock: op.clock, origin: op.origin };
}

/** Seed entity records from a board (used for legacy v1 / snapshot boards). */
export function seedEntities(
  board: Board,
  entities: EntityStore = emptyEntityStore()
): EntityStore {
  const zero: Stamp = { clock: 0, origin: "" };
  for (const list of board.lists) {
    if (!entities.lists[list.id]) {
      const { cards: _cards, ...meta } = list;
      void _cards;
      entities.lists[list.id] = {
        add: zero,
        edit: zero,
        snapshot: meta,
        order: { ...zero, cards: list.cards.map((card) => card.id) },
      };
    }
    for (const card of list.cards) {
      if (!entities.cards[card.id]) {
        entities.cards[card.id] = {
          add: zero,
          edit: zero,
          move: zero,
          listId: list.id,
          snapshot: card,
        };
      }
    }
  }
  for (const label of board.availableLabels) {
    if (!entities.labels[label.id]) {
      entities.labels[label.id] = { add: zero, snapshot: label };
    }
  }
  if (!entities.listOrder) {
    entities.listOrder = {
      ...zero,
      order: board.lists.map((list) => list.id),
    };
  }
  return entities;
}

export function initReduceState(
  board: Board,
  entities?: EntityStore
): ReduceState {
  const seeded = seedEntities(structuredClone(board), entities ? structuredClone(entities) : undefined);
  return {
    board: deriveBoard(board.id, board.title, seeded),
    entities: seeded,
    lastListDelete: new Map(),
    lastCardDelete: new Map(),
    listSnapshots: new Map(),
    cardSnapshots: new Map(),
    ghostMoves: new Map(),
  };
}

export function deriveBoard(id: string, title: string, entities: EntityStore): Board {
  const liveLists = new Set(
    Object.keys(entities.lists).filter((listId) => !entities.lists[listId].del)
  );
  const liveCards = new Set(
    Object.keys(entities.cards).filter((cardId) => !entities.cards[cardId].del)
  );

  const order = entities.listOrder?.order.filter((listId) =>
    liveLists.has(listId)
  ) ?? [];
  for (const listId of liveLists) {
    if (!order.includes(listId)) order.push(listId);
  }

  const lists: List[] = [];
  for (const listId of order) {
    const rec = entities.lists[listId];
    const cardOrder = rec.order?.cards.filter((cardId) => {
      const cardRec = entities.cards[cardId];
      return cardRec && !cardRec.del && cardRec.listId === listId;
    }) ?? [];
    for (const cardId of liveCards) {
      const cardRec = entities.cards[cardId];
      if (cardRec.listId === listId && !cardOrder.includes(cardId)) {
        cardOrder.push(cardId);
      }
    }
    lists.push({
      ...structuredClone(rec.snapshot),
      cards: cardOrder
        .map((cardId) => structuredClone(entities.cards[cardId].snapshot))
        .filter((card): card is Card => Boolean(card)),
    });
  }

  const availableLabels = Object.values(entities.labels)
    .filter((rec) => !rec.del)
    .sort((a, b) =>
      a.add.clock !== b.add.clock
        ? a.add.clock - b.add.clock
        : a.add.origin < b.add.origin
        ? -1
        : a.add.origin > b.add.origin
        ? 1
        : 0
    )
    .map((rec) => structuredClone(rec.snapshot));

  return { id, title, lists, availableLabels };
}

/** Canonical total order: lamport clock first, unique origin second. */
export function opOrder(a: BoardOp, b: BoardOp): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  return a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0;
}

function boardMeta(board: Board) {
  return { id: board.id, title: board.title };
}

function rebuild(state: ReduceState) {
  const { id, title } = boardMeta(state.board);
  state.board = deriveBoard(id, title, state.entities);
}

function matchesExpected<T>(
  actual: T | undefined,
  expected: Partial<T> | undefined
): boolean {
  if (!expected) return true;
  if (actual === undefined || actual === null) return false;
  for (const key of Object.keys(expected) as (keyof T)[]) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      return false;
    }
  }
  return true;
}

function findList(state: ReduceState, listId: string): List | undefined {
  return state.board.lists.find((list) => list.id === listId);
}

function findCard(
  state: ReduceState,
  cardId: string
): { list: List; card: Card; index: number } | undefined {
  for (const list of state.board.lists) {
    const index = list.cards.findIndex((card) => card.id === cardId);
    if (index !== -1) return { list, card: list.cards[index], index };
  }
  return undefined;
}

function currentCardOrder(state: ReduceState, listId: string): string[] {
  const list = findList(state, listId);
  return list ? list.cards.map((card) => card.id) : [];
}

function insertAfterOrder(order: string[], id: string, afterId: string | null) {
  const index = order.indexOf(id);
  if (index !== -1) order.splice(index, 1);
  if (afterId === null) {
    order.unshift(id);
    return;
  }
  const anchor = order.indexOf(afterId);
  order.splice(anchor === -1 ? order.length : anchor + 1, 0, id);
}

function addCardRecord(
  state: ReduceState,
  listId: string,
  card: Card,
  s: Stamp
) {
  const entities = state.entities;
  const listRec = entities.lists[listId];
  if (!listRec || listRec.del) return;
  const existing = entities.cards[card.id];
  if (existing && !existing.del) return;
  if (existing && existing.del && !stampGt(s, existing.del)) return;
  entities.cards[card.id] = {
    add: s,
    edit: s,
    move: s,
    listId,
    snapshot: structuredClone(card),
  };
  const order = listRec.order?.cards ?? [];
  if (!order.includes(card.id)) order.push(card.id);
  listRec.order = { ...s, cards: order };
}

function bufferGhost(
  state: ReduceState,
  op: { clock: number; origin: string },
  cardId: string,
  patch: CardPatch
) {
  const basedOn =
    "basedOnDelete" in op && typeof (op as { basedOnDelete?: string }).basedOnDelete === "string"
      ? ((op as { basedOnDelete: string }).basedOnDelete)
      : "*";
  const rec = state.entities.cards[cardId];
  if (!rec) return;
  if (!rec.ghost) rec.ghost = {};
  const incoming = { ...op, patch: structuredClone(patch) };
  const bucket = rec.ghost[basedOn] ?? { ...incoming, patch: {} };
  rec.ghost[basedOn] = {
    ...incoming,
    patch: { ...bucket.patch, ...incoming.patch },
  };
}

/** Fold only ghost edits based on the exact delete being undone. */
function applyGhostFor(state: ReduceState, rec: CardRec, deleteOpId: string) {
  void state;
  const bucket = rec.ghost?.[deleteOpId];
  if (!bucket) return;
  rec.snapshot = { ...rec.snapshot, ...structuredClone(bucket.patch) };
  if (rec.ghost) {
    delete rec.ghost[deleteOpId];
    if (Object.keys(rec.ghost).length === 0) rec.ghost = undefined;
  }
}

function applyMove(state: ReduceState, op: MoveCardOp, s: Stamp) {
  const entities = state.entities;
  const rec = entities.cards[op.cardId];
  if (!rec || rec.del) return;
  const target = entities.lists[op.toListId];
  if (!target || target.del) {
    state.ghostMoves.set(op.cardId, {
      listId: op.toListId,
      afterId: op.afterId,
    });
    return;
  }
  if (!stampGt(s, rec.move)) return;
  const oldOrder = currentCardOrder(state, rec.listId);
  let nextOrder: string[];
  if (rec.listId === op.toListId) {
    nextOrder = oldOrder.filter((id) => id !== op.cardId);
    insertAfterOrder(nextOrder, op.cardId, op.afterId);
    if (nextOrder.every((id, index) => id === oldOrder[index])) return;
  } else {
    const source = entities.lists[rec.listId];
    if (source?.order) {
      source.order = {
        ...s,
        cards: source.order.cards.filter((id) => id !== op.cardId),
      };
    }
    nextOrder = currentCardOrder(state, op.toListId).filter(
      (id) => id !== op.cardId
    );
    insertAfterOrder(nextOrder, op.cardId, op.afterId);
    rec.listId = op.toListId;
  }
  rec.move = s;
  target.order = { ...s, cards: nextOrder };
}

export function applyOp(state: ReduceState, op: BoardOp): void {
  const entities = state.entities;
  const s = stamp(op);
  switch (op.type) {
    case "addList": {
      const existing = entities.lists[op.listId];
      const snapshot = { ...structuredClone(op.list) };
      if (!existing) {
        entities.lists[op.listId] = {
          add: s,
          edit: s,
          snapshot,
          order: { ...s, cards: op.cards.map((card) => card.id) },
        };
      } else if (existing.del && stampGt(s, existing.del)) {
        existing.del = undefined;
        existing.add = s;
        existing.edit = s;
        existing.snapshot = snapshot;
        existing.order = { ...s, cards: op.cards.map((card) => card.id) };
      } else {
        return;
      }
      for (const card of op.cards) addCardRecord(state, op.listId, card, s);
      if (!entities.listOrder) {
        entities.listOrder = { ...s, order: [op.listId] };
      } else if (!entities.listOrder.order.includes(op.listId)) {
        entities.listOrder = {
          ...s,
          order: [...entities.listOrder.order, op.listId],
        };
      }
      rebuild(state);
      return;
    }
    case "editList": {
      const rec = entities.lists[op.listId];
      if (!rec || rec.del) return;
      const live = findList(state, op.listId);
      if (!live || !matchesExpected(live, op.expect)) return;
      if (!stampGt(s, rec.edit)) return;
      rec.edit = s;
      rec.snapshot = { ...rec.snapshot, ...structuredClone(op.patch) };
      rebuild(state);
      return;
    }
    case "deleteList": {
      const rec = entities.lists[op.listId];
      if (rec && (!rec.del || stampGt(s, rec.del))) {
        rec.del = { ...s, opId: op.id };
      }
      state.lastListDelete.set(op.listId, op.id);
      const list = findList(state, op.listId);
      if (list) state.listSnapshots.set(op.listId, structuredClone(list));
      for (const cardRec of Object.values(entities.cards)) {
        if (
          cardRec.listId === op.listId &&
          (!cardRec.del || stampGt(s, cardRec.del))
        ) {
          cardRec.del = { ...s, opId: op.id };
          state.lastCardDelete.set(cardRec.snapshot.id, op.id);
          state.cardSnapshots.set(
            cardRec.snapshot.id,
            structuredClone(cardRec.snapshot)
          );
        }
      }
      rebuild(state);
      return;
    }
    case "restoreList": {
      const rec = entities.lists[op.listId];
      if (!rec || rec.del?.opId !== op.deleteOpId) return;
      rec.del = undefined;
      for (const cardRec of Object.values(entities.cards)) {
        if (cardRec.listId === op.listId && cardRec.del?.opId === op.deleteOpId) {
          applyGhostFor(state, cardRec, op.deleteOpId);
          cardRec.del = undefined;
        }
      }
      for (const [cardId, move] of [...state.ghostMoves]) {
        const cardRec = entities.cards[cardId];
        if (!cardRec || cardRec.listId !== op.listId) continue;
        const target = entities.lists[move.listId];
        if (!target || target.del) continue;
        cardRec.listId = move.listId;
        cardRec.move = s;
        const order = target.order?.cards ?? [];
        insertAfterOrder(order, cardId, move.afterId);
        target.order = { ...s, cards: order };
        state.ghostMoves.delete(cardId);
      }
      if (entities.listOrder && !entities.listOrder.order.includes(op.listId)) {
        const order = [...entities.listOrder.order];
        if (op.insertAfter === null) order.unshift(op.listId);
        else {
          const anchor = order.indexOf(op.insertAfter);
          order.splice(anchor === -1 ? order.length : anchor + 1, 0, op.listId);
        }
        entities.listOrder = { ...s, order };
      }
      rebuild(state);
      return;
    }
    case "reorderLists": {
      if (entities.listOrder && !stampGt(s, entities.listOrder)) return;
      entities.listOrder = { ...s, order: [...op.order] };
      rebuild(state);
      return;
    }
    case "addCard": {
      addCardRecord(state, op.listId, op.card, s);
      rebuild(state);
      return;
    }
    case "editCard": {
      const rec = entities.cards[op.cardId];
      if (!rec) return;
      if (rec.del) {
        bufferGhost(state, op, op.cardId, op.patch);
        return;
      }
      const found = findCard(state, op.cardId);
      if (!found || !matchesExpected(found.card, op.expect)) return;
      if (!stampGt(s, rec.edit)) return;
      rec.edit = s;
      rec.snapshot = { ...rec.snapshot, ...structuredClone(op.patch) };
      rebuild(state);
      return;
    }
    case "deleteCard": {
      const rec = entities.cards[op.cardId];
      if (rec && (!rec.del || stampGt(s, rec.del))) {
        rec.del = { ...s, opId: op.id };
        const found = findCard(state, op.cardId);
        if (found) {
          state.cardSnapshots.set(op.cardId, structuredClone(found.card));
        }
      }
      state.lastCardDelete.set(op.cardId, op.id);
      rebuild(state);
      return;
    }
    case "restoreCard": {
      const rec = entities.cards[op.cardId];
      if (!rec || rec.del?.opId !== op.deleteOpId) return;
      const listRec = entities.lists[op.listId];
      if (!listRec || listRec.del) return;
      applyGhostFor(state, rec, op.deleteOpId);
      rec.del = undefined;
      rec.listId = op.listId;
      const order = listRec.order?.cards ?? [];
      insertAfterOrder(order, op.cardId, op.afterId);
      listRec.order = { ...s, cards: order };
      rebuild(state);
      return;
    }
    case "moveCard":
      applyMove(state, op, s);
      rebuild(state);
      return;
    case "addLabel": {
      const existing = entities.labels[op.label.id];
      if (!existing) {
        entities.labels[op.label.id] = {
          add: s,
          snapshot: structuredClone(op.label),
        };
      } else if (existing.del && stampGt(s, existing.del)) {
        existing.del = undefined;
        existing.add = s;
        existing.snapshot = structuredClone(op.label);
      }
      rebuild(state);
      return;
    }
    case "removeLabel": {
      const rec = entities.labels[op.labelId];
      if (rec && !rec.del) rec.del = s;
      rebuild(state);
      return;
    }
  }
}

/** Reduce ops over a base snapshot board. Duplicate ids apply once and ops
 *  are sorted canonically, so every tab converges regardless of delivery. */
export function reduceOps(
  base: Board,
  ops: BoardOp[],
  entities?: EntityStore
): ReduceState {
  const state = initReduceState(base, entities);
  const seen = new Set<string>();
  const unique: BoardOp[] = [];
  for (const op of ops) {
    if (seen.has(op.id)) continue;
    seen.add(op.id);
    unique.push(op);
  }
  unique.sort(opOrder);
  for (const op of unique) applyOp(state, op);
  rebuild(state);
  return state;
}

function mergeStamp<T extends Stamp>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b ? structuredClone(b) : undefined;
  if (!b) return structuredClone(a);
  return stampGt(b, a) ? structuredClone(b) : structuredClone(a);
}

function mergeGhosts(
  x: NonNullable<CardRec["ghost"]> | undefined,
  y: NonNullable<CardRec["ghost"]> | undefined
): CardRec["ghost"] {
  if (!x) return y ? structuredClone(y) : undefined;
  if (!y) return structuredClone(x);
  const result: NonNullable<CardRec["ghost"]> = structuredClone(x);
  for (const [key, bucket] of Object.entries(y)) {
    const existing = result[key];
    if (!existing || stampGt(bucket, existing)) {
      result[key] = {
        ...bucket,
        patch: { ...(existing?.patch ?? {}), ...structuredClone(bucket.patch) },
      };
    }
  }
  return result;
}

/** Merge entity stores produced by independently compacted tabs (LWW). */
export function mergeEntities(a: EntityStore, b: EntityStore): EntityStore {
  const result: EntityStore = {
    listOrder:
      mergeStamp(a.listOrder ?? undefined, b.listOrder ?? undefined) ?? null,
    lists: {},
    cards: {},
    labels: {},
  };
  for (const listId of new Set([...Object.keys(a.lists), ...Object.keys(b.lists)])) {
    const x = a.lists[listId];
    const y = b.lists[listId];
    if (!x || !y) {
      result.lists[listId] = structuredClone((x ?? y) as ListRec);
      continue;
    }
    const editWinner = stampGt(y.edit, x.edit) ? y : x;
    const orderWinner =
      !x.order || (y.order && stampGt(y.order, x.order)) ? y.order : x.order;
    result.lists[listId] = {
      add: mergeStamp(x.add, y.add)!,
      edit: editWinner.edit,
      snapshot: structuredClone(editWinner.snapshot),
      order: orderWinner ? structuredClone(orderWinner) : undefined,
      del: mergeStamp(x.del, y.del),
    };
  }
  for (const cardId of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) {
    const x = a.cards[cardId];
    const y = b.cards[cardId];
    if (!x || !y) {
      result.cards[cardId] = structuredClone((x ?? y) as CardRec);
      continue;
    }
    const editWinner = stampGt(y.edit, x.edit) ? y : x;
    const moveWinner = stampGt(y.move, x.move) ? y : x;
    result.cards[cardId] = {
      add: mergeStamp(x.add, y.add)!,
      edit: editWinner.edit,
      move: moveWinner.move,
      listId: moveWinner.listId,
      snapshot: structuredClone(editWinner.snapshot),
      del: mergeStamp(x.del, y.del),
      ghost: mergeGhosts(x.ghost, y.ghost),
    };
  }
  for (const labelId of new Set([...Object.keys(a.labels), ...Object.keys(b.labels)])) {
    const x = a.labels[labelId];
    const y = b.labels[labelId];
    if (!x || !y) {
      result.labels[labelId] = structuredClone((x ?? y) as LabelRec);
      continue;
    }
    result.labels[labelId] = {
      add: mergeStamp(x.add, y.add)!,
      snapshot: structuredClone(
        stampGt(y.add, x.add) ? y.snapshot : x.snapshot
      ),
      del: mergeStamp(x.del, y.del),
    };
  }
  return result;
}
