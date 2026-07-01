// ─── Harness ────────────────────────────────────────────────────────────────
// The main orchestration engine that powers agentic behavior.
// Implements the observe → think → plan → act → update loop.

import {
  type Message,
  type TokenUsage,
  getProviderRegistry,
  normalizeProviderError,
  ProviderError,
} from '@hyscode/ai-providers';
import {
  type HarnessConfig,
  type HarnessEvent,
  type HarnessEventHandler,
  type AgentType,
  type ToolCallRecord,
  type ConversationMode,
  type ToolExecutionContext,
  type ToolHandler,
  type Skill,
  type Rule,
  type AgentQuestion,
  type AgentQuestionAnswer,
  type TurnStatus,
  type TurnOutcome,
  type TurnRequest,
  type TurnRecord,
  DEFAULT_HARNESS_CONFIG,
} from './types';
import { ContextManager } from './context-manager';
import { ToolRouter } from './tool-router';
import { getAllBuiltinTools } from './tools';
import { getAgentDefinition } from './agents';
import { SkillLoader } from './skill-loader';
import { RuleLoader } from './rule-loader';
import { type SddDatabase, SddEngine } from './sdd-engine';
import {
  type PreCompletionHook,
  type PostToolHook,
  type MiddlewareContext,
  verificationMiddleware,
  LoopDetectionMiddleware,
  AutoGatherMiddleware,
  compactToolOutput,
} from './middleware';
import { TraceRecorder } from './trace-recorder';
import { type ModePolicy, getModePolicy, adjustPolicyForModel } from './mode-policies';
import type { MemoryManager } from './memory-manager';
import { MemoryExtractor } from './memory-extractor';
import { MemoryContextProvider } from './memory-context-provider';
import { TurnController } from './turn-controller';
import { selectToolPlan, type ToolSelectionDecision } from './tool-selection';
import { RequestPreparation, estimateActualCost } from './request-preparation';

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
  onApprovalRequest?: (
    pending: { id: string; toolName: string; input: Record<string, unknown>; description: string },
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Mode switch callback — returns true if approved, false if denied */
  onModeSwitchRequest?: (
    request: {
      id: string;
      fromMode: string;
      toMode: string;
      reason: string;
      contextSummary: string;
    },
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** User question callback — pauses agent loop, returns user answers */
  onUserQuestionRequest?: (
    id: string,
    questions: AgentQuestion[],
    title: string | undefined,
    signal: AbortSignal,
  ) => Promise<AgentQuestionAnswer[]>;
  /** SDD database interface */
  sddDb?: SddDatabase;
  /** Optional callback to save an approved SDD plan to disk */
  savePlanFile?: (
    sessionId: string,
    spec: string,
    tasks: import('./types').SddTask[],
  ) => Promise<void>;
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
  hasDirtyBuffers?: () => boolean;
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
  private listen:
    | ((event: string, handler: (payload: unknown) => void) => Promise<() => void>)
    | undefined;
  private workspacePath: string;
  private projectId: string;
  private conversationId = '';
  private _mode: ConversationMode = 'agent';
  private agentType: AgentType = 'build';
  private cancelled = false;
  private abortController: AbortController | null = null;
  private turnController = new TurnController();
  private toolCallHistory: ToolCallRecord[] = [];
  private onModeSwitchRequest: HarnessOptions['onModeSwitchRequest'] = undefined;
  private onUserQuestionRequest: HarnessOptions['onUserQuestionRequest'] = undefined;
  private activeSkills: Skill[] = [];
  private activeRules: Rule[] = [];

  // ─── Agent Terminal Integration ───────────────────────────────────
  private agentTerminalPtyId: string | undefined;
  private onTerminalCommand:
    | ((command: string, output: string, exitCode: number | null) => void)
    | undefined;

  // ─── Middleware ────────────────────────────────────────────────────
  private preCompletionHooks: PreCompletionHook[] = [verificationMiddleware];
  private postToolHooks: PostToolHook[] = [];
  private loopDetection = new LoopDetectionMiddleware();
  private autoGather = new AutoGatherMiddleware();

  // ─── Session Context ──────────────────────────────────────────────
  private delegationChain: Array<{ fromMode: string; toMode: string; reason: string }> = [];
  private currentIteration = 0;

  // ─── Tracing & Policies ───────────────────────────────────────────
  private traceRecorder = new TraceRecorder();
  private requestPreparation = new RequestPreparation();
  private _effectivePolicy: ModePolicy | null = null;

  // ─── Memory System ────────────────────────────────────────────────
  private memoryManager: MemoryManager | null = null;
  private memoryExtractor = new MemoryExtractor();
  private memoryContextProvider: MemoryContextProvider | null = null;
  private hasDirtyBuffers: (() => boolean) | undefined;

  constructor(options: HarnessOptions) {
    this.config = { ...DEFAULT_HARNESS_CONFIG, ...options.config };
    this.workspacePath = options.workspacePath;
    this.projectId = options.projectId;
    this.invoke = options.invoke;
    this.listen = options.listen;
    this.eventHandler = options.onEvent ?? null;
    this.skillLoader = options.skillLoader ?? null;
    this.ruleLoader = options.ruleLoader ?? null;
    this.hasDirtyBuffers = options.hasDirtyBuffers;

    // Agent terminal integration
    this.agentTerminalPtyId = options.agentTerminalPtyId;
    this.onTerminalCommand = options.onTerminalCommand;

    // Initialize context manager
    this.contextManager = new ContextManager();
    this.contextManager.setCostOptimization(this.config.costOptimization);

    // Initialize tool router
    this.toolRouter = new ToolRouter();
    this.toolRouter.setApprovalConfig(this.config.approval);
    if (this.eventHandler) {
      this.toolRouter.setEventHandler((event) => this.emit(event));
    }
    if (options.onApprovalRequest) {
      this.toolRouter.setApprovalCallback(async (pending, signal) => {
        this.turnController.transition('awaiting_interaction');
        try {
          return await options.onApprovalRequest!(
            {
              id: pending.id,
              toolName: pending.toolName,
              input: pending.input,
              description: pending.description,
            },
            signal,
          );
        } finally {
          this.turnController.transition('executing_tools');
        }
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
    this.registerProgressiveToolAccess();

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
      this.memoryContextProvider = new MemoryContextProvider(
        options.memoryManager,
        options.projectId,
      );
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
    this.turnController.cancel();
    this.abortController?.abort();
    if (this.sddSessionId && this.sddEngine) void this.sddEngine.cancel(this.sddSessionId);
  }

  setConfig(
    patch: Partial<
      Pick<
        HarnessConfig,
        | 'providerId'
        | 'modelId'
        | 'maxIterations'
        | 'maxInputTokens'
        | 'maxOutputTokens'
        | 'turnTimeoutMs'
        | 'approval'
        | 'thinking'
      >
    >,
  ): void {
    if (patch.providerId !== undefined) {
      this.config.providerId = patch.providerId;
      this._effectivePolicy = null;
    }
    if (patch.modelId !== undefined) {
      this.config.modelId = patch.modelId;
      this._effectivePolicy = null; // Invalidate — model change affects budgets
    }
    if (patch.maxIterations !== undefined) {
      this.config.maxIterations = patch.maxIterations;
      this._effectivePolicy = null; // Invalidate — iteration limit changed
    }
    if (patch.maxInputTokens !== undefined) this.config.maxInputTokens = patch.maxInputTokens;
    if (patch.maxOutputTokens !== undefined) this.config.maxOutputTokens = patch.maxOutputTokens;
    if (patch.turnTimeoutMs !== undefined) this.config.turnTimeoutMs = patch.turnTimeoutMs;
    if (
      patch.maxInputTokens !== undefined ||
      patch.maxOutputTokens !== undefined ||
      patch.turnTimeoutMs !== undefined
    ) {
      this._effectivePolicy = null;
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
  setOnTerminalCommand(
    cb: ((command: string, output: string, exitCode: number | null) => void) | undefined,
  ): void {
    this.onTerminalCommand = cb;
  }

  /** Set the delegation chain for the current session */
  setDelegationChain(
    chain: ReadonlyArray<{ fromMode: string; toMode: string; reason: string }>,
  ): void {
    this.delegationChain = chain.map((delegation) => ({ ...delegation }));
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
      const providerAdjusted = this.config.modelId
        ? adjustPolicyForModel(base, this.config.modelId, this.config.providerId)
        : { ...base };
      // User settings are the final global safety ceilings.
      this._effectivePolicy = {
        ...providerAdjusted,
        maxIterations: Math.min(providerAdjusted.maxIterations, this.config.maxIterations),
        maxInputTokens: Math.min(providerAdjusted.maxInputTokens, this.config.maxInputTokens),
        maxOutputTokens: Math.min(providerAdjusted.maxOutputTokens, this.config.maxOutputTokens),
        turnTimeoutMs: Math.min(providerAdjusted.turnTimeoutMs, this.config.turnTimeoutMs),
      };
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

  getContextTurnNumber(): number {
    return this.contextManager.getTurnNumber();
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
  async run(request: TurnRequest): Promise<TurnOutcome>;
  async run(
    userMessage: string,
    history: Message[],
    imageContent?: Array<{ base64: string; mediaType: string }>,
  ): Promise<TurnOutcome>;
  async run(
    requestOrMessage: string | TurnRequest,
    history: Message[] = [],
    imageContent?: Array<{ base64: string; mediaType: string }>,
  ): Promise<TurnOutcome> {
    const previousTurnId = this.turnController.id;
    try {
      return await this.runInternal(requestOrMessage, history, imageContent);
    } catch (error) {
      if (this.turnController.id !== previousTurnId) {
        const message = error instanceof Error ? error.message : String(error);
        this.traceRecorder.recordError(message);
        this.finishTurn(
          'error',
          {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
          message,
        );
      }
      throw error;
    }
  }

  private async runInternal(
    requestOrMessage: string | TurnRequest,
    history: Message[] = [],
    imageContent?: Array<{ base64: string; mediaType: string }>,
  ): Promise<TurnOutcome> {
    const userMessage =
      typeof requestOrMessage === 'string' ? requestOrMessage : requestOrMessage.userMessage;
    if (typeof requestOrMessage !== 'string') {
      history = requestOrMessage.history;
      imageContent = requestOrMessage.images;
    }
    const activeTurn = this.turnController.begin();
    this.cancelled = false;
    this.toolCallHistory = [];
    this.loopDetection.resetCounts();
    this.contextManager.clearGatheredFiles();
    this.contextManager.beginTurn();
    const turnStart = Date.now();

    // Resolve effective policy for this mode + model
    let policy = this.getEffectivePolicy();

    // Start tracing for this turn
    this.traceRecorder.startTrace(
      this.conversationId,
      this.agentType,
      this.config.providerId,
      this.config.modelId,
    );

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
        const memBlock = await this.memoryContextProvider.getContextBlock(
          userMessage,
          policy.maxInputTokens,
          this.config.costOptimization ? this.contextManager.getDeduplicationText() : '',
        );
        if (memBlock) {
          this.contextManager.addSource({
            id: 'memory-context',
            type: 'context_chip',
            priority: 'high',
            content: memBlock,
            tokenEstimate: Math.ceil(memBlock.length / 4),
            origin: 'memory',
            identity: `memory:${this.projectId}`,
            expiresAfterTurn: this.contextManager.getTurnNumber(),
          });
        } else this.contextManager.removeSource('memory-context');
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
    let agentDef = getAgentDefinition(this.agentType);
    let maxIter = policy.maxIterations;
    let iteration = 0;
    let finalResponse = '';
    let consecutiveIdenticalCalls = 0;
    let lastToolCallSignature = '';
    let verificationForced = false;
    let terminalStatus: TurnStatus = 'complete';
    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    /** Middleware-injected context messages for the next iteration */
    let middlewareInjections: string[] = [];
    let selectedTools: import('@hyscode/ai-providers').ToolDefinition[] | null = null;
    let toolSelectionDecisions: ToolSelectionDecision[] = [];
    let selectedToolMode: AgentType | null = null;
    let outputBudget = this.config.costOptimization
      ? initialOutputBudget(this.agentType, policy.maxOutputTokens)
      : policy.maxOutputTokens;

    while (iteration < maxIter && !this.cancelled) {
      this.turnController.transition('streaming');
      iteration++;
      this.traceRecorder.startIteration(iteration);
      this.currentIteration = iteration;
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
      const availableTools = this.toolRouter.getToolDefinitionsFiltered(
        policy.allowedToolCategories,
        agentDef.toolOverrides,
      );
      if (!selectedTools || selectedToolMode !== this.agentType) {
        const toolPlan = this.config.costOptimization
          ? selectToolPlan(
              availableTools,
              userMessage,
              new Set(this.toolCallHistory.map((call) => call.toolName)),
              this.agentType,
            )
          : {
              tools: availableTools,
              decisions: availableTools.map((tool) => ({
                name: tool.name,
                selected: true,
                reason: 'core' as const,
              })),
            };
        selectedTools = toolPlan.tools;
        toolSelectionDecisions = toolPlan.decisions;
        selectedToolMode = this.agentType;
      }
      const tools = selectedTools;
      const snapshot = this.contextManager.buildSnapshot(
        tools,
        policy.maxInputTokens,
        outputBudget,
      );
      this.traceRecorder.recordContextSnapshot(
        snapshot.tokenBreakdown,
        snapshot.entries,
        tools.length,
      );
      const droppedMessages = this.contextManager.getDroppedMessageCount();
      if (droppedMessages > 0) {
        this.emit({
          type: 'context_overflow',
          droppedMessages,
          droppedCategories: this.contextManager.getDroppedCategories(),
        });
      }

      // Record system prompt in trace (first iteration only captures it)
      if (iteration === 1) {
        this.traceRecorder.recordSystemPrompt(snapshot.systemPrompt, tools.length);
      }

      // Call LLM
      const registry = getProviderRegistry();
      const provider = registry.get(this.config.providerId);
      const model = provider?.models.find((candidate) => candidate.id === this.config.modelId);

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
      const abortFromTurn = () => abortController.abort(activeTurn.signal.reason);
      if (activeTurn.signal.aborted) abortFromTurn();
      else activeTurn.signal.addEventListener('abort', abortFromTurn, { once: true });

      const prepared = this.requestPreparation.prepare({
        snapshot,
        provider,
        model,
        modelId: this.config.modelId,
        maxOutputTokens: outputBudget,
        thinking: this.config.thinking,
        enabled: this.config.costOptimization,
      });
      this.traceRecorder.recordPreparedRequest(
        prepared.cost,
        prepared.stablePrefixHash,
        prepared.optimizations,
        toolSelectionDecisions,
      );
      const chatParams = {
        ...prepared.params,
        signal: abortController.signal,
      };

      let assistantText = '';
      let thinkingText = '';
      let toolCalls: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
        _rawInput?: string;
      }> = [];
      let providerStopReason: import('@hyscode/ai-providers').StopReason | null = null;
      let semanticContentReceived = false;
      let invalidToolCall: string | null = null;
      let retryCountThisIteration = 0;
      let iterationFailureStatus: 'error' | 'recoverable_error' | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Turn timeout after ${Math.round(policy.turnTimeoutMs / 1000)}s`));
        }, policy.turnTimeoutMs);
      });

      try {
        this.emit({ type: 'connection_state_changed', state: 'connecting' });
        await Promise.race([
          (async () => {
            for await (const chunk of registry.chat({
              ...chatParams,
              providerId: this.config.providerId || undefined,
              onRetry: ({ attempt, delayMs = 0, error }) => {
                retryCountThisIteration = attempt;
                this.emit({
                  type: 'connection_state_changed',
                  state: 'retry_wait',
                  message: error.userMessage,
                });
                this.emit({
                  type: 'retry_scheduled',
                  attempt,
                  delayMs,
                  error: error.toDetails(),
                });
              },
              onRetryStart: (attempt) => {
                this.emit({ type: 'retry_started', attempt });
                this.emit({ type: 'connection_state_changed', state: 'connecting' });
              },
            })) {
              this.emit({ type: 'stream_chunk', chunk });

              if (
                !semanticContentReceived &&
                (chunk.type === 'text_delta' ||
                  chunk.type === 'thinking_delta' ||
                  chunk.type === 'tool_call_start')
              ) {
                semanticContentReceived = true;
                this.emit({ type: 'connection_state_changed', state: 'connected' });
              }

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
                  const tc = toolCalls.find((t) => t.id === chunk.id);
                  if (tc) {
                    // Accumulate incremental JSON input
                    tc._rawInput = (tc._rawInput || '') + chunk.input;
                  }
                  break;
                }
                case 'tool_call_end': {
                  const tc = toolCalls.find((t) => t.id === chunk.id);
                  if (tc && tc._rawInput) {
                    try {
                      tc.input = JSON.parse(tc._rawInput);
                    } catch {
                      invalidToolCall = tc.name;
                    }
                  }
                  break;
                }
                case 'done':
                  providerStopReason = chunk.stopReason;
                  break;
                case 'usage':
                  // Each provider emits one consolidated usage chunk per API request.
                  // Sum across iterations of a multi-iteration turn.
                  tokenUsage.inputTokens += chunk.usage.inputTokens;
                  tokenUsage.outputTokens += chunk.usage.outputTokens;
                  if (chunk.usage.cacheReadTokens !== undefined) {
                    tokenUsage.cacheReadTokens =
                      (tokenUsage.cacheReadTokens ?? 0) + chunk.usage.cacheReadTokens;
                  }
                  if (chunk.usage.cacheWriteTokens !== undefined) {
                    tokenUsage.cacheWriteTokens =
                      (tokenUsage.cacheWriteTokens ?? 0) + chunk.usage.cacheWriteTokens;
                  }
                  if (chunk.usage.reasoningTokens !== undefined) {
                    tokenUsage.reasoningTokens =
                      (tokenUsage.reasoningTokens ?? 0) + chunk.usage.reasoningTokens;
                  }
                  tokenUsage.retryCount =
                    (tokenUsage.retryCount ?? 0) + (chunk.usage.retryCount ?? 0);
                  tokenUsage.possibleDuplicateCharge =
                    Boolean(tokenUsage.possibleDuplicateCharge) ||
                    Boolean(chunk.usage.possibleDuplicateCharge);
                  this.requestPreparation.recordUsage(
                    this.config.providerId,
                    this.config.modelId,
                    prepared.cost.estimatedInputTokens,
                    chunk.usage,
                  );
                  tokenUsage.estimatedCostUsd =
                    (tokenUsage.estimatedCostUsd ?? 0) + estimateActualCost(chunk.usage, model);
                  if (chunk.usage.totalTokens > 0) {
                    tokenUsage.totalTokens += chunk.usage.totalTokens;
                  } else {
                    tokenUsage.totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
                  }
                  break;
                case 'error':
                  throw chunk.details
                    ? new ProviderError(
                        chunk.details.technicalMessage,
                        chunk.details.provider,
                        chunk.details.statusCode,
                        chunk.details.retryable,
                        chunk.details.retryAfterMs,
                        chunk.details.kind,
                        chunk.details.phase,
                        chunk.details.userMessage,
                        chunk.details.requestId,
                      )
                    : new Error(chunk.error);
              }
            }
            if (invalidToolCall) {
              throw new Error(`Invalid JSON arguments received for tool "${invalidToolCall}"`);
            }
          })(),
          timeoutPromise,
        ]);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        this.traceRecorder.recordError(err instanceof Error ? err.message : String(err));
        this.traceRecorder.endIteration();
        if (this.cancelled || activeTurn.signal.aborted) {
          terminalStatus = 'cancelled';
          finalResponse = 'Request cancelled.';
          break;
        }
        const providerError = normalizeProviderError(
          err,
          this.config.providerId,
          semanticContentReceived ? 'streaming' : 'connecting',
        );
        if (semanticContentReceived) {
          iterationFailureStatus = 'recoverable_error';
          finalResponse = assistantText || providerError.userMessage;
          tokenUsage.possibleDuplicateCharge = toolCalls.length > 0;
          this.emit({
            type: 'connection_state_changed',
            state: 'degraded',
            message: providerError.userMessage,
          });
          this.emit({
            type: 'turn_recoverable_error',
            recovery: {
              error: providerError.toDetails(),
              action: toolCalls.length > 0 ? 'retry' : 'continue',
              partialText: assistantText,
              partialThinking: thinkingText,
              retryCount: retryCountThisIteration,
              possibleDuplicateCharge: toolCalls.length > 0,
            },
          });
        } else {
          iterationFailureStatus = 'error';
          finalResponse = providerError.userMessage;
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        activeTurn.signal.removeEventListener('abort', abortFromTurn);
      }
      if (iterationFailureStatus) terminalStatus = iterationFailureStatus;

      // Add assistant response to history
      const assistantMsg: Message = {
        role: 'assistant',
        content: [
          // Thinking must come first so the provider can round-trip it in the next turn
          ...(thinkingText ? [{ type: 'thinking' as const, thinking: thinkingText }] : []),
          ...(assistantText ? [{ type: 'text' as const, text: assistantText }] : []),
          ...(iterationFailureStatus === 'recoverable_error' ? [] : toolCalls).map((tc) => ({
            type: 'tool_call' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      };
      this.contextManager.addMessage(assistantMsg);
      this.emit({ type: 'transcript_message', role: 'assistant', blocks: assistantMsg.content });

      if (iterationFailureStatus) {
        break;
      }

      // If no tool calls, we're done — the LLM gave a final text response.
      // IMPORTANT: Do NOT check stopReason here. Some providers (Ollama, Gemini)
      // return 'end_turn' even when tool calls are present. The presence of
      // tool calls is the only reliable signal that the agent wants to continue.
      if (toolCalls.length === 0) {
        this.traceRecorder.setHadToolCalls(false);

        if (
          providerStopReason === 'max_tokens' &&
          this.config.costOptimization &&
          outputBudget < policy.maxOutputTokens
        ) {
          outputBudget = Math.min(policy.maxOutputTokens, outputBudget * 2);
          middlewareInjections.push(
            `[Continue the response from where it stopped. The output budget was increased to ${outputBudget} tokens.]`,
          );
          this.traceRecorder.endIteration();
          continue;
        }

        // ── Empty content recovery ──
        // Some reasoning models (DeepSeek, Kimi, MiMo) occasionally emit only
        // reasoning_content with no text or tool calls — the assistant message
        // ends up as content: []. Inject a nudge so the model emits actual text
        // rather than silently ending the turn with an empty response.
        if (!assistantText.trim() && thinkingText.trim() && !verificationForced) {
          this.traceRecorder.recordLoopWarning('empty_content_nudge', iteration);
          middlewareInjections.push(
            '[Please provide your response. Your reasoning is complete — now write the answer.]',
          );
          verificationForced = true;
          this.traceRecorder.endIteration();
          continue;
        }

        // ── Pre-completion middleware check ──
        // Before accepting the exit, run hooks to see if we should force continuation.
        if (!verificationForced && policy.verificationRequired) {
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
      this.turnController.transition('executing_tools');

      // Stuck detection: same tool call 3 times in a row
      const callSignature = toolCalls
        .map((tc) => `${tc.name}:${JSON.stringify(tc.input)}`)
        .join('|');
      if (callSignature === lastToolCallSignature) {
        consecutiveIdenticalCalls++;
        this.traceRecorder.recordRepeatedCall();
        if (consecutiveIdenticalCalls >= 3) {
          finalResponse =
            assistantText + '\n\n[Agent loop detected repeated identical tool calls. Stopping.]';
          terminalStatus = 'loop_detected';
          this.traceRecorder.recordLoopWarning('repeated_tool_calls', consecutiveIdenticalCalls);
          this.traceRecorder.endIteration();
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
        signal: activeTurn.signal,
        invoke: this.invoke,
        listen: this.listen,
        projectId: this.projectId,
        memoryManager: this.memoryManager ?? undefined,
        hasDirtyBuffers: this.hasDirtyBuffers,
        onFileChange: (change) => {
          if (!activeTurn.signal.aborted) this.emit({ type: 'file_change_pending', change });
        },
        // Agent terminal integration — shared PTY + command tracking
        agentTerminalPtyId: this.agentTerminalPtyId,
        onTerminalCommand: this.onTerminalCommand,
        gatheredContext: {
          add: (path, content, relevance, reason) => {
            const tokens = this.contextManager.addGatheredFile(path, content, relevance, reason);
            this.emit({
              type: 'context_gathered',
              filePath: path,
              relevance,
              reason,
              tokenEstimate: tokens,
            });
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
              this.turnController.transition('awaiting_interaction');
              try {
                const answers = await this.onUserQuestionRequest!(
                  id,
                  questions,
                  title,
                  activeTurn.signal,
                );
                this.emit({ type: 'user_question_answered', id, answers });
                return answers;
              } finally {
                this.turnController.transition('executing_tools');
              }
            }
          : undefined,
      };

      // Wire auto-gather middleware to the gathered context interface
      this.autoGather.setGatheredContext(executionContext.gatheredContext!);

      for (const tc of toolCalls) {
        // Set the per-call toolCallId before execution
        executionContext.toolCallId = tc.id;

        const record = await this.toolRouter.execute(tc.name, tc.id, tc.input, executionContext);
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
            record.output.metadata = {
              ...record.output.metadata,
              action: 'activate_skill',
              skillName,
            };
          } else {
            record.output.output = `Skill "${skillName}" not found. Use list_skills to see available skills.`;
            record.output.success = false;
          }
        }

        if (record.output.metadata?.action === 'list_skills' && this.skillLoader) {
          const allSkills = this.skillLoader.getAll();
          const skillList = allSkills.map((s) => ({
            name: s.frontmatter.name,
            description: s.frontmatter.description,
            active: s.active,
            activation: s.frontmatter.activation,
            scope: s.frontmatter.scope,
          }));
          record.output.output =
            skillList.length > 0
              ? `Available skills (only ENABLED skills are injected into context):\n${skillList.map((s) => `- **${s.name}** [${s.active ? 'ENABLED' : 'DISABLED'}] (${s.scope}): ${s.description}`).join('\n')}\n\nTo use a disabled skill, call activate_skill first.`
              : 'No skills are currently loaded.';
        }

        if (record.output.metadata?.action === 'create_skill') {
          const { skillName, skillContent, skillScope } = record.output.metadata as Record<
            string,
            string
          >;
          try {
            const basePath =
              skillScope === 'global'
                ? `${this.skillLoader?.['config']?.globalPath ?? ''}`
                : `${this.workspacePath}/.agents/skills`;
            const filePath = `${basePath}/${skillName}.md`;
            // Write skill file via Tauri invoke
            await executionContext.invoke('create_directory', { path: basePath });
            await executionContext.invoke('write_file', {
              path: filePath,
              content: skillContent,
            });
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
            this.turnController.transition('awaiting_interaction');
            const approved = await this.onModeSwitchRequest(
              {
                id: switchRequest.id,
                fromMode: switchRequest.fromMode,
                toMode: switchRequest.toMode,
                reason: switchRequest.reason,
                contextSummary: switchRequest.contextSummary,
              },
              activeTurn.signal,
            ).finally(() => this.turnController.transition('executing_tools'));
            // Override the tool output so the agent knows the user's decision
            if (approved) {
              this.delegationChain = [
                ...this.delegationChain,
                {
                  fromMode: switchRequest.fromMode,
                  toMode: targetMode,
                  reason,
                },
              ];
              this.setAgentType(targetMode as AgentType);
              agentDef = getAgentDefinition(this.agentType);
              policy = this.getEffectivePolicy();
              outputBudget = this.config.costOptimization
                ? initialOutputBudget(this.agentType, policy.maxOutputTokens)
                : policy.maxOutputTokens;
              maxIter = Math.max(iteration + 1, policy.maxIterations);
              record.output.output = `Mode switch APPROVED by user. The ${targetMode} agent has taken over this turn. Continue from this context summary:\n${contextSummary}`;
            } else {
              record.output.output = `Mode switch DENIED by user. The user chose to stay in the current mode (${this.agentType}). Ask the user what they'd like to change or adjust in the plan before proceeding. Do NOT request another mode switch immediately — engage with the user first.`;
            }
            this.emit({ type: 'mode_switch_resolved', request: switchRequest, approved });
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
      this.emit({ type: 'transcript_message', role: 'tool', blocks: toolResults.content });
    }

    this.turnController.transition('completing');
    const cancellationWasPartial = this.toolCallHistory.some(
      (call) => call.output.metadata?.cancellationPartial === true,
    );
    if (cancellationWasPartial) terminalStatus = 'cancelled_partial';
    else if (this.cancelled || activeTurn.signal.aborted) terminalStatus = 'cancelled';
    else if (terminalStatus === 'complete' && iteration >= maxIter)
      terminalStatus = 'max_iterations';
    const stopReason: TurnRecord['stopReason'] = terminalStatus;
    if (!finalResponse.trim() && terminalStatus === 'max_iterations') {
      finalResponse = `The agent reached the ${maxIter}-iteration limit before producing a final response. Review the completed tool calls before continuing.`;
    }
    if (!finalResponse.trim() && terminalStatus === 'cancelled')
      finalResponse = 'Request cancelled.';
    if (!finalResponse.trim() && terminalStatus === 'cancelled_partial')
      finalResponse =
        'Cancellation was requested, but one native operation completed before stopping.';
    const terminalError = ['error', 'recoverable_error'].includes(terminalStatus as string);
    this.finishTurn(
      terminalStatus,
      tokenUsage,
      terminalStatus === 'loop_detected'
        ? 'Stuck in loop: repeated identical tool calls'
        : terminalError
          ? finalResponse
          : undefined,
    );

    const turnRecord = this.buildTurnRecord(stopReason, iteration, turnStart);
    turnRecord.tokenUsage = tokenUsage;
    turnRecord.verificationForced = verificationForced;

    // ── Post-turn memory extraction (async, non-blocking) ──
    // Run after the turn so it never delays the response to the user.
    if (this.memoryManager && finalResponse && userMessage) {
      const toolNames = this.toolCallHistory.map((tc) => tc.toolName);
      this.memoryExtractor
        .extractAndPersist(
          this.memoryManager,
          userMessage,
          finalResponse,
          toolNames,
          this.projectId,
          this.conversationId,
        )
        .then((count) => {
          if (count > 0) {
            const extractedMems: Array<{ title: string; type: import('./types').MemoryType }> = [];
            this.emit({ type: 'memories_extracted', count, memories: extractedMems });
          }
        })
        .catch(() => {
          // Non-critical — never surface memory failures
        });
    }

    // Finalize trace and attach to turn record
    turnRecord.trace =
      this.traceRecorder.finalizeTrace(
        stopReason,
        turnRecord.tokenUsage,
        turnRecord.filesModified,
        turnRecord.verificationPerformed,
        verificationForced,
      ) ?? undefined;

    return {
      turnId: activeTurn.turnId,
      status: terminalStatus,
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

  restoreSddSession(sessionId: string): void {
    this.sddSessionId = sessionId;
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

    const session = await this.sddEngine.startSession(
      this.projectId,
      this.conversationId,
      description,
    );
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
  async rejectSddSpec(feedback?: string): Promise<string> {
    if (!this.sddEngine || !this.sddSessionId) {
      throw new Error('No active SDD session');
    }

    // Regenerate with optional feedback
    const spec = await this.sddEngine.generateSpec(this.sddSessionId, feedback);
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
    const execution = await this.sddEngine.execute(this.sddSessionId);
    if (execution !== 'completed') return `SDD execution ${execution}.`;
    const review = await this.sddEngine.review(this.sddSessionId);
    this.sddSessionId = null;
    return review;
  }

  async resumeSddPlan(): Promise<string> {
    if (!this.sddEngine || !this.sddSessionId) throw new Error('No active SDD session');
    this.sddEngine.resume();
    const execution = await this.sddEngine.execute(this.sddSessionId);
    if (execution !== 'completed') return `SDD execution ${execution}.`;
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
    const session = await this.sddEngine.startSession(
      this.projectId,
      this.conversationId,
      description,
    );
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
  ): Promise<TurnOutcome> {
    const originalType = this.agentType;
    const turnPrompt = agentTypeOverride
      ? getAgentDefinition(agentTypeOverride).basePrompt
      : getAgentDefinition(this.agentType).basePrompt;
    const originalPromptOverride = this.contextManager.getSystemPromptOverride();
    const originalMode = this._mode;

    // Force agent mode for the nested SDD phase call so the normal loop runs.
    this._mode = 'agent';

    if (agentTypeOverride) {
      this.agentType = agentTypeOverride;
      this._effectivePolicy = null; // invalidate cached policy
    }

    // Temporarily modify system prompt
    this.contextManager.setSystemPrompt(turnPrompt + '\n\n' + systemPromptAddon);

    try {
      const result = await this.run(userMessage, this.contextManager.getHistory());
      return result;
    } finally {
      // Restore state
      this._mode = originalMode;
      this.agentType = originalType;
      this._effectivePolicy = null;
      this.contextManager.setAgent(getAgentDefinition(originalType));
      this.contextManager.setSystemPrompt(originalPromptOverride);
    }
  }

  private emit(event: HarnessEvent): void {
    const iteration = event.iteration ?? (this.currentIteration || undefined);
    this.eventHandler?.({
      ...event,
      turnId: event.turnId ?? this.turnController.id,
      conversationId: event.conversationId ?? this.conversationId,
      ...(iteration !== undefined ? { iteration } : {}),
      ...(event.iterationId
        ? { iterationId: event.iterationId }
        : this.turnController.id && iteration
          ? { iterationId: `${this.turnController.id}:${iteration}` }
          : {}),
    });
  }

  private registerProgressiveToolAccess(): void {
    this.toolRouter.register({
      definition: {
        name: 'search_tools',
        description:
          'Search the compact catalog of registered tools before invoking a tool whose schema is not currently exposed.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      category: 'meta',
      requiresApproval: false,
      execute: async (input) => {
        const query = String(input.query ?? '').toLowerCase();
        const terms = query.split(/\s+/).filter(Boolean);
        const matches = this.toolRouter
          .getToolDefinitions()
          .filter((tool) => tool.name !== 'search_tools' && tool.name !== 'invoke_external_tool')
          .filter(
            (tool) =>
              terms.length === 0 ||
              terms.some((term) => `${tool.name} ${tool.description}`.toLowerCase().includes(term)),
          )
          .slice(0, 20)
          .map(
            (tool) =>
              `${tool.name}: ${tool.description}\nSchema: ${JSON.stringify(tool.inputSchema)}`,
          );
        return {
          success: true,
          output: matches.length > 0 ? matches.join('\n\n') : 'No matching tools found.',
        };
      },
    });
    this.toolRouter.register({
      definition: {
        name: 'invoke_external_tool',
        description:
          'Invoke a tool found with search_tools. The target tool keeps its normal validation and approval policy.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            input: { type: 'object' },
          },
          required: ['name', 'input'],
        },
      },
      category: 'meta',
      requiresApproval: false,
      execute: async (input, context) => {
        const name = String(input.name ?? '');
        if (!name || name === 'search_tools' || name === 'invoke_external_tool') {
          return { success: false, output: '', error: 'Invalid external tool name.' };
        }
        const handler = this.toolRouter.getHandler(name);
        if (!handler) {
          return {
            success: false,
            output: '',
            error: `Tool "${name}" is not registered.`,
          };
        }
        const nested = await this.toolRouter.execute(
          name,
          `${context.toolCallId}:external`,
          (input.input as Record<string, unknown>) ?? {},
          context,
        );
        return nested.output;
      },
    });
  }

  private finishTurn(status: TurnStatus, tokenUsage: TokenUsage, error?: string): void {
    if (!this.turnController.finish(status)) return;
    this.emit({ type: 'turn_end', reason: status, error, tokenUsage });
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
          .filter((tc) =>
            [
              'write_file',
              'edit_file',
              'create_file',
              'replace_lines',
              'insert_lines',
              'delete_file',
              'rename_file',
              'copy_file',
            ].includes(tc.toolName),
          )
          .flatMap((tc) =>
            [String(tc.input.path ?? tc.input.from ?? ''), String(tc.input.to ?? '')].filter(
              Boolean,
            ),
          ),
      ),
    ];

    const verificationPerformed = this.toolCallHistory.some((tc) => {
      if (tc.toolName === 'git_diff' || tc.toolName === 'git_status') return true;
      if (tc.toolName === 'run_terminal_command') {
        const cmd = String(tc.input.command ?? '').toLowerCase();
        return ['test', 'lint', 'check', 'tsc', 'eslint', 'pytest', 'cargo test'].some((p) =>
          cmd.includes(p),
        );
      }
      return false;
    });

    return {
      id: crypto.randomUUID(),
      conversationId: this.conversationId,
      mode: this.agentType,
      iterations,
      toolCalls: this.toolCallHistory,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }, // Replaced with the turn's authoritative totals by the caller.
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
    const addEnvironmentSource = (
      id: string,
      type: import('./types').ContextSource['type'],
      content: string,
      metadata?: Record<string, unknown>,
    ): void => {
      this.contextManager.addSource({
        id,
        type,
        priority: 'high',
        content,
        tokenEstimate: Math.ceil(content.length / 4),
        origin: 'environment',
        identity: id,
        expiresAfterTurn: this.contextManager.getTurnNumber(),
        metadata,
      });
    };

    addEnvironmentSource(
      'env-workspace',
      'file_tree',
      `<workspace_root>${env.workspacePath}</workspace_root>`,
    );

    if (env.activeFile) {
      const preview =
        env.activeFile.content.length > 2000
          ? env.activeFile.content.slice(0, 2000) + '\n... [truncated]'
          : env.activeFile.content;
      addEnvironmentSource(
        'env-active-file',
        'active_file',
        `<active_file path="${env.activeFile.path}" language="${env.activeFile.language}">\n${preview}\n</active_file>`,
        { filePath: env.activeFile.path },
      );
    }

    if (env.selection) {
      addEnvironmentSource(
        'env-selection',
        'selection',
        `<selection file="${env.selection.filePath}" lines="${env.selection.startLine}-${env.selection.endLine}">\n${env.selection.text}\n</selection>`,
        { filePath: env.selection.filePath },
      );
    }

    if (env.directoryTree) {
      addEnvironmentSource(
        'env-tree',
        'file_tree',
        `<directory_tree>\n${env.directoryTree}\n</directory_tree>`,
      );
    }

    if (env.gitState) {
      addEnvironmentSource(
        'env-git',
        'git_diff',
        `<git branch="${env.gitState.branch}" uncommitted="${env.gitState.uncommittedFiles}">\n${env.gitState.summary}\n</git>`,
      );
    }

    if (env.lastTerminalCommand) {
      const cmdOutput =
        env.lastTerminalCommand.output.length > 1000
          ? env.lastTerminalCommand.output.slice(-1000)
          : env.lastTerminalCommand.output;
      addEnvironmentSource(
        'env-terminal',
        'terminal',
        `<last_terminal_command exit="${env.lastTerminalCommand.exitCode}">\n$ ${env.lastTerminalCommand.command}\n${cmdOutput}\n</last_terminal_command>`,
      );
    }
  }
}

function initialOutputBudget(mode: AgentType, maximum: number): number {
  const defaults: Record<AgentType, number> = {
    chat: 4_000,
    plan: 8_000,
    build: 8_000,
    debug: 8_000,
    review: 6_000,
  };
  return Math.min(maximum, defaults[mode]);
}
