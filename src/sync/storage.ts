import type { SyncDocument } from "./ops";
import type { Board } from "../types/kanban";

export const STORAGE_KEY = "kanbanity-board";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Minimal window surface the engine needs (allows test fakes). */
export interface SyncHost {
  addEventListener(
    type: "storage",
    listener: (event: StorageEventLike) => void
  ): void;
  removeEventListener(
    type: "storage",
    listener: (event: StorageEventLike) => void
  ): void;
  localStorage: StorageLike;
}

export interface StorageEventLike {
  key: string | null;
  newValue: string | null;
}

export type LoadResult =
  | { kind: "document"; document: SyncDocument }
  | { kind: "legacy"; board: Board }
  | { kind: "empty" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Lenient validator: anything structurally close to a board is accepted as a
 * legacy snapshot so existing users never lose their data to a version bump.
 */
export function parseBoard(value: unknown): Board | null {
  if (!isObject(value)) return null;
  if (typeof value.title !== "string" || !Array.isArray(value.lists)) {
    return null;
  }
  return value as unknown as Board;
}

export function isDocument(value: unknown): value is SyncDocument {
  return isObject(value) && value.version === 2 && Array.isArray(value.ops);
}

/** Never throws: corrupt JSON yields "empty". */
export function loadRaw(storage: StorageLike, key = STORAGE_KEY): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { kind: "empty" };
  }
  if (raw === null) return { kind: "empty" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isDocument(parsed)) return { kind: "document", document: parsed };
    const board = parseBoard(parsed);
    if (board) return { kind: "legacy", board };
  } catch {
    // fall through
  }
  return { kind: "empty" };
}

/** Single-key atomic write of the whole document. */
export function saveRaw(
  storage: StorageLike,
  document: SyncDocument,
  key = STORAGE_KEY
): void {
  storage.setItem(key, JSON.stringify(document));
}
