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

### Persistência Local

- Todo o estado do board é persistido de forma atômica em uma única chave
  `kanbanity-board` dentro do `localStorage` (um documento com um log de
  operações — sem estado de negócio dividido em várias chaves).
- Múltiplas abas são sincronizadas em tempo real via eventos `storage`:
  cada mutação real é uma operação com carimbo de Lamport, ordem por chave
  fracionária (fractional indexing) e ids únicos por aba. Alterações
  concorrentes em objetos distintos são todas preservadas; edições/movimentos
  concorrentes no mesmo objeto convergem por uma regra determinística
  (timestamp maior vence; empate por id da operação). Exclusões são
  aderentes — uma edição ou movimento tardio baseado num estado antigo nunca
  ressuscita um objeto apagado.
- Undo/Redo comuns de editor: atalhos `Ctrl/Cmd+Z` e `Ctrl/Cmd+Shift+Z` (ou
  `Ctrl+Y`), além de botões na barra superior. Cada ação do usuário gera no
  máximo uma entrada de histórico; cancelar arrasto, arrastar para a mesma
  posição ou alvejar algo já removido não polui o histórico. Atualizações
  recebidas de outras abas nunca viram ações desfazíveis desta aba, e desfazer
  preserva edições remotas não relacionadas.
- A migração do formato antigo (quadro serializado) é automática e dados
  corrompidos não impedem a inicialização.

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
