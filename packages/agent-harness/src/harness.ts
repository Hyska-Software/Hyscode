// ─── Harness ────────────────────────────────────────────────────────────────
// The main orchestration engine that powers agentic behavior.
// Implements the observe → think → plan → act → update loop.

import type { Message } from '@hyscode/ai-providers';
import { getProviderRegistry } from '@hyscode/ai-providers';
import type {
  HarnessConfig,
  HarnessEvent,
  HarnessEventHandler,
  AgentType,
  ToolCallRecord,
  ConversationMode,
  ToolExecutionContext,
  ToolHandler,
  Skill,
  Rule,
  AgentQuestion,
  AgentQuestionAnswer,
} from './types';
import { DEFAULT_HARNESS_CONFIG } from './types';
import { ContextManager } from './context-manager';
import { ToolRouter } from './tool-router';
import { getAllBuiltinTools } from './tools';
import { getAgentDefinition } from './agents';
import { SkillLoader } from './skill-loader';
import { RuleLoader } from './rule-loader';
import type { SddDatabase } from './sdd-engine';
import { SddEngine } from './sdd-engine';
import type { PreCompletionHook, PostToolHook, MiddlewareContext } from './middleware';
import { verificationMiddleware, LoopDetectionMiddleware, AutoGatherMiddleware, compactToolOutput } from './middleware';
import type { TurnRecord } from './types';
import { TraceRecorder } from './trace-recorder';
import type { ModePolicy } from './mode-policies';
import { getModePolicy, adjustPolicyForModel } from './mode-policies';
import type { MemoryManager } from './memory-manager';
import { MemoryExtractor } from './memory-extractor';
import { MemoryContextProvider } from './memory-context-provider';

export interface HarnessOptions {
  config?: Partial<HarnessConfig>;
  workspacePath: string;
  projectId: string;
  /** Tauri invoke function */
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** Tauri event listener function */
  listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  /** Event handler for UI updates */
  onEvent?: HarnessEventHandler;
  /** Approval callback */
  onApprovalRequest?: (pending: { id: string; toolName: string; input: Record<string, unknown>; description: string }) => Promise<boolean>;
  /** Mode switch callback — returns true if approved, false if denied */
  onModeSwitchRequest?: (request: { id: string; fromMode: string; toMode: string; reason: string; contextSummary: string }) => Promise<boolean>;
  /** User question callback — pauses agent loop, returns user answers */
  onUserQuestionRequest?: (questions: AgentQuestion[], title?: string) => Promise<AgentQuestionAnswer[]>;
  /** SDD database interface */
  sddDb?: SddDatabase;
  /** Optional callback to save an approved SDD plan to disk */
  savePlanFile?: (sessionId: string, spec: string, tasks: import('./types').SddTask[]) => Promise<void>;
  /** Skill loader config */
  skillLoader?: SkillLoader;
  /** Rule loader config */
  ruleLoader?: RuleLoader;
  /** PTY id of the persistent agent terminal (managed by the UI). When set,
   *  run_terminal_command writes to this shared session instead of spawning a new one. */
  agentTerminalPtyId?: string;
  /** Callback fired after a terminal command finishes (for environment context tracking). */
  onTerminalCommand?: (command: string, output: string, exitCode: number | null) => void;
  /** Memory manager — enables persistent cross-session knowledge. */
  memoryManager?: MemoryManager;
}

export class Harness {
  private config: HarnessConfig;
  private contextManager: ContextManager;
  private toolRouter: ToolRouter;
  private skillLoader: SkillLoader | null;
  private ruleLoader: RuleLoader | null;
  private sddEngine: SddEngine | null = null;
  private eventHandler: HarnessEventHandler | null;
  private invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  private listen: ((event: string, handler: (payload: unknown) => void) => Promise<() => void>) | undefined;
  private workspacePath: string;
  private projectId: string;
  private conversationId = '';
  private _mode: ConversationMode = 'agent';
  private agentType: AgentType = 'build';
  private cancelled = false;
  private abortController: AbortController | null = null;
  private toolCallHistory: ToolCallRecord[] = [];
  private onModeSwitchRequest: HarnessOptions['onModeSwitchRequest'] = undefined;
  private onUserQuestionRequest: HarnessOptions['onUserQuestionRequest'] = undefined;
  private activeSkills: Skill[] = [];
  private activeRules: Rule[] = [];

  // ─── Reentrancy Guard ─────────────────────────────────────────────
  /** When true, `run()` skips SDD mode checks to allow recursive agent turns. */
  private _inAgentTurn = false;

  // ─── Agent Terminal Integration ───────────────────────────────────
  private agentTerminalPtyId: string | undefined;
  private onTerminalCommand: ((command: string, output: string, exitCode: number | null) => void) | undefined;

  // ─── Middleware ────────────────────────────────────────────────────
  private preCompletionHooks: PreCompletionHook[] = [verificationMiddleware];
  private postToolHooks: PostToolHook[] = [];
  private loopDetection = new LoopDetectionMiddleware();
  private autoGather = new AutoGatherMiddleware();

  // ─── Session Context ──────────────────────────────────────────────
  private delegationChain: Array<{ fromMode: string; toMode: string; reason: string }> = [];

