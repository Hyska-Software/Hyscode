// ─── Middleware ──────────────────────────────────────────────────────────────
// Hooks that run around the agent loop to enforce deterministic behaviors.
// Inspired by PreCompletionChecklistMiddleware and LoopDetectionMiddleware
// from the deepagents harness engineering approach.

import type { AgentType, ToolCallRecord } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MiddlewareContext {
  /** Current agent mode */
  mode: AgentType;
  /** Current iteration number (1-indexed) */
  iteration: number;
  /** Max allowed iterations */
  maxIterations: number;
  /** All tool calls made during this turn so far */
  toolCallHistory: ToolCallRecord[];
  /** Accumulated assistant text in this turn */
  assistantText: string;
  /** Conversation ID */
  conversationId: string;
}

/**
 * Called when the LLM returns no tool calls (about to exit).
 * Returns `null` to allow exit, or a string to inject as context
 * and force one more iteration.
 */
export interface PreCompletionHook {
  name: string;
  check(ctx: MiddlewareContext): string | null;
}

/**
 * Called after each tool call completes.
 * Returns `null` for no-op, or a string to inject into context
 * before the next LLM call.
 */
export interface PostToolHook {
  name: string;
  afterTool(toolName: string, record: ToolCallRecord, ctx: MiddlewareContext): string | null;
}

// ─── Verification Middleware ────────────────────────────────────────────────
// Intercepts agent exit in build/debug/review modes when no verification
// evidence is found. Injects a checklist reminder to force a verification pass.

/** Terminal command substrings that indicate verification activity */
const VERIFICATION_COMMAND_PATTERNS = [
  'test', 'jest', 'vitest', 'mocha', 'pytest', 'cargo test',
  'npm test', 'pnpm test', 'yarn test',
  'tsc', 'eslint', 'prettier --check', 'rustfmt --check',
  'check', 'lint', 'typecheck', 'compile',
  'node --check', 'python -m py_compile',
];

/** Agent modes that require verification before exit */
const MODES_REQUIRING_VERIFICATION: Set<AgentType> = new Set(['build', 'debug', 'review']);
const FILE_MUTATION_TOOLS = new Set([
  'write_file', 'edit_file', 'create_file', 'replace_lines', 'insert_lines',
  'delete_file', 'rename_file', 'copy_file',
]);

function hasVerificationEvidence(toolCalls: ToolCallRecord[]): boolean {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];

    // Any git_diff or git_status counts (reviewing changes)
    if (tc.toolName === 'git_diff' || tc.toolName === 'git_status') {
      return true;
    }

    // Terminal commands that look like verification
    if (tc.toolName === 'run_terminal_command') {
      const cmd = String(tc.input.command ?? '').toLowerCase();
      if (VERIFICATION_COMMAND_PATTERNS.some((p) => cmd.includes(p))) {
        return true;
      }
    }

    // Track edited and read files
    if (FILE_MUTATION_TOOLS.has(tc.toolName)) {
      editedFiles.add(String(tc.input.path ?? ''));
    }
    if (tc.toolName === 'read_file') {
      readFiles.add(String(tc.input.path ?? ''));
    }
  }

  // Accept verification if: a file was read BEFORE or AFTER it was edited.
  // Pre-edit reads prove the agent understood the file before modifying it.
  // Post-edit reads prove the agent verified its changes.
  for (const edited of editedFiles) {
    if (edited && readFiles.has(edited)) {
      return true;
    }
  }

  // Also accept if search_code or get_diagnostics was used (code understanding)
  if (toolCalls.some((tc) => tc.toolName === 'search_code' || tc.toolName === 'get_diagnostics')) {
    return true;
  }

  return false;
}

export const verificationMiddleware: PreCompletionHook = {
  name: 'verification',

  check(ctx: MiddlewareContext): string | null {
    // Only enforce in modes that require verification
    if (!MODES_REQUIRING_VERIFICATION.has(ctx.mode)) return null;

    // If no tool calls were made at all, the agent just answered a question — skip
    if (ctx.toolCallHistory.length === 0) return null;

    // Check if any file-modifying tool was used
    const hasEdits = ctx.toolCallHistory.some((tc) =>
      FILE_MUTATION_TOOLS.has(tc.toolName),
    );
    if (!hasEdits) return null;

    // Check if verification already happened
    if (hasVerificationEvidence(ctx.toolCallHistory)) return null;

    // No verification found — inject a checklist
    return `<verification_reminder>
IMPORTANT: You have made file changes but have not verified your work yet.
Before completing, you MUST perform at least one verification step:

1. **Re-read modified files** to confirm changes are correct
2. **Run tests** if a test framework is available (npm test, cargo test, pytest, etc.)
3. **Check for compilation/lint errors** (tsc --noEmit, eslint, etc.)
4. **Review git diff** to see a summary of all changes made

Do NOT skip verification. Run at least one of the above before finishing.
</verification_reminder>`;
  },
};

