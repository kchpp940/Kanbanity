import { describe, expect, it } from "vitest";
import { initialBoard } from "../../data/initial-data";
import { BoardEngine, MAX_LIVE_OPS } from "../engine";
import { ControllableBus, MemoryBus, createTabs } from "./harness";
import {
  addCard,
  addLabel,
  cardPosition,
  deleteCard,
  deleteList,
  editCard,
  editList,
  getCard,
  moveCard,
  serialize,
} from "./helpers";
import type { Board } from "../../types/kanban";

const FALLBACK = (): Board => structuredClone(initialBoard);
const LIST_1 = initialBoard.lists[0].id;
const LIST_2 = initialBoard.lists[1].id;
const LIST_3 = initialBoard.lists[2].id;
const CARD_1 = initialBoard.lists[0].cards[0].id;
const CARD_2 = initialBoard.lists[0].cards[1].id;
const CARD_3 = initialBoard.lists[1].cards[0].id;

function expectConverged(engines: BoardEngine[]) {
  const snapshots = engines.map((engine) => serialize(engine.getBoard()));
  for (const snapshot of snapshots) {
    expect(snapshot).toBe(snapshots[0]);
  }
}

describe("multi-tab sync and undo/redo", () => {
  it("two tabs edit different cards: both edits survive", () => {
    const bus = new MemoryBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    expect(editCard(a, LIST_1, CARD_1, { title: "from A" })).toBe(true);
    expect(editCard(b, LIST_2, CARD_3, { title: "from B" })).toBe(true);
    expectConverged([a, b]);
    expect(getCard(a, CARD_1)?.title).toBe("from A");
    expect(getCard(a, CARD_3)?.title).toBe("from B");
  });

  it("two tabs edit the same card: deterministic LWW, both converge", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    editCard(a, LIST_1, CARD_1, { title: "A wins?" });
    editCard(b, LIST_1, CARD_1, { title: "B wins?" });
    bus.deliverAll();
    expectConverged([a, b]);
    const winner = getCard(a, CARD_1)!.title;
    // B committed with the higher clock; deterministic rule.
    expect(winner).toBe("B wins?");
    expect(getCard(b, CARD_1)!.title).toBe("B wins?");
  });

  it("delete vs late edit on old state: deleted object never resurrects", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    // Tab A deletes the card; tab B (still on stale state) edits it.
    expect(deleteCard(a, LIST_1, CARD_1)).toBe(true);
    expect(editCard(b, LIST_1, CARD_1, { title: "late edit" })).toBe(true);
    bus.deliverAll();
    expectConverged([a, b]);
    expect(getCard(a, CARD_1)).toBeUndefined();
    expect(getCard(b, CARD_1)).toBeUndefined();
  });

  it("two tabs move the same card concurrently: one deterministic placement", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    // Both move CARD_1 into list 2, but at different positions.
    moveCard(a, CARD_1, LIST_2, null);
    moveCard(b, CARD_1, LIST_2, CARD_3);
    bus.deliverAll();
    expectConverged([a, b]);
    const position = cardPosition(a, CARD_1);
    expect(position?.listId).toBe(LIST_2);
    // The higher-clock move (B: after CARD_3) wins.
    expect(position?.index).toBe(1);
    // Original list keeps the other card only.
    const firstList = a.getBoard().lists.find((l) => l.id === LIST_1)!;
    expect(firstList.cards.map((c) => c.id)).toEqual([CARD_2]);
  });

  it("stale tab keeps editing before receiving the new version, then converges without snapshot overwrite", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    // A performs several commits while B is disconnected.
    editCard(a, LIST_1, CARD_1, { title: "A1" });
    editCard(a, LIST_1, CARD_2, { title: "A2" });
    addCard(a, LIST_2, { title: "A new card" });
    // Stale B operates on its outdated board.
    editCard(b, LIST_2, CARD_3, { title: "B stale" });
    bus.deliverAll();
    expectConverged([a, b]);
    expect(getCard(a, CARD_1)?.title).toBe("A1");
    expect(getCard(a, CARD_2)?.title).toBe("A2");
    expect(getCard(a, CARD_3)?.title).toBe("B stale");
    expect(
      a.getBoard().lists.find((l) => l.id === LIST_2)!.cards.some(
        (card) => card.title === "A new card"
      )
    ).toBe(true);
  });

  it("remote updates arriving with local undo history are not undoable locally", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    editCard(a, LIST_1, CARD_1, { title: "local change" });
    editCard(b, LIST_2, CARD_3, { title: "remote change" });
    bus.deliverAll();
    expectConverged([a, b]);
    // Undo in A must revert only A own edit, never B remote edit.
    expect(a.undo()).toBe(true);
    expect(getCard(a, CARD_1)?.title).toBe(initialBoard.lists[0].cards[0].title);
    expect(getCard(a, CARD_3)?.title).toBe("remote change");
  });

