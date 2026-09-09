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
  type ApprovalDecision,
  type HarnessEventHandler,
  type ToolRiskLevel,
  SAFE_TOOLS,
  DESTRUCTIVE_TOOLS,
  CATEGORY_RISK,
  GIT_WORKTREE_SWEEPING_TOOLS,
} from './types';
import { ExternalPathAccessRegistry } from './external-path-access';

export class ToolRouter {
  private handlers = new Map<string, ToolHandler>();
  private approvalConfig: ApprovalConfig = { mode: 'manual' };
  private eventHandler: HarnessEventHandler | null = null;
  private readonly externalPathAccess: ExternalPathAccessRegistry;
  private approvalCallback:
    | ((pending: PendingToolCall, signal: AbortSignal) => Promise<ApprovalDecision>)
    | null = null;

  constructor(externalPathAccess?: ExternalPathAccessRegistry) {
    this.externalPathAccess = externalPathAccess ?? new ExternalPathAccessRegistry();
  }

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
    callback: (pending: PendingToolCall, signal: AbortSignal) => Promise<ApprovalDecision>,
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
          error: `Unknown tool: ${toolName}.${suggestSimilarTool(toolName, Array.from(this.handlers.keys()))}`,
        },
        durationMs: Date.now() - startTime,
        approved: false,
        timestamp: new Date().toISOString(),
      };
      this.emitResult(record);
      return record;
    }

    input = normalizeToolInput(handler.definition.inputSchema, input);
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

    if (GIT_WORKTREE_SWEEPING_TOOLS.has(toolName) && context.hasDirtyBuffers?.()) {
      const record: ToolCallRecord = {
        id: toolCallId,
        toolName,
        input,
        output: {
          success: false,
          output: '',
          error:
            'Git operation blocked because the editor has unsaved buffers. Save or revert them first.',
        },
        durationMs: Date.now() - startTime,
        approved: false,
        timestamp: new Date().toISOString(),
      };
      this.emitResult(record);
      return record;
    }

    let externalAccessRequest = null;
    try {
      externalAccessRequest = handler.externalPathAccess
        ? this.externalPathAccess.inspect(handler.externalPathAccess, input, context.workspacePath)
        : null;
    } catch (err) {
      const record: ToolCallRecord = {
        id: toolCallId,
        toolName,
        input,
        output: {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        },
        durationMs: Date.now() - startTime,
        approved: false,
        timestamp: new Date().toISOString(),
      };
      this.emitResult(record);
      return record;
    }

    const externalApprovalRequired =
      externalAccessRequest !== null && !this.externalPathAccess.isCovered(externalAccessRequest);

    // External path approval is mandatory and independent of the configured
    // tool approval mode. A covered session grant still needs to be attached
    // to the execution context so the handler cannot escape its authorization.
    const needsApproval = this.needsApproval(toolName, handler);
    const approvalRequired = needsApproval || externalApprovalRequired;
    let approvalDecision: ApprovalDecision = true;

    if (approvalRequired) {
      approvalDecision = await this.requestApproval(
        toolCallId,
        toolName,
        input,
        context.signal,
        externalApprovalRequired ? externalAccessRequest ?? undefined : undefined,
      );
      const approved = normalizeApprovalDecision(approvalDecision).approved;

      if (!approved) {
        const result: ToolResult = {
          success: false,
          output: '',
          error: externalApprovalRequired
            ? 'External path access was denied or requires explicit user approval.'
            : 'Tool call was rejected by the user.',
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

    if (externalAccessRequest && externalApprovalRequired) {
      const decision = normalizeApprovalDecision(approvalDecision);
      this.externalPathAccess.grant(externalAccessRequest, decision.externalGrant ?? 'once');
    }

    const executionContext = externalAccessRequest
      ? {
          ...context,
          externalPathAccess: this.externalPathAccess.createAccess(
            externalAccessRequest,
            context.workspacePath,
          ),
        }
      : context;

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
        : await executeWithAbort(handler.execute(input, executionContext), context.signal);
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
    return handler.riskLevel ?? CATEGORY_RISK[handler.category] ?? 'moderate';
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

  /** Clear all external directory grants when a new session becomes active. */
  clearExternalPathGrants(): void {
    this.externalPathAccess.clear();
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
    externalAccess?: PendingToolCall['externalAccess'],
  ): Promise<ApprovalDecision> {
    if (!this.approvalCallback) {
      // Existing normal approvals remain compatible with headless callers,
      // but mandatory external access fails closed without a user callback.
      return externalAccess ? { approved: false } : true;
    }

    const handler = this.handlers.get(toolName);
    const riskLevel = handler
      ? this.getToolRiskLevel(toolName, handler)
      : ('moderate' as ToolRiskLevel);

    return new Promise<ApprovalDecision>((resolve) => {
      let resolved = false;
      const settle = (decision: ApprovalDecision) => {
        if (!resolved) {
          resolved = true;
          resolve(decision);
        }
      };
      const onAbort = () => settle({ approved: false });
      if (signal.aborted) return settle(false);
      signal.addEventListener('abort', onAbort, { once: true });

      const pending: PendingToolCall = {
        id,
        toolName,
        input,
        description: this.describeToolCall(toolName, input),
        riskLevel,
        ...(externalAccess ? { externalAccess } : {}),
        resolve: settle,
      };

      // Emit event so UI can display and interact with the pending call
      this.eventHandler?.({
        type: 'tool_call_pending',
        pending,
      });

      void Promise.resolve()
        .then(() => this.approvalCallback!(pending, signal))
        .then(settle)
        .catch(() => settle({ approved: false }))
        .finally(() => {
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

function normalizeApprovalDecision(decision: ApprovalDecision): {
  approved: boolean;
  externalGrant?: 'once' | 'session-directory';
} {
  if (typeof decision === 'boolean') return { approved: decision };
  return decision;
}

function validateInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return 'Tool input must be an object.';
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in input) || input[key] === undefined || input[key] === null) {
      return `Invalid tool input: missing required field "${key}". Received keys: [${Object.keys(input).join(', ') || '(none)'}].`;
    }
  }
  const properties = (schema.properties ?? {}) as Record<
    string,
    { type?: string; enum?: unknown[] }
  >;
  for (const [key, value] of Object.entries(input)) {
    const property = properties[key];
    if (!property) continue;
    if (property.enum && !property.enum.includes(value))
      return `Invalid tool input: "${key}" is not an allowed value.`;
    if (property.type === 'array' && !Array.isArray(value))
      return `Invalid tool input: "${key}" must be an array.`;
    if (property.type === 'integer' && !Number.isInteger(value))
      return `Invalid tool input: "${key}" must be an integer.`;
    if (property.type === 'number' && typeof value !== 'number')
      return `Invalid tool input: "${key}" must be a number.`;
    if (property.type === 'boolean' && typeof value !== 'boolean')
      return `Invalid tool input: "${key}" must be a boolean.`;
    if (property.type === 'string' && typeof value !== 'string')
      return `Invalid tool input: "${key}" must be a string.`;
    if (
      property.type === 'object' &&
      (typeof value !== 'object' || value === null || Array.isArray(value))
    ) {
      return `Invalid tool input: "${key}" must be an object.`;
    }
  }
  return null;
}

/** Well-known parameter synonyms models emit instead of the canonical snake_case names. */
const COMMON_PARAM_ALIASES: Record<string, string[]> = {
  path: ['file_path', 'filepath', 'filePath', 'filename', 'file_name', 'file'],
  old_string: ['oldString', 'old_text', 'oldText', 'search', 'find'],
  new_string: ['newString', 'new_text', 'newText', 'replace', 'replacement', 'content'],
  replace_all: ['replaceAll', 'replaceall', 'all'],
  start_line: ['startLine', 'start', 'from_line', 'fromLine'],
  end_line: ['endLine', 'end', 'to_line', 'toLine'],
  new_content: ['newContent', 'newcontent', 'content'],
  content: ['new_content', 'newContent', 'newcontent'],
  base_path: ['basePath', 'basepath', 'root', 'dir', 'directory'],
  max_results: ['maxResults', 'maxresults', 'limit'],
  max_lines_per_file: ['maxLinesPerFile', 'max_lines', 'maxLines'],
  terminal_id: ['terminalId', 'terminalid', 'id'],
  target_mode: ['targetMode', 'targetmode', 'mode'],
  context_summary: ['contextSummary', 'contextsummary', 'summary'],
  skill_name: ['skillName', 'skillname', 'skill', 'name'],
};

function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Normalize raw LLM tool input before validation.
 * - Resolves camelCase / well-known synonyms to the canonical snake_case keys
 *   declared in the schema (models trained on camelCase hallucinate `oldString`).
 * - Coerces weak-model typings: numeric strings → integer/number,
 *   "true"/"false"/1/0 → boolean, numbers/booleans → string, JSON strings → array/object.
 * Returns a new object; the caller's original is never mutated.
 */
export function normalizeToolInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  if (Object.keys(properties).length === 0) return { ...input };
  const normalized: Record<string, unknown> = { ...input };
  const lowerIndex = new Map<string, string>();
  for (const key of Object.keys(normalized)) lowerIndex.set(key.toLowerCase(), key);

  const resolveAlias = (canonical: string): string | null => {
    if (canonical in normalized) return canonical;
    const camel = toCamelCase(canonical);
    if (camel in normalized) return camel;
    const snake = toSnakeCase(canonical);
    if (snake in normalized) return snake;
    const candidates = COMMON_PARAM_ALIASES[canonical] ?? [];
    for (const alias of candidates) {
      if (alias in normalized) return alias;
      const byLower = lowerIndex.get(alias.toLowerCase());
      if (byLower) return byLower;
    }
    const byLower = lowerIndex.get(canonical.toLowerCase());
    return byLower ?? null;
  };

  for (const [canonical, property] of Object.entries(properties)) {
    const found = resolveAlias(canonical);
    if (found && found !== canonical && !(canonical in normalized)) {
      normalized[canonical] = normalized[found];
    }
    if (!(canonical in normalized)) continue;
    normalized[canonical] = coerceToolValue(property.type, normalized[canonical]);
  }
  return normalized;
}

function coerceToolValue(type: string | undefined, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  switch (type) {
    case 'integer': {
      if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^-?\d+(\.0+)?$/.test(trimmed)) return parseInt(trimmed, 10);
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    }
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) return parsed;
      }
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on'].includes(lower)) return true;
        if (['false', '0', 'no', 'n', 'off'].includes(lower)) return false;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      return value;
    }
    case 'string': {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return value;
    }
    case 'array': {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
          try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            /* fall through to single-element wrap */
          }
        }
        return [value];
      }
      return [value];
    }
    case 'object': {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
        } catch {
          /* keep original so validation reports a clear error */
        }
      }
      return value;
    }
    default:
      return value;
  }
}