  // ─── Tracing & Policies ───────────────────────────────────────────
  private traceRecorder = new TraceRecorder();
  private _effectivePolicy: ModePolicy | null = null;

  // ─── Memory System ────────────────────────────────────────────────
  private memoryManager: MemoryManager | null = null;
  private memoryExtractor = new MemoryExtractor();
  private memoryContextProvider: MemoryContextProvider | null = null;

  constructor(options: HarnessOptions) {
    this.config = { ...DEFAULT_HARNESS_CONFIG, ...options.config };
    this.workspacePath = options.workspacePath;
    this.projectId = options.projectId;
    this.invoke = options.invoke;
    this.listen = options.listen;
    this.eventHandler = options.onEvent ?? null;
    this.skillLoader = options.skillLoader ?? null;
    this.ruleLoader = options.ruleLoader ?? null;

    // Agent terminal integration
    this.agentTerminalPtyId = options.agentTerminalPtyId;
    this.onTerminalCommand = options.onTerminalCommand;

    // Initialize context manager
    this.contextManager = new ContextManager();

    // Initialize tool router
    this.toolRouter = new ToolRouter();
    this.toolRouter.setApprovalConfig(this.config.approval);
    if (this.eventHandler) {
      this.toolRouter.setEventHandler(this.eventHandler);
    }
    if (options.onApprovalRequest) {
      this.toolRouter.setApprovalCallback(async (pending) => {
        return options.onApprovalRequest!({
          id: pending.id,
          toolName: pending.toolName,
          input: pending.input,
          description: pending.description,
        });
      });
    }

    // Store mode switch callback
    this.onModeSwitchRequest = options.onModeSwitchRequest;

    // Store user question callback
    this.onUserQuestionRequest = options.onUserQuestionRequest;

    // Register built-in tools
    for (const tool of getAllBuiltinTools()) {
      this.toolRouter.register(tool);
    }

    // Register post-tool hooks
    this.postToolHooks.push(this.loopDetection);
    this.postToolHooks.push(this.autoGather);

    // Initialize SDD engine if database provided
    if (options.sddDb) {
      this.sddEngine = new SddEngine({
        db: options.sddDb,
        eventHandler: this.eventHandler ?? undefined,
        runAgentTurn: (addon, msg, typeOverride) => this.runSingleTurn(addon, msg, typeOverride),
        savePlanFile: options.savePlanFile,
      });
    }

    // Initialize memory system if manager provided
    if (options.memoryManager) {
      this.memoryManager = options.memoryManager;
      this.memoryContextProvider = new MemoryContextProvider(options.memoryManager, options.projectId);
    }
  }

  // ─── Configuration ──────────────────────────────────────────────────

  setMode(mode: ConversationMode): void {
    this._mode = mode;
  }

  setAgentType(type: AgentType): void {
    this.agentType = type;
    this._effectivePolicy = null; // Invalidate cached policy
    const agentDef = getAgentDefinition(type);
    this.contextManager.setAgent(agentDef);
  }

  setConversationId(id: string): void {
    this.conversationId = id;
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }

  setConfig(patch: Partial<Pick<HarnessConfig, 'providerId' | 'modelId' | 'maxIterations' | 'approval' | 'thinking'>>): void {
    if (patch.providerId !== undefined) this.config.providerId = patch.providerId;
    if (patch.modelId !== undefined) {
      this.config.modelId = patch.modelId;
      this._effectivePolicy = null; // Invalidate — model change affects budgets
    }
    if (patch.maxIterations !== undefined) {
      this.config.maxIterations = patch.maxIterations;
      this._effectivePolicy = null; // Invalidate — iteration limit changed
    }
    if (patch.approval !== undefined) {
      this.config.approval = patch.approval;
      this.toolRouter.setApprovalConfig(patch.approval);
    }
    if (patch.thinking !== undefined) {
      this.config.thinking = patch.thinking;
    }
  }

  /** Update the shared agent terminal PTY id (called by the bridge before each turn). */
  setAgentTerminalPtyId(ptyId: string | undefined): void {
    this.agentTerminalPtyId = ptyId;
  }

  /** Read the currently-wired agent terminal PTY id. */
  getAgentTerminalPtyId(): string | undefined {
    return this.agentTerminalPtyId;
  }

  /** Update the terminal command callback (called by the bridge at init). */
  setOnTerminalCommand(cb: ((command: string, output: string, exitCode: number | null) => void) | undefined): void {
    this.onTerminalCommand = cb;
  }

  /** Set the delegation chain for the current session */
  setDelegationChain(chain: Array<{ fromMode: string; toMode: string; reason: string }>): void {
    this.delegationChain = chain;
  }

  /** Inject delegation chain as a context source so the agent is aware of mode switches */
  private injectDelegationChain(): void {
    if (this.delegationChain.length === 0) return;
    const lines = this.delegationChain.map(
      (d, i) => `${i + 1}. ${d.fromMode} → ${d.toMode}${d.reason ? ` (${d.reason})` : ''}`,
    );
    this.contextManager.addSource({
      id: 'delegation-chain',
      type: 'context_chip',
      priority: 'medium',
      content: `<delegation_history>\n${lines.join('\n')}\n</delegation_history>`,
      tokenEstimate: Math.ceil(lines.join('\n').length / 4),
    });
  }

