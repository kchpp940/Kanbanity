import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Board, Card, Label, ListTone } from "../types/kanban";
import { SyncEngine, type EngineSnapshot } from "../sync/engine";
import type { SyncHost } from "../sync/storage";
import { BoardContext } from "./BoardContext";

function getHost(): SyncHost | null {
  if (typeof window === "undefined") return null;
  return window as unknown as SyncHost;
}

export function BoardProvider({
  children,
  initialBoard,
  engine,
}: {
  children: ReactNode;
  initialBoard: Board;
  engine?: SyncEngine;
}) {
  const [syncEngine] = useState<SyncEngine>(() => {
    if (engine) return engine;
    const host = getHost();
    return SyncEngine.create(initialBoard, host, {
      storage: host ? host.localStorage : undefined,
    });
  });

  useEffect(() => () => syncEngine.dispose(), [syncEngine]);

  const snapshot = useSyncExternalStore(
    (onChange) => syncEngine.subscribe(() => onChange()),
    () => syncEngine.getSnapshot(),
    () => syncEngine.getSnapshot()
  );

  const board = snapshot.board;

  const value = useMemo(
    () => ({
      board,
      setBoard: (next: Board | ((prev: Board) => Board)) => {
        // Retained for API compatibility; wholesale board replacement cannot
        // be expressed as an atomic op under the sync model, so it is a no-op.
        if (typeof next === "function") {
          void (next as (prev: Board) => Board)(board);
        }
      },
      addList: (
        title: string,
        firstCardTitle?: string,
        tone?: ListTone,
        labels?: Label[]
      ) => {
        syncEngine.addList(title, firstCardTitle, tone, labels);
      },
      updateList: (
        listId: string,
        data: { title: string; tone: ListTone; labels: Label[] }
      ) => {
        syncEngine.updateList(listId, data);
      },
      deleteList: (listId: string) => {
        syncEngine.deleteList(listId);
      },
      addCard: (
        listId: string,
        data: {
          title: string;
          content?: string;
          labels: Label[];
          dueDate?: string;
          priority?: "low" | "medium" | "high";
        }
      ) => {
        syncEngine.addCard(listId, data);
      },
      updateCard: (listId: string, cardId: string, newData: Partial<Card>) => {
        syncEngine.updateCard(listId, cardId, newData);
      },
      deleteCard: (listId: string, cardId: string) => {
        syncEngine.deleteCard(listId, cardId);
      },
      addLabel: (label: { name: string; color: string }) => {
        syncEngine.addLabel(label);
      },
      reorderLists: (oldIndex: number, newIndex: number) => {
        syncEngine.reorderList(oldIndex, newIndex);
      },
      moveCard: (
        activeCardId: string,
        overId: string,
        _activeType: "Card" | "List",
        overType: "Card" | "List"
      ) => {
        syncEngine.moveCard(activeCardId, overId, overType);
      },
      undo: () => {
        syncEngine.undo();
      },
      redo: () => {
        syncEngine.redo();
      },
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
    }),
    [board, snapshot.canUndo, snapshot.canRedo, syncEngine]
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export type { EngineSnapshot };
export { SyncEngine };
