## Objective
- Redesign HysCode desktop (Tauri v2 + React 19 + Tailwind v4) usando Aurora UI (de `C:\Users\estev\BIBLIOTECA`) como linguagem visual. Aurora vendorizada em `@hyscode/ui`; sistema multi-tema do HysCode preservado (6 temas + extensões + Monaco + ícones).
- Fase atual: Phases 2 & 3 (restyle de primitivos e chrome), mantendo `@base-ui/react` + APIs existentes (sem troca para Radix, sem quebrar call sites `render=`), conforme pivot do usuário ("pode continuar usando base se quiser").

## Important Details
- Branch: `Redesign-full` (específica p/ redesign, rastreia `hyska/Redesign-full`). Já fez merge de `hyska/main` → `0.5.1-build.57` (conflitos de versão em package.json/Cargo.toml/tauri.conf.json resolvidos pegando build.57).
- Aurora = React + Tailwind v4, OpenAI-inspired, neutral + (teal), dark-first, borderless. Tokens: `bg-card`, `bg-popover`, `hover:bg-muted`, `text-primary`, `bg-primary/15` (badge tinted), `shadow-sm`/`shadow-md`, `rounded-md`/`rounded-lg`, `active:scale-[0.98]`, keyframes `aurora-scale-in`/etc (em `packages/ui/src/styles/theme.css`).
- HysCode: shadcn bridge (`@theme inline` em `app.css`) + tokens de tema `.theme-*` via `useThemeEffect` + `settings-store` (`themeId`/`ThemeId`). Tokens semânticos: `--primary`, `--accent` (roxo por tema), `--surface`, `--surface-raised`, `--destructive`, `--success`, `--error`. `accent` data-field em `onboarding` é a cor swatch do tema (NÃO confundir com classe).
- Não commitado ainda (aguarda OK do usuário, per AGENTS.md).

## Work State
### Completed
- **Phase 0**: Aurora vendorizada em `packages/ui/src/` (components/, lib/, providers/, styles/theme.css, index.ts barrel). Imports `@/lib`→`../../lib` (108 arquivos), ThemeToggle `@/providers`→`../../providers`. `package.json` com Radix/CVA/clsx/tailwind-merge/lucide alinhados.
- **Phase 1**: `theme.css` (raw scales + easings + keyframes + `@source`). `app.css` importa lib theme.css + 6 `.theme-*` palettes + tokens `--destructive-foreground`, `--editor-bg/gutter`, `--terminal-bg/fg`. `accent-<n>`→tokens semânticos em 25 componentes.
- **Phase 2 (primitivos, Base UI mantido)**: button (`rounded-md`, `active:scale-[0.98]`, `shadow-sm`, `hover:bg-primary/90`), textarea (`bg-card`), tooltip (`shadow-md`), scroll-area (thumb `bg-muted-foreground/30` — corrigiu bug de thumb invisível), badge (`default`=`bg-primary/15 text-primary`), tab-badge (`bg-primary/15`), dropdown-menu (itens `hover:bg-muted`), dialogs (`bg-card`/`bg-primary`/`bg-destructive`), select (itens `hover:bg-muted`), mermaid-block (`hover:bg-muted`, `bg-primary/50`).
- **Phase 3 (chrome)**: titlebar (`border-b`), statusbar (`text-primary` + `border-t`), activity-bar (badge `bg-primary`), welcome (`accent`→`primary`, `error`→`destructive`), onboarding (regex `(?<![\w.])accent(?!:)`→`primary` e `(?<=text-|bg-|hover:bg-|border-)error`→`destructive`; campos `accent:`/`theme.accent`/`'error'` preservados).
- **Phase 3 aprofundada (unificação de marca)**: `accent`→`primary` em 132 arquivos (preservando swatches `accent:`/`.accent`), `bg-accent-muted`→`bg-primary/15`, `hover:bg-white/5`→`hover:bg-muted`, `error`→`destructive` (restante em file-tree).
- **Convergência semântica**: cores de status `red/green/yellow-400/500` → tokens `destructive`/`success`/`warning`.
- **TRANSFERÊNCIA VISUAL REAL (Aurora) — hyscode-dark/light**: reescreveu `.theme-hyscode-dark` e `.theme-hyscode-light` em `app.css` com a paleta EXATA da Aurora: acento **teal `#10a37f`** (era roxo `#a855f7`), fundo dark **`#202123`** (era `#0d0d0d`), card `#2a2b32`, surface-raised `#35363f`, bordas finas visíveis `rgba(255,255,255,0.08)`, input `0.12`, **ring teal `#10a37f`**, foreground `#ececf1`, muted-foreground `#8e8ea0`. Light: bg `#f7f7f8`, primary teal `#0d8a6c`, bordas `rgba(0,0,0,0.08)`.
- **Button** alinhado ao Aurora: `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background` (era `ring-3 ring-ring/50`).
- **Syntax highlight** (markdown): keyword/selector → teal (`#2fb28f` dark, `#0d8a6c` light).
- **FILETREE TRANSFERIDO (Aurora → HysCode)**: restilizado `file-tree.tsx` (1166 linhas, todas funcionalidades preservadas: git, diagnósticos, drag-drop, menu de contexto, teclado, rename inline, schema viewer, histórico):
  - **Row**: flat (sem `rounded`), `gap-1.5 py-1 pr-2 text-left text-sm`, `hover:bg-muted`, selection `bg-primary/15`, indent `depth*12+8`.
  - **Chevron**: `ChevronRight` com `rotate-90` ao abrir (padrão Aurora), `h-3.5 w-3.5 text-muted-foreground transition-transform`.
  - **Ícones**: node `h-4 w-4`, spacer `w-3.5`, loader `h-3.5`.
  - **InlineInput**: `rounded-md bg-card ring-2 ring-primary/40`.
  - **ContextMenu**: `rounded-xl border-border bg-popover shadow-lg`; itens `hover:bg-muted`.
  - **Git badges**: `amber/purple/orange` → `warning/primary/warning`.
  - **Diagnostics dots**: `red-400/amber-400/green-400` → `destructive/warning/success`.
  - **Pending overlay**: `bg-card shadow-sm`.
  - `file-explorer-view.tsx` (header) mantido; todos os ícones material SVG (`file-icons.tsx`) preservados.
