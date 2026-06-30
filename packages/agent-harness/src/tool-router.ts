// ─── Tool Router ────────────────────────────────────────────────────────────
// Routes LLM tool calls to concrete implementations and manages approval flow.

import type { ToolDefinition } from '@hyscode/ai-providers';
import {
  type ToolHandler,
  type ToolResult,
  type ToolCallRecord,
  type ToolExecutionContext,
  type ToolCategory,
  type ApprovalConfig,
  type PendingToolCall,
  type HarnessEventHandler,
  type ToolRiskLevel,
  SAFE_TOOLS,
  DESTRUCTIVE_TOOLS,
  CATEGORY_RISK,
} from './types';

export class ToolRouter {
  private handlers = new Map<string, ToolHandler>();
  private approvalConfig: ApprovalConfig = { mode: 'manual' };
  private eventHandler: HarnessEventHandler | null = null;
  private approvalCallback: ((pending: PendingToolCall, signal: AbortSignal) => Promise<boolean>) | null = null;

  // ─── Registration ───────────────────────────────────────────────────

  register(handler: ToolHandler): void {
    this.handlers.set(handler.definition.name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  // ─── Configuration ──────────────────────────────────────────────────

  setApprovalConfig(config: ApprovalConfig): void {
    this.approvalConfig = {
      ...config,
      sessionTrustedTools: config.sessionTrustedTools ?? this.approvalConfig.sessionTrustedTools,
    };
  }

  setEventHandler(handler: HarnessEventHandler): void {
    this.eventHandler = handler;
  }

  /** Set callback for requesting user approval */
  setApprovalCallback(
    callback: (pending: PendingToolCall, signal: AbortSignal) => Promise<boolean>,
  ): void {
    this.approvalCallback = callback;
  }

  // ─── Tool Definitions ───────────────────────────────────────────────

  /** Get tool definitions for all registered tools (for sending to LLM) */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.handlers.values()).map((h) => h.definition);
  }

  /** Get tool definitions filtered by allowed categories */
  getToolDefinitionsForCategories(categories: ToolCategory[]): ToolDefinition[] {
    return Array.from(this.handlers.values())
      .filter((h) => categories.includes(h.category))
      .map((h) => h.definition);
  }

  /** Get tool definitions with specific allow/deny overrides */
  getToolDefinitionsFiltered(
    categories: ToolCategory[],
    overrides?: { allow?: string[]; deny?: string[] },
  ): ToolDefinition[] {
    const defs = this.getToolDefinitionsForCategories(categories);

    if (!overrides) return defs;

    let filtered = defs;
    if (overrides.deny?.length) {
      filtered = filtered.filter((d) => !overrides.deny!.includes(d.name));
    }
    if (overrides.allow?.length) {
      // Add tools that are explicitly allowed even if not in categories
      const alreadyIncluded = new Set(filtered.map((d) => d.name));
      for (const name of overrides.allow) {
        if (!alreadyIncluded.has(name)) {
          const handler = this.handlers.get(name);
          if (handler) {
            filtered.push(handler.definition);
          }
        }
      }
    }

    return filtered;
  }

  // ─── Tool Execution ─────────────────────────────────────────────────

