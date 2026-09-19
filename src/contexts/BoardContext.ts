import { createContext, useContext } from "react";
import type { Board, Card, Label, ListTone } from "../types/kanban";

export interface BoardContextType {
  board: Board;
  addList: (
    title: string,
    firstCardTitle?: string,
    tone?: ListTone,
    labels?: Label[]
  ) => void;
  updateList: (
    listId: string,
    data: { title: string; tone: ListTone; labels: Label[] }
  ) => void;
  deleteList: (listId: string) => void;
  addCard: (
    listId: string,
    data: {
      title: string;
      content?: string;
      labels: Label[];
      dueDate?: string;
      priority?: "low" | "medium" | "high";
    }
  ) => void;
  updateCard: (listId: string, cardId: string, newData: Partial<Card>) => void;
  deleteCard: (listId: string, cardId: string) => void;
  addLabel: (label: { name: string; color: string }) => void;
  reorderLists: (oldIndex: number, newIndex: number) => void;
  moveCard: (
    activeCardId: string,
    overId: string,
    activeType: "Card" | "List",
    overType: "Card" | "List"
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const BoardContext = createContext<BoardContextType | undefined>(undefined);

export function useBoard() {
  const context = useContext(BoardContext);
  if (context === undefined) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return context;
}
