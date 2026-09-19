import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import App from "./App";
import { initialBoard } from "./data/initial-data";

describe("Undo/Redo UI", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("supports undo/redo buttons and keyboard shortcuts", () => {
    render(<App />);
    const undoButton = screen.getByRole("button", { name: "Desfazer" });
    const redoButton = screen.getByRole("button", { name: "Refazer" });
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();

    // Edit the first card through the existing UI flow.
    const openButtons = screen.getAllByText("Abrir");
    fireEvent.click(openButtons[0]);
    const titleInput = screen.getByDisplayValue(initialBoard.lists[0].cards[0].title);
    fireEvent.change(titleInput, { target: { value: "Mudou pelo UI" } });
    fireEvent.click(screen.getByText("Salvar"));
    expect(screen.getByText("Mudou pelo UI")).toBeInTheDocument();

    expect(undoButton).toBeEnabled();
    fireEvent.click(undoButton);
    expect(screen.getByText(initialBoard.lists[0].cards[0].title)).toBeInTheDocument();
    expect(redoButton).toBeEnabled();

    // Keyboard redo (Ctrl+Shift+Z), then undo (Ctrl+Z).
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("Mudou pelo UI")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByText(initialBoard.lists[0].cards[0].title)).toBeInTheDocument();
  });
});
