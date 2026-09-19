import { describe, expect, it } from "vitest";
import { initialBoard } from "../../data/initial-data";
import { MemoryBus, createTabs } from "./harness";
import type { BoardOp } from "../op";

describe("engine smoke", () => {
  it("two tabs edit different cards and converge", () => {
    const bus = new MemoryBus();
    const [a, b] = createTabs(structuredClone(initialBoard), 2, bus);
    a.commit(({ board, clock, origin, makeId }) => {
      const card = board.lists[0].cards[0];
      const op: BoardOp = {
        id: makeId(), clock, origin,
        type: "editCard", listId: board.lists[0].id, cardId: card.id,
        patch: { title: "A-title" }, expect: { title: card.title },
      };
      return { op, history: "editCard" };
    });
    b.commit(({ board, clock, origin, makeId }) => {
      const card = board.lists[1].cards[0];
      const op: BoardOp = {
        id: makeId(), clock, origin,
        type: "editCard", listId: board.lists[1].id, cardId: card.id,
        patch: { title: "B-title" }, expect: { title: card.title },
      };
      return { op, history: "editCard" };
    });
    const titleA = a.getBoard().lists[0].cards[0].title;
    const titleB = b.getBoard().lists[1].cards[0].title;
    expect(titleA).toBe("A-title");
    expect(titleB).toBe("B-title");
    expect(serialize(a.getBoard())).toBe(serialize(b.getBoard()));
  });

  it("undo/redo restores title", () => {
    const bus = new MemoryBus();
    const [a] = createTabs(structuredClone(initialBoard), 1, bus);
    const original = a.getBoard().lists[0].cards[0].title;
    a.commit(({ board, clock, origin, makeId }) => {
      const card = board.lists[0].cards[0];
      const op: BoardOp = {
        id: makeId(), clock, origin,
        type: "editCard", listId: board.lists[0].id, cardId: card.id,
        patch: { title: "changed" }, expect: { title: card.title },
      };
      return { op, history: "editCard" };
    });
    expect(a.getBoard().lists[0].cards[0].title).toBe("changed");
    a.undo();
    expect(a.getBoard().lists[0].cards[0].title).toBe(original);
    a.redo();
    expect(a.getBoard().lists[0].cards[0].title).toBe("changed");
  });
});

function serialize(value: unknown): string {
  return JSON.stringify(value);
}
