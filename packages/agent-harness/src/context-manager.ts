// ─── Context Manager ────────────────────────────────────────────────────────
// Assembles the context window sent to the LLM, managing token budgets.

import {
  type Message,
  type ToolDefinition,
  estimateMessageTokens,
  estimateToolDefinitionTokens,
  estimateSystemPromptTokens,
} from '@hyscode/ai-providers';
import type {
  ContextSource,
  ContextSnapshot,
  TokenBudget,
  ContextPriority,
  GatheredContextEntry,
  Skill,
  AgentDefinition,
  Rule,
  ContextTokenBreakdown,
  ContextEntryDecision,
} from './types';

const PRIORITY_ORDER: ContextPriority[] = ['always', 'high', 'medium', 'low'];

/** Max fraction of available tokens that gathered context can consume. */
const AUTOMATIC_CONTEXT_BUDGET_FRACTION = 0.2;
const CONTEXT_WRAPPER_TOKEN_ALLOWANCE = 12;

export class ContextManager {
  private sources: ContextSource[] = [];
  private conversationHistory: Message[] = [];
  private activeSkills: Skill[] = [];
  private allSkills: Skill[] = [];
  private activeRules: Rule[] = [];
  private agentDef: AgentDefinition | null = null;
  private systemPromptOverride: string | null = null;
  private droppedMessages = 0;
  private droppedOrphanTools = 0;
  private turnNumber = 0;
  private currentTurnStart = 0;
  private costOptimization = true;

  // ─── Gathered Context (agent-managed) ─────────────────────────────
  // Files the agent autonomously decides are important to keep in context.
  // Indexed by absolute file path. Survives across iterations within a turn.
  private gatheredFiles = new Map<string, GatheredContextEntry>();

  // ─── Configuration ──────────────────────────────────────────────────

  setAgent(agent: AgentDefinition): void {
    this.agentDef = agent;
  }

  setCostOptimization(enabled: boolean): void {
    this.costOptimization = enabled;
  }

  setSystemPrompt(prompt: string | null): void {
    this.systemPromptOverride = prompt;
  }

  getSystemPromptOverride(): string | null {
    return this.systemPromptOverride;
  }

  setActiveSkills(skills: Skill[]): void {
    this.activeSkills = skills;
  }

  setAllSkills(skills: Skill[]): void {
    this.allSkills = skills;
  }

  setActiveRules(rules: Rule[]): void {
    this.activeRules = rules;
  }

  // ─── Context Sources ────────────────────────────────────────────────

  addSource(source: ContextSource): void {
    // Replace existing source with same ID
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
  }

  removeSource(id: string): void {
    this.sources = this.sources.filter((s) => s.id !== id);
  }

  clearSources(): void {
    this.sources = [];
  }

  /** Clear ephemeral sources and gathered files when switching conversations. */
  clearConversationContext(): void {
    this.clearSources();
    this.clearGatheredFiles();
    this.conversationHistory = [];
  }

  /** Backward-compatible explicit reset used by UI adapters. */
  clearAll(): void {
    this.clearConversationContext();
  }

  getDroppedMessageCount(): number {
    return this.droppedMessages;
  }

  beginTurn(): void {
    this.turnNumber++;
    this.sources = this.sources.filter(
      (source) =>
        source.expiresAfterTurn === undefined || source.expiresAfterTurn >= this.turnNumber,
    );
  }

  getTurnNumber(): number {
    return this.turnNumber;
  }

  getDroppedCategories(): Array<'history' | 'orphan_tool'> {
    const categories: Array<'history' | 'orphan_tool'> = [];
    if (this.droppedMessages > this.droppedOrphanTools) categories.push('history');
    if (this.droppedOrphanTools > 0) categories.push('orphan_tool');
    return categories;
  }

  // ─── Gathered Context (Agent-Managed) ───────────────────────────────

  /**
   * Add a file to gathered context. If already gathered, updates content and relevance.
   * Returns the token estimate for the gathered file.
   */
  addGatheredFile(path: string, content: string, relevance: number, reason: string): number {
    const tokenEstimate = Math.ceil(content.length / 4);
    this.gatheredFiles.set(path, {
      path,
      content,
      relevance: Math.max(0, Math.min(1, relevance)),
      reason,
      tokenEstimate,
      gatheredAt: new Date().toISOString(),
      version: hashContent(content),
      renderStrategy: 'excerpt',
    });
    return tokenEstimate;
  }