/** Suggest the closest registered tool when the model calls a name that doesn't exist. */
function suggestSimilarTool(target: string, candidates: string[]): string {
  let best: string | null = null;
  let bestScore = 0;
  const normalizedTarget = target.toLowerCase();
  // Hard-coded renames for tools the system prompt historically referenced.
  const legacyNames: Record<string, string> = {
    grep_search: 'search_code',
    search_files: 'search_code',
    search_text: 'search_code',
    list_code_symbols: 'search_code',
    get_file_info: 'get_file_info',
  };
  if (legacyNames[target] && candidates.includes(legacyNames[target])) {
    return ` Did you mean "${legacyNames[target]}"?`;
  }
  for (const candidate of candidates) {
    const score = similarityScore(normalizedTarget, candidate.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best && bestScore >= 0.5) return ` Did you mean "${best}"?`;
  return '';
}

function similarityScore(a: string, b: string): number {
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  const distance = levenshtein(a, b);
  return 1 - distance / longer;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let carry = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, carry + (a[i - 1] === b[j - 1] ? 0 : 1));
      carry = temp;
    }
  }
  return prev[b.length];
}

/**
 * Parse tool-call JSON emitted by the model, tolerating the malformations
 * weak models frequently produce (trailing commas, single quotes, unescaped
 * control characters inside strings, truncated streams).
 * Returns the parsed object or throws the original SyntaxError.
 */
