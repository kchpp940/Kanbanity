import type { Board, Label, List, Card } from "../types/kanban";
import type { BoardOp, StoreEnvelope } from "./op";
import {
  deriveBoard,
  seedEntities,
} from "./reducer";
import { emptyEntityStore, type EntityStore } from "./records";

export const STORAGE_KEY = "kanbanity-board";

/** Minimal storage + cross-tab event transport (localStorage in browsers). */
export interface BoardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  subscribe(handler: (raw: string | null) => void): () => void;
}

export function createBrowserStorage(): BoardStorage {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    subscribe(handler) {
      const listener = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY) return;
        handler(event.newValue);
      };
      window.addEventListener("storage", listener);
      return () => window.removeEventListener("storage", listener);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeLabel(label: unknown): Label | null {
  const record = asRecord(label);
  if (!record || typeof record.id !== "string" || typeof record.name !== "string") {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    color: typeof record.color === "string" ? record.color : "",
  };
}

function sanitizeCard(card: unknown): Card | null {
  const record = asRecord(card);
  if (!record || typeof record.id !== "string" || typeof record.title !== "string") {
    return null;
  }
  const labels = Array.isArray(record.labels)
    ? (record.labels.map(sanitizeLabel).filter(Boolean) as Label[])
    : [];
  const priority =
    record.priority === "low" || record.priority === "medium" || record.priority === "high"
      ? record.priority
      : undefined;
  return {
    id: record.id,
    title: record.title,
    content: typeof record.content === "string" ? record.content : undefined,
    labels,
    dueDate: typeof record.dueDate === "string" ? record.dueDate : undefined,
    priority,
  };
}

function sanitizeList(list: unknown): List | null {
  const record = asRecord(list);
  if (!record || typeof record.id !== "string" || typeof record.title !== "string") {
    return null;
  }
  const cards = Array.isArray(record.cards)
    ? (record.cards.map(sanitizeCard).filter(Boolean) as Card[])
    : [];
  const labels = Array.isArray(record.labels)
    ? (record.labels.map(sanitizeLabel).filter(Boolean) as Label[])
    : [];
  return {
    id: record.id,
    title: record.title,
    tone: typeof record.tone === "string" ? (record.tone as List["tone"]) : undefined,
    cards,
    labels,
  };
}

/** Tolerant loader: v1 raw boards, v2 envelopes and corrupt data all work. */
export function sanitizeBoard(value: unknown, fallback: Board): Board {
  const record = asRecord(value);
  if (!record) return structuredClone(fallback);
  const lists = Array.isArray(record.lists)
    ? (record.lists.map(sanitizeList).filter(Boolean) as List[])
    : [];
  const availableLabels = Array.isArray(record.availableLabels)
    ? (record.availableLabels.map(sanitizeLabel).filter(Boolean) as Label[])
    : [];
  return {
    id: typeof record.id === "string" ? record.id : fallback.id,
    title: typeof record.title === "string" ? record.title : fallback.title,
    lists,
    availableLabels,
  };
}

export function isEnvelope(value: unknown): value is StoreEnvelope {
  const record = asRecord(value);
  return !!record && record.format === 2 && Array.isArray(record.ops);
}

export function parseEnvelope(raw: string | null, fallback: Board): StoreEnvelope | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isEnvelope(parsed)) {
    const safeBoard = sanitizeBoard(parsed.board, fallback);
    let entities: EntityStore;
    if (
      typeof parsed.entities === "object" &&
      parsed.entities !== null
    ) {
      entities = parsed.entities as EntityStore;
      // Re-seed from the snapshot to self-heal truncated/old metadata.
      entities = seedEntities(safeBoard, entities);
    } else {
      entities = seedEntities(safeBoard, emptyEntityStore());
    }
    const derived = deriveBoard(safeBoard.id, safeBoard.title, entities);
    return {
      format: 2,
      clock: typeof parsed.clock === "number" ? parsed.clock : 0,
      sender: typeof parsed.sender === "string" ? parsed.sender : "",
      folded: Array.isArray(parsed.folded)
        ? parsed.folded.filter((id): id is string => typeof id === "string")
        : [],
      ops: Array.isArray(parsed.ops) ? (parsed.ops as BoardOp[]) : [],
      board: derived,
      entities,
    };
  }
  // Legacy v1 data: a bare board. Migrate in place into a v2 envelope.
  const board = asRecord(parsed);
  if (board && Array.isArray(board.lists)) {
    return {
      format: 2,
      clock: 0,
      sender: "",
      folded: [],
      ops: [],
      board: sanitizeBoard(parsed, fallback),
      entities: emptyEntityStore(),
    };
  }
  return null;
}

export function emptyEnvelope(board: Board): StoreEnvelope {
  const safe = sanitizeBoard(board, board);
  return {
    format: 2,
    clock: 0,
    sender: "",
    folded: [],
    ops: [],
    board: safe,
    entities: seedEntities(safe, emptyEntityStore()),
  };
}