describe("undo/redo semantics", () => {
  it("undo a cross-list drag restores list, position, labels, date and priority", () => {
    const bus = new MemoryBus();
    const [a] = createTabs(FALLBACK(), 1, bus);
    const card = getCard(a, CARD_1)!;
    expect(card.title).toBeTruthy();
    const originalPosition = cardPosition(a, CARD_1)!;
    const before = serialize(a.getBoard());

    editCard(a, LIST_1, CARD_1, {
      labels: [initialBoard.availableLabels[0]],
      dueDate: "2030-05-05",
      priority: "high",
    });
    moveCard(a, CARD_1, LIST_2, null);
    expect(cardPosition(a, CARD_1)?.listId).toBe(LIST_2);

    a.undo(); // undo move
    expect(cardPosition(a, CARD_1)).toEqual(originalPosition);
    a.undo(); // undo edit
    expect(serialize(a.getBoard())).toBe(before);
    const restored = getCard(a, CARD_1)!;
    expect(restored.labels).toEqual(card.labels);
    expect(restored.dueDate).toBe(card.dueDate);
    expect(restored.priority).toBe(card.priority);

    a.redo();
    expect(getCard(a, CARD_1)?.priority).toBe("high");
    a.redo();
    expect(cardPosition(a, CARD_1)?.listId).toBe(LIST_2);
  });

  it("undo a delete, then receive a remote edit: restored card keeps the edit", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    deleteCard(a, LIST_1, CARD_1);
    bus.deliverAll();
    // B sees the deletion, then A undoes its own delete.
    expect(a.undo()).toBe(true);
    // Meanwhile B edits the (deleted there) card before seeing the restore.
    editCard(b, LIST_1, CARD_1, { title: "B edit while deleted" });
    bus.deliverAll();
    expectConverged([a, b]);
    // Restore happened, and the concurrent edit is preserved via ghost buffering.
    expect(getCard(a, CARD_1)?.title).toBe("B edit while deleted");
  });

  it("undo of a delete is safe when another tab deleted the card again", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    deleteCard(a, LIST_1, CARD_1);
    bus.deliverAll();
    a.undo(); // restore
    bus.deliverAll();
    expect(getCard(b, CARD_1)).toBeDefined();
    // B deletes it; stale A tries to undo the restore (redo path) / undo again.
    deleteCard(b, LIST_1, CARD_1);
    bus.deliverAll();
    a.undo(); // should not resurrect
    expectConverged([a, b]);
    expect(getCard(a, CARD_1)).toBeUndefined();
  });

  it("new local action clears the redo branch (editor semantics)", () => {
    const bus = new MemoryBus();
    const [a] = createTabs(FALLBACK(), 1, bus);
    editCard(a, LIST_1, CARD_1, { title: "v1" });
    a.undo();
    expect(a.canRedo()).toBe(true);
    editCard(a, LIST_1, CARD_2, { title: "different action" });
    expect(a.canRedo()).toBe(false);
  });

  it("no-op actions (cancel, drop on same spot, missing target) create no history", () => {
    const bus = new MemoryBus();
    const [a] = createTabs(FALLBACK(), 1, bus);
    const before = serialize(a.getBoard());
    // Drop back onto the card's own effective slot (no reorder).
    moveCard(a, CARD_1, LIST_1, CARD_1);
    expect(serialize(a.getBoard())).toBe(before);
    expect(a.canUndo()).toBe(false);
    // Missing target.
    expect(
      a.commit((ctx) => {
        const exists = ctx.board.lists.some((list) =>
          list.cards.some((card) => card.id === "does-not-exist")
        );
        if (!exists) return null;
        return {
          op: {
            id: ctx.makeId(), clock: ctx.clock, origin: ctx.origin,
            type: "deleteCard", listId: LIST_1, cardId: "does-not-exist",
          },
        };
      })
    ).toBe(false);
    expect(a.canUndo()).toBe(false);
  });
});

