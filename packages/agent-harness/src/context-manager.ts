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
} from './types';

const PRIORITY_ORDER: ContextPriority[] = ['always', 'high', 'medium', 'low'];

/** Max fraction of available tokens that gathered context can consume. */
const GATHERED_CONTEXT_BUDGET_FRACTION = 0.3;

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

  // ─── Gathered Context (agent-managed) ─────────────────────────────
  // Files the agent autonomously decides are important to keep in context.
  // Indexed by absolute file path. Survives across iterations within a turn.
  private gatheredFiles = new Map<string, GatheredContextEntry>();

  // ─── Configuration ──────────────────────────────────────────────────

  setAgent(agent: AgentDefinition): void {
    this.agentDef = agent;
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
    });
    return tokenEstimate;
  }

  /** Remove a file from gathered context. Returns true if it existed. */
  removeGatheredFile(path: string): boolean {
    return this.gatheredFiles.delete(path);
  }

  /** Get all gathered files, sorted by relevance (highest first). */
  getGatheredFiles(): GatheredContextEntry[] {
    return Array.from(this.gatheredFiles.values())
      .sort((a, b) => b.relevance - a.relevance);
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
  }

  addMessage(message: Message): void {
    this.conversationHistory.push(message);
  }

  getHistory(): Message[] {
    return this.conversationHistory;
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
        responseBuffer: Math.min(4096, maxOutputTokens),
      },
      available: maxInputTokens - systemTokens - toolTokens - Math.min(4096, maxOutputTokens),
    };

    // Build messages within budget
    const messages = this.buildMessages(budget.available);

    const totalTokens =
      systemTokens + toolTokens + estimateMessageTokens(messages);

    return {
      systemPrompt,
      messages,
      tools,
      totalTokens,
      budget,
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
      parts.push('CRITICAL: Read and follow EVERY rule below before taking any action. Rules override default behavior.');
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
    const inactiveSkills = this.allSkills.filter(s => !s.active);
    if (inactiveSkills.length > 0) {
      const names = inactiveSkills.map(s => s.frontmatter.name).join(', ');
      parts.push(`\n<available_skills count="${inactiveSkills.length}">`);
      parts.push(`Available but inactive: ${names}`);
      parts.push('Use `list_skills` for details or `activate_skill` to enable one.');
      parts.push('</available_skills>');
    }

    return parts.join('\n');
  }

  // ─── Message Construction ───────────────────────────────────────────

  private buildMessages(availableTokens: number): Message[] {
    let remaining = availableTokens;
    this.droppedMessages = 0;
    this.droppedOrphanTools = 0;

    // Step 2: Add context sources by priority (non-always)
    const contextMessages: Message[] = [];
    const nonAlwaysSources = this.sources
      .filter((s) => s.priority !== 'always')
      .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));

    for (const source of nonAlwaysSources) {
      if (source.tokenEstimate <= remaining) {
        contextMessages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Context: ${source.type}]\n${source.content}`,
            },
          ],
        });
        remaining -= source.tokenEstimate;
      }
    }

    // Step 3: Add gathered files (agent-managed context) within sub-budget
    const gatheredMessages: Message[] = [];
    if (this.gatheredFiles.size > 0) {
      const gatheredBudget = Math.floor(availableTokens * GATHERED_CONTEXT_BUDGET_FRACTION);
      let gatheredUsed = 0;

      // Sort by relevance (highest first) so most important files are kept
      const sorted = this.getGatheredFiles();

      const fileParts: string[] = [];
      for (const entry of sorted) {
        if (gatheredUsed + entry.tokenEstimate > gatheredBudget) continue;
        if (entry.tokenEstimate > remaining) continue;
        fileParts.push(
          `<gathered_file path="${entry.path}" relevance="${entry.relevance.toFixed(2)}" reason="${entry.reason}">\n${entry.content}\n</gathered_file>`
        );
        gatheredUsed += entry.tokenEstimate;
        remaining -= entry.tokenEstimate;
      }

      if (fileParts.length > 0) {
        gatheredMessages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Gathered Context: ${fileParts.length} file(s) in agent working memory]\n<gathered_context>\n${fileParts.join('\n')}\n</gathered_context>`,
            },
          ],
        });
      }
    }

    // Step 4: Include protocol frames atomically. An assistant tool-call message
    // and its following tool-result message must never be split by truncation.
    const frames = this.buildProtocolFrames(this.conversationHistory);
    const includedFrames: Message[][] = [];
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index];
      const tokens = estimateMessageTokens(frame);
      if (tokens > remaining) {
        this.droppedMessages += frames.slice(0, index + 1).reduce((sum, item) => sum + item.length, 0);
        break;
      }
      includedFrames.unshift(frame);
      remaining -= tokens;
    }

    let history = includedFrames.flat();
    const firstUser = this.conversationHistory.find((message) => message.role === 'user');
    if (history.length === 0 && frames.length > 0) {
      const newest = frames[frames.length - 1];
      history = this.truncateMessages(newest, remaining);
    }
    if (history.length > 0 && history[0].role !== 'user' && firstUser && !history.includes(firstUser)) {
      const tokens = estimateMessageTokens([firstUser]);
      if (tokens <= remaining) history.unshift(firstUser);
    }

    return [...gatheredMessages, ...contextMessages, ...history];
  }

  private buildProtocolFrames(messages: Message[]): Message[][] {
    const frames: Message[][] = [];
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const hasToolCalls = message.role === 'assistant' && message.content.some((item) => item.type === 'tool_call');
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
        const charBudget = remainingTokens * 4; // rough estimate
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
        result.push(truncated);
        break;
      }
    }

    return result;
  }
}
