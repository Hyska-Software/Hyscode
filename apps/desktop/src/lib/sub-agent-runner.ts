import { DelegatedRunner, Harness, resolveEffectiveAgentPolicy, SUB_AGENT_PREAMBLE } from '@hyscode/agent-harness';
import type {
  AgentType,
  Skill,
  Rule,
  HarnessEvent,
  ToolCallRecord,
  TerminalRuntimeAdapter,
  EnvironmentContext,
  MemoryManager,
  ToolHandler,
  TurnRecord,
} from '@hyscode/agent-harness';
import type { TokenUsage } from '@hyscode/ai-providers';
import type { AgentMode, SubAgentState, ToolCallDisplay } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubAgentRunnerOptions {
  id: string;
  task: string;
  mode: AgentMode;
  workspacePath: string;
  projectId: string;
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  onApproval: (pending: {
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
  }, signal: AbortSignal) => Promise<boolean>;
  onUpdate: (patch: Partial<SubAgentState>) => void;
  /** Events that need bridge/store-side handling (file changes, usage, API
   *  accounting) are forwarded here instead of being dropped. */
  onBridgeEvent?: (event: HarnessEvent) => void;
  activeSkills: Skill[];
  activeRules: Rule[];
  /** Visible terminal runtime (shared with the main agent). When omitted the
   *  sub-agent falls back to invisible one-shot PTYs. */
  terminalRuntime?: TerminalRuntimeAdapter;
  /** Track completed terminal commands for the parent's environment context. */
  onTerminalCommand?: (command: string, output: string, exitCode: number | null) => void;
  /** Parent harness used to create a child with the same runtime environment. */
  parentHarness?: Harness;
  /** Parent conversation keeps memory provenance and terminal ownership correct. */
  conversationId?: string;
  parentTurnId?: string;
  environmentContext?: EnvironmentContext;
  delegationChain?: ReadonlyArray<{ fromMode: string; toMode: string; reason: string }>;
  memoryManager?: MemoryManager;
  externalTools?: ToolHandler[];
  onTurnRecord?: (record: TurnRecord) => void;
}

const MAX_LIVE_OUTPUT_CHARS = 65_536;

// ─── SubAgentRunner ──────────────────────────────────────────────────────────

/**
 * Runs a focused subtask using a fresh Harness instance.
 * Sub-agents never register spawn_subagent (no recursion).
 * They inherit skills/rules from the parent and share the same approval pipeline.
 */
export class SubAgentRunner {
  private harness: Harness;
  private delegatedRunner?: DelegatedRunner;
  private onUpdate: SubAgentRunnerOptions['onUpdate'];
  private onBridgeEvent: SubAgentRunnerOptions['onBridgeEvent'];
  private onTurnRecord: SubAgentRunnerOptions['onTurnRecord'];
  private toolCallCache: ToolCallDisplay[] = [];
  private streamingOutput = '';
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  constructor(options: SubAgentRunnerOptions) {
    this.onUpdate = options.onUpdate;
    this.onBridgeEvent = options.onBridgeEvent;
    this.onTurnRecord = options.onTurnRecord;
    this.optionsConversationId = options.conversationId ?? crypto.randomUUID();
    this.optionsParentTurnId = options.parentTurnId;
    this.optionsEnvironmentContext = options.environmentContext;

    const settings = useSettingsStore.getState();
    const providerId = settings.activeProviderId ?? '';
    const modelId = settings.activeModelId ?? '';

    // Resolve the sub-agent's approval policy the same way the main agent
    // does: per-mode defaults + user preferences + custom overrides. This
    // keeps custom category/tool rules and session-trust working inside
    // sub-agents instead of silently degrading to handler defaults.
    const policy = resolveEffectiveAgentPolicy(options.mode as AgentType, modelId, providerId, {
      approvalMode: settings.subAgentAutoApprove ? 'yolo' : settings.approvalMode,
      customApproval:
        settings.approvalMode === 'custom'
          ? {
              // Settings store uses: true = auto-approve. Harness uses: true = needs approval.
              categoryOverrides: Object.fromEntries(
                Object.entries(settings.customApprovalRules.categoryRules).map(([k, autoApprove]) => [
                  k,
                  !autoApprove,
                ]),
              ) as Record<string, boolean>,
              toolOverrides: Object.fromEntries(
                Object.entries(settings.customApprovalRules.toolRules).map(([k, autoApprove]) => [
                  k,
                  !autoApprove,
                ]),
              ),
            }
          : undefined,
      maxIterations: settings.subAgentMaxIterations,
    });

    const childConfig = {
      providerId,
      modelId,
      maxIterations: policy.maxIterations,
      maxOutputTokens: policy.maxOutputTokens,
      maxInputTokens: policy.maxInputTokens,
      turnTimeoutMs: policy.turnTimeoutMs,
      approval: policy.approval,
    };
    const onEvent = (event: HarnessEvent): void => this.handleEvent(event);
    if (options.parentHarness) {
      this.delegatedRunner = new DelegatedRunner({
        parentHarness: options.parentHarness,
        mode: options.mode as AgentType,
        config: childConfig,
        conversationId: this.optionsConversationId,
        environmentContext: options.environmentContext,
        delegationChain: options.delegationChain,
        activeSkills: options.activeSkills,
        activeRules: options.activeRules,
        externalTools: options.externalTools,
        onEvent,
      });
      this.harness = this.delegatedRunner.getHarness();
    } else {
      this.harness = new Harness({
        workspacePath: options.workspacePath,
        projectId: options.projectId,
        invoke: options.invoke,
        listen: options.listen,
        delegationLevel: 1,
        config: childConfig,
        onEvent,
        onApprovalRequest: options.onApproval,
        terminalRuntime: options.terminalRuntime,
        onTerminalCommand: options.onTerminalCommand,
        memoryManager: options.memoryManager,
      });
    }

    // Apply agent type — sub-agents never get spawn_subagent (no Harness.registerExternalTool called here)
    this.harness.setAgentType(options.mode as AgentType);

    // Inherit active skills and rules from the parent context
    this.harness.setActiveSkills(options.activeSkills);
    this.harness.setActiveRules(options.activeRules);
    this.harness.setDelegationChain(options.delegationChain ?? []);
  }

