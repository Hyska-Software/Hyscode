// ─── Tool Router ────────────────────────────────────────────────────────────
// Routes LLM tool calls to concrete implementations and manages approval flow.

import type { ToolDefinition } from '@hyscode/ai-providers';
import type {
  ToolHandler,
  ToolResult,
  ToolCallRecord,
  ToolExecutionContext,
  ToolCategory,
  ApprovalConfig,
  PendingToolCall,
  HarnessEventHandler,
  ToolRiskLevel,
} from './types';
import { SAFE_TOOLS, DESTRUCTIVE_TOOLS, CATEGORY_RISK } from './types';

export class ToolRouter {
  private handlers = new Map<string, ToolHandler>();
  private approvalConfig: ApprovalConfig = { mode: 'manual' };
  private eventHandler: HarnessEventHandler | null = null;
  private approvalCallback: ((pending: PendingToolCall) => Promise<boolean>) | null = null;

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
    this.approvalConfig = config;
  }

  setEventHandler(handler: HarnessEventHandler): void {
    this.eventHandler = handler;
  }

  /** Set callback for requesting user approval */
  setApprovalCallback(
    callback: (pending: PendingToolCall) => Promise<boolean>,
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

    if (!handler) {
      return {
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
    }

    // Check approval
    const needsApproval = this.needsApproval(toolName, handler);

    if (needsApproval) {
      const approved = await this.requestApproval(toolCallId, toolName, input);

      if (!approved) {
        const result: ToolResult = {
          success: false,
          output: '',
          error: 'Tool call was rejected by the user.',
        };
        return {
          id: toolCallId,
          toolName,
          input,
          output: result,
          durationMs: Date.now() - startTime,
          approved: false,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Emit start event
    this.eventHandler?.({
      type: 'tool_call_start',
      toolCallId,
      toolName,
      input,
    });

    // Execute the tool
    let result: ToolResult;
    try {
      result = await handler.execute(input, context);
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

      this.approvalCallback!(pending).then(settle);
    });
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
