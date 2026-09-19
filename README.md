# Kanbanity

Uma aplicação web de quadro Kanban com visual cartoon, construída com React, TypeScript e Vite para organizar tarefas de forma leve, visual e divertida.

> Organize seu fluxo de trabalho em listas, arraste cartões entre colunas e acompanhe a evolução das suas tarefas em um painel com vibe de gibi/cartoon.

---

## Sobre o Projeto

O Kanbanity é um quadro Kanban focado em experiência visual e produtividade individual.

Ele oferece:

- Organização de tarefas em listas personalizáveis.
- Cartões com descrição, etiquetas, data de vencimento e prioridade.
- Arrastar e soltar de listas e cartões com animações suaves.
- Estatísticas rápidas sobre o quadro (cards totais, concluídos, atrasados, lista mais movimentada).
- Persistência local automática no navegador (sem backend).

Tudo isso em uma interface com:

- Tema cartoon com inspiração retrô em HQs.
- Cores vibrantes configuradas via Tailwind CSS.
- Layout responsivo pensado principalmente para desktop e tablets.

---

## Funcionalidades Principais

### Quadro Kanban Cartoon

- Listas em colunas: “A Fazer”, “Em Progresso”, “Concluído” (configuráveis).
- Criação, edição e exclusão de listas.
- Drag and drop de listas e cartões usando `@dnd-kit/core` e `@dnd-kit/sortable`.
- Animações de movimento e modais com `framer-motion`.

### Cards Ricos em Informações

- Título e descrição opcional de cada tarefa.
- Etiquetas (tags) múltiplas por card.
- Campo de data de vencimento com destaque visual:
  - Vermelho para tarefas atrasadas.
  - Amarelo para tarefas que vencem hoje.
  - Indicação de data formatada (dd/mm).
- Campo de prioridade:
  - Baixa, Média ou Alta, com cores distintas.

### Etiquetas e Tags

- Conjunto inicial de etiquetas prontas, como:
  - Urgente, Prioridade Alta, Média, Baixa.
  - Bug, Feature, Design, DevOps.
- Possibilidade de criar novas etiquetas diretamente pelo modal do cartão:
  - Escolha de nome e cor entre várias opções pré-definidas.
- Destaque especial para etiquetas críticas (Urgente/Prioridade Alta) no cartão.

### Filtros e Busca

- Campo de busca por:
  - Título do card.
  - Conteúdo/descrição.
  - Nome das etiquetas.
- Filtro por etiqueta específica.
- Filtro por lista específica.
- Combinação de filtros, exibindo apenas as listas com cards que atendem aos critérios.

### Estatísticas do Board

- Modal de estatísticas do quadro com:
  - Total de cards.
  - Quantidade de cards concluídos (última lista).
  - Quantidade de cards atrasados.
  - Lista mais movimentada (com mais cards).

### Persistência Local, Sincronização e Histórico

- Todo o estado do board é salvo de forma atômica em uma única chave localStorage (kanbanity-board), em um envelope versionado (formato 2). Dados legados (quadro bruto da versão anterior) migram automaticamente e dados corrompidos nunca quebram a inicialização.
- Cada modificação real (criar/editar/excluir listas e cartões, reordenar listas, mover cartões na mesma lista ou entre listas e criar etiquetas) é uma operação atômica com id estável, relógio de Lamport e origem da aba. Ações sem mudança real (cancelar drag, soltar na posição original, alvo inexistente) não geram operação nem histórico.
- Várias abas sincronizam via eventos storage (sem polling, sem backend, sem refresh). Operações são deduzidas por id e reduzidas em ordem canônica (clock depois origin), então eventos fora de ordem ou duplicados convergem exatamente para o mesmo estado.
- Conflitos usam regras determinísticas: último escritor ganha por campo (Lamport + origem); movimentos concorrentes do mesmo cartão compõem a ordenação canonicamente; exclusões vencem edições/movimentos atrasados: um objeto excluído nunca reaparece, mas o undo de uma exclusão pode incorporar edições concorrentes.
- Undo/Redo por aba com botões no cabeçalho e atalhos Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z (ou Ctrl/Cmd+Y). O histórico é apenas local: atualizações remotas não entram na pilha de undo e novas ações locais descartam o branch de redo. Undo nunca reverte edições alheias nem ressuscita objetos removidos por outra aba.
- Ao recarregar, o estado final é reconstruído a partir do snapshot, operações e metadados CRDT; o log é compactado automaticamente sem perder convergência entre abas compactadas independentemente.

### Tema e Visual

- Paleta de cores em estilo cartoon retrô configurada em `tailwind.config.js` (namespace `retro`).
- Fontes personalizadas para reforçar o clima de HQ:
  - `Bangers` para títulos.
  - `Comic Sans` / fontes de sistema para o corpo de texto.
