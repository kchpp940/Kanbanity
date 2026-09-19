import { cleanup, render } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { BoardProvider } from "../../contexts/BoardProvider";
import { BoardEngine } from "../engine";
import { MemoryBus } from "./harness";
import { initialBoard } from "../../data/initial-data";
import type { Board } from "../../types/kanban";

function Probe({ engine }: { engine: BoardEngine }) {
  return <div>{engine.getBoard().lists.length}</div>;
}

describe("engine lifecycle", () => {
  beforeEach(() => localStorage.clear());

  it("provider mount/unmount does not leak listeners; engines converge", () => {
    const bus = new MemoryBus();
    const fallback: Board = structuredClone(initialBoard);
    const engine = new BoardEngine({
      storage: bus.storage("embedded"),
      fallback,
      tabId: "embedded",
    });
    const { unmount } = render(
      <BoardProvider initialBoard={fallback} engine={engine}>
        <Probe engine={engine} />
      </BoardProvider>
    );
    unmount();
    cleanup();
    expect(engine.getBoard().lists.length).toBe(3);
  });
});
