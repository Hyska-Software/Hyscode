# Compilação Completa de Modelos por Provedor

Referência consolidada de todos os modelos listados nas documentações oficiais de cada provedor, com ID, nome, janela de contexto, custos em USD (por 1M tokens) e tipos de pensamento/esforço suportados. 

---

## 1. OpenCode Go

Assinatura de baixo custo: **US$ 5 no primeiro mês, depois US$ 10/mês**. Acesso a modelos abertos selecionados, hospedados em US, UE e Singapura. Os preços abaixo são os **preços de referência por 1M tokens** usados para calcular os limites de uso (5h = US$ 12, semanal = US$ 30, mensal = US$ 60).

| Nome | ID do modelo | Janela de contexto | Entrada | Saída | Cache read | Cache write | Tipos de pensamento |
|---|---|---|---|---|---|---|---|
| Grok 4.5 | `grok-4.5` | 500K | $2.00 | $6.00 | $0.30 | – | reasoning model (low/medium/high) |
| GPT 5.6 Luna | `gpt-5.6-luna` | 1.05M | $0.20 | $1.20 | $0.02 | $0.25 | none/low/med/high/xhigh/max + standard/pro |
| GLM-5.2 | `glm-5.2` | 1M | $1.40 | $4.40 | $0.26 | – | thinking model |
| GLM-5.1 | `glm-5.1` | 1M | $1.40 | $4.40 | $0.26 | – | thinking model |
| Kimi K3 | `kimi-k3` | 1M | $3.00 | $15.00 | $0.30 | – | reasoning (low/medium/high) |
| Kimi K2.7 Code | `kimi-k2.7-code` | 256K | $0.95 | $4.00 | $0.19 | – | thinking |
| Kimi K2.6 | `kimi-k2.6` | 256K | $0.95 | $4.00 | $0.16 | – | thinking |
| MiMo-V2.5 | `mimo-v2.5` | 1M | $0.14 | $0.28 | $0.0028 | – | thinking |
| MiMo-V2.5-Pro | `mimo-v2.5-pro` | 1M | $0.435 | $0.87 | $0.003625 | – | thinking |
| MiniMax M3 | `minimax-m3` | 1M | $0.30 | $1.20 | $0.06 | – | hybrid thinking |
| MiniMax M2.7 | `minimax-m2.7` | 1M | $0.30 | $1.20 | $0.06 | $0.375 | hybrid thinking |
| MiniMax M2.5 | `minimax-m2.5` | 1M | $0.30 | $1.20 | $0.06 | $0.375 | hybrid thinking |
| Qwen3.7 Max | `qwen3.7-max` | 1M | $2.50 | $7.50 | $0.50 | $3.125 | thinking (low/medium/high) |
| Qwen3.7 Plus | `qwen3.7-plus` | 256K–1M | $0.40 / $1.20 (>256K) | $1.60 / $4.80 | $0.04 / $0.12 | $0.50 / $1.50 | thinking |
| Qwen3.6 Plus | `qwen3.6-plus` | 256K–1M | $0.50 / $2.00 (>256K) | $3.00 / $6.00 | $0.05 / $0.20 | $0.625 / $2.50 | thinking |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1M | $0.435 | $0.87 | $0.003625 | – | reasoning (low/medium/high) |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 1M | $0.14 | $0.28 | $0.0028 | – | reasoning (low/medium/high) |
| Hy3 | `hy3` | 1M | $0.14 | $0.58 | $0.035 | – | thinking |

**Endpoint unificado:** `https://opencode.ai/zen/go/v1/chat/completions` (modelos OpenAI-compatible), `https://opencode.ai/zen/go/v1/messages` (modelos Anthropic-compatible) ou `https://opencode.ai/zen/go/v1/responses` (GPT 5.6 Luna). No config do OpenCode, o ID usa o prefixo `opencode-go/<model-id>`.

---

## 2. OpenCode Zen

Gateway de IA curado pela equipe OpenCode, **pay-as-you-go** por 1M tokens. Inclui modelos gratuitos (por tempo limitado) e modelos proprietários (OpenAI, Anthropic, Google, xAI) além dos abertos.

### 2.1 Modelos gratuitos (free)

