import { useEffect } from "react";
import { useBoard } from "../contexts/BoardContext";

/**
 * Keyboard shortcuts:
 *  - Undo: Ctrl/Cmd+Z
 *  - Redo: Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
 * Inputs/textarea/contenteditable are ignored so text editing keeps native
 * behavior.
 */
export function useUndoRedo() {
  const { undo, redo, canUndo, canRedo } = useBoard();

  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        element.isContentEditable
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (isEditable(event.target)) return;

      if (key === "z" && !event.shiftKey) {
        if (!canUndo) return;
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        if (!canRedo) return;
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, canUndo, canRedo]);
}
