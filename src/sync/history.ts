import type { List } from "../types/kanban";
import type {
  AddCardOp,
  AddLabelOp,
  AddListOp,
  BoardOp,
  DeleteCardOp,
  DeleteListOp,
  EditCardOp,
  EditListOp,
  HistoryEntry,
  MoveCardOp,
  ReorderListsOp,
} from "./op";

interface BoardLike {
  lists: List[];
}

function findList(board: BoardLike, listId: string): List | undefined {
  return board.lists.find((list) => list.id === listId);
}

function findCardLocation(
  board: BoardLike,
  cardId: string
): { list: List; index: number } | undefined {
  for (const list of board.lists) {
    const index = list.cards.findIndex((card) => card.id === cardId);
    if (index !== -1) return { list, index };
  }
  return undefined;
}

function afterIdOf(
  board: BoardLike,
  listId: string,
  cardId: string
): string | null {
  const list = findList(board, listId);
  if (!list) return null;
  const index = list.cards.findIndex((card) => card.id === cardId);
  if (index <= 0) return null;
  return list.cards[index - 1].id;
}

type MoveCardOpEx = MoveCardOp & {
  originListId?: string;
  originAfter?: string | null;
};

/**
 * Build the compensating op for undoing a committed local op. Every inverse
 * is a normal replicated op with guards: it can never resurrect an object
 * another tab deleted nor overwrite fields another tab changed afterwards.
 * Returns null when the inverse no longer applies.
 */
export function buildInverse(
  entry: HistoryEntry,
  board: BoardLike,
  lastListDelete: Map<string, string>,
  lastCardDelete: Map<string, string>,
  meta: { id: string; clock: number; origin: string }
): BoardOp | null {
  const { op } = entry;
  const base = { id: meta.id, clock: meta.clock, origin: meta.origin };

  switch (entry.kind) {
    case "addList": {
      const addOp = op as AddListOp;
      if (!findList(board, addOp.listId)) return null;
      return { ...base, type: "deleteList", listId: addOp.listId };
    }
    case "editList": {
      const editOp = op as EditListOp;
      const list = findList(board, editOp.listId);
      if (!list) return null;
      const original = editOp.expect ?? {};
      const patch: EditListOp["patch"] = {};
      const expect: NonNullable<EditListOp["expect"]> = {};
      for (const key of Object.keys(editOp.patch) as (keyof typeof patch)[]) {
        if (!(key in original)) return null;
        patch[key] = original[key] as never;
        expect[key] = list[key] as never;
      }
      if (Object.keys(patch).length === 0) return null;
      return {
        ...base,
        type: "editList",
        listId: editOp.listId,
        patch,
        expect,
      };
    }
    case "deleteList": {
      const deleteOp = op as DeleteListOp;
      if (lastListDelete.get(deleteOp.listId) !== deleteOp.id) return null;
      const lists = board.lists;
      const insertAfter = lists.length > 0 ? lists[lists.length - 1].id : null;
      return {
        ...base,
        type: "restoreList",
        listId: deleteOp.listId,
        deleteOpId: deleteOp.id,
        insertAfter,
      };
    }
    case "reorderLists": {
      const reorderOp = op as ReorderListsOp;
      const previous = invertOrder(reorderOp.order, reorderOp.listId);
      const current = board.lists.map((list) => list.id);
      if (
        previous.length !== current.length ||
        previous.every((id, index) => id === current[index])
      ) {
        return null;
      }
      return {
        ...base,
        type: "reorderLists",
        order: previous,
        listId: reorderOp.listId,
      };
    }
    case "addCard": {
      const addOp = op as AddCardOp;
      if (!findCardLocation(board, addOp.card.id)) return null;
      return {
        ...base,
        type: "deleteCard",
        listId: addOp.listId,
        cardId: addOp.card.id,
      };
    }
    case "editCard": {
      const editOp = op as EditCardOp;
      const location = findCardLocation(board, editOp.cardId);
      if (!location) return null;
      const card = location.list.cards[location.index];
      const original = editOp.expect ?? {};
      const patch: EditCardOp["patch"] = {};
      const expect: NonNullable<EditCardOp["expect"]> = {};
      for (const key of Object.keys(editOp.patch) as (keyof typeof patch)[]) {
        if (!(key in original)) return null;
        patch[key] = original[key] as never;
        expect[key] = card[key] as never;
      }
      if (Object.keys(patch).length === 0) return null;
      return {
        ...base,
        type: "editCard",
        listId: location.list.id,
        cardId: editOp.cardId,
        patch,
        expect,
      };
    }
    case "deleteCard": {
      const deleteOp = op as DeleteCardOp;
      if (lastCardDelete.get(deleteOp.cardId) !== deleteOp.id) return null;
      return {
        ...base,
        type: "restoreCard",
        cardId: deleteOp.cardId,
        deleteOpId: deleteOp.id,
        listId: deleteOp.listId,
        afterId: null,
      };
    }
    case "moveCard": {
      const moveOp = op as MoveCardOpEx;
      const originListId = moveOp.originListId;
      const originAfter = moveOp.originAfter;
      if (!originListId || originAfter === undefined) return null;
      if (!findList(board, originListId)) return null;
      const location = findCardLocation(board, moveOp.cardId);
      if (
        location &&
        location.list.id === originListId &&
        afterIdOf(board, originListId, moveOp.cardId) === originAfter
      ) {
        return null;
      }
      // Record where the card currently sits, so re-undoing later can
      // rebuild the inverse again.
      const currentAfter = location
        ? afterIdOf(board, location.list.id, moveOp.cardId)
        : moveOp.afterId;
      const currentListId = location ? location.list.id : moveOp.toListId;
      return {
        ...base,
        type: "moveCard",
        cardId: moveOp.cardId,
        toListId: originListId,
        afterId: originAfter,
        originListId: currentListId,
        originAfter: currentAfter,
      };
    }
    case "addLabel": {
      const addOp = op as AddLabelOp;
      return {
        ...base,
        type: "removeLabel",
        labelId: addOp.label.id,
      };
    }
  }
}