| Nome | ID do modelo | Entrada | Saída | Cache read |
|---|---|---|---|---|
| Big Pickle (stealth) | `big-pickle` | Free | Free | Free |
| DeepSeek V4 Flash Free | `deepseek-v4-flash-free` | Free | Free | Free |
| MiMo-V2.5 Free | `mimo-v2.5-free` | Free | Free | Free |
| Laguna S 2.1 Free | `laguna-s-2.1-free` | Free | Free | Free |
| Ling-3.0-flash Free | `ling-3.0-flash-free` | Free | Free | Free |
| North Mini Code Free | `north-mini-code-free` | Free | Free | Free |
| Nemotron 3 Ultra Free | `nemotron-3-ultra-free` | Free | Free | Free |

### 2.2 Modelos abertos pagos

| Nome | ID do modelo | Janela de contexto | Entrada | Saída | Cache read | Cache write | Tipos de pensamento |
|---|---|---|---|---|---|---|---|
| MiniMax M3 | `minimax-m3` | 1M | $0.30 | $1.20 | $0.06 | – | hybrid thinking |
| MiniMax M2.7 | `minimax-m2.7` | 1M | $0.30 | $1.20 | $0.06 | – | hybrid thinking |
| MiniMax M2.5 | `minimax-m2.5` | 1M | $0.30 | $1.20 | $0.06 | – | hybrid thinking |
| GLM 5.2 | `glm-5.2` | 1M | $1.40 | $4.40 | $0.26 | – | thinking |
| GLM 5.1 | `glm-5.1` | 1M | $1.40 | $4.40 | $0.26 | – | thinking |
| GLM 5 | `glm-5` | 1M | $1.00 | $3.20 | $0.20 | – | thinking |
| Kimi K2.7 Code | `kimi-k2.7-code` | 256K | $0.95 | $4.00 | $0.19 | – | thinking |
| Kimi K2.6 | `kimi-k2.6` | 256K | $0.95 | $4.00 | $0.16 | – | thinking |
| Kimi K2.5 | `kimi-k2.5` | 256K | $0.60 | $3.00 | $0.10 | – | thinking |
| Qwen3.7 Max | `qwen3.7-max` | 1M | $2.50 | $7.50 | $0.50 | $3.125 | thinking (low/med/high) |
| Qwen3.7 Plus | `qwen3.7-plus` | 1M | $0.40 | $1.60 | $0.04 | $0.50 | thinking |
| Qwen3.6 Plus | `qwen3.6-plus` | 1M | $0.50 | $3.00 | $0.05 | $0.625 | thinking |
| Qwen3.5 Plus | `qwen3.5-plus` | 1M | $0.20 | $1.20 | $0.02 | $0.25 | thinking |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1M | $1.74 | $3.48 | $0.145 | – | reasoning |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 1M | $0.14 | $0.28 | $0.028 | – | reasoning |

### 2.3 Modelos Anthropic (via Zen)

| Nome | ID do modelo | Janela de contexto | Entrada | Saída | Cache read | Cache write | Tipos de pensamento |
|---|---|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1M | $10.00 | $50.00 | $1.00 | $12.50 | adaptive thinking (low/med/high/xhigh/max) |
| Claude Opus 5 | `claude-opus-5` | 1M | $5.00 | $25.00 | $0.50 | $6.25 | adaptive thinking (low/med/high/xhigh/max) |
| Claude Opus 4.8 | `claude-opus-4-8` | 1M | $5.00 | $25.00 | $0.50 | $6.25 | adaptive thinking (low/med/high/xhigh/max) |
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | $5.00 | $25.00 | $0.50 | $6.25 | adaptive thinking (low/med/high/xhigh/max) |
| Claude Opus 4.6 | `claude-opus-4-6` | 1M | $5.00 | $25.00 | $0.50 | $6.25 | adaptive thinking (low/med/high/max) |
| Claude Opus 4.5 | `claude-opus-4-5` | 1M | $5.00 | $25.00 | $0.50 | $6.25 | adaptive thinking (low/med/high) |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $2.00 | $10.00 | $0.20 | $2.50 | adaptive thinking (low/med/high/xhigh/max) |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | $3.00 | $15.00 | $0.30 | $3.75 | adaptive thinking (low/med/high/max) |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | 200K–1M | $3.00 / $6.00 (>200K) | $15.00 / $22.50 | $0.30 / $0.60 | $3.75 / $7.50 | extended thinking |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1.00 | $5.00 | $0.10 | $1.25 | extended thinking |

