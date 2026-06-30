import type {
  AIProvider,
  AIModel,
  ChatParams,
  StreamChunk,
  Message,
  ToolDefinition,
  FetchImpl,
} from '../types';
import { ProviderError } from '../types';
import { parseNDJSONStream } from '../retry';

// ─── Ollama Message Formatting ──────────────────────────────────────────────

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

function toOllamaMessages(messages: Message[], systemPrompt?: string): OllamaMessage[] {
  const result: OllamaMessage[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      result.push({ role: 'system', content: text });
      continue;
    }

    if (msg.role === 'tool') {
      // Ollama treats tool results as user messages
      for (const c of msg.content) {
        if (c.type === 'tool_result') {
          result.push({ role: 'user', content: `Tool result for ${c.toolCallId}: ${c.output}` });
        }
      }
      continue;
    }

    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const textParts: string[] = [];
    const images: string[] = [];
    const toolCalls: OllamaToolCall[] = [];

    for (const c of msg.content) {
      if (c.type === 'text') textParts.push(c.text);
      if (c.type === 'image') images.push(c.base64);
      if (c.type === 'tool_call') {
        toolCalls.push({ function: { name: c.name, arguments: c.input } });
      }
    }

    const ollamaMsg: OllamaMessage = { role, content: textParts.join('') };
    if (images.length) ollamaMsg.images = images;
    if (toolCalls.length) ollamaMsg.tool_calls = toolCalls;
    result.push(ollamaMsg);
  }

  return result;
}

function toOllamaTools(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

// ─── Provider Implementation ────────────────────────────────────────────────

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama' as const;
  readonly name = 'Ollama (Local)';
  models: AIModel[] = [];

  private baseUrl: string;
  private fetchImpl: FetchImpl;

  constructor(baseUrl = 'http://localhost:11434', fetchImpl?: FetchImpl) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return true; // Ollama doesn't need an API key
  }

  async listModels(): Promise<AIModel[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = (await response.json()) as { models?: Array<{ name: string; details?: { parameter_size?: string }; size?: number }> };
      this.models = (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        provider: 'ollama',
        contextWindow: 1_000_000, // Conservative upper bound; Ollama models vary widely
        maxOutputTokens: 8_192,
        supportsTools: true, // Assume true, will fail gracefully if not
        supportsStreaming: true,
        supportsVision: m.name.includes('llava') || m.name.includes('vision'),
      }));

      return this.models;
    } catch {
      return [];
    }
  }

  async *chat(params: ChatParams): AsyncIterable<StreamChunk> {
    const messages = toOllamaMessages(params.messages, params.systemPrompt);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
    };

    const options: Record<string, unknown> = {};
    if (params.maxTokens) options.num_predict = params.maxTokens;
    if (params.temperature !== undefined) options.temperature = params.temperature;
    if (params.topP !== undefined) options.top_p = params.topP;
    if (params.stopSequences?.length) options.stop = params.stopSequences;
    if (Object.keys(options).length) body.options = options;

    if (params.tools?.length) body.tools = toOllamaTools(params.tools);

    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new ProviderError(
        `Ollama API error: ${response.status} ${errorBody}`,
        'ollama',
        response.status,
        response.status >= 500,
      );
    }

    let hasToolCalls = false;

    for await (const chunk of parseNDJSONStream(response, params.signal)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = chunk as any;

      if (obj.message?.content) {
        yield { type: 'text_delta', text: obj.message.content };
      }

      if (obj.message?.tool_calls) {
        hasToolCalls = true;
        for (const tc of obj.message.tool_calls) {
          const callId = `ollama_${tc.function.name}_${Date.now()}`;
          yield { type: 'tool_call_start', id: callId, name: tc.function.name };
          yield {
            type: 'tool_call_delta',
            id: callId,
            input: JSON.stringify(tc.function.arguments ?? {}),
          };
          yield { type: 'tool_call_end', id: callId };
        }
      }

      if (obj.done) {
        if (obj.eval_count !== undefined || obj.prompt_eval_count !== undefined) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: obj.prompt_eval_count ?? 0,
              outputTokens: obj.eval_count ?? 0,
              totalTokens: (obj.prompt_eval_count ?? 0) + (obj.eval_count ?? 0),
            },
          };
        }
        yield { type: 'done', stopReason: hasToolCalls ? 'tool_use' : 'end_turn' };
      }
    }
  }
}
