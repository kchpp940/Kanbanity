import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import App from "./App";

describe("Board Integration Tests", () => {
  beforeEach(() => {
    localStorage.clear();
  });

   afterEach(() => {
     cleanup();
  });

  it("should create a new list", async () => {
    render(<App />);

    // Click on "Nova lista" button
    const newListButton = screen.getByText("Nova lista");
    fireEvent.click(newListButton);

    // Fill in the list title
    const titleInput = screen.getByPlaceholderText("Ex: A Fazer");
    fireEvent.change(titleInput, { target: { value: "Minha Nova Lista" } });

    // Click on "Salvar" button
    const saveButton = screen.getByText("Salvar");
    fireEvent.click(saveButton);

    // Verify if the list was created by looking for the heading specifically
    const headings = screen.getAllByRole("heading", { level: 3 });
    const newListHeading = headings.find(
      (h) => h.textContent === "Minha Nova Lista"
    );
    expect(newListHeading).toBeInTheDocument();
  });

  it("should create a new card in a list", async () => {
    render(<App />);

    // First, create a list
    const newListButton = screen.getByText("Nova lista");
    fireEvent.click(newListButton);
    const titleInput = screen.getByPlaceholderText("Ex: A Fazer");
    fireEvent.change(titleInput, { target: { value: "Lista de Tarefas" } });
    const saveButton = screen.getByText("Salvar");
    fireEvent.click(saveButton);

    // Wait for list modal to close (it might take time due to animation)
    // We check if "Nova Lista" title (from modal) is gone
    await waitFor(() =>
      expect(screen.queryByText("Nova Lista")).not.toBeInTheDocument()
    );

    // Find the "Adicionar cartão" button
    // Note: The text is "Adicionar cartão", not "Adicionar card"
    const addCardButtons = screen.getAllByText("Adicionar cartão");
    const targetAddButton = addCardButtons[addCardButtons.length - 1];
    fireEvent.click(targetAddButton);

    // Verify modal opens
    expect(screen.getByText("Detalhes do cartão")).toBeInTheDocument();

    // Fill card details
    const cardTitleInput = screen.getByPlaceholderText("Ex: Comprar leite");
    fireEvent.change(cardTitleInput, {
      target: { value: "Novo Cartão Teste" },
    });

    const cardContentInput = screen.getByPlaceholderText(
      "Ex: Detalhes da tarefa..."
    );
    fireEvent.change(cardContentInput, {
      target: { value: "Descrição do teste" },
    });

    // Save card
    const saveCardButton = screen.getByText("Salvar");
    fireEvent.click(saveCardButton);

    // Verify card is in the document
    expect(screen.getByText("Novo Cartão Teste")).toBeInTheDocument();
  });

  it("should persist data in localStorage", async () => {
    // 1. Render App and create a list
    const { unmount } = render(<App />);

    const newListButton = screen.getByText("Nova lista");
    fireEvent.click(newListButton);
    const titleInput = screen.getByPlaceholderText("Ex: A Fazer");
    fireEvent.change(titleInput, { target: { value: "Lista Persistente" } });
    const saveButton = screen.getByText("Salvar");
    fireEvent.click(saveButton);

    // Check if it exists
    const headings = screen.getAllByRole("heading", { level: 3 });
    const listHeading = headings.find(
      (h) => h.textContent === "Lista Persistente"
    );
    expect(listHeading).toBeInTheDocument();

    // 2. Unmount App (simulating refresh/close)
    unmount();

    // 3. Render App again (cleanup guarantees a fresh mount like a refresh)
    render(<App />);

    // 4. Check if data persists
    const headingsAfter = screen.getAllByRole("heading", { level: 3 });
    const listHeadingAfter = headingsAfter.find(
      (h) => h.textContent === "Lista Persistente"
    );
    expect(listHeadingAfter).toBeInTheDocument();
  });

  it("should edit an existing card and close the modal", async () => {
    const { container } = render(<App />);

    // 1. Create List
    const newListButton = screen.getByText("Nova lista");
    fireEvent.click(newListButton);
    const titleInput = screen.getByPlaceholderText("Ex: A Fazer");
    fireEvent.change(titleInput, { target: { value: "Lista de Edição" } });
    const saveButton = screen.getByText("Salvar");
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(screen.queryByText("Nova Lista")).not.toBeInTheDocument()
    );

    // 2. Create Card
    const addCardButtons = screen.getAllByText("Adicionar cartão");
    const targetAddButton = addCardButtons[addCardButtons.length - 1];
    fireEvent.click(targetAddButton);
    const cardTitleInput = screen.getByPlaceholderText("Ex: Comprar leite");
    fireEvent.change(cardTitleInput, { target: { value: "Cartão Original" } });
    const saveCardButton = screen.getByText("Salvar");
    fireEvent.click(saveCardButton);
    // Wait for create modal to close
    await waitFor(() =>
      expect(screen.queryByText("Detalhes do cartão")).not.toBeInTheDocument()
    );

    // 3. Open Card for Editing
    const openButtons = screen.getAllByText("Abrir");
    const targetOpenButton = openButtons[openButtons.length - 1];
    fireEvent.click(targetOpenButton);

    // 4. Verify Modal Open
    expect(screen.getByText("Detalhes do cartão")).toBeInTheDocument();

    // 5. Edit Card
    const editTitleInput = screen.getByDisplayValue("Cartão Original");
    fireEvent.change(editTitleInput, { target: { value: "Cartão Editado" } });

    // Edit Date
    // Use container query selector for date input since it lacks aria-label/id
    const dateInput = container.querySelector('input[type="date"]');
    if (!dateInput) throw new Error("Date input not found");
    fireEvent.change(dateInput, { target: { value: "2024-12-31" } });

    // 6. Save
    // The modal has a "Salvar" button.
    // Note: There might be multiple "Salvar" buttons if other modals are hidden?
    // No, modals are conditionally rendered.
    const saveEditButton = screen.getByText("Salvar");
    fireEvent.click(saveEditButton);

    // 7. Verify Modal Closed
    await waitFor(() =>
      expect(screen.queryByText("Detalhes do cartão")).not.toBeInTheDocument()
    );

    // 8. Verify Card Updated
    expect(screen.getByText("Cartão Editado")).toBeInTheDocument();

    // 9. Verify Date updated (tooltip or visual indicator)
    // The card component renders date in a span inside a div with title="Vence em: YYYY-MM-DD"
    // The text content is formatted date.
    // "2024-12-31" -> "31/12"
    expect(screen.getByText("31/12")).toBeInTheDocument();
  });
});
