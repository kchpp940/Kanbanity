import { describe, expect, it } from "vitest";
import { midpoint } from "./order";
import { reduceOps, seedDocument } from "./reducer";
import { loadRaw } from "./storage";
import type { Board } from "../types/kanban";

export function makeBoard(): Board {
  return {
    id: "board-1",
    title: "B",
    availableLabels: [
      { id: "l1", name: "Bug", color: "red" },
      { id: "l2", name: "Feature", color: "blue" },
    ],
    lists: [
      {
        id: "L1",
        title: "Todo",
        tone: "blue",
        labels: [],
        cards: [
          { id: "C1", title: "Card 1", labels: [] },
          { id: "C2", title: "Card 2", labels: [] },
        ],
      },
      {
        id: "L2",
        title: "Doing",
        tone: "yellow",
        labels: [],
        cards: [{ id: "C3", title: "Card 3", labels: [] }],
      },
      {
        id: "L3",
        title: "Done",
        tone: "green",
        labels: [],
        cards: [],
      },
    ],
  };
}

describe("fractional ordering", () => {
  it("midpoint stays strictly between bounds", () => {
    expect(midpoint(null, null)).toBe("V");
    const a = midpoint(null, null);
    const b = midpoint(a, null);
    expect(a < b).toBe(true);
    const c = midpoint(null, a);
    expect(c < a).toBe(true);
    const d = midpoint(c, a);
    expect(c < d && d < a).toBe(true);
  });

  it("survives randomized interleaving insertions", () => {
    const keys: string[] = [];
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 500; i += 1) {
      const index = Math.floor(rand() * (keys.length + 1));
      const before = keys[index - 1] ?? null;
      const after = keys[index] ?? null;
      const key = midpoint(before, after);
      expect(before === null || before < key).toBe(true);
      expect(after === null || key < after).toBe(true);
      keys.splice(index, 0, key);
    }
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("storage compatibility", () => {
  it("seeds and reduces a document deterministically", () => {
    const doc = seedDocument(makeBoard(), 0);
    const first = reduceOps(doc.ops, doc.boardTitle).board;
    const second = reduceOps([...doc.ops].reverse(), doc.boardTitle).board;
    expect(first).toEqual(second);
    expect(first.lists.map((l) => l.id)).toEqual(["L1", "L2", "L3"]);
    expect(first.lists[0].cards.map((c) => c.id)).toEqual(["C1", "C2"]);
  });

  it("never crashes on corrupt or legacy data", () => {
    const legacy = makeBoard();
    const storage = {
      value: JSON.stringify(legacy),
      getItem() {
        return this.value;
      },
      setItem() {},
    };
    expect(loadRaw(storage).kind).toBe("legacy");
    storage.value = "{not json";
    expect(loadRaw(storage).kind).toBe("empty");
    storage.value = JSON.stringify({ hello: "world" });
    expect(loadRaw(storage).kind).toBe("empty");
    storage.value = JSON.stringify({ version: 99, ops: null });
    expect(loadRaw(storage).kind).toBe("empty");
  });
});