/** Reconstruct the pre-reorder order by shifting the moved id back. */
function invertOrder(order: string[], movedId: string): string[] {
  const index = order.indexOf(movedId);
  if (index <= 0) return [...order];
  const next = [...order];
  const [item] = next.splice(index, 1);
  next.splice(index - 1, 0, item);
  return next;
}

/** Rebuild the original forward op for redo, dropped if its target is gone. */
export function buildRedo(
  entry: HistoryEntry,
  board: BoardLike,
  lastListDelete: Map<string, string>,
  lastCardDelete: Map<string, string>,
  meta: { id: string; clock: number; origin: string }
): BoardOp | null {
  const { op, kind } = entry;
  switch (kind) {
    case "addList": {
      const addOp = op as AddListOp;
      if (findList(board, addOp.listId)) return null;
      if (lastListDelete.has(addOp.listId)) return null;
      break;
    }
    case "addCard": {
      const addOp = op as AddCardOp;
      if (lastCardDelete.has(addOp.card.id)) return null;
      const list = findList(board, addOp.listId);
      if (!list || list.cards.some((card) => card.id === addOp.card.id)) {
        return null;
      }
      break;
    }
    case "deleteList": {
      const deleteOp = op as DeleteListOp;
      if (!findList(board, deleteOp.listId)) return null;
      break;
    }
    case "deleteCard": {
      const deleteOp = op as DeleteCardOp;
      if (!findCardLocation(board, deleteOp.cardId)) return null;
      break;
    }
    case "editList": {
      const editOp = op as EditListOp;
      if (!findList(board, editOp.listId)) return null;
      break;
    }
    case "editCard": {
      const editOp = op as EditCardOp;
      if (!findCardLocation(board, editOp.cardId)) return null;
      break;
    }
    case "moveCard": {
      const moveOp = op as MoveCardOpEx;
      if (!findCardLocation(board, moveOp.cardId)) return null;
      if (!findList(board, moveOp.toListId)) return null;
      break;
    }
    case "reorderLists": {
      const reorderOp = op as ReorderListsOp;
      const live = new Set(board.lists.map((list) => list.id));
      if (reorderOp.order.some((id) => !live.has(id))) return null;
      break;
    }
    case "addLabel":
      break;
  }
  const id = op.id;
  const clock = op.clock;
  const origin = op.origin;
  void id;
  void clock;
  void origin;
  const replay: BoardOp = { ...(op as BoardOp), ...meta };
  return replay;
}
