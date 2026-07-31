import { Harness, resolveEffectiveAgentPolicy } from '@hyscode/agent-harness';
import type {
  AgentType,
  Skill,
  Rule,
  HarnessEvent,
  ToolCallRecord,
  TerminalRuntimeAdapter,
} from '@hyscode/agent-harness';
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
}

const MAX_LIVE_OUTPUT_CHARS = 65_536;

// ─── SubAgentRunner ──────────────────────────────────────────────────────────

/** Prepended to every sub-agent task to enforce autonomous execution rules */
const SUBAGENT_PREAMBLE = `[SUB-AGENT CONTEXT]
You are running as an autonomous sub-agent. Rules:
1. You CANNOT use ask_user — if information is missing, make reasonable assumptions and proceed.
2. Do NOT read the same file more than three times. If you have already gathered content from a file, use it.
3. Complete your task fully and return a comprehensive, detailed result as your final text response.
4. Do NOT spawn additional sub-agents.

Your task:

`;

/**
 * Runs a focused subtask using a fresh Harness instance.
 * Sub-agents never register spawn_subagent (no recursion).
 * They inherit skills/rules from the parent and share the same approval pipeline.
 */
export class SubAgentRunner {
  private harness: Harness;
  private onUpdate: SubAgentRunnerOptions['onUpdate'];
  private onBridgeEvent: SubAgentRunnerOptions['onBridgeEvent'];
  private toolCallCache: ToolCallDisplay[] = [];
  private streamingOutput = '';
  /** Track file read counts to detect read-loop and cancel early */
  private fileReadCounts = new Map<string, number>();
  private static readonly MAX_FILE_READS = 3;
  private loopCancelledReason: string | null = null;

  constructor(options: SubAgentRunnerOptions) {
    this.onUpdate = options.onUpdate;
    this.onBridgeEvent = options.onBridgeEvent;

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

    this.harness = new Harness({
      workspacePath: options.workspacePath,
      projectId: options.projectId,
      invoke: options.invoke,
      listen: options.listen,
      delegationLevel: 1,
      config: {
        providerId,
        modelId,
        maxIterations: policy.maxIterations,
        maxOutputTokens: policy.maxOutputTokens,
        maxInputTokens: policy.maxInputTokens,
        turnTimeoutMs: policy.turnTimeoutMs,
        approval: policy.approval,
      },
      onEvent: (event: HarnessEvent) => this.handleEvent(event),
      onApprovalRequest: options.onApproval,
      terminalRuntime: options.terminalRuntime,
      onTerminalCommand: options.onTerminalCommand,
    });

    // Apply agent type — sub-agents never get spawn_subagent (no Harness.registerExternalTool called here)
    this.harness.setAgentType(options.mode as AgentType);

    // Inherit active skills and rules from the parent context
    this.harness.setActiveSkills(options.activeSkills);
    this.harness.setActiveRules(options.activeRules);
  }

  async run(task: string): Promise<string> {
    const convId = crypto.randomUUID();
    this.harness.setConversationId(convId);
    this.fileReadCounts.clear();
    this.loopCancelledReason = null;

    const prefixedTask = SUBAGENT_PREAMBLE + task;

    try {
      const outcome = await this.harness.run(prefixedTask, []);

      // Read-loop guard tripped: report the reason explicitly instead of
      // returning a generic "Request cancelled." success.
      if (this.loopCancelledReason) {
        const msg = `__SUBAGENT_STATUS__:${this.loopCancelledReason}`;
        this.onUpdate({ status: 'cancelled', output: msg, completedAt: Date.now() });
        return msg;
      }

      const { response, toolCalls, status } = outcome;

      // Surface user cancellations as 'cancelled' instead of a false 'done'.
      if (status === 'cancelled' || status === 'cancelled_partial') {
        const msg = response || 'Request cancelled.';
        this.onUpdate({ status: 'cancelled', output: msg, completedAt: Date.now() });
        return msg;
      }

      // When max_iterations is hit the response may be empty — synthesize a
      // fallback from the gathered tool call history so the parent gets context.
      const finalOutput = response || this.buildFallbackOutput(toolCalls);

      this.onUpdate({ status: 'done', output: finalOutput, completedAt: Date.now() });
      return finalOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onUpdate({ status: 'error', output: msg, completedAt: Date.now() });
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

  /** Extract the file paths involved in a read-style tool call. */
  private extractReadPaths(event: HarnessEvent): string[] {
    if (event.type !== 'tool_call_start') return [];
    if (event.toolName === 'read_file' || event.toolName === 'gather_context') {
      const path = String((event.input as Record<string, unknown>)?.path ?? '');
      return path ? [path] : [];
    }
    if (event.toolName === 'read_multiple_files') {
      const paths = (event.input as Record<string, unknown>)?.paths;
      return Array.isArray(paths) ? paths.map((p) => String(p)).filter(Boolean) : [];
    }
    return [];
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

        // Detect file-read loop: same file read more than MAX_FILE_READS times
        for (const filePath of this.extractReadPaths(event)) {
          const count = (this.fileReadCounts.get(filePath) ?? 0) + 1;
          this.fileReadCounts.set(filePath, count);
          if (count > SubAgentRunner.MAX_FILE_READS) {
            this.loopCancelledReason =
              `cancelled — read-loop guard: stopped after reading "${filePath}" ${count} times. ` +
              `Gather the file once with gather_context and reuse the content instead of re-reading it.`;
            this.harness.cancel();
          }
        }
        break;
      }
      case 'tool_call_result': {
        this.toolCallCache = this.toolCallCache.map((tc) =>
          tc.id === event.toolCallId
            ? {
                ...tc,
                status: (event.result.success ? 'success' : 'error') as ToolCallDisplay['status'],
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
}