// ─── Loop Detection Middleware ──────────────────────────────────────────────
// Tracks per-file edit counts and warns the agent when it's editing the same
// file repeatedly (potential doom loop).

const LOOP_THRESHOLD = 4; // Warn after N edits to the same file

export class LoopDetectionMiddleware implements PostToolHook {
  name = 'loop_detection';

  /** Per-file edit counter (reset per turn via resetCounts) */
  private fileEditCounts = new Map<string, number>();

  /** Flag tracking whether we've already warned about this file */
  private warned = new Set<string>();

  resetCounts(): void {
    this.fileEditCounts.clear();
    this.warned.clear();
  }

  afterTool(toolName: string, record: ToolCallRecord, _ctx: MiddlewareContext): string | null {
    // Only track file-editing tools
    if (!FILE_MUTATION_TOOLS.has(toolName)) return null;

    const filePath = String(record.input.path ?? '');
    if (!filePath) return null;

    const count = (this.fileEditCounts.get(filePath) ?? 0) + 1;
    this.fileEditCounts.set(filePath, count);

    if (count >= LOOP_THRESHOLD && !this.warned.has(filePath)) {
      this.warned.add(filePath);
      return `<loop_warning>
You have edited "${filePath}" ${count} times in this turn.
This may indicate a doom loop where small variations of the same approach keep failing.

Consider:
- Stepping back and reconsidering the overall approach
- Reading the file fresh to understand the current state
- Trying a fundamentally different strategy instead of incremental fixes
- Checking if there's a misunderstanding of the requirements
</loop_warning>`;
    }

    // On subsequent edits after warning, add a lighter reminder
    if (count > LOOP_THRESHOLD && count % 3 === 0) {
      return `<loop_reminder>Still editing "${filePath}" (${count} edits). Strongly consider a different approach.</loop_reminder>`;
    }

    return null;
  }
}

// ─── Tool Output Compaction ─────────────────────────────────────────────────
// Large tool outputs are compacted to head+tail with a note about the full
// output being available via re-read. This prevents context rot from noisy
// tool results.

const COMPACTION_THRESHOLD = 8000; // chars (~2000 tokens)
const COMPACTION_HEAD = 2000;
const COMPACTION_TAIL = 2000;

/**
 * Compact a tool output string if it exceeds the threshold.
 * Keeps the first and last N characters with a note in between.
 */
export function compactToolOutput(output: string, toolName: string): string {
  if (output.length <= COMPACTION_THRESHOLD) return output;

  const head = output.slice(0, COMPACTION_HEAD);
  const tail = output.slice(-COMPACTION_TAIL);
  const omittedChars = output.length - COMPACTION_HEAD - COMPACTION_TAIL;
  const omittedLines = output.slice(COMPACTION_HEAD, -COMPACTION_TAIL).split('\n').length;

  return `${head}\n\n... [${omittedLines} lines / ${omittedChars} chars omitted from ${toolName} output — re-read the file or re-run the command for full output] ...\n\n${tail}`;
}
// ─── Auto-Gather Middleware ─────────────────────────────────────────────────
// In build/debug modes, automatically promotes read_file results to gathered
// context with medium relevance. This ensures files the agent reads are kept
// in working memory without requiring explicit gather_context calls.

/** Modes where auto-gather is active */
const AUTO_GATHER_MODES: Set<AgentType> = new Set(['build', 'debug']);

/** Files with these extensions get auto-gathered at slightly higher relevance */
const HIGH_VALUE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.rs', '.toml', '.json', '.md',
]);

export class AutoGatherMiddleware implements PostToolHook {
  name = 'auto_gather';

  private gatheredContext: {
    add(path: string, content: string, relevance: number, reason: string): number;
    has(path: string): boolean;
    getTokens(): number;
  } | null = null;

  /** Must be called by the harness after constructing the execution context */
  setGatheredContext(ctx: typeof this.gatheredContext): void {
    this.gatheredContext = ctx;
  }

  afterTool(toolName: string, record: ToolCallRecord, ctx: MiddlewareContext): string | null {
    // Only active in build/debug modes
    if (!AUTO_GATHER_MODES.has(ctx.mode)) return null;
    if (!this.gatheredContext) return null;

    // Only track read_file calls
    if (toolName !== 'read_file') return null;
    if (!record.output.success) return null;

    const filePath = String(record.input.path ?? '');
    if (!filePath) return null;

    // Don't re-gather if already in working memory
    if (this.gatheredContext.has(filePath)) return null;

    // Skip if the output is too large (> 50k chars ~12.5k tokens)
    const content = record.output.output;
    if (content.length > 50_000) return null;

    // Determine relevance based on file extension
    const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '';
    const relevance = HIGH_VALUE_EXTENSIONS.has(ext) ? 0.5 : 0.35;

    this.gatheredContext.add(filePath, content, relevance, 'auto-gathered from read_file');

    return null; // No injection needed — the file is silently added to working memory
  }
}