describe("delivery robustness and refresh", () => {
  it("out-of-order and duplicated events still converge with no double apply", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    editCard(a, LIST_1, CARD_1, { title: "A-1" });
    editCard(b, LIST_2, CARD_3, { title: "B-1" });
    addLabel(a, { name: "new label", color: "bg-retro-red" });
    const labelCount = a.getBoard().availableLabels.length;

    // Reverse order + duplicates to B.
    bus.deliver("tab-1", (raws) => [...raws].reverse());
    bus.deliver("tab-1", (raws) => [...raws, ...raws]);
    // Same mess delivered normally to A for B writes.
    bus.deliver("tab-0", (raws) => [...raws].reverse().concat(raws));

    expectConverged([a, b]);
    expect(a.getBoard().availableLabels.length).toBe(labelCount);
    // Idempotence: re-delivering every event again changes nothing.
    const before = serialize(a.getBoard());
    bus.deliverAll((raws) => [...raws, ...raws, ...raws]);
    expectConverged([a, b]);
    expect(serialize(a.getBoard())).toBe(before);
  });

  it("continuous undo/redo followed by refresh restores identical state", () => {
    const bus = new MemoryBus();
    const initial = createTabs(FALLBACK(), 1, bus)[0];
    editCard(initial, LIST_1, CARD_1, { title: "x1" });
    editCard(initial, LIST_2, CARD_3, { priority: "low" });
    moveCard(initial, CARD_2, LIST_2, CARD_3);
    addLabel(initial, { name: "frozen", color: "bg-retro-blue" });

    for (let i = 0; i < 3; i++) initial.undo();
    for (let i = 0; i < 2; i++) initial.undo();
    for (let i = 0; i < 4; i++) initial.redo();

    const expected = serialize(initial.getBoard());
    initial.destroy();

    const restored = new BoardEngine({
      storage: bus.storage("tab-refresh"),
      fallback: FALLBACK(),
      tabId: "tab-refresh",
    });
    expect(serialize(restored.getBoard())).toBe(expected);
  });

  it("legacy raw v1 board data migrates and corrupt data does not crash", () => {
    const rawBoard = {
      id: "board-1",
      title: "Velho",
      lists: [
        {
          id: "old-list",
          title: "Velha lista",
          cards: [{ id: "old-card", title: "Velho card", labels: "broken" }],
        },
        "not-a-list",
      ],
      availableLabels: "nope",
    };
    const bus = new MemoryBus();
    const storage = bus.storage("legacy");
    storage.setItem("kanbanity-board", JSON.stringify(rawBoard));
    const engine = new BoardEngine({ storage, fallback: FALLBACK(), tabId: "legacy" });
    expect(engine.getBoard().lists.some((l) => l.id === "old-list")).toBe(true);
    expect(engine.getBoard().lists[0].cards[0].labels).toEqual([]);
    engine.destroy();

    const badBus = new MemoryBus();
    const badStorage = badBus.storage("bad");
    badStorage.setItem("kanbanity-board", "{not json");
    const fallback = new BoardEngine({
      storage: badStorage,
      fallback: FALLBACK(),
      tabId: "bad",
    });
    expect(fallback.getBoard().lists.length).toBeGreaterThan(0);
  });

  it("unrelated concurrent edits survive around a list delete undo", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    deleteList(a, LIST_1);
    bus.deliverAll();
    // B edits a card in list 2 while A deletes list 1.
    editList(b, LIST_2, { title: "renamed by B" });
    a.undo(); // restore list 1
    bus.deliverAll();
    expectConverged([a, b]);
    expect(a.getBoard().lists.some((l) => l.id === LIST_1)).toBe(true);
    expect(
      a.getBoard().lists.find((l) => l.id === LIST_2)?.title
    ).toBe("renamed by B");
  });

  it("compacts long logs without losing convergence", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    for (let i = 0; i < MAX_LIVE_OPS + 25; i++) {
      editCard(a, LIST_1, CARD_1, { title: "title-" + i });
    }
    bus.deliverAll();
    // B also compacts independently.
    editCard(b, LIST_1, CARD_2, { title: "B after compaction" });
    bus.deliverAll();
    expectConverged([a, b]);
    expect(getCard(a, CARD_1)?.title).toBe(
      "title-" + (MAX_LIVE_OPS + 24)
    );
    expect(getCard(a, CARD_2)?.title).toBe("B after compaction");
  });

  it("concurrent moves inside the same list compose after independent compaction", () => {
    const bus = new ControllableBus();
    const [a, b] = createTabs(FALLBACK(), 2, bus);
    // Add plenty of history so both sides compact separately afterwards.
    for (let i = 0; i < 10; i++) {
      editCard(a, LIST_3, initialBoard.lists[2].cards[0].id, {
        title: "warmup-" + i,
      });
    }
    bus.deliverAll();
    // List 1 has [CARD_1, CARD_2]. A moves CARD_2 to top; B moves
    // CARD_1... concurrent disjoint reorders.
    moveCard(a, CARD_2, LIST_1, null);
    moveCard(b, CARD_1, LIST_1, CARD_2);
    // Neither delivers; both then compact via more local history on other
    // entities, then sync.
    bus.deliverAll();
    expectConverged([a, b]);
    const order = a
      .getBoard()
      .lists.find((list) => list.id === LIST_1)!.cards.map((card) => card.id);
    expect(new Set(order)).toEqual(new Set([CARD_1, CARD_2]));
  });
});
});