  /** Remove a file from gathered context. Returns true if it existed. */
  removeGatheredFile(path: string): boolean {
    return this.gatheredFiles.delete(path);
  }

  /** Get all gathered files, sorted by relevance (highest first). */
  getGatheredFiles(): GatheredContextEntry[] {
    return Array.from(this.gatheredFiles.values()).sort((a, b) => b.relevance - a.relevance);
  }

  /** Clear all gathered files. */
  clearGatheredFiles(): void {
    this.gatheredFiles.clear();
  }

  /** Check if a file is already gathered. */
  hasGatheredFile(path: string): boolean {
    return this.gatheredFiles.has(path);
  }

  /** Get total tokens used by gathered files. */
  getGatheredTokens(): number {
    let total = 0;
    for (const entry of this.gatheredFiles.values()) {
      total += entry.tokenEstimate;
    }
    return total;
  }

  // ─── Conversation History ───────────────────────────────────────────

  setHistory(messages: Message[]): void {
    this.conversationHistory = messages;
    this.currentTurnStart = messages.length;
  }

  addMessage(message: Message): void {
    this.conversationHistory.push(message);
  }

  getHistory(): Message[] {
    return this.conversationHistory;
  }

  getDeduplicationText(): string {
    const messageText = this.conversationHistory
      .flatMap((message) => message.content)
      .map((content) =>
        content.type === 'text'
          ? content.text
          : content.type === 'tool_result'
            ? content.output
            : '',
      )
      .join('\n');
    const explicitText = this.sources
      .filter((source) => source.origin === 'explicit')
      .map((source) => source.content)
      .join('\n');
    return `${messageText}\n${explicitText}`.toLowerCase();
  }

  // ─── Build Context Snapshot ─────────────────────────────────────────

  buildSnapshot(
    tools: ToolDefinition[],
    maxInputTokens: number,
    maxOutputTokens: number,
  ): ContextSnapshot {
    const systemPrompt = this.buildSystemPrompt();
    const systemTokens = estimateSystemPromptTokens(systemPrompt);
    const toolTokens = estimateToolDefinitionTokens(tools);

    const budget: TokenBudget = {
      maxInput: maxInputTokens,
      maxOutput: maxOutputTokens,
      reserved: {
        systemPrompt: systemTokens,
        toolDefinitions: toolTokens,
        responseBuffer: maxOutputTokens,
      },
      available: Math.max(0, maxInputTokens - systemTokens - toolTokens - maxOutputTokens),
    };

    // Build messages within budget
    const plan = this.buildMessages(budget.available);
    const messages = plan.messages;

    const totalTokens = systemTokens + toolTokens + estimateMessageTokens(messages);

    return {
      systemPrompt,
      messages,
      tools,
      totalTokens,
      budget,
      tokenBreakdown: {
        ...plan.breakdown,
        system: systemTokens,
        tools: toolTokens,
        total: totalTokens,
      },
      entries: plan.entries,
    };
  }

  // ─── System Prompt Construction ─────────────────────────────────────

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    // Base agent prompt
    if (this.systemPromptOverride) {
      parts.push(this.systemPromptOverride);
    } else if (this.agentDef) {
      parts.push(this.agentDef.basePrompt);
    }

    // Active rules (injected before skills — higher precedence)
    if (this.activeRules.length > 0) {
      parts.push('\n<active_rules>');
      parts.push(
        'CRITICAL: Read and follow EVERY rule below before taking any action. Rules override default behavior.',
      );
      for (const rule of this.activeRules) {
        parts.push(`<rule name="${rule.name}" scope="${rule.scope}">\n${rule.content}\n</rule>`);
      }
      parts.push('</active_rules>');
    }