- Estilo de painel com bordas grossas, sombras e “cartoon vibes”.
- Suporte a `darkMode: "class"` no Tailwind, com infraestrutura de contexto de tema preparada:
  - `ThemeContext` e `ThemeProvider` para armazenar o tema.
  - Componente `ThemeToggle` para alternar entre claro/escuro.

---

## Tecnologias Utilizadas

Este projeto foi construído com o ecossistema moderno do React:

- **React 19** – biblioteca principal de UI.
- **TypeScript** – tipagem estática para segurança e manutenção.
- **Vite** – bundler e dev server rápido.
- **Tailwind CSS v4** – estilização utilitária e customizável.
- **@dnd-kit/core** e **@dnd-kit/sortable** – drag and drop acessível e performático.
- **Framer Motion** – animações suaves em modais e transições de layout.
- **Vitest** – testes unitários e de integração.
- **Testing Library (React)** – testes focados em comportamento do usuário.
- **ESLint** – análise estática de código.

---

## Como Executar o Projeto

### Pré-requisitos

- Node.js 18 ou superior.
- Gerenciador de pacotes:
  - `npm` (recomendado) ou `yarn` ou `pnpm`.

### Passo a passo

1. **Clone o repositório**

   ```bash
   git clone https://github.com/miquelven/kanbanity.git
   cd kanbanity
   ```

2. **Instale as dependências**

   ```bash
   npm install
   # ou
   yarn install
   # ou
   pnpm install
   ```

3. **Execute o servidor de desenvolvimento**

   ```bash
   npm run dev
   ```

4. **Acesse a aplicação**

- Abra o navegador no endereço exibido pelo Vite (por padrão, `http://localhost:5173`).

---

## Scripts Disponíveis

No `package.json`, você encontra os seguintes scripts:

- `npm run dev` – inicia o servidor de desenvolvimento do Vite.
- `npm run build` – gera o build de produção.
- `npm run preview` – serve localmente o build de produção.
- `npm run lint` – roda o ESLint em todo o projeto.
- `npm test` – executa a suíte de testes com Vitest.

---

## Estrutura do Projeto

Abaixo um resumo da estrutura principal do projeto:

```bash
.
├── public/
│   └── vite.svg
├── src/
│   ├── assets/
│   │   └── react.svg
│   ├── components/
│   │   ├── Board.tsx          # Layout principal do quadro Kanban
│   │   ├── List.tsx           # Colunas/listas com suporte a drag and drop
│   │   ├── Card.tsx           # Cartões individuais com labels, prioridade e data
│   │   ├── CardModal.tsx      # Modal para criar/editar cards
│   │   ├── BoardStatsModal.tsx# Modal de estatísticas do board
│   │   └── ThemeToggle.tsx    # Botão de alternância de tema (claro/escuro)
│   ├── contexts/
│   │   ├── BoardContext.ts    # Contexto React para o estado do quadro
│   │   ├── BoardProvider.tsx  # Provider com operações de listas/cards/labels
│   │   ├── ThemeContext.tsx   # Provider de tema (light/dark)
│   │   └── theme.ts           # Tipos e hook para consumo do tema
│   ├── hooks/
│   │   ├── useBoardDragDrop.ts# Lógica de drag and drop de listas e cards
│   │   ├── useBoardFilters.ts # Filtros por texto, etiqueta e lista
│   │   ├── useBoardStats.ts   # Cálculo de estatísticas do board
│   │   └── usePersistentState.ts # Hook para persistir estado no localStorage
│   ├── data/
│   │   ├── initial-data.ts    # Estado inicial do board
│   │   └── labels.ts          # Conjunto inicial de etiquetas
│   ├── types/
│   │   └── kanban.ts          # Tipos TypeScript para Board, List, Card e Label
│   ├── App.tsx                # Composição da UI principal
│   ├── main.tsx               # Ponto de entrada React + Vite
│   ├── index.css              # Estilos globais
│   └── App.css                # Estilos específicos da aplicação
├── index.html                 # HTML base usado pelo Vite
├── package.json               # Dependências e scripts
├── tailwind.config.js         # Configuração do Tailwind (tema cartoon retrô)
└── tsconfig*.json             # Configurações de TypeScript
```

---

## Testes

O projeto possui testes de integração básicos para o fluxo principal do board:

- Criação de novas listas.
- Criação de novos cards.
- Persistência dos dados no `localStorage`.
- Edição de cards (incluindo data de vencimento) e verificação visual da atualização.

Para rodar os testes:

```bash
npm test
```

---

## Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou enviar Pull Requests.

1. Faça um fork do projeto.
2. Crie uma branch para sua feature:

   ```bash
   git checkout -b feature/minha-feature
   ```

3. Faça commit das suas alterações:

   ```bash
   git commit -m "Adiciona: minha feature"
   ```

4. Faça push para a branch:

   ```bash
   git push origin feature/minha-feature
   ```

5. Abra um Pull Request descrevendo suas mudanças.