### 2.4 Modelos Google Gemini (via Zen)

| Nome | ID do modelo | Janela de contexto | Entrada | Saída | Cache read | Tipos de pensamento |
|---|---|---|---|---|---|---|
| Gemini 3.6 Flash | `gemini-3.6-flash` | 1M | $1.50 | $7.50 | $0.15 | thinking (low/med/high) |
| Gemini 3.5 Flash | `gemini-3.5-flash` | 1M | $1.50 | $9.00 | $0.15 | thinking (low/med/high) |
| Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite` | 1M | $0.30 | $2.50 | $0.03 | thinking (low/med) |
| Gemini 3.1 Pro | `gemini-3.1-pro` | 200K–1M | $2.00 / $4.00 (>200K) | $12.00 / $18.00 | $0.20 / $0.40 | thinking (low/med/high) |
| Gemini 3 Flash | `gemini-3-flash` | 1M | $0.50 | $3.00 | $0.05 | thinking (low/med) |

### 2.5 Modelos xAI Grok (via Zen)

| Nome | ID do modelo | Janela de contexto | Entrada | Saída | Cache read | Tipos de pensamento |
|---|---|---|---|---|---|---|
| Grok 4.5 | `grok-4.5` | 200K–500K | $2.00 / $4.00 (>200K) | $6.00 / $12.00 | $0.30 / $0.60 | reasoning (low/med/high) |
| Grok Build 0.1 | `grok-build-0.1` | 200K | $1.00 | $2.00 | $0.20 | reasoning |

### 2.6 Modelos OpenAI GPT (via Zen)

| Nome | ID do modelo | Janela de contexto | Entrada | Saída | Cache read | Cache write | Tipos de pensamento |
|---|---|---|---|---|---|---|---|
| GPT 5.6 Sol | `gpt-5.6-sol` | 1.05M (272K short ctx) | $5.00 / $10.00 (>272K) | $30.00 / $45.00 | $0.50 / $1.00 | $6.25 / $12.50 | none/low/med/high/xhigh/max + standard/pro mode |
| GPT 5.6 Terra | `gpt-5.6-terra` | 1.05M | $2.00 / $4.00 (>272K) | $12.00 / $18.00 | $0.20 / $0.40 | $2.50 / $5.00 | none/low/med/high/xhigh/max + standard/pro |
| GPT 5.6 Luna | `gpt-5.6-luna` | 1.05M | $0.20 / $0.40 (>272K) | $1.20 / $1.80 | $0.02 / $0.04 | $0.25 / $0.50 | none/low/med/high/xhigh/max + standard/pro |
| GPT 5.5 | `gpt-5.5` | 1M (272K short ctx) | $5.00 / $10.00 (>272K) | $30.00 / $45.00 | $0.50 / $1.00 | – | none/low/med/high/xhigh/max |
| GPT 5.5 Pro | `gpt-5.5-pro` | 1M | $30.00 | $180.00 | $30.00 | – | none/low/med/high/xhigh/max |
| GPT 5.4 | `gpt-5.4` | 1M | $2.50 / $5.00 (>272K) | $15.00 / $22.50 | $0.25 / $0.50 | – | none/low/med/high/xhigh/max |
| GPT 5.4 Pro | `gpt-5.4-pro` | 1M | $30.00 | $180.00 | $30.00 | – | none/low/med/high/xhigh/max |
| GPT 5.4 Mini | `gpt-5.4-mini` | 200K | $0.75 | $4.50 | $0.075 | – | none/low/med/high |
| GPT 5.4 Nano | `gpt-5.4-nano` | 200K | $0.20 | $1.25 | $0.02 | – | none/low/med |
| GPT 5.3 Codex | `gpt-5.3-codex` | 272K | $1.75 | $14.00 | $0.175 | – | none/low/med/high/xhigh/max |
| GPT 5.3 Codex Spark | `gpt-5.3-codex-spark` | 272K | $1.75 | $14.00 | $0.175 | – | none/low/med/high |
| GPT 5.2 | `gpt-5.2` | 272K | $1.75 | $14.00 | $0.175 | – | none/low/med/high/xhigh |
| GPT 5.2 Codex | `gpt-5.2-codex` | 272K | $1.75 | $14.00 | $0.175 | – | none/low/med/high/xhigh |
| GPT 5.1 | `gpt-5.1` | 272K | $1.07 | $8.50 | $0.107 | – | none/low/med/high/xhigh |
| GPT 5.1 Codex | `gpt-5.1-codex` | 272K | $1.07 | $8.50 | $0.107 | – | none/low/med/high/xhigh |
| GPT 5.1 Codex Max | `gpt-5.1-codex-max` | 272K | $1.25 | $10.00 | $0.125 | – | none/low/med/high/xhigh/max |
| GPT 5.1 Codex Mini | `gpt-5.1-codex-mini` | 272K | $0.25 | $2.00 | $0.025 | – | none/low/med |
| GPT 5 | `gpt-5` | 272K | $1.07 | $8.50 | $0.107 | – | none/low/med/high/xhigh |
| GPT 5 Codex | `gpt-5-codex` | 272K | $1.07 | $8.50 | $0.107 | – | none/low/med/high/xhigh |
| GPT 5 Nano | `gpt-5-nano` | 200K | $0.05 | $0.40 | $0.005 | – | none/low/med |

*Nota: modelos marcados como obsoletos no Zen incluem GPT 5.2 Codex, GPT 5.1 Codex/Max/Mini, GPT 5 Codex (descontinuados em 23/07/2026), Claude Opus 4.1 (05/08/2026), Claude Sonnet 4 (15/06/2026), Claude Haiku 3.5 (16/02/2026), Gemini 3 Pro (09/03/2026), MiniMax M2.5 (05/08/2026), GLM 5 (14/05/2026), Kimi K2.5 (05/08/2026), entre outros.*

No config do OpenCode, o ID do modelo no Zen usa o prefixo `opencode/<model-id>` (ex.: `opencode/gpt-5.5`).

---

## 3. OpenRouter

OpenRouter é um **gateway unificado** que dá acesso a 400+ modelos de múltiplos provedores através de um único endpoint (`/api/v1/chat/completions`). Os IDs seguem o formato `provider/model-id`. Como a precificação é repassada dos provedores originais, a tabela abaixo usa as informações oficiais dos provedores (OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Moonshot, etc.).

| Nome | ID no OpenRouter | Janela de contexto | Entrada | Saída | Tipos de pensamento |
|---|---|---|---|---|---|
| GPT 5.6 Sol | `openai/gpt-5.6-sol` | 1.05M | $5.00 | $30.00 | none/low/med/high/xhigh/max + standard/pro |
| GPT 5.6 Terra | `openai/gpt-5.6-terra` | 1.05M | $2.50 | $15.00 | none/low/med/high/xhigh/max + standard/pro |
| GPT 5.6 Luna | `openai/gpt-5.6-luna` | 1.05M | $1.00 | $6.00 | none/low/med/high/xhigh/max + standard/pro |
| GPT 5.5 | `openai/gpt-5.5` | 1M | $5.00 | $30.00 | none/low/med/high/xhigh/max |
| GPT 5.5 Pro | `openai/gpt-5.5-pro` | 1M | $30.00 | $180.00 | none/low/med/high/xhigh/max |
| GPT 5.4 | `openai/gpt-5.4` | 1M | $2.50 | $15.00 | none/low/med/high/xhigh/max |
| GPT 5.4 Pro | `openai/gpt-5.4-pro` | 1M | $30.00 | $180.00 | none/low/med/high/xhigh/max |
| GPT 5.4 Mini | `openai/gpt-5.4-mini` | 200K | $0.75 | $4.50 | none/low/med/high |
| GPT 5.4 Nano | `openai/gpt-5.4-nano` | 200K | $0.20 | $1.25 | none/low/med |
| GPT 5.3 Codex | `openai/gpt-5.3-codex` | 272K | $1.75 | $14.00 | none/low/med/high/xhigh/max |
| Claude Fable 5 | `anthropic/claude-fable-5` | 1M | $10.00 | $50.00 | adaptive (low/med/high/xhigh/max) |
| Claude Opus 4.8 | `anthropic/claude-opus-4.8` | 1M | $5.00 | $25.00 | adaptive (low/med/high/xhigh/max) |
| Claude Opus 4.7 | `anthropic/claude-opus-4.7` | 1M | $5.00 | $25.00 | adaptive (low/med/high/xhigh/max) |
| Claude Opus 4.6 | `anthropic/claude-opus-4.6` | 1M | $5.00 | $25.00 | adaptive (low/med/high/max) |
| Claude Opus 4.5 | `anthropic/claude-opus-4.5` | 1M | $5.00 | $25.00 | adaptive (low/med/high) |
| Claude Sonnet 5 | `anthropic/claude-sonnet-5` | 1M | $2.00 (intro) / $3.00 | $10.00 / $15.00 | adaptive (low/med/high/xhigh/max) |
| Claude Sonnet 4.6 | `anthropic/claude-sonnet-4.6` | 1M | $3.00 | $15.00 | adaptive (low/med/high/max) |
| Claude Sonnet 4.5 | `anthropic/claude-sonnet-4.5` | 200K | $3.00 | $15.00 | extended thinking |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` | 200K | $1.00 | $5.00 | extended thinking |
| Gemini 3.6 Flash | `google/gemini-3.6-flash` | 1M | $1.50 | $7.50 | thinking (low/med/high) |
| Gemini 3.5 Flash | `google/gemini-3.5-flash` | 1M | $1.50 | $9.00 | thinking (low/med/high) |
| Gemini 3.5 Flash Lite | `google/gemini-3.5-flash-lite` | 1M | $0.30 | $2.50 | thinking (low/med) |
| Gemini 3.1 Pro | `google/gemini-3.1-pro` | 1M | $2.00 | $12.00 | thinking (low/med/high) |
| Gemini 3 Flash | `google/gemini-3-flash` | 1M | $0.50 | $3.00 | thinking (low/med) |
| Grok 4.5 | `x-ai/grok-4.5` | 500K | $2.00 | $6.00 | reasoning (low/med/high) |
| Grok Build 0.1 | `x-ai/grok-build-0.1` | 200K | $1.00 | $2.00 | reasoning |
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | 1M | $1.74 | $3.48 | reasoning (low/med/high) |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | 1M | $0.14 | $0.28 | reasoning (low/med/high) |
| Qwen3.7 Max | `qwen/qwen3.7-max` | 1M | $2.50 | $7.50 | thinking (low/med/high) |
| Qwen3.7 Plus | `qwen/qwen3.7-plus` | 1M | $0.40 | $1.60 | thinking |
| Kimi K3 | `moonshotai/kimi-k3` | 1M | $3.00 | $15.00 | reasoning (low/med/high) |
| Kimi K2.7 Code | `moonshotai/kimi-k2.7-code` | 256K | $0.95 | $4.00 | thinking |
| Kimi K2.6 | `moonshotai/kimi-k2.6` | 256K | $0.95 | $4.00 | thinking |
| GLM 5.2 | `z-ai/glm-5.2` | 1M | $1.40 | $4.40 | thinking |
| GLM 5.1 | `z-ai/glm-5.1` | 1M | $1.40 | $4.40 | thinking |
| MiniMax M3 | `minimax/minimax-m3` | 1M | $0.30 | $1.20 | hybrid thinking |
| MiMo-V2.5 | `xiaomi/mimo-v2.5` | 1M | $0.14 | $0.28 | thinking |
| MiMo-V2.5-Pro | `xiaomi/mimo-v2.5-pro` | 1M | $0.435 | $0.87 | thinking |
| Hy3 | `minimax/hy3` | 1M | $0.14 | $0.58 | thinking |