  async run(task: string): Promise<string> {
    const convId = this.optionsConversationId;
    this.harness.setConversationId(convId);
    if (this.optionsEnvironmentContext && !this.delegatedRunner) {
      this.harness.injectEnvironmentContext(this.optionsEnvironmentContext);
    }
    this.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    try {
      const outcome = this.delegatedRunner
        ? await this.delegatedRunner.run(task)
        : await this.harness.run(SUB_AGENT_PREAMBLE + task, []);
      const record: TurnRecord = {
        ...outcome.turnRecord,
        conversationId: convId,
        parentTurnId: this.optionsParentTurnId,
        trace: outcome.turnRecord.trace
          ? { ...outcome.turnRecord.trace, conversationId: convId, parentTurnId: this.optionsParentTurnId }
          : undefined,
      };
      this.onTurnRecord?.(record);

      const { response, toolCalls, status } = outcome;

      // Surface user cancellations as 'cancelled' instead of a false 'done'.
      if (status === 'cancelled' || status === 'cancelled_partial') {
        const msg = response || 'Request cancelled.';
        this.onUpdate({
          status: 'cancelled',
          stopReason: status,
          output: msg,
          tokenUsage: this.tokenUsage,
          completedAt: Date.now(),
        });
        return msg;
      }

      // When max_iterations is hit the response may be empty — synthesize a
      // fallback from the gathered tool call history so the parent gets context.
      const finalOutput = response || this.buildFallbackOutput(toolCalls);

      this.onUpdate({
        status: status === 'complete' ? 'done' : 'error',
        stopReason: status,
        output: finalOutput,
        tokenUsage: this.tokenUsage,
        completedAt: Date.now(),
      });
      return finalOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onUpdate({
        status: 'error',
        stopReason: 'error',
        output: msg,
        tokenUsage: this.tokenUsage,
        completedAt: Date.now(),
      });
      throw err;
    }
  }

  /** Trust a tool for the rest of this sub-agent's session (scoped router). */
  trustTool(toolName: string): void {
    this.harness.getToolRouter()?.trustToolForSession?.(toolName);
  }