    // Context sources marked as 'always' priority
    const alwaysSources = this.sources.filter((s) => s.priority === 'always');
    if (alwaysSources.length > 0) {
      parts.push('\n<context>');
      for (const source of alwaysSources) {
        parts.push(`<${source.type}>\n${source.content}\n</${source.type}>`);
      }
      parts.push('</context>');
    }

    // Active skills (full content injected into context)
    if (this.activeSkills.length > 0) {
      parts.push('\n<active_skills>');
      for (const skill of this.activeSkills) {
        parts.push(`<skill name="${skill.frontmatter.name}">\n${skill.content}\n</skill>`);
      }
      parts.push('</active_skills>');
    }

    // Skill directory: compact listing of available skills.
    // Instead of dumping full descriptions of every inactive skill (which causes
    // context rot), we use progressive disclosure: a one-liner list so the agent
    // knows what exists, and the `list_skills` tool for full details.
    const inactiveSkills = this.allSkills.filter((s) => !s.active);
    if (inactiveSkills.length > 0) {
      const names = inactiveSkills.map((s) => s.frontmatter.name).join(', ');
      parts.push(`\n<available_skills count="${inactiveSkills.length}">`);
      parts.push(`Available but inactive: ${names}`);
      parts.push('Use `list_skills` for details or `activate_skill` to enable one.');
      parts.push('</available_skills>');
    }