- **MONACO + TERMINAL INTEGRADOS (hyscode-dark/light)**: Monaco `editor.background`→`#202123`, cursor/scrollbar/seleção teal, syntax teal; xterm bg/cursor/magenta teal; fallbacks extensão→teal.
- **Validação**: `typecheck` 10/10, `lint` 9/9, `vite build` (desktop) OK (1m47s). `npm run build` raiz falha só em `claude-agent-sidecar` (falta `bun`).
- NOTA: `--editor-bg`/`--editor-gutter`/`--terminal-bg`/`--terminal-fg` (adicionados na Phase 1) são tokens mortos (não usados); Monaco/terminal usam seus próprios temas em `monaco-themes.ts`.
- **Validação**: `npm run typecheck` 10/10, `npm run lint` 9/9 (6 warnings pré-existentes em db-schema-viewer/extensions-view/mermaid-block). Build vite OK em fases anteriores.

### Active
- **Phase 3 comp. de IDE**: FileTree transferido. Outros componentes de IDE (TabBar, Terminal visual, StatusBar, agent panels) podem ser refinados opcionalmente.
- **Validação**: `typecheck` 10/10, `lint` 9/9, `vite build` (desktop) OK (1m47s).

### Blocked
- `npm run build` raiz quebra em `@hyscode/claude-agent-sidecar` por `bun` ausente no ambiente (issue de toolchain, não do redesign). Build do app desktop isolado passa.

## Next Move
1. (Opcional) Aplicar paleta Aurora aos 4 temas de extensão (nord/dracula/github-dark/monokai) ou deixá-los como variantes.
2. (Opcional) Componentes de IDE (FileTree, TabBar, Terminal, StatusBar, ActivityBar) — refinar para padrão Aurora (raio `xl`, `shadow-sm`, `tracking-tight` em títulos) sobrepondo os tokens já aplicados.
3. **Commit/PR**: recomenda-se commitar `Redesign-full` e abrir PR (ainda NÃO commitado, aguarda OK do usuário).

## Relevant Files
- `C:\Users\estev\BIBLIOTECA` — Aurora referência (src/components/*, src/styles/theme.css, DESIGN_SYSTEM.md)
- `C:\Users\estev\Hyscode\packages\ui\src\styles\theme.css` — raw scales + keyframes
- `C:\Users\estev\Hyscode\apps\desktop\src\app.css` — bridge `@theme inline` + 6 `.theme-*`
- `C:\Users\estev\Hyscode\apps\desktop\src\components\ui\` — 11 shims já restyled
- `C:\Users\estev\Hyscode\apps\desktop\src\components\titlebar\`, `statusbar\`, `sidebar\activity-bar.tsx`, `welcome\`, `onboarding\` — chrome já restyled
- `C:\Users\estev\Hyscode\apps\desktop\src\components\sidebar\views\` — ALVO (file-tree.tsx, file-explorer-view.tsx, git-view.tsx, git-view-new.tsx, search-view.tsx, skills-view.tsx, extensions-view.tsx, devices-view.tsx, docker-view.tsx, memories-view.tsx, agent-sidebar-view.tsx, skill-editor.tsx, extension-view-panel.tsx, file-icons.tsx)
- `C:\Users\estev\Hyscode\apps\desktop\src\components\layouts\` — ALVO (agent-layout.tsx, editor-layout.tsx, agent-left-panel.tsx, agent-right-panel.tsx, right-tab-context-menu.tsx)
- `C:\Users\estev\Hyscode\apps\desktop\src\components\agent\` — ALVO (agent-input.tsx, agent panels)
- `C:\Users\estev\Hyscode\apps\desktop\src\components\editor\` — ALVO
- `C:\Users\estev\Hyscode\apps\desktop\src\stores\settings-store.ts` — `themeId`/`ThemeId`
- Branch: `Redesign-full`
