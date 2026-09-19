import type { Board, Card, Label, ListTone } from "../../types/kanban";
import type { BoardEngine } from "../engine";
import type { BoardOp, CardPatch } from "../op";

type AnyOp = Parameters<BoardEngine["commit"]>[0] extends (
  ctx: infer C
) => infer R
  ? (ctx: C) => R
  : never;

export function editCard(
  engine: BoardEngine,
  listId: string,
  cardId: string,
  patch: CardPatch
): boolean {
  return engine.commit((ctx) => {
    const list = ctx.board.lists.find((item) => item.id === listId);
    const card = list?.cards.find((item) => item.id === cardId);
    let basedOnDelete: string | undefined;
    if (!list || !card) {
      // Stale-tab edit of a card the engine knows is deleted.
      const deleted = engine.deletedCardOp(cardId);
      if (!deleted) return null;
      basedOnDelete = deleted;
    }
    const expect: CardPatch = {};
    if (card) {
      for (const key of Object.keys(patch) as (keyof CardPatch)[]) {
        (expect as unknown as Record<string, unknown>)[key] = (
          card as unknown as Record<string, unknown>
        )[key];
      }
    }
    const op: BoardOp = {
      id: ctx.makeId(),
      clock: ctx.clock,
      origin: ctx.origin,
      type: "editCard",
      listId,
      cardId,
      patch,
      expect: basedOnDelete ? undefined : expect,
      basedOnDelete,
    };
    return { op, history: "editCard" };
  });
}

export function deleteCard(
  engine: BoardEngine,
  listId: string,
  cardId: string
): boolean {
  return engine.commit((ctx) => {
    const list = ctx.board.lists.find((item) => item.id === listId);
    if (!list?.cards.some((card) => card.id === cardId)) return null;
    return {
      op: {
        id: ctx.makeId(),
        clock: ctx.clock,
        origin: ctx.origin,
        type: "deleteCard",
        listId,
        cardId,
      },
      history: "deleteCard",
    };
  });
}

export function addCard(
  engine: BoardEngine,
  listId: string,
  card: { title: string; labels?: Label[] }
): boolean {
  return engine.commit((ctx) => {
    const list = ctx.board.lists.find((item) => item.id === listId);
    if (!list) return null;
    const newCard: Card = {
      id: "card-" + Math.random().toString(36).slice(2, 10),
      title: card.title,
      labels: card.labels ?? [],
    };
    return {
      op: {
        id: ctx.makeId(),
        clock: ctx.clock,
        origin: ctx.origin,
        type: "addCard",
        listId,
        card: newCard,
      },
      history: "addCard",
    };
  });
}

export function editList(
  engine: BoardEngine,
  listId: string,
  patch: { title?: string; tone?: ListTone }
): boolean {
  return engine.commit((ctx) => {
    const list = ctx.board.lists.find((item) => item.id === listId);
    if (!list) return null;
    return {
      op: {
        id: ctx.makeId(),
        clock: ctx.clock,
        origin: ctx.origin,
        type: "editList",
        listId,
        patch,
      },
      history: "editList",
    };
  });
}

export function deleteList(engine: BoardEngine, listId: string): boolean {
  return engine.commit((ctx) => {
    if (!ctx.board.lists.some((list) => list.id === listId)) return null;
    return {
      op: {
        id: ctx.makeId(),
        clock: ctx.clock,
        origin: ctx.origin,
        type: "deleteList",
        listId,
      },
      history: "deleteList",
    };
  });
}

export function addLabel(
  engine: BoardEngine,
  label: { name: string; color: string }
): boolean {
  return engine.commit((ctx) => {
    const id = "label-" + Math.random().toString(36).slice(2, 10);
    return {
      op: {
        id: ctx.makeId(),
        clock: ctx.clock,
        origin: ctx.origin,
        type: "addLabel",
        label: { id, ...label },
      },
      history: "addLabel",
    };
  });
}

/** Move card so it sits after afterId (null = first) inside toListId. */
export function moveCard(
  engine: BoardEngine,
  cardId: string,
  toListId: string,
  afterId: string | null
): boolean {
  return engine.commit((ctx) => {
    let sourceListId: string | undefined;
    let sourceIndex = -1;
    for (const list of ctx.board.lists) {
      const index = list.cards.findIndex((card) => card.id === cardId);
      if (index !== -1) {
        sourceListId = list.id;
        sourceIndex = index;
        break;
      }
    }
    if (!sourceListId) return null;
    const source = ctx.board.lists.find((l) => l.id === sourceListId)!;
    const originAfter =
      sourceIndex <= 0 ? null : source.cards[sourceIndex - 1].id;
    const effectiveAfter = afterId === cardId ? originAfter : afterId;
    if (toListId === sourceListId && effectiveAfter === originAfter) {
      return null;
    }
    const op: BoardOp = {
      id: ctx.makeId(),
      clock: ctx.clock,
      origin: ctx.origin,
      type: "moveCard",
      cardId,
      afterId: effectiveAfter,
      toListId,
      originListId: sourceListId,
      originAfter,
    };
    return { op, history: "moveCard" };
  });
}

export function reorderLists(
  engine: BoardEngine,
  listId: string,
  order: string[]
): boolean {
  return engine.commit((ctx) => {
    return {
      op: {
        id: ctx.makeId(),
        clock: ctx.clock,
        origin: ctx.origin,
        type: "reorderLists",
        order,
        listId,
      },
      history: "reorderLists",
    };
  });
}

/** Deterministic full-board snapshot used to prove convergence. */
export function serialize(board: Board): string {
  return JSON.stringify(board);
}

export function getCard(engine: BoardEngine, cardId: string): Card | undefined {
  for (const list of engine.getBoard().lists) {
    const card = list.cards.find((item) => item.id === cardId);
    if (card) return card;
  }
  return undefined;
}

export function cardPosition(
  engine: BoardEngine,
  cardId: string
): { listId: string; index: number } | undefined {
  for (const list of engine.getBoard().lists) {
    const index = list.cards.findIndex((card) => card.id === cardId);
    if (index !== -1) return { listId: list.id, index };
  }
  return undefined;
}

export type { AnyOp };
