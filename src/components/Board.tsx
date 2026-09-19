import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  closestCorners,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import type { Label, ListTone } from "../types/kanban";
import { List, ListContent } from "./List";
import { CardModal } from "./CardModal";
import { CardContent } from "./Card";
import { createPortal } from "react-dom";
import { useBoard } from "../contexts/BoardContext";
import { useBoardDragDrop } from "../hooks/useBoardDragDrop";
import { useBoardFilters } from "../hooks/useBoardFilters";
import { BoardStatsModal } from "./BoardStatsModal";

function useUndoRedoShortcuts() {
  const { undo, redo, canUndo, canRedo } = useBoard();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        if (canRedo) redo();
      } else if (canUndo) {
        undo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);
}

type SelectedCard = {
  listId: string;
  cardId: string;
} | null;

type DeleteTarget =
  | { type: "list"; listId: string }
  | { type: "card"; listId: string; cardId: string }
  | null;

type HeaderAccent = "yellow" | "red" | "green" | "blue";

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({}),
};

export function Board() {
  const {
    board,
    addList,
    updateList,
    deleteList,
    deleteCard,
    addLabel,
    addCard,
    updateCard,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useBoard();

  useUndoRedoShortcuts();

  const { activeDragItem, handleDragStart, handleDragEnd } = useBoardDragDrop();

  const {
    searchQuery,
    setSearchQuery,
    filterLabelId,
    setFilterLabelId,
    filterListId,
    setFilterListId,
    filteredLists,
    availableLabels,
  } = useBoardFilters();

  const [selectedCard, setSelectedCard] = useState<SelectedCard>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [newCardListId, setNewCardListId] = useState<string | null>(null);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [listModalTitle, setListModalTitle] = useState("");
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [listModalFirstCardTitle, setListModalFirstCardTitle] = useState("");
  const [listModalTone, setListModalTone] = useState<ListTone>("blue");
  const [listModalLabels, setListModalLabels] = useState<Label[]>([]);
  const [headerAccent, setHeaderAccent] = useState<HeaderAccent>("yellow");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  function handleSaveListModal() {
    const trimmedTitle = listModalTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    if (editingListId) {
      updateList(editingListId, {
        title: trimmedTitle,
        tone: listModalTone,
        labels: listModalLabels,
      });
    } else {
      addList(
        trimmedTitle,
        listModalFirstCardTitle,
        listModalTone,
        listModalLabels
      );
    }

    setListModalTitle("");
    setListModalFirstCardTitle("");
    setListModalTone("blue");
    setListModalLabels([]);
    setEditingListId(null);
    setIsListModalOpen(false);
  }

  function handleOpenCreateList() {
    setEditingListId(null);
    setListModalTitle("");
    setListModalFirstCardTitle("");
    setListModalTone("blue");
    setListModalLabels([]);
    setIsListModalOpen(true);
  }

  function handleOpenEditList(listId: string) {
    const list = board.lists.find((l) => l.id === listId);
    if (!list) return;

    setEditingListId(listId);
    setListModalTitle(list.title);
    setListModalFirstCardTitle(""); // No need to show this when editing
    setListModalTone(list.tone || "blue");
    setListModalLabels(list.labels || []);
    setIsListModalOpen(true);
  }

  function requestDeleteList(listId: string) {
    setDeleteTarget({ type: "list", listId });
  }

  function requestDeleteCard(listId: string, cardId: string) {
    setDeleteTarget({ type: "card", listId, cardId });
  }

  const selectedCardData =
    selectedCard &&
    (() => {
      const list = board.lists.find((item) => item.id === selectedCard.listId);
      if (!list) {
        return null;
      }

      const card = list.cards.find((item) => item.id === selectedCard.cardId);
      if (!card) {
        return null;
      }

      return { listId: list.id, card };
    })();

  const listTones: ListTone[] = [
    "blue",
    "purple",
    "pink",
    "red",
    "orange",
    "yellow",
    "green",
    "teal",
  ];

  const headerAccentClasses: Record<HeaderAccent, string> = {
    yellow: "bg-retro-yellow",
    red: "bg-retro-red",
    green: "bg-retro-green",
    blue: "bg-retro-blue",
  };

  const toneBackgroundClasses: Record<ListTone, string> = {
    accent: "bg-retro-accent",
    blue: "bg-retro-blue",
    purple: "bg-retro-purple",
    pink: "bg-retro-pink",
    red: "bg-retro-red",
    orange: "bg-retro-orange",
    yellow: "bg-retro-yellow",
    green: "bg-retro-green",
    teal: "bg-retro-teal",
  };

  return (
    <div className="px-2 pb-4 pt-2 sm:px-4 sm:pb-6 sm:pt-3">
      <motion.header
        className={`mb-6 flex items-center justify-between rounded-3xl border-2 border-retro-ink px-6 py-4 shadow-retroPanel ${headerAccentClasses[headerAccent]}`}
        layout
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
      >
        <h1 className="font-retroHeading text-4xl font-black uppercase tracking-[0.24em] text-retro-ink drop-shadow-sm dark:text-retro-ink">
          {board.title}
        </h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="Desfazer (Ctrl/Cmd+Z)"
              aria-label="Desfazer"
              className="rounded-full border-2 border-retro-ink bg-retro-paper px-3 py-1 text-sm font-bold font-retroHeading uppercase text-retro-ink shadow-[2px_2px_0_rgba(0,0,0,1)] transition-all enabled:hover:translate-y-[1px] enabled:hover:shadow-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              ↩ Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Refazer (Ctrl/Cmd+Shift+Z)"
              aria-label="Refazer"
              className="rounded-full border-2 border-retro-ink bg-retro-paper px-3 py-1 text-sm font-bold font-retroHeading uppercase text-retro-ink shadow-[2px_2px_0_rgba(0,0,0,1)] transition-all enabled:hover:translate-y-[1px] enabled:hover:shadow-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              ↪ Redo
            </button>
          </div>
          <button
            onClick={() => setIsStatsOpen(true)}
            className="rounded-full border-2 border-retro-ink bg-retro-paper px-4 py-1 text-sm font-bold font-retroHeading uppercase text-retro-ink shadow-[2px_2px_0_rgba(0,0,0,1)] hover:translate-y-[1px] hover:shadow-none transition-all"
          >
            Stats
          </button>
          <input
            type="text"
            placeholder="Buscar cards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48 px-3 py-1 rounded-xl border-2 border-retro-ink bg-retro-paper text-sm font-retroBody text-retro-ink placeholder:text-retro-ink/50 shadow-[2px_2px_0_rgba(0,0,0,1)] focus:outline-none focus:translate-y-[2px] focus:shadow-none transition-all"
          />
          <div className="flex gap-2">
            {(["red", "green", "blue"] as HeaderAccent[]).map((accent) => {
              const dotColor =
                accent === "red"
                  ? "bg-retro-red"
                  : accent === "green"
                  ? "bg-retro-green"
                  : "bg-retro-blue";

              const isActive = headerAccent === accent;

              return (
                <button
                  key={accent}
                  type="button"
                  onClick={() => setHeaderAccent(accent)}
                  aria-label={`Mudar cor do cabeçalho para ${accent}`}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-retro-ink shadow-[0_4px_0_rgba(0,0,0,0.7)] transition-all cursor-pointer ${
                    isActive
                      ? "scale-110 shadow-[0_0_0_4px_rgba(0,0,0,0.9)]"
                      : "opacity-80 hover:-translate-y-[1px] hover:opacity-100"
                  }`}
                >
                  <span
                    className={`h-3.5 w-3.5 rounded-full ${dotColor} shadow-[0_0_0_2px_rgba(0,0,0,0.5)]`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </motion.header>
      <section className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterLabelId}
            onChange={(event) =>
              setFilterLabelId(
                event.target.value
                  ? (event.target.value as string | "all")
                  : "all"
              )
            }
            className="rounded-full border-2 border-retro-ink/50 bg-retro-paper px-3 py-2 text-xs font-retroBody text-retro-ink shadow-[0_3px_0_rgba(0,0,0,0.6)] focus:outline-none focus:ring-2 focus:ring-retro-accent"
          >
            <option value="all">Todas as labels</option>
            {availableLabels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
          <select
            value={filterListId}
            onChange={(event) =>
              setFilterListId(
                event.target.value
                  ? (event.target.value as string | "all")
                  : "all"
              )
            }
            className="rounded-full border-2 border-retro-ink/50 bg-retro-paper px-3 py-2 text-xs font-retroBody text-retro-ink shadow-[0_3px_0_rgba(0,0,0,0.6)] focus:outline-none focus:ring-2 focus:ring-retro-accent"
          >
            <option value="all">Todas as listas</option>
            {board.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleOpenCreateList}
            className="inline-flex items-center gap-2 rounded-full border-2 border-retro-ink bg-retro-accent px-6 py-3 text-sm font-black uppercase tracking-[0.22em] text-retro-ink shadow-[0_3px_0_rgba(0,0,0,0.8)] transition-all hover:-translate-y-[1px] hover:bg-retro-accentSoft hover:shadow-[0_1px_0_rgba(0,0,0,0.8)] active:translate-y-[1px] active:shadow-none cursor-pointer"
          >
            <span className="text-base leading-none">+</span>
            <span>Nova lista</span>
          </button>
        </div>
      </section>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto p-4">
          <SortableContext
            items={filteredLists.map((list) => list.id)}
            strategy={horizontalListSortingStrategy}
          >
            {filteredLists.map((list, index) => (
              <List
                key={list.id}
                {...list}
                tone={list.tone ?? listTones[index % listTones.length]}
                onStartAddCard={(listId) => setNewCardListId(listId)}
                onDeleteCard={requestDeleteCard}
                onDeleteList={requestDeleteList}
                onEditList={handleOpenEditList}
                onOpenCard={(listId, cardId) =>
                  setSelectedCard({ listId, cardId })
                }
              />
            ))}
          </SortableContext>
        </div>
        {createPortal(
          <DragOverlay dropAnimation={dropAnimation}>
            {activeDragItem ? (
              activeDragItem.type === "Card" ? (
                <CardContent {...activeDragItem.data} dragOverlay />
              ) : (
                <ListContent
                  {...activeDragItem.data}
                  tone="accent"
                  onStartAddCard={() => {}}
                  onDeleteCard={() => {}}
                  onDeleteList={() => {}}
                  onEditList={() => {}}
                  onOpenCard={() => {}}
                  dragOverlay
                />
              )
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </DndContext>

      <AnimatePresence>
        {isListModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-retro-ink/50 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md rounded-xl border-4 border-retro-ink bg-retro-paper p-6 shadow-retroPanel"
            >
              <h2 className="mb-4 font-retroHeading text-2xl font-black uppercase text-retro-ink">
                {editingListId ? "Editar Lista" : "Nova Lista"}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-bold uppercase tracking-wider text-retro-ink/70">
                    Título da Lista
                  </label>
                  <input
                    type="text"
                    value={listModalTitle}
                    onChange={(e) => setListModalTitle(e.target.value)}
                    className="w-full rounded border-2 border-retro-ink bg-retro-paper px-3 py-2 font-retroBody font-bold text-retro-ink shadow-[2px_2px_0_rgba(0,0,0,1)] focus:outline-none focus:shadow-none focus:translate-x-[2px] focus:translate-y-[2px] transition-all"
                    placeholder="Ex: A Fazer"
                    autoFocus
                  />
                </div>

                {!editingListId && (
                  <div>
                    <label className="mb-1 block text-sm font-bold uppercase tracking-wider text-retro-ink/70">
                      Primeiro Cartão (Opcional)
                    </label>
                    <input
                      type="text"
                      value={listModalFirstCardTitle}
                      onChange={(e) =>
                        setListModalFirstCardTitle(e.target.value)
                      }
                      className="w-full rounded border-2 border-retro-ink bg-retro-paper px-3 py-2 font-retroBody font-bold text-retro-ink shadow-[2px_2px_0_rgba(0,0,0,1)] focus:outline-none focus:shadow-none focus:translate-x-[2px] focus:translate-y-[2px] transition-all"
                      placeholder="Ex: Pesquisar referências"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-bold uppercase tracking-wider text-retro-ink/70">
                    Cor do Tema
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {listTones.map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => setListModalTone(tone)}
                        className={`h-8 w-8 rounded-full border-2 border-retro-ink shadow-[1px_1px_0_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 ${
                          toneBackgroundClasses[tone]
                        } ${
                          listModalTone === tone
                            ? "ring-2 ring-retro-ink ring-offset-2"
                            : ""
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsListModalOpen(false)}
                    className="rounded border-2 border-retro-ink px-4 py-2 font-black uppercase text-retro-ink transition-transform hover:bg-retro-ink/5 active:translate-y-0.5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveListModal}
                    className="rounded border-2 border-retro-ink bg-retro-accent px-4 py-2 font-black uppercase text-retro-ink shadow-[2px_2px_0_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:shadow-[3px_3px_0_rgba(0,0,0,1)] active:translate-y-0 active:shadow-[1px_1px_0_rgba(0,0,0,1)]"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-retro-ink/80 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="w-full max-w-sm rounded-xl border-4 border-retro-ink bg-retro-paper p-6 text-center shadow-retroPanel"
            >
              <div className="mb-4 text-5xl">🗑️</div>
              <h3 className="mb-2 font-retroHeading text-xl font-black uppercase text-retro-ink">
                Tem certeza?
              </h3>
              <p className="mb-6 font-retroBody text-retro-ink/80">
                Isso irá excluir permanentemente{" "}
                {deleteTarget.type === "list" ? "esta lista" : "este cartão"}.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="rounded border-2 border-retro-ink px-4 py-2 font-black uppercase text-retro-ink transition-transform hover:bg-retro-ink/5"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (deleteTarget.type === "list") {
                      deleteList(deleteTarget.listId);
                    } else {
                      deleteCard(deleteTarget.listId, deleteTarget.cardId);
                    }
                    setDeleteTarget(null);
                  }}
                  className="rounded border-2 border-retro-ink bg-retro-red px-4 py-2 font-black uppercase text-retro-paper shadow-[2px_2px_0_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:shadow-[3px_3px_0_rgba(0,0,0,1)]"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isStatsOpen && (
          <BoardStatsModal onClose={() => setIsStatsOpen(false)} />
        )}
        {selectedCardData && (
          <CardModal
            card={selectedCardData.card}
            availableLabels={availableLabels}
            onClose={() => setSelectedCard(null)}
            onCreateLabel={addLabel}
            onSave={(data) => {
              updateCard(
                selectedCardData.listId,
                selectedCardData.card.id,
                data
              );
              setSelectedCard(null);
            }}
          />
        )}
      </AnimatePresence>

      {newCardListId && (
        <CardModal
          availableLabels={availableLabels}
          onClose={() => setNewCardListId(null)}
          onCreateLabel={addLabel}
          onSave={(data) => {
            addCard(newCardListId, data);
            setNewCardListId(null);
          }}
        />
      )}
    </div>
  );
}
