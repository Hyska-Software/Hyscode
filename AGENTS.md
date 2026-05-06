Use a skill de caveman sempre antes de começar a trabalhar na solicitação do usuário

Não use o caveman quando fazer mensagens de commit

## OpenCode Go
Assinatura baixo custo (~$10/mês). Acesso a modelos abertos testados.
Model IDs na config: `opencode-go/<model-id>`
Endpoint: `https://opencode.ai/zen/go/v1/chat/completions`
Models:
- deepseek-v4-pro, deepseek-v4-flash
- glm-5, glm-5.1
- kimi-k2.5, kimi-k2.6
- mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro, mimo-v2.5
- minimax-m2.7, minimax-m2.5
- qwen3.5-plus, qwen3.6-plus
MiniMax M2.5/M2.7 usam endpoint `https://opencode.ai/zen/go/v1/messages` (Anthropic API)
Qwen usam `@ai-sdk/alibaba`

## OpenCode Zen
Gateway curado com modelos testados pela equipe. Pay-as-you-go.
Model IDs na config: `opencode/<model-id>`
Endpoint base: `https://opencode.ai/zen/v1`
Models disponíveis:
- GPT: gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2, gpt-5.2-codex, gpt-5.1, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5, gpt-5-codex, gpt-5-nano
- Claude: claude-opus-4-7, claude-opus-4-6, claude-opus-4-5, claude-opus-4-1, claude-sonnet-4-6, claude-sonnet-4-5, claude-sonnet-4, claude-haiku-4-5, claude-3-5-haiku
- Gemini: gemini-3.1-pro, gemini-3-flash
- Outros: qwen3.6-plus, qwen3.5-plus, minimax-m2.7, minimax-m2.5, minimax-m2.5-free, glm-5.1, glm-5, kimi-k2.5, kimi-k2.6, big-pickle, ling-2.6-flash, hy3-preview-free, nemotron-3-super-free
Modelos free: big-pickle, minimax-m2.5-free, ling-2.6-flash, hy3-preview-free, nemotron-3-super-free, gpt-5-nano
Obs: modelos free podem coletar dados pra treinamento. Sempre verificar docs.