  getSddEngine(): SddEngine | null {
    return this.sddEngine;
  }

  /** Get the trace recorder for external callers (bridge). */
  getTraceRecorder(): TraceRecorder {
    return this.traceRecorder;
  }

  /** Get the tool router for external callers (bridge). */
  getToolRouter(): ToolRouter {
    return this.toolRouter;
  }

  /** Get the context manager for external callers (bridge). */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /** Get active skills for external callers (bridge). */
  getActiveSkills(): Skill[] {
    return this.activeSkills;
  }

  /** Set active skills for external callers (bridge). */
  setActiveSkills(skills: Skill[]): void {
    this.activeSkills = skills;
    this.contextManager.setActiveSkills(skills);
  }

  /** Get active rules for external callers (bridge). */
  getActiveRules(): Rule[] {
    return this.activeRules;
  }

  /** Set active rules for external callers (bridge). */
  setActiveRules(rules: Rule[]): void {
    this.activeRules = rules;
    this.contextManager.setActiveRules(rules);
  }

  /** Get the rule loader (for external callers to list rules) */
  getRuleLoader(): RuleLoader | null {
    return this.ruleLoader;
  }

  /** Get the workspace path for external callers (bridge). */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Compute the effective policy for the current mode + model.
   * Merges the base mode policy with model-specific adjustments.
   * Respects user-configured maxIterations from the HarnessConfig.
   */
  getEffectivePolicy(): ModePolicy {
    if (!this._effectivePolicy || this._effectivePolicy.mode !== this.agentType) {
      const base = getModePolicy(this.agentType);
      // User-configured maxIterations takes precedence over the mode default
      const merged: ModePolicy = {
        ...base,
        maxIterations: this.config.maxIterations ?? base.maxIterations,
      };
      this._effectivePolicy = this.config.modelId
        ? adjustPolicyForModel(merged, this.config.modelId)
        : merged;
    }
    return this._effectivePolicy;
  }

  // ─── External Tool Registration (MCP, extensions) ───────────────────

  /** Register an external tool (e.g. from MCP server) into the tool router */
  registerExternalTool(handler: ToolHandler): void {
    this.toolRouter.register(handler);
  }

  /** Unregister a tool by name */
  unregisterTool(name: string): void {
    this.toolRouter.unregister(name);
  }

  /** Add a context source (e.g. attached file, selection, etc.) */
  addContextSource(source: import('./types').ContextSource): void {
    this.contextManager.addSource(source);
  }

  /** Remove a context source by ID */
  removeContextSource(id: string): void {
    this.contextManager.removeSource(id);
  }

  /** Get the skill loader (for external callers to list skills) */
  getSkillLoader(): SkillLoader | null {
    return this.skillLoader;
  }

  // ─── Skills ─────────────────────────────────────────────────────────

  async loadSkills(): Promise<void> {
    if (!this.skillLoader) return;
    await this.skillLoader.loadAll();

    // NOTE: We do NOT auto-activate skills here.
    // The skills store (frontend) is the single source of truth for which
    // skills are enabled. HarnessBridge.syncActiveSkills() is called before
    // each run() to push the store state into the harness.
    this.activeSkills = this.skillLoader.getActive();
    this.contextManager.setActiveSkills(this.activeSkills);
    this.contextManager.setAllSkills(this.skillLoader.getAll());
  }

  // ─── Main Agent Loop ────────────────────────────────────────────────

