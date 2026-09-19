import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import { BoardContext, type BoardContextType } from "./BoardContext";
import type { Board, Card, Label, ListTone } from "../types/kanban";
import { BoardEngine, type CommitContext } from "../sync/engine";
import { createBrowserStorage } from "../sync/storage";
import type {
  BoardOp,
  CardPatch,
  MoveCardOp,
} from "../sync/op";

function createId(prefix: string) {
  return prefix + "-" + Math.random().toString(36).slice(2, 9);
}

function cardPatchDiff(current: Card, data: {
  title: string;
  content?: string;
  labels: Label[];
  dueDate?: string;
  priority?: "low" | "medium" | "high";
}): CardPatch | null {
  const patch: CardPatch = {};
  if (data.title !== current.title) patch.title = data.title;
  const nextContent = data.content;
  if ((nextContent ?? "") !== (current.content ?? "")) {
    patch.content = nextContent;
  }
  if (JSON.stringify(data.labels ?? []) !== JSON.stringify(current.labels ?? [])) {
    patch.labels = data.labels;
  }
  const nextDue = data.dueDate;
  if ((nextDue ?? "") !== (current.dueDate ?? "")) {
    patch.dueDate = nextDue;
  }
  if ((data.priority ?? "") !== (current.priority ?? "")) {
    patch.priority = data.priority;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Insert position described by the card immediately preceding the slot. */
function cardAfterId(
  cardIds: string[],
  index: number
): string | null {
  return index <= 0 ? null : cardIds[index - 1];
}

export function BoardProvider({
  children,
  initialBoard,
  engine: injectedEngine,
}: {
  children: ReactNode;
  initialBoard: Board;
  engine?: BoardEngine;
}) {
  const [engine] = useState<BoardEngine>(
    () =>
      injectedEngine ??
      new BoardEngine({
      storage: createBrowserStorage(),
      fallback: initialBoard,
      })
  );
  useSyncExternalStore(engine.subscribe, () => engine.getBoard());

  const value: BoardContextType = (() => {
    function findList(listId: string, ctx: CommitContext) {
      return ctx.board.lists.find((list) => list.id === listId);
    }

    function addList(
      title: string,
      firstCardTitle?: string,
      tone?: ListTone,
      labels?: Label[]
    ) {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;
      const trimmedFirstCardTitle = firstCardTitle?.trim();
      engine.commit((ctx) => {
        const listId = createId("list");
        const cards: Card[] =
          trimmedFirstCardTitle && trimmedFirstCardTitle.length > 0
            ? [
                {
                  id: createId("card"),
                  title: trimmedFirstCardTitle,
                  content: undefined,
                  labels: [],
                },
              ]
            : [];
        const op: BoardOp = {
          id: ctx.makeId(),
          clock: ctx.clock,
          origin: ctx.origin,
          type: "addList",
          listId,
          list: {
            id: listId,
            title: trimmedTitle,
            tone: tone ?? "blue",
            labels: labels ?? [],
          },
          cards,
        };
        return { op, history: "addList" };
      });
    }

    function updateList(
      listId: string,
      data: { title: string; tone: ListTone; labels: Label[] }
    ) {
      engine.commit((ctx) => {
        const list = findList(listId, ctx);
        if (!list) return null;
        const patch: { title?: string; tone?: ListTone; labels?: Label[] } = {};
        const expect: typeof patch = {};
        if (data.title !== list.title) {
          patch.title = data.title;
          expect.title = list.title;
        }
        if (data.tone !== list.tone) {
          patch.tone = data.tone;
          expect.tone = list.tone;
        }
        if (JSON.stringify(data.labels ?? []) !== JSON.stringify(list.labels ?? [])) {
          patch.labels = data.labels;
          expect.labels = list.labels ?? [];
        }
        if (Object.keys(patch).length === 0) return null;
        return {
          op: {
            id: ctx.makeId(),
            clock: ctx.clock,
            origin: ctx.origin,
            type: "editList",
            listId,
            patch,
            expect,
          },
          history: "editList",
        };
      });
    }

    function deleteList(listId: string) {
      engine.commit((ctx) => {
        if (!findList(listId, ctx)) return null;
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

    function addCard(
      listId: string,
      data: {
        title: string;
        content?: string;
        labels: Label[];
        dueDate?: string;
        priority?: "low" | "medium" | "high";
      }
    ) {
      const trimmedTitle = data.title.trim();
      if (!trimmedTitle) return;
      engine.commit((ctx) => {
        const list = findList(listId, ctx);
        if (!list) return null;
        const card: Card = {
          id: createId("card"),
          title: trimmedTitle,
          content: data.content,
          labels: data.labels,
          dueDate: data.dueDate,
          priority: data.priority,
        };
        return {
          op: {
            id: ctx.makeId(),
            clock: ctx.clock,
            origin: ctx.origin,
            type: "addCard",
            listId,
            card,
          },
          history: "addCard",
        };
      });
    }

    function updateCard(listId: string, cardId: string, newData: Partial<Card>) {
      engine.commit((ctx) => {
        const list = findList(listId, ctx);
        const card = list?.cards.find((item) => item.id === cardId);
        let basedOnDelete: string | undefined;
        let patch: CardPatch | null;
        if (!list || !card) {
          // Stale tab submitting after the card was deleted elsewhere:
          // record the edit against that exact delete so an undo-delete can
          // fold it in, while the delete itself still wins.
          basedOnDelete = engine.deletedCardOp(cardId);
          if (!basedOnDelete) return null;
          patch = {};
          for (const [key, value] of Object.entries(newData)) {
            (patch as Record<string, unknown>)[key] = value;
          }
        } else {
          const candidate = {
            title: newData.title ?? card.title,
            content: newData.content,
            labels: newData.labels ?? card.labels,
            dueDate: newData.dueDate,
            priority: newData.priority,
          };
          patch = cardPatchDiff(card, candidate);
          if (!patch) return null;
        }
        const expect: CardPatch = {};
        if (card) {
          for (const key of Object.keys(patch) as (keyof CardPatch)[]) {
            (expect as unknown as Record<string, unknown>)[key] = (
              card as unknown as Record<string, unknown>
            )[key];
          }
        }
        return {
          op: {
            id: ctx.makeId(),
            clock: ctx.clock,
            origin: ctx.origin,
            type: "editCard",
            listId: list?.id ?? listId,
            cardId,
            patch,
            expect: basedOnDelete ? undefined : expect,
            basedOnDelete,
          },
          history: "editCard",
        };
      });
    }

    function deleteCard(listId: string, cardId: string) {
      engine.commit((ctx) => {
        const list = findList(listId, ctx);
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

    function addLabel(label: { name: string; color: string }) {
      engine.commit((ctx) => {
        const trimmed = label.name.trim();
        if (!trimmed) return null;
        const id = createId("label");
        return {
          op: {
            id: ctx.makeId(),
            clock: ctx.clock,
            origin: ctx.origin,
            type: "addLabel",
            label: { id, name: trimmed, color: label.color },
          },
          history: "addLabel",
        };
      });
    }

    function reorderLists(oldIndex: number, newIndex: number) {
      engine.commit((ctx) => {
        if (
          oldIndex === newIndex ||
          oldIndex < 0 ||
          newIndex < 0 ||
          oldIndex >= ctx.board.lists.length ||
          newIndex >= ctx.board.lists.length
        ) {
          return null;
        }
        const order = ctx.board.lists.map((list) => list.id);
        const [moved] = order.splice(oldIndex, 1);
        order.splice(newIndex, 0, moved);
        return {
          op: {
            id: ctx.makeId(),
            clock: ctx.clock,
            origin: ctx.origin,
            type: "reorderLists",
            order,
            listId: moved,
          },
          history: "reorderLists",
        };
      });
    }

    function moveCard(
      activeCardId: string,
      overId: string,
      _activeType: "Card" | "List",
      overType: "Card" | "List"
    ) {
      engine.commit((ctx) => {
        let sourceList: { id: string; cards: Card[] } | undefined;
        let sourceIndex = -1;
        for (const list of ctx.board.lists) {
          const index = list.cards.findIndex((card) => card.id === activeCardId);
          if (index !== -1) {
            sourceList = list;
            sourceIndex = index;
            break;
          }
        }
        if (!sourceList) return null;

        let targetListId = sourceList.id;
        if (overType === "Card") {
          const overList = ctx.board.lists.find((list) =>
            list.cards.some((card) => card.id === overId)
          );
          if (!overList) return null;
          targetListId = overList.id;
        } else {
          const overList = ctx.board.lists.find((list) => list.id === overId);
          if (!overList) return null;
          targetListId = overList.id;
        }

        const originAfter = cardAfterId(
          sourceList.cards.map((card) => card.id),
          sourceIndex
        );

        const targetList = ctx.board.lists.find(
          (list) => list.id === targetListId
        )!;
        const targetCardIds = targetList.cards
          .filter((card) => card.id !== activeCardId)
          .map((card) => card.id);

        let afterId: string | null;
        if (overType === "Card") {
          const overIndex = targetCardIds.indexOf(overId);
          if (overIndex === -1) {
            afterId = targetCardIds.length > 0
              ? targetCardIds[targetCardIds.length - 1]
              : null;
          } else {
            afterId = overIndex === 0 ? null : targetCardIds[overIndex - 1];
          }
        } else {
          afterId = targetCardIds.length > 0
            ? targetCardIds[targetCardIds.length - 1]
            : null;
        }

        // No-op: same list and same effective slot.
        if (targetListId === sourceList.id) {
          const without = sourceList.cards
            .map((card) => card.id)
            .filter((id) => id !== activeCardId);
          const insertIndex =
            afterId === null ? 0 : without.indexOf(afterId) + 1;
          if (insertIndex === sourceIndex) return null;
        }

        const op: MoveCardOp = {
          id: ctx.makeId(),
          clock: ctx.clock,
          origin: ctx.origin,
          type: "moveCard",
          cardId: activeCardId,
          afterId,
          toListId: targetListId,
          originListId: sourceList.id,
          originAfter,
        };
        return { op, history: "moveCard" };
      });
    }

    return {
      board: engine.getBoard(),
      addList,
      updateList,
      deleteList,
      addCard,
      updateCard,
      deleteCard,
      addLabel,
      reorderLists,
      moveCard,
      undo: () => engine.undo(),
      redo: () => engine.redo(),
      canUndo: engine.canUndo(),
      canRedo: engine.canRedo(),
    };
  })();

  return (
    <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
  );
}
