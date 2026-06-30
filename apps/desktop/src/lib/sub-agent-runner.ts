import { Harness } from '@hyscode/agent-harness';
import type { AgentType, Skill, Rule, HarnessEvent } from '@hyscode/agent-harness';
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
  activeSkills: Skill[];
  activeRules: Rule[];
}

// ─── SubAgentRunner ──────────────────────────────────────────────────────────

/** Prepended to every sub-agent task to enforce autonomous execution rules */
const SUBAGENT_PREAMBLE = `[SUB-AGENT CONTEXT]
You are running as an autonomous sub-agent. Rules:
1. You CANNOT use ask_user — if information is missing, make reasonable assumptions and proceed.
2. Do NOT read the same file more than twice. If you have already gathered content from a file, use it.
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
  private toolCallCache: ToolCallDisplay[] = [];
  private streamingOutput = '';
  /** Track file read counts to detect read-loop and cancel early */
  private fileReadCounts = new Map<string, number>();
  private static readonly MAX_FILE_READS = 3;

  constructor(options: SubAgentRunnerOptions) {
    this.onUpdate = options.onUpdate;

    const settings = useSettingsStore.getState();

    this.harness = new Harness({
      workspacePath: options.workspacePath,
      projectId: options.projectId,
      invoke: options.invoke,
      listen: options.listen,
      config: {
        providerId: settings.activeProviderId ?? '',
        modelId: settings.activeModelId ?? '',
        maxIterations: settings.subAgentMaxIterations,
        maxOutputTokens: 16_000,
        maxInputTokens: 200_000,
        turnTimeoutMs: 300_000,
        approval: { mode: settings.subAgentAutoApprove ? 'yolo' : settings.approvalMode },
      },
      onEvent: (event: HarnessEvent) => this.handleEvent(event),
      onApprovalRequest: options.onApproval,
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

    const prefixedTask = SUBAGENT_PREAMBLE + task;

    try {
      const { response, toolCalls } = await this.harness.run(prefixedTask, []);

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

  /**
   * Build a synthetic summary from tool call records when the agent hit
   * max_iterations without producing a final text response.
   */
  private buildFallbackOutput(toolCalls: import('@hyscode/agent-harness').ToolCallRecord[]): string {
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

        // Detect file-read loop: same file read more than MAX_FILE_READS times
        if (event.toolName === 'read_file' || event.toolName === 'gather_context') {
          const filePath = String((event.input as Record<string, unknown>)?.path ?? '');
          if (filePath) {
            const count = (this.fileReadCounts.get(filePath) ?? 0) + 1;
            this.fileReadCounts.set(filePath, count);
            if (count > SubAgentRunner.MAX_FILE_READS) {
              // Cancel the sub-agent — it's looping on file reads
              this.harness.cancel();
            }
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
      case 'stream_chunk': {
        if (event.chunk.type === 'text_delta') {
          this.streamingOutput += event.chunk.text;
          this.onUpdate({ output: this.streamingOutput });
        }
        break;
      }
    }
  }
}