export function parseToolCallInput(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (originalError) {
    const repaired = repairToolCallJson(raw);
    if (repaired !== null) {
      try {
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        /* fall through and throw the original error */
      }
    }
    throw originalError;
  }
}

function repairToolCallJson(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  // Some models wrap the JSON in markdown fences.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  // Remove trailing commas before } or ].
  text = text.replace(/,\s*([}\]])/g, '$1');
  // Convert single-quoted keys/strings to double quotes when it looks like
  // the model used Python-style quoting throughout.
  if (text.includes("'") && !text.includes('"')) {
    text = text.replace(/'/g, '"');
  }
  // Escape raw control characters (literal newlines/tabs) inside string
  // literals — the most common failure when old_string/new_string embed code.
  try {
    return escapeRawControlsInStrings(text);
  } catch {
    return text;
  }
}

function escapeRawControlsInStrings(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else if (ch.charCodeAt(0) < 0x20) {
        out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      } else {
        out += ch;
      }
    } else {
      out += ch;
      if (ch === '"') inString = true;
    }
  }
  return out;
}

async function executeWithAbort(
  execution: Promise<ToolResult>,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (signal.aborted) return { success: false, output: '', error: 'Tool call cancelled.' };
  // Do not race an uncancellable native mutation. Returning early would tell the
  // UI that cancellation completed while the operation could still mutate disk.
  const result = await execution;
  if (!signal.aborted || result.error?.toLowerCase().includes('cancel')) return result;
  return {
    success: false,
    output: result.output,
    error: 'Cancellation was requested, but the native operation completed before it could stop.',
    metadata: { ...result.metadata, cancellationPartial: true, operationCompleted: true },
  };
}
