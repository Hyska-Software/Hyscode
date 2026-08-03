# SpectraLang Support for HysCode

Suporte nativo à linguagem [SpectraLang](https://github.com/Estevaobonatto/SpectraLang) no HysCode — linguagem, syntax highlighting, IntelliSense via LSP (`spectra-lsp`), snippets, formatação, diagnósticos e comandos do toolchain (`spectralang`).

## Features

- **Linguagem**: associação de `.spectra` / `.spc`, syntax highlighting (Monarch), brackets, auto-closing, indentation
- **Language Service** (via `spectra-lsp`):
  - Diagnósticos ao digitar (syntax, semantic, lint) com debounce
  - Hover com tipo e escopo do símbolo
  - Completions (keywords, std.api, símbolos do documento, rotas de API)
  - Go-to-definition, references, rename, document highlights
  - Signature help, inlay hints (tipos de `let`), code actions (quick fixes)
  - Formatação (`spectralang fmt --stdin`) via "Format Document"
  - Símbolos do documento e do workspace
- **Comandos** (paleta + menu de contexto + editor/title):
  - `Spectra: Run` (Ctrl+F5) — executa o arquivo no terminal integrado
  - `Spectra: Check` (Ctrl+Shift+H) — type-check via `spectralang check`
  - `Spectra: Compile` — `spectralang compile`
  - `Spectra: Lint Workspace` — `spectralang lint`
  - `Spectra: Format File` — `spectralang fmt`
  - `Spectra: New Project` — scaffold `spectralang new`
  - `Spectra: Compiler Actions...` / `Spectra: API Actions...` — quick picks
- **Snippets**: módulo, funções (sync/async), struct/enum/impl, loops, match, imports, f-strings, handlers e rotas `std.api`
- **Status bar** e **aba de Settings** dedicada (toolchain, lint/format on save)

## Pré-requisitos

O toolchain SpectraLang (`spectralang` e `spectra-lsp`) precisa estar no `PATH`:

- **Instalador oficial**: instala ambos os binários e adiciona ao PATH automaticamente
- **Build local**: `cargo build -p spectra-cli -p spectra-lsp` (binários em `target/debug/`)

Verifique com `spectralang --help` e `spectra-lsp --version` (ou pelo painel de LSP do HysCode, aba Servidores → Spectra Language Server).

## Configuração

| Chave | Padrão | Descrição |
|---|---|---|
| `spectra.cliPath` | `spectralang` | Caminho do binário `spectralang` |
| `spectra.lintOnSave` | `true` | Incluir lints nos diagnósticos ao salvar |
| `spectra.formatOnSave` | `false` | Formatar via LSP ao salvar |

Também configurável pela aba **Settings → SpectraLang**.

## Instalação

1. Abra o painel de **Extensões** (sidebar)
2. **Instalar da pasta** e selecione `extensions/spectra-support/` (ou instale o `.zip` empacotado)
3. Para atualizações durante o desenvolvimento: `pwsh scripts/sync-extensions.ps1` e recarregue o app

## Notas de manutenção

- O tokenizer Monarch do core do Hyscode (`packages/lsp-client/src/language-registry.ts`, `registerSpectra`) é derivado da grammar TextMate oficial `tools/vscode-extension/syntaxes/spectra.tmLanguage.json` do repositório SpectraLang — mantenha-os em sincronia ao evoluir a linguagem.
- Os snippets são copiados de `tools/vscode-extension/snippets/spectra.code-snippets`.
- O LSP é o binário `spectra-lsp` do repo SpectraLang (`tools/spectra-lsp`), que espelha o servidor usado pela extensão VS Code oficial.