    return parts.join('\n');
  }

  // ─── Message Construction ───────────────────────────────────────────

  private buildMessages(availableTokens: number): {
    messages: Message[];
    breakdown: ContextTokenBreakdown;
    entries: ContextEntryDecision[];
  } {
    let remaining = availableTokens;
    this.droppedMessages = 0;
    this.droppedOrphanTools = 0;

    const breakdown: ContextTokenBreakdown = emptyBreakdown();
    const entries: ContextEntryDecision[] = [];

    // Reserve history first. The newest user frame is the current request and is
    // mandatory; the frame before it is the active tool protocol frame when present.
    // and its following tool-result message must never be split by truncation.
    const frames = this.buildProtocolFrames(this.conversationHistory);
    const includedFrames: Message[][] = [];
    let droppedFrames: Message[][] = [];
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index];
      const tokens = estimateMessageTokens(frame);
      if (tokens > remaining) {
        if (index === frames.length - 1) {
          const compacted = this.truncateMessages(frame, remaining);
          if (compacted.length > 0) includedFrames.unshift(compacted);
          const used = estimateMessageTokens(compacted);
          breakdown.currentTurn += used;
          entries.push({
            id: 'current-turn',
            category: 'currentTurn',
            tokens: used,
            included: true,
          });
          remaining -= used;
        } else {
          droppedFrames = frames.slice(0, index + 1);
          this.droppedMessages += droppedFrames.reduce((sum, item) => sum + item.length, 0);
          breakdown.dropped += tokens;
          entries.push({
            id: `history-${index}`,
            category: 'recentHistory',
            tokens,
            included: false,
            reason: 'budget',
          });
        }
        break;
      }
      includedFrames.unshift(frame);
      remaining -= tokens;
      const category =
        index === frames.length - 1
          ? 'currentTurn'
          : frame.some((message) => message.role === 'tool')
            ? 'activeToolFrame'
            : 'recentHistory';
      breakdown[category] += tokens;
      entries.push({ id: `history-${index}`, category, tokens, included: true });
    }

    const history = includedFrames.flat();
    const includedReadPaths = collectReadPaths(history);
    const stableContextMessages: Message[] = [];
    const volatileContextMessages: Message[] = [];
    const checkpointMessages: Message[] = [];
    const seen = new Set<string>();
    let automaticUsed = 0;
    const automaticBudget = Math.floor(availableTokens * AUTOMATIC_CONTEXT_BUDGET_FRACTION);
    if (droppedFrames.length > 0 && remaining > 80) {
      const checkpoint = buildHistoryCheckpoint(droppedFrames, Math.min(remaining, 500));
      const checkpointTokens = estimateMessageTokens([checkpoint]);
      if (checkpointTokens <= remaining) {
        checkpointMessages.push(checkpoint);
        remaining -= checkpointTokens;
        breakdown.recentHistory += checkpointTokens;
        entries.push({
          id: 'history-checkpoint',
          category: 'recentHistory',
          tokens: checkpointTokens,
          included: true,
        });
      }
    }
    const candidates = [
      ...this.sources.filter((source) => source.priority !== 'always'),
      ...this.getGatheredFiles().map((entry) => ({
        id: `gathered:${entry.path}`,
        type: 'gathered_file' as const,
        priority: 'medium' as const,
        content: `<gathered_file path="${entry.path}" version="${entry.version}">\n${entry.content}\n</gathered_file>`,
        tokenEstimate: entry.tokenEstimate,
        identity: `file:${normalizePath(entry.path)}`,
        version: entry.version,
        origin: 'automatic' as const,
      })),
    ].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
    const currentTurnMessages = this.conversationHistory.slice(this.currentTurnStart);

    for (const source of candidates) {
      const category =
        source.origin === 'memory'
          ? 'memory'
          : source.origin === 'environment'
            ? 'environment'
            : source.origin === 'explicit' || source.type === 'context_chip'
              ? 'explicit'
              : 'automatic';
      const identity = source.identity ?? source.id;
      const tokens =
        estimateMessageTokens([
          {
            role: 'user',
            content: [{ type: 'text', text: `[Context: ${source.type}]\n${source.content}` }],
          },
        ]) + CONTEXT_WRAPPER_TOKEN_ALLOWANCE;
      const isReadDuplicate =
        source.type === 'gathered_file' && includedReadPaths.has(identity.replace(/^file:/, ''));
      const isSuperseded = this.costOptimization && isSourceSuperseded(source, currentTurnMessages);
      if (
        seen.has(`${identity}:${source.version ?? hashContent(source.content)}`) ||
        isReadDuplicate ||
        isSuperseded
      ) {
        breakdown.deduplicated += tokens;
        entries.push({
          id: source.id,
          category,
          tokens,
          included: false,
          reason: isSuperseded ? 'superseded' : 'duplicate',
        });
        continue;
      }
      const automatic = category !== 'explicit';
      if (tokens > remaining || (automatic && automaticUsed + tokens > automaticBudget)) {
        breakdown.dropped += tokens;
        entries.push({ id: source.id, category, tokens, included: false, reason: 'budget' });
        continue;
      }
      seen.add(`${identity}:${source.version ?? hashContent(source.content)}`);
      const target =
        category === 'memory' || category === 'environment' || source.id === '__context_hints__'
          ? volatileContextMessages
          : stableContextMessages;
      target.push({
        role: 'user',
        content: [{ type: 'text', text: `[Context: ${source.type}]\n${source.content}` }],
      });
      remaining -= tokens;
      if (automatic) automaticUsed += tokens;
      breakdown[category] += tokens;
      entries.push({ id: source.id, category, tokens, included: true });
    }

    if (!this.costOptimization) {
      return {
        messages: [
          ...stableContextMessages,
          ...volatileContextMessages,
          ...checkpointMessages,
          ...history,
        ],
        breakdown,
        entries,
      };
    }
    const currentTurnMessage = this.conversationHistory[this.currentTurnStart];
    const currentTurnIndex = currentTurnMessage ? history.indexOf(currentTurnMessage) : -1;
    const historicalHistory = currentTurnIndex >= 0 ? history.slice(0, currentTurnIndex) : [];
    const currentHistory = currentTurnIndex >= 0 ? history.slice(currentTurnIndex) : history;
    return {
      messages: [
        ...stableContextMessages,
        ...checkpointMessages,
        ...historicalHistory,
        ...volatileContextMessages,
        ...currentHistory,
      ],
      breakdown,
      entries,
    };
  }

  private buildProtocolFrames(messages: Message[]): Message[][] {
    const frames: Message[][] = [];
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const hasToolCalls =
        message.role === 'assistant' && message.content.some((item) => item.type === 'tool_call');
      if (hasToolCalls && messages[index + 1]?.role === 'tool') {
        frames.push([message, messages[index + 1]]);
        index++;
      } else if (message.role !== 'tool') {
        frames.push([message]);
      } else {
        // Orphan tool messages are invalid provider history and are discarded.
        this.droppedMessages++;
        this.droppedOrphanTools++;
      }
    }
    return frames;
  }

  private truncateMessages(messages: Message[], maxTokens: number): Message[] {
    // Simple truncation: trim content of messages to fit
    const result: Message[] = [];
    let used = 0;

    for (const msg of messages) {
      const tokens = estimateMessageTokens([msg]);
      if (used + tokens <= maxTokens) {
        result.push(msg);
        used += tokens;
      } else {
        // Truncate this message's text content
        const remainingTokens = maxTokens - used;
        const charBudget = Math.max(0, remainingTokens - 8) * 4; // leave room for framing + marker
        const truncated: Message = {
          ...msg,
          content: msg.content.map((c) => {
            if (c.type === 'text' && c.text.length > charBudget) {
              return {
                ...c,
                text: c.text.slice(0, charBudget) + '\n... [truncated]',
              };
            }
            return c;
          }),
        };
        if (remainingTokens > 8) result.push(truncated);
        break;
      }
    }

    return result;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function hashContent(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

function collectReadPaths(messages: Message[]): Set<string> {
  const paths = new Set<string>();
  for (const message of messages) {
    for (const content of message.content) {
      if (
        content.type === 'tool_call' &&
        content.name === 'read_file' &&
        typeof content.input.path === 'string'
      ) {
        paths.add(normalizePath(content.input.path));
      }
    }
  }
  return paths;
}

function isSourceSuperseded(source: ContextSource, messages: Message[]): boolean {
  if (source.origin !== 'environment' && source.id !== '__context_hints__') return false;
  const calls = messages
    .flatMap((message) => message.content)
    .filter(
      (content): content is Extract<Message['content'][number], { type: 'tool_call' }> =>
        content.type === 'tool_call',
    );
  if (source.id === '__context_hints__') {
    return calls.some((call) => ['find_files', 'search_code', 'read_file'].includes(call.name));
  }
  if (source.id === 'env-tree') {
    return calls.some((call) =>
      ['list_directory', 'find_files', 'search_code'].includes(call.name),
    );
  }
  if (source.id === 'env-git') {
    return calls.some((call) => ['git_status', 'git_diff'].includes(call.name));
  }
  if (source.id === 'env-terminal') {
    return calls.some((call) => call.name === 'run_terminal_command');
  }
  if (source.id === 'env-active-file') {
    const sourcePath = normalizePath(String(source.metadata?.filePath ?? ''));
    return calls.some(
      (call) =>
        call.name === 'read_file' && normalizePath(String(call.input.path ?? '')) === sourcePath,
    );
  }
  return false;
}

function buildHistoryCheckpoint(frames: Message[][], tokenBudget: number): Message {
  const errors: string[] = [];
  const fileActions: string[] = [];
  const recentText: string[] = [];
  for (const frame of [...frames].reverse()) {
    for (const message of frame) {
      for (const content of message.content) {
        if (content.type === 'text' && content.text.trim()) {
          recentText.push(`${message.role}: ${content.text.replace(/\s+/g, ' ').slice(0, 240)}`);
        } else if (content.type === 'tool_call') {
          const path = content.input.path ?? content.input.from ?? content.input.to;
          if (path) fileActions.push(`tool call: ${content.name} ${String(path)}`);
        } else if (content.type === 'tool_result' && content.isError) {
          errors.push(
            `unresolved tool error: ${content.output.replace(/\s+/g, ' ').slice(0, 240)}`,
          );
        }
      }
    }
  }
  const facts = [...errors, ...fileActions, ...recentText];
  const charBudget = Math.max(120, tokenBudget * 4 - 80);
  const text = `<history_checkpoint frames="${frames.length}">\n${facts.join('\n').slice(0, charBudget)}\n</history_checkpoint>`;
  return { role: 'user', content: [{ type: 'text', text }] };
}

function emptyBreakdown(): ContextTokenBreakdown {
  return {
    system: 0,
    tools: 0,
    currentTurn: 0,
    activeToolFrame: 0,
    recentHistory: 0,
    explicit: 0,
    memory: 0,
    environment: 0,
    automatic: 0,
    total: 0,
    dropped: 0,
    deduplicated: 0,
  };
}
