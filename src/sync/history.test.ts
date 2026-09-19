import { describe, expect, it } from "vitest";
import { SyncEngine } from "./engine";
import { TabHarness, type FakeTab } from "./test-harness";
import { makeBoard } from "./helpers.test";

function openEngine(tab: FakeTab): SyncEngine {
  return SyncEngine.create(makeBoard(), tab);
}
function listTitles(engine: SyncEngine) {
  return engine.getSnapshot().board.lists.map((l) => l.title);
}
function cardTitles(engine: SyncEngine, listId: string) {
  return engine
    .getSnapshot()
    .board.lists.find((l) => l.id === listId)!
    .cards.map((c) => c.title);
}
function findCard(engine: SyncEngine, cardId: string) {
  for (const list of engine.getSnapshot().board.lists) {
    const card = list.cards.find((c) => c.id === cardId);
    if (card) return { list, card };
  }
  return null;
}

describe("single-tab history semantics", () => {
  it("does not record no-op actions", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    expect(engine.getSnapshot().canUndo).toBe(false);
    expect(engine.moveCard("C1", "C1", "Card").changed).toBe(false);
    expect(engine.moveCard("C1", "NOPE", "Card").changed).toBe(false);
    expect(engine.moveCard("C1", "NOPE", "List").changed).toBe(false);
    expect(engine.addList("   ").changed).toBe(false);
    expect(engine.updateCard("L1", "C1", { title: "Card 1" }).changed).toBe(false);
    expect(engine.reorderList(1, 1).changed).toBe(false);
    expect(engine.reorderList(0, 99).changed).toBe(false);
    expect(engine.getSnapshot().canUndo).toBe(false);
  });

  it("undo/redo restores complete card state", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    const label = engine.getSnapshot().board.availableLabels[0];
    engine.updateCard("L1", "C1", {
      title: "Updated",
      content: "desc",
      labels: [label],
      dueDate: "2030-01-02",
      priority: "high",
    });
    engine.undo();
    let card = findCard(engine, "C1")!.card;
    expect(card.title).toBe("Card 1");
    expect(card.content).toBeUndefined();
    expect(card.labels).toEqual([]);
    expect(card.dueDate).toBeUndefined();
    expect(card.priority).toBeUndefined();
    engine.redo();
    card = findCard(engine, "C1")!.card;
    expect(card.title).toBe("Updated");
    expect(card.content).toBe("desc");
    expect(card.labels).toEqual([label]);
    expect(card.dueDate).toBe("2030-01-02");
    expect(card.priority).toBe("high");
  });

  it("new local edit clears the redo branch", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    engine.updateCard("L1", "C1", { title: "A" });
    engine.undo();
    expect(engine.getSnapshot().canRedo).toBe(true);
    engine.updateCard("L1", "C2", { title: "B" });
    expect(engine.getSnapshot().canRedo).toBe(false);
  });

  it("undo/redo a cross-list drag restores list membership and order", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    engine.moveCard("C1", "C3", "Card");
    expect(findCard(engine, "C1")!.list.id).toBe("L2");
    expect(cardTitles(engine, "L2")).toEqual(["Card 1", "Card 3"]);
    engine.undo();
    expect(findCard(engine, "C1")!.list.id).toBe("L1");
    expect(cardTitles(engine, "L1")).toEqual(["Card 1", "Card 2"]);
    expect(cardTitles(engine, "L2")).toEqual(["Card 3"]);
    engine.redo();
    expect(cardTitles(engine, "L2")).toEqual(["Card 1", "Card 3"]);
    expect(cardTitles(engine, "L1")).toEqual(["Card 2"]);
  });

  it("continuous undo/redo restores order, lists, labels, dates and priority", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    const label = engine.getSnapshot().board.availableLabels[1];
    engine.updateCard("L1", "C2", {
      title: "C2x",
      labels: [label],
      dueDate: "2031-05-05",
      priority: "low",
    });
    engine.addList("Extra", "seed card");
    engine.moveCard("C2", "L3", "List");
    engine.reorderList(0, 2);
    const snapshot = JSON.stringify(engine.getSnapshot().board);
    engine.undo();
    engine.undo();
    engine.undo();
    engine.undo();
    expect(listTitles(engine)).toEqual(["Todo", "Doing", "Done"]);
    expect(findCard(engine, "C2")!.list.id).toBe("L1");
    expect(findCard(engine, "C2")!.card.title).toBe("Card 2");
    engine.redo();
    engine.redo();
    engine.redo();
    engine.redo();
    expect(JSON.stringify(engine.getSnapshot().board)).toBe(snapshot);
  });

  it("delete + restore (undo) keeps card content", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    engine.deleteCard("L1", "C1");
    expect(findCard(engine, "C1")).toBeNull();
    engine.undo();
    const restored = findCard(engine, "C1");
    expect(restored).not.toBeNull();
    expect(restored!.list.id).toBe("L1");
    expect(restored!.card.title).toBe("Card 1");
    engine.redo();
    expect(findCard(engine, "C1")).toBeNull();
  });

  it("creating a list with first card is one history entry", () => {
    const h = new TabHarness();
    const engine = openEngine(h.createTab());
    engine.addList("New", "first");
    engine.undo();
    expect(listTitles(engine)).toEqual(["Todo", "Doing", "Done"]);
  });

  it("creating a label is atomic and undoable", () => {
    const h = new TabHarness();
    const eng = openEngine(h.createTab());
    eng.addLabel({ name: "Custom", color: "purple" });
    expect(eng.getSnapshot().board.availableLabels.map((l) => l.name)).toContain(
      "Custom"
    );
    eng.undo();
    expect(
      eng.getSnapshot().board.availableLabels.map((l) => l.name)
    ).not.toContain("Custom");
    eng.redo();
    expect(eng.getSnapshot().board.availableLabels.map((l) => l.name)).toContain(
      "Custom"
    );
  });
});