  async execute(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallRecord> {
    const startTime = Date.now();
    const handler = this.handlers.get(toolName);
    this.eventHandler?.({
      type: 'tool_call_start',
      toolCallId,
      toolName,
      input,
    });

    if (!handler) {
      const record: ToolCallRecord = {
        id: toolCallId,
        toolName,
        input,
        output: {
          success: false,
          output: '',
          error: `Unknown tool: ${toolName}`,
        },
        durationMs: Date.now() - startTime,
        approved: false,
        timestamp: new Date().toISOString(),
      };
      this.emitResult(record);
      return record;
    }

    const validationError = validateInput(handler.definition.inputSchema, input);
    if (validationError) {
      const record: ToolCallRecord = {
        id: toolCallId,
        toolName,
        input,
        output: { success: false, output: '', error: validationError },
        durationMs: Date.now() - startTime,
        approved: false,
        timestamp: new Date().toISOString(),
      };
      this.emitResult(record);
      return record;
    }

    if (context.signal.aborted) {
      const record = this.cancelledRecord(toolName, toolCallId, input, startTime);
      this.emitResult(record);
      return record;
    }

    const dirtyUnsafeGitTools = new Set([
      'git_checkout', 'git_pull', 'git_stash', 'git_merge', 'git_reset',
    ]);
    if (dirtyUnsafeGitTools.has(toolName) && context.hasDirtyBuffers?.()) {
      const record: ToolCallRecord = {
        id: toolCallId,
        toolName,
        input,
        output: {
          success: false,
          output: '',
          error: 'Git operation blocked because the editor has unsaved buffers. Save or revert them first.',
        },
        durationMs: Date.now() - startTime,
        approved: false,
        timestamp: new Date().toISOString(),
      };
      this.emitResult(record);
      return record;
    }

    // Check approval
    const needsApproval = this.needsApproval(toolName, handler);

    if (needsApproval) {
      const approved = await this.requestApproval(toolCallId, toolName, input, context.signal);

      if (!approved) {
        const result: ToolResult = {
          success: false,
          output: '',
          error: 'Tool call was rejected by the user.',
        };
        const record: ToolCallRecord = {
          id: toolCallId,
          toolName,
          input,
          output: result,
          durationMs: Date.now() - startTime,
          approved: false,
          timestamp: new Date().toISOString(),
        };
        this.emitResult(record);
        return record;
      }
    }

    if (this.approvalConfig.mode === 'notify') {
      this.eventHandler?.({
        type: 'tool_call_notification',
        toolCallId,
        toolName,
        description: this.describeToolCall(toolName, input),
      });
    }

    // Execute the tool
    let result: ToolResult;
    try {
      result = context.signal.aborted
        ? { success: false, output: '', error: 'Tool call cancelled.' }
        : await executeWithAbort(handler.execute(input, context), context.signal);
    } catch (err) {
      result = {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - startTime;

    // Emit result event
    this.eventHandler?.({
      type: 'tool_call_result',
      toolCallId,
      toolName,
      result,
      durationMs,
    });

    return {
      id: toolCallId,
      toolName,
      input,
      output: result,
      durationMs,
      approved: true,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Approval Logic ─────────────────────────────────────────────────

  /** Classify a tool's risk level for smart approval */
  getToolRiskLevel(toolName: string, handler: ToolHandler): ToolRiskLevel {
    if (SAFE_TOOLS.has(toolName)) return 'safe';
    if (DESTRUCTIVE_TOOLS.has(toolName)) return 'destructive';
    return CATEGORY_RISK[handler.category] ?? 'moderate';
  }

  /** Mark a tool as trusted for the current session (session-trust mode) */
  trustToolForSession(toolName: string): void {
    if (!this.approvalConfig.sessionTrustedTools) {
      this.approvalConfig.sessionTrustedTools = new Set();
    }
    this.approvalConfig.sessionTrustedTools.add(toolName);
  }

  /** Clear all session-trusted tools (e.g. on new session) */
  clearSessionTrust(): void {
    this.approvalConfig.sessionTrustedTools?.clear();
  }

  /** Get set of tools trusted in this session */
  getSessionTrustedTools(): Set<string> {
    return this.approvalConfig.sessionTrustedTools ?? new Set();
  }

  private needsApproval(toolName: string, handler: ToolHandler): boolean {
    const { mode, categoryOverrides, toolOverrides, sessionTrustedTools } = this.approvalConfig;

    // Tool-level override (highest priority)
    if (toolOverrides?.[toolName] !== undefined) {
      return toolOverrides[toolName];
    }

    // Mode-level check
    switch (mode) {
      case 'yolo':
        return false;

      case 'manual':
        return handler.requiresApproval;

      case 'smart': {
        // Auto-approve safe tools, ask for destructive ones
        const risk = this.getToolRiskLevel(toolName, handler);
        if (risk === 'safe') return false;
        if (risk === 'destructive') return true;
        // Moderate: use handler's default requiresApproval
        return handler.requiresApproval;
      }

      case 'notify':
        // Never blocks — approval dialog is skipped,
        // but the bridge will show a notification
        return false;

      case 'session-trust': {
        // If already trusted in this session, auto-approve
        if (sessionTrustedTools?.has(toolName)) return false;
        // Otherwise, ask (the dialog offers "trust this tool")
        return handler.requiresApproval;
      }

      case 'custom': {
        if (categoryOverrides) {
          const catOverride = categoryOverrides[handler.category];
          if (catOverride !== undefined) return catOverride;
        }
        return handler.requiresApproval;
      }

      default:
        return handler.requiresApproval;
    }
  }

  private async requestApproval(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!this.approvalCallback) {
      // No callback set — auto-approve
      return true;
    }

    const handler = this.handlers.get(toolName);
    const riskLevel = handler ? this.getToolRiskLevel(toolName, handler) : 'moderate' as ToolRiskLevel;

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (approved: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(approved);
        }
      };
      const onAbort = () => settle(false);
      if (signal.aborted) return settle(false);
      signal.addEventListener('abort', onAbort, { once: true });

      const pending: PendingToolCall = {
        id,
        toolName,
        input,
        description: this.describeToolCall(toolName, input),
        riskLevel,
        resolve: settle,
      };

      // Emit event so UI can display and interact with the pending call
      this.eventHandler?.({
        type: 'tool_call_pending',
        pending,
      });

      this.approvalCallback!(pending, signal).then(settle).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

  private emitResult(record: ToolCallRecord): void {
    this.eventHandler?.({
      type: 'tool_call_result',
      toolCallId: record.id,
      toolName: record.toolName,
      result: record.output,
      durationMs: record.durationMs,
    });
  }

  private cancelledRecord(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    startTime: number,
  ): ToolCallRecord {
    return {
      id: toolCallId,
      toolName,
      input,
      output: { success: false, output: '', error: 'Tool call cancelled.' },
      durationMs: Date.now() - startTime,
      approved: false,
      timestamp: new Date().toISOString(),
    };
  }

  private describeToolCall(toolName: string, input: Record<string, unknown>): string {
    // Generate a human-readable description of the tool call
    switch (toolName) {
      case 'write_file':
      case 'create_file':
        return `${toolName}: ${input.path}`;
      case 'edit_file':
        return `edit_file: ${input.path}`;
      case 'replace_lines':
        return `replace_lines: ${input.path} (lines ${input.start_line}${input.end_line ? `-${input.end_line}` : ''})`;
      case 'insert_lines':
        return `insert_lines: ${input.path} (after line ${input.line})`;
      case 'read_multiple_files':
        return `read_multiple_files: ${Array.isArray(input.paths) ? (input.paths as string[]).join(', ') : input.paths}`;
      case 'run_code':
        return `run_code: ${input.language}`;
      case 'run_terminal_command':
        return `run: ${input.command}`;
      case 'git_commit':
        return `git commit: "${input.message}"`;
      case 'git_add':
        return `git add: ${Array.isArray(input.paths) ? (input.paths as string[]).join(', ') : 'all'}`;
      case 'mcp_call':
        return `MCP: ${input.server_id}/${input.tool_name}`;
      case 'delete_file':
        return `delete: ${input.path}`;
      case 'git_push':
        return `git push${input.remote ? `: ${input.remote}` : ''}`;
      case 'git_reset':
        return `git reset${input.hard ? ' --hard' : ''}`;
      default:
        return `${toolName}(${Object.keys(input).join(', ')})`;
    }
  }
}

function validateInput(schema: Record<string, unknown>, input: Record<string, unknown>): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Tool input must be an object.';
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  for (const key of required) {
    if (!(key in input) || input[key] === undefined || input[key] === null) {
      return `Invalid tool input: missing required field "${key}".`;
    }
  }
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  for (const [key, value] of Object.entries(input)) {
    const property = properties[key];
    if (!property) continue;
    if (property.enum && !property.enum.includes(value)) return `Invalid tool input: "${key}" is not an allowed value.`;
    if (property.type === 'array' && !Array.isArray(value)) return `Invalid tool input: "${key}" must be an array.`;
    if (property.type === 'integer' && (!Number.isInteger(value))) return `Invalid tool input: "${key}" must be an integer.`;
    if (property.type === 'number' && typeof value !== 'number') return `Invalid tool input: "${key}" must be a number.`;
    if (property.type === 'boolean' && typeof value !== 'boolean') return `Invalid tool input: "${key}" must be a boolean.`;
    if (property.type === 'string' && typeof value !== 'string') return `Invalid tool input: "${key}" must be a string.`;
    if (property.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      return `Invalid tool input: "${key}" must be an object.`;
    }
  }
  return null;
}

async function executeWithAbort(execution: Promise<ToolResult>, signal: AbortSignal): Promise<ToolResult> {
  if (signal.aborted) return { success: false, output: '', error: 'Tool call cancelled.' };
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<ToolResult>((resolve) => {
    onAbort = () => resolve({ success: false, output: '', error: 'Tool call cancelled.' });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([execution, cancellation]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
