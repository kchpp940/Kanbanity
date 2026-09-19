import { describe, expect, it } from "vitest";
import { SyncEngine } from "./engine";
import { TabHarness, type FakeTab } from "./test-harness";
import { makeBoard } from "./helpers.test";

function open(tab: FakeTab): SyncEngine {
  return SyncEngine.create(makeBoard(), tab);
}
function listTitles(e: SyncEngine) {
  return e.getSnapshot().board.lists.map((l) => l.title);
}
function cardTitles(e: SyncEngine, listId: string) {
  return e
    .getSnapshot()
    .board.lists.find((l) => l.id === listId)!
    .cards.map((c) => c.title);
}
function findCard(e: SyncEngine, id: string) {
  for (const list of e.getSnapshot().board.lists) {
    const card = list.cards.find((c) => c.id === id);
    if (card) return { list, card };
  }
  return null;
}
function converge(a: SyncEngine, b: SyncEngine) {
  expect(a.getSnapshot().board).toEqual(b.getSnapshot().board);
}

describe("multi-tab synchronization", () => {
  it("merges edits to different cards in both directions", () => {
    const h = new TabHarness();
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.updateCard("L1", "C1", { title: "from A" });
    b.updateCard("L1", "C2", { title: "from B" });
    converge(a, b);
    expect(findCard(a, "C1")!.card.title).toBe("from A");
    expect(findCard(a, "C2")!.card.title).toBe("from B");
  });

  it("resolves simultaneous edits to the same card deterministically", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.updateCard("L1", "C1", { priority: "low" });
    b.updateCard("L1", "C1", { priority: "high" });
    h.flush();
    converge(a, b);
    expect(findCard(a, "C1")!.card.priority).toBe("high");
  });

  it("delete wins against a stale-tab edit; deleted card never revives", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.deleteCard("L1", "C1");
    b.updateCard("L1", "C1", { title: "late edit" });
    h.flush();
    converge(a, b);
    expect(findCard(a, "C1")).toBeNull();
    expect(cardTitles(a, "L1")).toEqual(["Card 2"]);
    // Even re-ingesting both docs in any order cannot bring C1 back.
    expect(a.ingestRaw(h.rawValue)).toBe(false);
    expect(findCard(a, "C1")).toBeNull();
  });

  it("two tabs moving the same card converge to one placement", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.moveCard("C1", "C3", "Card");
    b.moveCard("C1", "L3", "List");
    h.flush();
    converge(a, b);
    expect(findCard(a, "C1")!.list.id).toBe("L3");
    expect(cardTitles(a, "L2")).toEqual(["Card 3"]);
  });

  it("stale tab operations merge instead of overwriting newer board", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const fresh = open(h.createTab());
    const stale = open(h.createTab());
    fresh.updateCard("L1", "C1", { title: "fresh change" });
    fresh.deleteList("L3");
    stale.addCard("L1", { title: "stale new card", labels: [] });
    stale.updateCard("L1", "C2", { title: "stale edit" });
    h.flush();
    converge(fresh, stale);
    expect(listTitles(fresh)).toEqual(["Todo", "Doing"]);
    expect(findCard(fresh, "C1")!.card.title).toBe("fresh change");
    expect(findCard(fresh, "C2")!.card.title).toBe("stale edit");
    const titles = fresh
      .getSnapshot()
      .board.lists.flatMap((l) => l.cards.map((c) => c.title));
    expect(titles).toContain("stale new card");
  });

  it("remote updates never become local undo history", () => {
    const h = new TabHarness();
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.updateCard("L1", "C1", { title: "remote" });
    expect(b.getSnapshot().canUndo).toBe(false);
    b.undo();
    expect(findCard(b, "C1")!.card.title).toBe("remote");
  });

  it("undo leaves unrelated remote edits intact", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.updateCard("L1", "C1", { title: "A change" });
    b.updateCard("L1", "C2", { title: "B unrelated" });
    h.flush();
    a.undo();
    expect(findCard(a, "C1")!.card.title).toBe("Card 1");
    expect(findCard(a, "C2")!.card.title).toBe("B unrelated");
    h.flush();
    converge(a, b);
  });

  it("undoing a cross-list drag is safe after remote list deletion", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.moveCard("C1", "C3", "Card"); // C1 -> L2
    b.deleteList("L1"); // origin list removed concurrently
    h.flush();
    a.undo(); // must not resurrect L1 or corrupt structure
    expect(listTitles(a)).toEqual(["Doing", "Done"]);
    expect(findCard(a, "C1")!.list.id).toBe("L2");
    converge(a, b);
  });

  it("undo delete then receiving a remote edit keeps everything valid", () => {
    const h = new TabHarness();
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.deleteCard("L1", "C1");
    a.undo();
    expect(findCard(a, "C1")).not.toBeNull();
    b.updateCard("L1", "C1", { priority: "medium" });
    converge(a, b);
    expect(findCard(a, "C1")!.card.priority).toBe("medium");
  });

  it("converges after undo/redo cycles followed by a refresh reload", () => {
    const h = new TabHarness();
    const a = open(h.createTab());
    a.updateCard("L1", "C1", { title: "x1" });
    a.updateCard("L1", "C1", { title: "x2" });
    a.undo();
    a.redo();
    a.moveCard("C3", "C2", "Card");
    a.undo();
    // Final state: x2 applied, and C3 move was undone so C3 stays in L2.
    // Simulate refresh: a brand new engine over the same persisted document.
    const reloaded = open(h.createTab());
    expect(findCard(reloaded, "C1")!.card.title).toBe("x2");
    expect(findCard(reloaded, "C3")!.list.id).toBe("L2");
    expect(cardTitles(reloaded, "L1")).toEqual(["x2", "Card 2"]);
    expect(cardTitles(reloaded, "L2")).toEqual(["Card 3"]);
  });

  it("tolerates duplicated and out-of-order sync events", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.updateCard("L1", "C1", { title: "first" });
    a.updateCard("L1", "C1", { title: "second" });
    b.updateCard("L1", "C2", { title: "b-edit" });
    const stateAfterAFirst = h.getItem("kanbanity-board")!;
    h.flush();
    const stateAfterB = h.getItem("kanbanity-board")!;
    const opsCount = () =>
      (JSON.parse(h.getItem("kanbanity-board")!) as { ops: unknown[] }).ops
        .length;
    const before = opsCount();
    // Re-deliver an ancient document, then a newer one, twice.
    b.ingestRaw(stateAfterAFirst);
    b.ingestRaw(stateAfterAFirst);
    b.ingestRaw(stateAfterB);
    b.ingestRaw(stateAfterB);
    converge(a, b);
    expect(opsCount()).toBe(before);
    expect(findCard(b, "C1")!.card.title).toBe("second");
    expect(findCard(b, "C2")!.card.title).toBe("b-edit");
    // Reorder delivery through the harness queue: newest first then older.
    h.flush((events) => [...events].reverse());
    converge(a, b);
  });

  it("never applies the same op twice", () => {
    const h = new TabHarness();
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.addCard("L1", { title: "once", labels: [] });
    a.addCard("L1", { title: "twice", labels: [] });
    const raw = h.getItem("kanbanity-board")!;
    const doc = JSON.parse(raw) as { ops: unknown[] };
    const opCount = doc.ops.length;
    // Re-ingest the complete document many times.
    for (let i = 0; i < 5; i += 1) {
      expect(b.ingestRaw(raw)).toBe(false);
    }
    const stored = JSON.parse(h.getItem("kanbanity-board")!) as {
      ops: unknown[];
    };
    expect(stored.ops.length).toBe(opCount);
    expect(cardTitles(b, "L1")).toEqual([
      "Card 1",
      "Card 2",
      "once",
      "twice",
    ]);
  });

  it("a move into a concurrently deleted list is dropped", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.deleteList("L2");
    b.moveCard("C1", "C3", "Card");
    h.flush();
    converge(a, b);
    expect(findCard(b, "C1")!.list.id).toBe("L1");
    expect(listTitles(b)).toEqual(["Todo", "Done"]);
  });

  it("concurrent list deletion and card insertion converge", () => {
    const h = new TabHarness();
    h.autoFlush = false;
    const a = open(h.createTab());
    const b = open(h.createTab());
    a.deleteList("L1");
    b.addCard("L1", { title: "new card", labels: [] });
    h.flush();
    converge(a, b);
    // List stays deleted; card is tombstoned-alive but unreachable.
    expect(listTitles(b)).toEqual(["Doing", "Done"]);
    expect(
      b.getSnapshot().board.lists.flatMap((l) => l.cards).length
    ).toBe(1);
  });
});