*OpenRouter também oferece variantes `:nitro` (mais rápido) e `:fast` (ex.: `anthropic/claude-opus-4.8-fast`) com preço e latência diferentes.*

---

## 4. Anthropic Claude (provedor direto)

Modelos de linguagem da Anthropic. Todos os preços em USD por 1M tokens (MTok). Os modelos 4.6+ usam IDs no formato dateless `claude-{name}-{major}[-{minor}]` (ex.: `claude-opus-4-8`).

| Modelo | Claude API ID | Janela de contexto | Saída máx. | Entrada | Saída | Cache write 5m / 1h | Cache hit | Pensamento |
|---|---|---|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1M | 128K | $10 | $50 | $12.50 / $20 | $1 | adaptive (low/med/high/xhigh/max) |
| Claude Mythos 5 (acesso limitado) | `claude-mythos-5` | 1M | 128K | $10 | $50 | $12.50 / $20 | $1 | adaptive (low/med/high/xhigh/max) |
| Claude Opus 4.8 | `claude-opus-4-8` | 1M | 128K | $5 | $25 | $6.25 / $10 | $0.50 | adaptive (low/med/high/xhigh/max) |
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 128K | $5 | $25 | $6.25 / $10 | $0.50 | adaptive (low/med/high/xhigh/max) |
| Claude Opus 4.6 | `claude-opus-4-6` | 1M | 128K | $5 | $25 | $6.25 / $10 | $0.50 | adaptive (low/med/high/max) |
| Claude Opus 4.5 | `claude-opus-4-5` | 1M | 128K | $5 | $25 | $6.25 / $10 | $0.50 | adaptive (low/med/high) |
| Claude Opus 4.1 (depreciado) | `claude-opus-4-1` | 200K | 64K | $15 | $75 | $18.75 / $30 | $1.50 | extended thinking |
| Claude Opus 4 (aposentado) | `claude-opus-4` | 200K | 64K | $15 | $75 | $18.75 / $30 | $1.50 | extended thinking |
| Claude Sonnet 5 (até 31/08/2026) | `claude-sonnet-5` | 1M | 128K | $2 | $10 | $2.50 / $4 | $0.20 | adaptive (low/med/high/xhigh/max) |
| Claude Sonnet 5 (a partir de 01/09/2026) | `claude-sonnet-5` | 1M | 128K | $3 | $15 | $3.75 / $6 | $0.30 | adaptive (low/med/high/xhigh/max) |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 128K | $3 | $15 | $3.75 / $6 | $0.30 | adaptive (low/med/high/max) |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250929` | 200K | 64K | $3 | $15 | $3.75 / $6 | $0.30 | extended thinking |
| Claude Sonnet 4 (aposentado) | `claude-sonnet-4` | 200K | 64K | $3 | $15 | $3.75 / $6 | $0.30 | extended thinking |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | 200K | 64K | $1 | $5 | $1.25 / $2 | $0.10 | extended thinking |
| Claude Haiku 3.5 (aposentado) | `claude-haiku-3-5` | 200K | 64K | $0.80 | $4 | $1 / $1.60 | $0.08 | extended thinking |

**Níveis de esforço (parâmetro `effort`):** `low`, `medium`, `high` (padrão), `xhigh` (somente Fable 5, Mythos 5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5) e `max` (Fable 5, Mythos 5, Opus 5, Opus 4.8, Mythos Preview, Opus 4.7, Opus 4.6, Sonnet 5, Sonnet 4.6). Claude Opus 4.8 e Sonnet 5 têm `effort` default `high` em todas as superfícies. Claude Fable 5, Opus 4.7+ e Sonnet 5 usam um novo tokenizer (~30% mais tokens).

Endpoints equivalentes: `anthropic.claude-{name}-{major}[-{minor}]` no Amazon Bedrock e o mesmo ID da Claude API no Google Cloud (modelos pré-4.6 usam sufixo de data).

---

## 5. OpenAI

Preços em USD por 1M tokens (tier Standard). Modelos de raciocínio suportam `reasoning.effort` com valores `none`, `minimal`, `low`, `medium` (default para GPT-5.5/5.6), `high`, `xhigh`, `max` (disponibilidade depende do modelo). GPT-5.6 também suporta `reasoning.mode` = `standard` (default) ou `pro`.

### 5.1 Modelos principais (flagship / frontier)

| Modelo | ID | Alias | Janela de contexto | Saída máx. | Entrada (short ctx) | Saída (short ctx) | Entrada (long ctx) | Saída (long ctx) | Cached input | Cache writes | Pensamento |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GPT-5.6 Sol | `gpt-5.6-sol` | `gpt-5.6` | 1.05M | 128K | $5.00 | $30.00 | $10.00 | $45.00 | $0.50 | $6.25 | none/low/med/high/xhigh/max + standard/pro |
| GPT-5.6 Terra | `gpt-5.6-terra` | – | 1.05M | 128K | $2.50 | $15.00 | $5.00 | $22.50 | $0.25 | $3.125 | none/low/med/high/xhigh/max + standard/pro |
| GPT-5.6 Luna | `gpt-5.6-luna` | – | 1.05M | 128K | $1.00 | $6.00 | $2.00 | $9.00 | $0.10 | $1.25 | none/low/med/high/xhigh/max + standard/pro |
| GPT-5.5 | `gpt-5.5` | – | 1M | 128K | $5.00 | $30.00 | $10.00 | $45.00 | $0.50 | – | none/low/med/high/xhigh/max |
| GPT-5.5 Pro | `gpt-5.5-pro` | – | 1M | – | $30.00 | $180.00 | $60.00 | $270.00 | – | – | none/low/med/high/xhigh/max |
| GPT-5.4 | `gpt-5.4` | – | 1M | 128K | $2.50 | $15.00 | $5.00 | $22.50 | $0.25 | – | none/low/med/high/xhigh/max |
| GPT-5.4 Pro | `gpt-5.4-pro` | – | 1M | – | $30.00 | $180.00 | $60.00 | $270.00 | – | – | none/low/med/high/xhigh/max |
| GPT-5.4 Mini | `gpt-5.4-mini` | – | 200K | – | $0.75 | $4.50 | – | – | $0.075 | – | none/low/med/high |
| GPT-5.4 Nano | `gpt-5.4-nano` | – | 200K | – | $0.20 | $1.25 | – | – | $0.02 | – | none/low/med |

### 5.2 Modelos Codex e especializados

| Modelo | ID | Janela de contexto | Entrada | Saída | Cached input | Pensamento |
|---|---|---|---|---|---|---|
| GPT-5.3 Codex | `gpt-5.3-codex` | 272K | $1.75 | $14.00 | $0.175 | none/low/med/high/xhigh/max |
| GPT-5.3 Codex Spark | `gpt-5.3-codex-spark` | 272K | $1.75 | $14.00 | $0.175 | none/low/med/high |
| GPT-5.2 / 5.2 Codex | `gpt-5.2`, `gpt-5.2-codex` | 272K | $1.75 | $14.00 | $0.175 | none/low/med/high/xhigh |
| GPT-5.1 / 5.1 Codex | `gpt-5.1`, `gpt-5.1-codex` | 272K | $1.07 | $8.50 | $0.107 | none/low/med/high/xhigh |
| GPT-5.1 Codex Max | `gpt-5.1-codex-max` | 272K | $1.25 | $10.00 | $0.125 | none/low/med/high/xhigh/max |
| GPT-5.1 Codex Mini | `gpt-5.1-codex-mini` | 272K | $0.25 | $2.00 | $0.025 | none/low/med |
| GPT-5 / 5 Codex | `gpt-5`, `gpt-5-codex` | 272K | $1.07 | $8.50 | $0.107 | none/low/med/high/xhigh |
| GPT-5 Nano | `gpt-5-nano` | 200K | $0.05 | $0.40 | $0.005 | none/low/med |
| ChatGPT (latest) | `chat-latest` | – | $5.00 | $30.00 | $0.50 | – |
| o3 Deep Research | `o3-deep-research` | – | $5.00 | $20.00 | – | deep research |
| o4-mini Deep Research | `o4-mini-deep-research` | – | $1.00 | $4.00 | – | deep research |
| Computer Use Preview | `computer-use-preview` | – | $1.50 | $6.00 | – | reasoning |
| GPT-5.4 Cyber | `gpt-5.4-cyber` | – | – | – | – | cyber reasoning |

### 5.3 Multimodais (áudio, imagem, vídeo, transcrição)

| Modelo | ID | Modalidade | Entrada | Cached input | Saída |
|---|---|---|---|---|---|
| GPT-Realtime 2.1 | `gpt-realtime-2.1` | Áudio | $32.00 | $0.40 | $64.00 |
|  |  | Texto | $4.00 | $0.40 | $24.00 |
|  |  | Imagem | $5.00 | $0.50 | – |
| GPT-Realtime 2.1 mini | `gpt-realtime-2.1-mini` | Áudio | $10.00 | $0.30 | $20.00 |
|  |  | Texto | $0.60 | $0.06 | $2.40 |
|  |  | Imagem | $0.80 | $0.08 | – |
| GPT-Realtime Translate | `gpt-realtime-translate` | Áudio | – | – | $0.034/min |
| GPT-Realtime Whisper | `gpt-realtime-whisper` | Áudio | – | – | $0.017/min |
| GPT Image 2 | `gpt-image-2` | Imagem | $8.00 | $2.00 | $30.00 |
|  |  | Texto | $5.00 | $1.25 | – |
| GPT Image 1.5 | `gpt-image-1.5` | Imagem | $8.00 | $2.00 | $32.00 |
|  |  | Texto | $5.00 | $1.25 | $10.00 |
| GPT Image 1 Mini | `gpt-image-1-mini` | Imagem | $2.50 | $0.25 | $8.00 |
|  |  | Texto | $2.00 | $0.20 | – |
| Sora 2 (720p) | `sora-2` | Vídeo | – | – | $0.10/seg |
| Sora 2 Pro (720p) | `sora-2-pro` | Vídeo | – | – | $0.30/seg |
| Sora 2 Pro (1024p) | `sora-2-pro` | Vídeo | – | – | $0.50/seg |
| Sora 2 Pro (1080p) | `sora-2-pro` | Vídeo | – | – | $0.70/seg |
| GPT-4o Transcribe | `gpt-4o-transcribe` | Transcrição | $2.50 | $10.00 | $0.006/min |
| GPT-4o mini Transcribe | `gpt-4o-mini-transcribe` | Transcrição | $1.25 | $5.00 | $0.003/min |

Tier **Batch** oferece 50% de desconto sobre o Standard; tier **Priority** (ex.: GPT-5.3 Codex) cobra 2x o Standard. Endpoints regionais (data residency) para modelos lançados após 05/03/2026 têm acréscimo de 10%.

### 5.4 Ferramentas (custo adicional)

| Ferramenta | Preço |
|---|---|
| Web search (todos os modelos) | $10.00 / 1k chamadas + tokens do conteúdo |
| Web search preview (modelos de raciocínio) | $10.00 / 1k chamadas + tokens |
| Web search preview (modelos não-raciocínio) | $25.00 / 1k chamadas + tokens grátis |
| Containers (Hosted Shell / Code Interpreter) | $0.03 (1GB) a $1.92 (64GB) por sessão de 20 min |
| File search storage | $0.10 / GB por dia (1 GB grátis) |
| Tool call | $2.50 / 1k chamadas |

---

## Observações finais

- **Níveis de pensamento comparados**: OpenAI usa `none` → `minimal` → `low` → `medium` → `high` → `xhigh` → `max` (via `reasoning.effort`), com GPT-5.6 adicionando `reasoning.mode` = `standard`/`pro`. Anthropic usa `low` → `medium` → `high` → `xhigh` → `max` (via `effort`), onde `xhigh` é restrito a Fable 5/Mythos 5/Opus 5/4.8/4.7/Sonnet 5 e `max` a um subconjunto maior. Modelos abertos (Grok, DeepSeek, Qwen, GLM, Kimi, MiMo) tipicamente suportam níveis `low`/`medium`/`high` de raciocínio.
- **Janelas de contexto de 1M tokens** estão disponíveis em Claude Fable 5/Opus 4.8/Sonnet 5 (Anthropic), GPT-5.6 Sol/Terra/Luna e GPT-5.5 (OpenAI, 1.05M), Gemini 3.x Flash/Pro (Google), Grok 4.5 (500K), DeepSeek V4, Qwen3.7 Max, GLM-5.2 e Kimi K3.
- **Modelos depreciados/aposentados**: consultar a seção "Modelos obsoletos" do Zen e as páginas de depreciação do Claude e OpenAI para datas exatas de descontinuação.
```