  /**
   * Run a full agent turn: user sends a message, agent responds (possibly with tool calls).
   * Returns the final assistant text response.
   */
  async run(
    userMessage: string,
    history: Message[],
    imageContent?: Array<{ base64: string; mediaType: string }>,
  ): Promise<{ response: string; toolCalls: ToolCallRecord[]; turnRecord: TurnRecord }> {
    this.cancelled = false;
    this.toolCallHistory = [];
    this.loopDetection.resetCounts();
    const turnStart = Date.now();

    // Resolve effective policy for this mode + model
    const policy = this.getEffectivePolicy();

    // Start tracing for this turn
    this.traceRecorder.startTrace(
      this.conversationId,
      this.agentType,
      this.config.providerId,
      this.config.modelId,
    );

    // In SDD mode, start a new session and return the spec for user review.
    // Subsequent phases are driven by explicit approve/reject calls.
    // Skip this check when called recursively from runAgentTurn (SDD task execution).
    if (this._mode === 'sdd' && !this._inAgentTurn) {
      const { spec } = await this.startSdd(userMessage);
      const turnRecord = this.buildTurnRecord('complete', 1, turnStart);
      turnRecord.trace = this.traceRecorder.finalizeTrace('complete', { input: 0, output: 0 }, []) ?? undefined;
      return { response: spec, toolCalls: this.toolCallHistory, turnRecord };
    }

    // In chat mode, override to chat agent
    if (this._mode === 'chat' && this.agentType !== 'chat') {
      this.setAgentType('chat');
    }

    // NOTE: Skill triggers are intentionally skipped here.
    // The skills store controls which skills are active. Trigger-based
    // auto-activation would bypass user preferences. The agent can still
    // use the activate_skill tool to request skill activation.

    // Set conversation history
    this.contextManager.setHistory(history);

    // Inject relevant memories as a high-priority context source (async, best-effort)
    if (this.memoryContextProvider) {
      try {
        const policy = this.getEffectivePolicy();
        const memBlock = await this.memoryContextProvider.getContextBlock(userMessage, policy.maxInputTokens);
        if (memBlock) {
          this.contextManager.addSource({
            id: 'memory-context',
            type: 'context_chip',
            priority: 'high',
            content: memBlock,
            tokenEstimate: Math.ceil(memBlock.length / 4),
          });
        }
      } catch {
        // Memory injection is non-critical — never block the turn
      }
    }

    // Add user message to history (with optional image attachments)
    const userMsgContent: import('@hyscode/ai-providers').MessageContent[] = [
      { type: 'text', text: userMessage },
    ];
    if (imageContent?.length) {
      for (const img of imageContent) {
        userMsgContent.push({ type: 'image', base64: img.base64, mediaType: img.mediaType });
      }
    }
    const userMsg: Message = { role: 'user', content: userMsgContent };
    this.contextManager.addMessage(userMsg);

    // Agent loop
    const agentDef = getAgentDefinition(this.agentType);
    const maxIter = policy.maxIterations;
    let iteration = 0;
    let finalResponse = '';
    let consecutiveIdenticalCalls = 0;
    let lastToolCallSignature = '';
    let verificationForced = false;
    /** Middleware-injected context messages for the next iteration */
    let middlewareInjections: string[] = [];

    while (iteration < maxIter && !this.cancelled) {
      iteration++;
      this.traceRecorder.startIteration(iteration);
      this.emit({ type: 'turn_start', conversationId: this.conversationId, iteration });

      // Inject any middleware-generated context from the previous iteration
      if (middlewareInjections.length > 0) {
        for (const inj of middlewareInjections) {
          this.traceRecorder.recordMiddlewareInjection(inj);
        }
        const injectionText = middlewareInjections.join('\n\n');
        this.contextManager.addMessage({
          role: 'user',
          content: [{ type: 'text', text: injectionText }],
        });
        middlewareInjections = [];
      }

      // Inject delegation chain so the agent knows how it arrived here
      this.injectDelegationChain();

      // Build context snapshot (use policy-based limits)
      const tools = this.toolRouter.getToolDefinitionsFiltered(
        policy.allowedToolCategories,
        agentDef.toolOverrides,
      );
      const snapshot = this.contextManager.buildSnapshot(
        tools,
        policy.maxInputTokens,
        policy.maxOutputTokens,
      );

      // Record system prompt in trace (first iteration only captures it)
      if (iteration === 1) {
        this.traceRecorder.recordSystemPrompt(snapshot.systemPrompt, tools.length);
      }

      // Call LLM
      const registry = getProviderRegistry();

      // Emit api_request_sent so the UI can track credit usage
      this.emit({
        type: 'api_request_sent',
        iteration,
        providerId: this.config.providerId,
        modelId: this.config.modelId,
      });

      // Turn timeout enforcement
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const abortController = new AbortController();
      this.abortController = abortController;

      const chatParams = {
        model: this.config.modelId,
        messages: snapshot.messages,
        systemPrompt: snapshot.systemPrompt,
        tools: snapshot.tools,
        maxTokens: policy.maxOutputTokens,
        signal: abortController.signal,
        thinking: this.config.thinking,
      };

      let assistantText = '';
      let thinkingText = '';
      let toolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; _rawInput?: string }> = [];

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Turn timeout after ${Math.round(policy.turnTimeoutMs / 1000)}s`));
        }, policy.turnTimeoutMs);
      });

      try {
        console.log('[Harness] snapshot.messages roles:', JSON.stringify(snapshot.messages.map(m => m.role)));
        await Promise.race([
          (async () => {
            for await (const chunk of registry.chat({
              ...chatParams,
              providerId: this.config.providerId || undefined,
            })) {
          this.emit({ type: 'stream_chunk', chunk });

          switch (chunk.type) {
            case 'text_delta':
              assistantText += chunk.text;
              break;
            case 'thinking_delta':
              // Accumulate for history round-trip (Kimi/MiMo require reasoning_content back)
              thinkingText += chunk.text;
              break;
            case 'tool_call_start':
              toolCalls.push({
                id: chunk.id,
                name: chunk.name,
                input: {},
              });
              break;
            case 'tool_call_delta': {
              const tc = toolCalls.find(t => t.id === chunk.id);
              if (tc) {
                // Accumulate incremental JSON input
                tc._rawInput = (tc._rawInput || '') + chunk.input;
              }
              break;
            }
            case 'tool_call_end': {
              const tc = toolCalls.find(t => t.id === chunk.id);
              if (tc && tc._rawInput) {
                try { tc.input = JSON.parse(tc._rawInput); } catch { /* keep empty */ }
              }
              break;
            }
            case 'done':
              // stopReason is tracked by the provider but the loop
              // relies solely on toolCalls.length to decide continuation.
              break;
            case 'error':
              throw new Error(chunk.error);
          }
        }
          })(),
          timeoutPromise,
        ]);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        this.traceRecorder.recordError(err instanceof Error ? err.message : String(err));
        this.traceRecorder.endIteration();
        this.emit({
          type: 'turn_end',
          reason: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // Add assistant response to history
      const assistantMsg: Message = {
        role: 'assistant',
        content: [
          // Thinking must come first so the provider can round-trip it in the next turn
          ...(thinkingText ? [{ type: 'thinking' as const, thinking: thinkingText }] : []),
          ...(assistantText ? [{ type: 'text' as const, text: assistantText }] : []),
          ...toolCalls.map((tc) => ({
            type: 'tool_call' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      };
      console.log('[Harness] assistantMsg content blocks:', JSON.stringify(assistantMsg.content.map(c => c.type)));
      console.log('[Harness] assistantMsg full:', JSON.stringify(assistantMsg));
      this.contextManager.addMessage(assistantMsg);

      // If no tool calls, we're done — the LLM gave a final text response.
      // IMPORTANT: Do NOT check stopReason here. Some providers (Ollama, Gemini)
      // return 'end_turn' even when tool calls are present. The presence of
      // tool calls is the only reliable signal that the agent wants to continue.
      if (toolCalls.length === 0) {
        this.traceRecorder.setHadToolCalls(false);

        // ── Empty content recovery ──
        // Some reasoning models (DeepSeek, Kimi, MiMo) occasionally emit only
        // reasoning_content with no text or tool calls — the assistant message
        // ends up as content: []. Inject a nudge so the model emits actual text
        // rather than silently ending the turn with an empty response.
        if (!assistantText.trim() && thinkingText.trim() && !verificationForced) {
          this.traceRecorder.recordLoopWarning('empty_content_nudge', iteration);
          middlewareInjections.push('[Please provide your response. Your reasoning is complete — now write the answer.]');
          verificationForced = true;
          this.traceRecorder.endIteration();
          continue;
        }

        // ── Pre-completion middleware check ──
        // Before accepting the exit, run hooks to see if we should force continuation.
        if (!verificationForced) {
          const mwCtx: MiddlewareContext = {
            mode: this.agentType,
            iteration,
            maxIterations: maxIter,
            toolCallHistory: this.toolCallHistory,
            assistantText,
            conversationId: this.conversationId,
          };
          for (const hook of this.preCompletionHooks) {
            const injection = hook.check(mwCtx);
            if (injection) {
              middlewareInjections.push(injection);
              verificationForced = true; // Only force once to avoid infinite loops
            }
          }
          if (middlewareInjections.length > 0) {
            this.traceRecorder.endIteration();
            // Don't break — continue the loop so the agent sees the injection
            continue;
          }
        }

        this.traceRecorder.endIteration();
        finalResponse = assistantText;
        break;
      }

      this.traceRecorder.setHadToolCalls(true);

      // Stuck detection: same tool call 3 times in a row
      const callSignature = toolCalls.map((tc) => `${tc.name}:${JSON.stringify(tc.input)}`).join('|');
      if (callSignature === lastToolCallSignature) {
        consecutiveIdenticalCalls++;
        this.traceRecorder.recordRepeatedCall();
        if (consecutiveIdenticalCalls >= 3) {
          finalResponse = assistantText + '\n\n[Agent loop detected repeated identical tool calls. Stopping.]';
          this.traceRecorder.recordLoopWarning('repeated_tool_calls', consecutiveIdenticalCalls);
          this.traceRecorder.endIteration();
          this.emit({ type: 'turn_end', reason: 'error', error: 'Stuck in loop: repeated identical tool calls' });
          break;
        }
      } else {
        consecutiveIdenticalCalls = 0;
        lastToolCallSignature = callSignature;
      }

      // Execute tool calls
      const toolResults: Message = {
        role: 'tool',
        content: [],
      };

      const executionContext: ToolExecutionContext = {
        workspacePath: this.workspacePath,
        conversationId: this.conversationId,
        toolCallId: '', // set per-call below
        invoke: this.invoke,
        listen: this.listen,
        projectId: this.projectId,
        memoryManager: this.memoryManager ?? undefined,
        onFileChange: (change) => {
          this.emit({ type: 'file_change_pending', change });
        },
        // Agent terminal integration — shared PTY + command tracking
        agentTerminalPtyId: this.agentTerminalPtyId,
        onTerminalCommand: this.onTerminalCommand,
        gatheredContext: {
          add: (path, content, relevance, reason) => {
            const tokens = this.contextManager.addGatheredFile(path, content, relevance, reason);
            this.emit({ type: 'context_gathered', filePath: path, relevance, reason, tokenEstimate: tokens });
            return tokens;
          },
          remove: (path) => {
            const removed = this.contextManager.removeGatheredFile(path);
            if (removed) this.emit({ type: 'context_dropped', filePath: path });
            return removed;
          },
          has: (path) => this.contextManager.hasGatheredFile(path),
          getAll: () => this.contextManager.getGatheredFiles(),
          getTokens: () => this.contextManager.getGatheredTokens(),
          clear: () => this.contextManager.clearGatheredFiles(),
        },
        askUser: this.onUserQuestionRequest
          ? async (questions: AgentQuestion[], title?: string) => {
              const id = crypto.randomUUID();
              this.emit({ type: 'user_question_request', id, title, questions });
              const answers = await this.onUserQuestionRequest!(questions, title);
              this.emit({ type: 'user_question_answered', id, answers });
              return answers;
            }
          : undefined,
      };

      // Wire auto-gather middleware to the gathered context interface
      this.autoGather.setGatheredContext(executionContext.gatheredContext!);

      for (const tc of toolCalls) {
        // Set the per-call toolCallId before execution
        executionContext.toolCallId = tc.id;

        const record = await this.toolRouter.execute(
          tc.name,
          tc.id,
          tc.input,
          executionContext,
        );
        this.toolCallHistory.push(record);

        // Record tool call in trace
        this.traceRecorder.recordToolCall(record);

        // Handle special meta-tool actions
        if (record.output.metadata?.action === 'activate_skill' && this.skillLoader) {
          const skillName = record.output.metadata.skillName as string;
          const skill = this.skillLoader.getByName(skillName);
          if (skill) {
            // Only activate if the skill is enabled in the store.
            // The bridge event handler will sync store → harness on the
            // 'activate_skill' metadata so the store stays authoritative.
            const activated = this.skillLoader.activate(skillName);
            if (activated) {
              this.activeSkills = this.skillLoader.getActive();
              this.contextManager.setActiveSkills(this.activeSkills);
              this.contextManager.setAllSkills(this.skillLoader.getAll());
            }
            record.output.output = `Skill "${skillName}" activation requested. The skill store will be updated.`;
            record.output.metadata = { ...record.output.metadata, action: 'activate_skill', skillName };
          } else {
            record.output.output = `Skill "${skillName}" not found. Use list_skills to see available skills.`;
            record.output.success = false;
          }
        }

        if (record.output.metadata?.action === 'list_skills' && this.skillLoader) {
          const allSkills = this.skillLoader.getAll();
          const skillList = allSkills.map(s => ({
            name: s.frontmatter.name,
            description: s.frontmatter.description,
            active: s.active,
            activation: s.frontmatter.activation,
            scope: s.frontmatter.scope,
          }));
          record.output.output = skillList.length > 0
            ? `Available skills (only ENABLED skills are injected into context):\n${skillList.map(s => `- **${s.name}** [${s.active ? 'ENABLED' : 'DISABLED'}] (${s.scope}): ${s.description}`).join('\n')}\n\nTo use a disabled skill, call activate_skill first.`
            : 'No skills are currently loaded.';
        }

        if (record.output.metadata?.action === 'create_skill') {
          const { skillName, skillContent, skillScope } = record.output.metadata as Record<string, string>;
          try {
            const basePath = skillScope === 'global'
              ? `${this.skillLoader?.['config']?.globalPath ?? ''}`
              : `${this.workspacePath}/.agents/skills`;
            const filePath = `${basePath}/${skillName}.md`;
            // Write skill file via Tauri invoke
            await executionContext.invoke('create_directory', { path: basePath });
            await executionContext.invoke('write_file', { path: filePath, content: skillContent });
            record.output.output = `Skill "${skillName}" created at ${filePath}. It will be available after refreshing skills.`;
            record.output.metadata = { ...record.output.metadata, filePath };
          } catch (err) {
            record.output.output = `Failed to create skill "${skillName}": ${err instanceof Error ? err.message : String(err)}`;
            record.output.success = false;
          }
        }

        // Handle mode switch delegation request — PAUSE and wait for user decision
        if (record.output.metadata?.action === 'mode_switch') {
          const targetMode = record.output.metadata.targetMode as string;
          const reason = (record.output.metadata.reason as string) || '';
          const contextSummary = (record.output.metadata.contextSummary as string) || '';
          const switchRequest = {
            id: crypto.randomUUID(),
            fromMode: this.agentType,
            toMode: targetMode as import('./types').AgentType,
            reason,
            contextSummary,
          };
          this.emit({ type: 'mode_switch_request', request: switchRequest });

          // Wait for user approval/denial (like tool approvals)
          if (this.onModeSwitchRequest) {
            const approved = await this.onModeSwitchRequest({
              id: switchRequest.id,
              fromMode: switchRequest.fromMode,
              toMode: switchRequest.toMode,
              reason: switchRequest.reason,
              contextSummary: switchRequest.contextSummary,
            });
            this.emit({ type: 'mode_switch_resolved', request: switchRequest, approved });
            // Override the tool output so the agent knows the user's decision
            if (approved) {
              record.output.output = `Mode switch APPROVED by user. Switching to ${targetMode} agent now. You can stop — the ${targetMode} agent will take over with your context summary.`;
            } else {
              record.output.output = `Mode switch DENIED by user. The user chose to stay in the current mode (${this.agentType}). Ask the user what they'd like to change or adjust in the plan before proceeding. Do NOT request another mode switch immediately — engage with the user first.`;
            }
          }
        }

        // ── Tool output compaction ──
        // Compact large outputs to prevent context rot
        const rawOutput = record.output.success
          ? record.output.output
          : `Error: ${record.output.error}`;
        const compactedOutput = compactToolOutput(rawOutput, tc.name);

        toolResults.content.push({
          type: 'tool_result',
          toolCallId: tc.id,
          output: compactedOutput,
          isError: !record.output.success,
        });

        // ── Post-tool middleware hooks ──
        const mwCtx: MiddlewareContext = {
          mode: this.agentType,
          iteration,
          maxIterations: maxIter,
          toolCallHistory: this.toolCallHistory,
          assistantText,
          conversationId: this.conversationId,
        };
        for (const hook of this.postToolHooks) {
          const injection = hook.afterTool(tc.name, record, mwCtx);
          if (injection) {
            middlewareInjections.push(injection);
          }
        }
      }

      // End iteration after all tool calls are processed
      this.traceRecorder.endIteration();

      // Add tool results to history
      this.contextManager.addMessage(toolResults);
    }

    const stopReason: TurnRecord['stopReason'] = this.cancelled
      ? 'cancelled'
      : iteration >= maxIter
        ? 'max_iterations'
        : 'complete';

    if (this.cancelled) {
      this.emit({ type: 'turn_end', reason: 'cancelled' });
    } else if (iteration >= maxIter) {
      this.emit({ type: 'turn_end', reason: 'max_iterations' });
    } else {
      this.emit({ type: 'turn_end', reason: 'complete' });
    }

    const turnRecord = this.buildTurnRecord(stopReason, iteration, turnStart);
    turnRecord.verificationForced = verificationForced;

    // ── Post-turn memory extraction (async, non-blocking) ──
    // Run after the turn so it never delays the response to the user.
    if (this.memoryManager && finalResponse && userMessage) {
      const toolNames = this.toolCallHistory.map(tc => tc.toolName);
      this.memoryExtractor.extractAndPersist(
        this.memoryManager,
        userMessage,
        finalResponse,
        toolNames,
        this.projectId,
        this.conversationId,
      ).then((count) => {
        if (count > 0) {
          const extractedMems: Array<{ title: string; type: import('./types').MemoryType }> = [];
          this.emit({ type: 'memories_extracted', count, memories: extractedMems });
        }
      }).catch(() => {
        // Non-critical — never surface memory failures
      });
    }

    // Finalize trace and attach to turn record
    turnRecord.trace = this.traceRecorder.finalizeTrace(
      stopReason,
      turnRecord.tokenUsage,
      turnRecord.filesModified,
      turnRecord.verificationPerformed,
      verificationForced,
    ) ?? undefined;

    return {
      response: finalResponse,
      toolCalls: this.toolCallHistory,
      turnRecord,
    };
  }

  // ─── SDD Mode ───────────────────────────────────────────────────────

  /** Active SDD session ID (set when SDD is in progress) */
  private sddSessionId: string | null = null;

  /** Get the current SDD session ID */
  getSddSessionId(): string | null {
    return this.sddSessionId;
  }

  /** Get the failed task from the current SDD session (if any) */
  getSddFailedTask(): import('./types').SddTask | null {
    return this.sddEngine?.failedTask ?? null;
  }

  /**
   * Start a new SDD session: create the session and generate a spec.
   * Returns the spec text. The caller is responsible for presenting it
   * to the user for approval (the harness does NOT auto-approve).
   */
  async startSdd(description: string): Promise<{ sessionId: string; spec: string }> {
    if (!this.sddEngine) {
      throw new Error('SDD Engine not initialized (no database provided)');
    }

    const session = await this.sddEngine.startSession(this.projectId, description);
    this.sddSessionId = session.id;

    const spec = await this.sddEngine.generateSpec(session.id);
    return { sessionId: session.id, spec };
  }

  /**
   * Approve the SDD spec and generate the implementation plan.
   * Returns the task list. The caller presents it for user review.
   */
  async approveSddSpec(): Promise<import('./types').SddTask[]> {
    if (!this.sddEngine || !this.sddSessionId) {
      throw new Error('No active SDD session');
    }

    await this.sddEngine.approveSpec(this.sddSessionId);
    const tasks = await this.sddEngine.generatePlan(this.sddSessionId);
    return tasks;
  }

  /**
   * Reject the SDD spec and regenerate it.
   * Returns the new spec text.
   */
  async rejectSddSpec(_feedback?: string): Promise<string> {
    if (!this.sddEngine || !this.sddSessionId) {
      throw new Error('No active SDD session');
    }

    // Regenerate with optional feedback
    const spec = await this.sddEngine.generateSpec(this.sddSessionId);
    return spec;
  }

  /**
   * Approve the SDD plan and begin execution + review.
   * Returns the final review text.
   */
  async approveSddPlan(): Promise<string> {
    if (!this.sddEngine || !this.sddSessionId) {
      throw new Error('No active SDD session');
    }

    await this.sddEngine.approvePlan(this.sddSessionId);
    await this.sddEngine.execute(this.sddSessionId);
    const review = await this.sddEngine.review(this.sddSessionId);
    this.sddSessionId = null;
    return review;
  }

  /**
   * Promote the current build-mode conversation into a structured SDD session.
   * Uses the provided description to generate a spec, then returns it for approval.
   * The conversation history is preserved in the harness context manager.
   */
  async promoteToSdd(description: string): Promise<{ sessionId: string; spec: string }> {
    if (!this.sddEngine) {
      throw new Error('SDD Engine not initialized (no database provided)');
    }
    const session = await this.sddEngine.startSession(this.projectId, description);
    this.sddSessionId = session.id;
    const spec = await this.sddEngine.generateSpec(session.id);
    return { sessionId: session.id, spec };
  }

  /**
   * @deprecated Use startSdd() + approveSddSpec() + approveSddPlan() instead.
   * Kept for backward compatibility but now delegates to the stepped API.
   */
  async runSdd(description: string): Promise<string> {
    await this.startSdd(description);
    await this.approveSddSpec();
    const review = await this.approveSddPlan();
    return review;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /** Run a single agent turn (used by SDD engine) */
  private async runSingleTurn(
    systemPromptAddon: string,
    userMessage: string,
    agentTypeOverride?: AgentType,
  ): Promise<string> {
    const originalType = this.agentType;
    const originalPrompt = agentTypeOverride
      ? getAgentDefinition(agentTypeOverride).basePrompt
      : getAgentDefinition(this.agentType).basePrompt;
    const originalMode = this._mode;

    // Guard: prevent run() from re-entering SDD mode when called recursively
    this._inAgentTurn = true;
    // Force agent mode for the recursive call so the normal loop runs
    this._mode = 'agent';

    if (agentTypeOverride) {
      this.agentType = agentTypeOverride;
      this._effectivePolicy = null; // invalidate cached policy
    }

    // Temporarily modify system prompt
    this.contextManager.setSystemPrompt(originalPrompt + '\n\n' + systemPromptAddon);

    try {
      const result = await this.run(userMessage, this.contextManager.getHistory());
      return result.response;
    } finally {
      // Restore state
      this._inAgentTurn = false;
      this._mode = originalMode;
      this.agentType = originalType;
      this._effectivePolicy = null;
      this.contextManager.setSystemPrompt(originalPrompt);
    }
  }

  private emit(event: HarnessEvent): void {
    this.eventHandler?.(event);
  }

  // ─── Turn Record Builder ────────────────────────────────────────────

  private buildTurnRecord(
    stopReason: TurnRecord['stopReason'],
    iterations: number,
    turnStart: number,
  ): TurnRecord {
    const filesModified = [
      ...new Set(
        this.toolCallHistory
          .filter((tc) => ['write_file', 'edit_file', 'create_file'].includes(tc.toolName))
          .map((tc) => String(tc.input.path ?? '')),
      ),
    ];

    const verificationPerformed = this.toolCallHistory.some((tc) => {
      if (tc.toolName === 'git_diff' || tc.toolName === 'git_status') return true;
      if (tc.toolName === 'run_terminal_command') {
        const cmd = String(tc.input.command ?? '').toLowerCase();
        return ['test', 'lint', 'check', 'tsc', 'eslint', 'pytest', 'cargo test'].some((p) => cmd.includes(p));
      }
      return false;
    });

    return {
      id: crypto.randomUUID(),
      conversationId: this.conversationId,
      mode: this.agentType,
      iterations,
      toolCalls: this.toolCallHistory,
      tokenUsage: { input: 0, output: 0 }, // Populated by bridge from stream events
      stopReason,
      verificationPerformed,
      verificationForced: false, // Updated by caller if needed
      filesModified,
      durationMs: Date.now() - turnStart,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Environment Context ────────────────────────────────────────────

  /**
   * Inject a deterministic environment context package at the start of a turn.
   * Called by the bridge before run() to provide the agent with workspace awareness.
   */
  injectEnvironmentContext(env: import('./types').EnvironmentContext): void {
    const parts: string[] = [];

    parts.push(`<environment>`);
    parts.push(`<workspace_root>${env.workspacePath}</workspace_root>`);

    if (env.activeFile) {
      const preview = env.activeFile.content.length > 2000
        ? env.activeFile.content.slice(0, 2000) + '\n... [truncated]'
        : env.activeFile.content;
      parts.push(`<active_file path="${env.activeFile.path}" language="${env.activeFile.language}">\n${preview}\n</active_file>`);
    }

    if (env.selection) {
      parts.push(`<selection file="${env.selection.filePath}" lines="${env.selection.startLine}-${env.selection.endLine}">\n${env.selection.text}\n</selection>`);
    }

    if (env.directoryTree) {
      parts.push(`<directory_tree>\n${env.directoryTree}\n</directory_tree>`);
    }

    if (env.gitState) {
      parts.push(`<git branch="${env.gitState.branch}" uncommitted="${env.gitState.uncommittedFiles}">\n${env.gitState.summary}\n</git>`);
    }

    if (env.lastTerminalCommand) {
      const cmdOutput = env.lastTerminalCommand.output.length > 1000
        ? env.lastTerminalCommand.output.slice(-1000)
        : env.lastTerminalCommand.output;
      parts.push(`<last_terminal_command exit="${env.lastTerminalCommand.exitCode}">\n$ ${env.lastTerminalCommand.command}\n${cmdOutput}\n</last_terminal_command>`);
    }

    parts.push(`</environment>`);

    this.contextManager.addSource({
      id: 'env-context',
      type: 'active_file', // Reuses existing type for now
      priority: 'high',
      content: parts.join('\n'),
      tokenEstimate: Math.ceil(parts.join('\n').length / 4),
    });
  }
}