  /**
   * Build a synthetic summary from tool call records when the agent hit
   * max_iterations without producing a final text response.
   */
  private buildFallbackOutput(toolCalls: ToolCallRecord[]): string {
    if (!toolCalls.length) {
      return '__SUBAGENT_STATUS__:reached max iterations without producing output. No tool calls were made.';
    }

    const successCalls = toolCalls.filter(tc => tc.output.success);
    const parts: string[] = [];

    const fileReads  = successCalls.filter(tc => ['read_file', 'read_multiple_files', 'gather_context'].includes(tc.toolName));
    const fileWrites = successCalls.filter(tc => ['write_file', 'create_file', 'edit_file'].includes(tc.toolName));
    const commands   = successCalls.filter(tc => ['run_command', 'run_terminal_command'].includes(tc.toolName));

    parts.push(`Reached max iterations after ${toolCalls.length} tool calls.`);
    if (fileReads.length)  parts.push(`Read ${fileReads.length} file(s).`);
    if (fileWrites.length) {
      const names = fileWrites.map(tc => (tc.input as Record<string, unknown>)?.path as string || '?').join(', ');
      parts.push(`Modified/created: ${names}.`);
    }
    if (commands.length) parts.push(`Ran ${commands.length} command(s).`);
    if (!fileWrites.length && !commands.length) {
      parts.push('No files were modified. The agent gathered context but did not complete a final response.');
    }

    return `__SUBAGENT_STATUS__:${parts.join(' ')}`;
  }

  cancel(): void {
    this.harness.cancel();
  }

  private handleEvent(event: HarnessEvent): void {
    switch (event.type) {
      case 'tool_call_start': {
        const tc: ToolCallDisplay = {
          id: event.toolCallId,
          name: event.toolName,
          input: event.input as Record<string, unknown>,
          status: 'running',
          startedAt: Date.now(),
        };
        this.toolCallCache = [...this.toolCallCache, tc];
        this.onUpdate({ toolCalls: [...this.toolCallCache] });

        break;
      }
      case 'tool_call_result': {
        this.toolCallCache = this.toolCallCache.map((tc) =>
          tc.id === event.toolCallId
            ? {
                ...tc,
                status: event.result.success
                  ? 'success'
                  : event.result.error?.toLowerCase().includes('cancel')
                    ? 'cancelled'
                    : 'error',
                output: event.result.output,
                error: event.result.error,
                completedAt: Date.now(),
              }
            : tc,
        );
        this.onUpdate({ toolCalls: [...this.toolCallCache] });
        break;
      }
      case 'terminal_progress': {
        const progress = event.progress;
        this.toolCallCache = this.toolCallCache.map((tc) =>
          tc.id === progress.toolCallId
            ? {
                ...tc,
                terminalId: progress.terminalId,
                terminalState: progress.state,
                liveOutput: `${tc.liveOutput ?? ''}${progress.chunk}`.slice(-MAX_LIVE_OUTPUT_CHARS),
              }
            : tc,
        );
        this.onUpdate({ toolCalls: [...this.toolCallCache] });
        break;
      }
      case 'stream_chunk': {
        if (event.chunk.type === 'text_delta') {
          this.streamingOutput = (this.streamingOutput + event.chunk.text).slice(
            -MAX_LIVE_OUTPUT_CHARS,
          );
          this.onUpdate({ output: this.streamingOutput });
        }
        // Usage chunks are forwarded so the parent turn's token accounting
        // includes sub-agent spend.
        if (event.chunk.type === 'usage') {
          this.applyUsage(event.chunk.usage);
          this.onBridgeEvent?.(event);
        }
        break;
      }
      // Bridge-side events: file-change review pipeline and API accounting.
      case 'file_change_pending':
      case 'api_request_sent': {
        this.onBridgeEvent?.(event);
        break;
      }
    }
  }

  private optionsConversationId: string;
  private optionsParentTurnId?: string;
  private optionsEnvironmentContext?: EnvironmentContext;

  private applyUsage(usage: TokenUsage): void {
    const current = this.tokenUsage;
    const inputTokens = current.inputTokens + usage.inputTokens;
    const outputTokens = current.outputTokens + usage.outputTokens;
    const totalTokens =
      usage.totalTokens > 0 ? current.totalTokens + usage.totalTokens : inputTokens + outputTokens;
    const effectiveInput = Math.max(0, usage.inputTokens - (usage.cacheReadTokens ?? 0));
    this.tokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
      requestCount: (current.requestCount ?? 0) + 1,
      lastInputTokens: usage.inputTokens,
      lastEffectiveInputTokens: effectiveInput,
      peakInputTokens: Math.max(current.peakInputTokens ?? 0, usage.inputTokens),
      peakEffectiveInputTokens: Math.max(current.peakEffectiveInputTokens ?? 0, effectiveInput),
      cacheReadTokens: (current.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: (current.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
      reasoningTokens: (current.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
      retryCount: (current.retryCount ?? 0) + (usage.retryCount ?? 0),
      estimatedCostUsd: (current.estimatedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0),
      possibleDuplicateCharge:
        Boolean(current.possibleDuplicateCharge) || Boolean(usage.possibleDuplicateCharge),
    };
    this.onUpdate({ tokenUsage: this.tokenUsage });
  }
}
