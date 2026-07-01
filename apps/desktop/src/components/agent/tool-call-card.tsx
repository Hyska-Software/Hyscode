import hljs from 'highlight.js';
import {
  Wrench,
  Check,
  X,
  Loader2,
  Clock,
  FileText,
  Search,
  Terminal,
  GitBranch,
  FolderOpen,
  Pencil,
  Plus,
  Zap,
  Globe,
  Database,
  Network,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Code2,
  Trash2,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { useState, memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/stores/terminal-store';
import type { ToolCallDisplay } from '@/stores/agent-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectLang(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'xml',
    htm: 'xml',
    svg: 'xml',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    dart: 'dart',
    xml: 'xml',
    graphql: 'graphql',
    tf: 'hcl',
    hcl: 'hcl',
  };
  return map[ext] ?? '';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(startedAt?: number, completedAt?: number): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = completedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function highlightCode(raw: string, lang: string): string {
  if (!raw) return '';
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value;
    }
    return escapeHtml(raw);
  } catch {
    return escapeHtml(raw);
  }
}

// ─── Inline Diff Viewer ───────────────────────────────────────────────────────

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  line: string;
  oldNum?: number;
  newNum?: number;
}

function computeInlineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];
  let i = 0,
    j = 0;
  let oldNum = 1,
    newNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: 'ctx', line: oldLines[i], oldNum, newNum });
      i++;
      j++;
      oldNum++;
      newNum++;
    } else {
      // Simple heuristic: check if next line matches
      const nextOldMatch =
        j + 1 < newLines.length && i < oldLines.length && oldLines[i] === newLines[j + 1];
      const nextNewMatch =
        i + 1 < oldLines.length && j < newLines.length && oldLines[i + 1] === newLines[j];

      if (nextOldMatch && !nextNewMatch) {
        result.push({ type: 'add', line: newLines[j], newNum });
        j++;
        newNum++;
      } else if (nextNewMatch && !nextOldMatch) {
        result.push({ type: 'del', line: oldLines[i], oldNum });
        i++;
        oldNum++;
      } else {
        if (i < oldLines.length) {
          result.push({ type: 'del', line: oldLines[i], oldNum });
          i++;
          oldNum++;
        }
        if (j < newLines.length) {
          result.push({ type: 'add', line: newLines[j], newNum });
          j++;
          newNum++;
        }
      }
    }
  }
  return result;
}

function InlineDiff({
  oldText,
  newText,
  lang,
}: {
  oldText: string;
  newText: string;
  lang: string;
}) {
  const lines = useMemo(() => computeInlineDiff(oldText, newText), [oldText, newText]);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 py-1 text-[10px] text-muted-foreground/45 transition-colors hover:text-muted-foreground/70"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Diff ({lines.filter((l) => l.type !== 'ctx').length} changes)</span>
      </button>
      {expanded && (
        <div className="max-h-[320px] overflow-auto rounded-md bg-muted/30">
          <table className="w-full font-mono text-[11px] leading-[1.6]">
            <tbody>
              {lines.map((l, idx) => (
                <tr
                  key={idx}
                  className={cn(
                    l.type === 'add' && 'bg-green-500/[0.06]',
                    l.type === 'del' && 'bg-red-500/[0.06]',
                  )}
                >
                  <td className="w-8 select-none pr-2 text-right text-muted-foreground/25">
                    {l.oldNum ?? ''}
                  </td>
                  <td className="w-8 select-none pr-2 text-right text-muted-foreground/25">
                    {l.newNum ?? ''}
                  </td>
                  <td className="w-4 select-none text-center">
                    {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
                  </td>
                  <td className="pr-4">
                    <span
                      className={cn(
                        l.type === 'add' && 'text-green-400/85',
                        l.type === 'del' && 'text-red-400/85',
                        l.type === 'ctx' && 'text-foreground/50',
                      )}
                      dangerouslySetInnerHTML={{
                        __html: l.type === 'ctx' ? escapeHtml(l.line) : highlightCode(l.line, lang),
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── File Edit Card (write_file / create_file / edit_file) ────────────────────

function FileEditCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const path = (toolCall.input.path as string) ?? '';
  const rawContent = (toolCall.input.new_string ??
    toolCall.input.new_content ??
    toolCall.input.content ??
    '') as string;
  const oldContent = (toolCall.input.old_string as string) ?? '';
  const lang = detectLang(path);
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const isEdit = toolCall.name === 'edit_file';
  const isCreate = toolCall.name === 'create_file';
  const isReplaceLines = toolCall.name === 'replace_lines';
  const isInsertLines = toolCall.name === 'insert_lines';

  const highlightedCode = useMemo(() => highlightCode(rawContent, lang), [rawContent, lang]);

  let statusText: string | null = null;
  if (isDone) {
    if (isEdit) statusText = 'Edit applied successfully.';
    else if (isCreate) statusText = 'File created successfully.';
    else if (isReplaceLines) statusText = 'Lines replaced successfully.';
    else if (isInsertLines) statusText = 'Lines inserted successfully.';
    else statusText = 'Write applied successfully.';
  } else if (isError) {
    statusText = toolCall.error ?? 'Operation failed.';
  }

  const OpIcon: LucideIcon = isEdit ? Pencil : isCreate ? Plus : FileText;

  return (
    <div className="agent-fade-in my-2 overflow-hidden">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}

      {/* Header */}
      <div className="flex items-center gap-2 py-1.5">
        <OpIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground/65">
          {path}
        </span>
        {isCreate && (
          <span className="shrink-0 rounded px-1 py-[1px] text-[9px] font-medium text-green-400/80">
            NEW
          </span>
        )}
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">
            {duration}
          </span>
        )}
      </div>

      {/* Status line */}
      {statusText && (
        <div
          className={cn(
            'py-1 text-[11px]',
            isError ? 'text-destructive/80' : 'text-muted-foreground/50',
          )}
        >
          {statusText}
        </div>
      )}

      {/* Diff or Code block */}
      {isEdit && oldContent && isDone ? (
        <InlineDiff oldText={oldContent} newText={rawContent} lang={lang} />
      ) : rawContent ? (
        <div className="rounded-md bg-muted/30">
          <pre className="max-h-[280px] cursor-text select-text overflow-auto px-4 py-3 text-[11.5px] leading-[1.7]">
            <code
              className={cn('hljs', lang && `language-${lang}`)}
              dangerouslySetInnerHTML={{ __html: highlightedCode || escapeHtml(rawContent) }}
            />
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// ─── File Reference Row (read_file / search_code / find_files / get_file_info) ─

function FileReferenceRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const path = (toolCall.input.path as string) ?? (toolCall.input.query as string) ?? '';
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const [showOutput, setShowOutput] = useState(false);

  // For read_file, we can show a preview of the output
  const hasOutput = !!toolCall.output && toolCall.output.length > 0;
  const isReadFile = toolCall.name === 'read_file';
  const isSearch = toolCall.name === 'search_code';
  const isFind = toolCall.name === 'find_files';

  const outputPreview = useMemo(() => {
    if (!hasOutput) return null;
    const lines = toolCall.output!.split('\n');
    if (isSearch || isFind) {
      return (
        lines.slice(0, 8).join('\n') +
        (lines.length > 8 ? `\n... ${lines.length - 8} more lines` : '')
      );
    }
    return (
      lines.slice(0, 6).join('\n') +
      (lines.length > 6 ? `\n... ${lines.length - 6} more lines` : '')
    );
  }, [hasOutput, toolCall.output, isSearch, isFind]);

  return (
    <div className="agent-fade-in my-0.5">
      <div className="flex items-center gap-2 py-1">
        {isRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
        ) : isError ? (
          <X className="h-3 w-3 shrink-0 text-destructive" />
        ) : isDone ? (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400/70" />
        ) : (
          <Clock className="h-3 w-3 shrink-0 text-yellow-400/40" />
        )}
        {isReadFile ? (
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground/35" />
        ) : isSearch ? (
          <Search className="h-3 w-3 shrink-0 text-muted-foreground/35" />
        ) : isFind ? (
          <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/35" />
        ) : (
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground/35" />
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground/60">{path}</span>
        {hasOutput && isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-muted-foreground/70"
          >
            {showOutput ? 'hide' : 'preview'}
          </button>
        )}
      </div>

      {showOutput && outputPreview && (
        <div className="rounded-md bg-muted/30">
          <pre className="max-h-[200px] cursor-text select-text overflow-auto px-4 py-2 font-mono text-[11px] leading-[1.6] text-foreground/60">
            {outputPreview}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <div className="py-1 text-[10px] text-destructive/85">{toolCall.error}</div>
      )}
    </div>
  );
}

// ─── Terminal Card (run_terminal_command / *command*) ──────────────────────────

function TerminalCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const command = (toolCall.input.command as string) ?? '';
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="agent-fade-in my-2">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}

      {/* Header */}
      <div className="flex items-center gap-2 py-1.5">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-green-400/50" />
        <span className="flex-1 truncate font-mono text-[11px] text-foreground/65">{command}</span>
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">
            {duration}
          </span>
        )}
        {isRunning && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
        )}
        {isError && <X className="h-3 w-3 shrink-0 text-destructive" />}
        {isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-muted-foreground/70"
          >
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
        <button
          onClick={() => {
            const agentSession = useTerminalStore.getState().getAgentSession();
            if (agentSession) {
              useTerminalStore.getState().setActiveSession(agentSession.id);
            }
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground/30 transition-colors hover:text-muted-foreground/70"
          title="Jump to agent terminal"
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Output */}
      {showOutput && toolCall.output && (
        <div className="rounded-md bg-muted/30">
          <pre className="max-h-[200px] cursor-text select-text overflow-auto px-4 py-3 font-mono text-[11px] leading-[1.65] text-[var(--color-success)]/85">
            {toolCall.output}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <pre className="whitespace-pre-wrap py-1 font-mono text-[11px] text-destructive/85">
          {toolCall.error}
        </pre>
      )}
    </div>
  );
}

// ─── Run Code Card ────────────────────────────────────────────────────────────

function RunCodeCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const language = (toolCall.input.language as string) ?? '';
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(false);

  const code = (toolCall.input.code as string) ?? '';
  const codePreview =
    code.split('\n').slice(0, 3).join('\n') + (code.split('\n').length > 3 ? '...' : '');
  const lang = language;
  const highlighted = useMemo(() => highlightCode(codePreview, lang), [codePreview, lang]);

  return (
    <div className="agent-fade-in my-2">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}

      <div className="flex items-center gap-2 py-1.5">
        <Code2 className="h-3.5 w-3.5 shrink-0 text-amber-400/50" />
        <span className="text-[11px] font-medium text-foreground/65">Run {language}</span>
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">
            {duration}
          </span>
        )}
        {isRunning && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
        )}
        {isError && <X className="h-3 w-3 shrink-0 text-destructive" />}
        {isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-muted-foreground/70"
          >
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
      </div>

      {/* Code preview */}
      <div className="rounded-md bg-muted/30 px-3 py-2">
        <pre className="cursor-text select-text font-mono text-[10px] leading-[1.6] text-foreground/40">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>

      {showOutput && toolCall.output && (
        <div className="mt-1 rounded-md bg-muted/30">
          <pre className="max-h-[200px] cursor-text select-text overflow-auto px-4 py-3 font-mono text-[11px] leading-[1.65] text-foreground/70">
            {toolCall.output}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <pre className="whitespace-pre-wrap py-1 font-mono text-[11px] text-destructive/85">
          {toolCall.error}
        </pre>
      )}
    </div>
  );
}

// ─── Browser Card (web_search / web_fetch) ────────────────────────────────────

function BrowserCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(false);

  const query = (toolCall.input.query as string) ?? '';
  const url = (toolCall.input.url as string) ?? '';
  const label = toolCall.name === 'web_search' ? 'Web Search' : 'Web Fetch';
  const target = query || url || '';

  return (
    <div className="agent-fade-in my-2">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}

      <div className="flex items-center gap-2 py-1.5">
        <Globe className="h-3.5 w-3.5 shrink-0 text-sky-400/50" />
        <span className="text-[11px] font-medium text-foreground/65">{label}</span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground/50">
          {target}
        </span>
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">
            {duration}
          </span>
        )}
        {isRunning && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
        )}
        {isError && <X className="h-3 w-3 shrink-0 text-destructive" />}
        {isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-muted-foreground/70"
          >
            {showOutput ? 'hide' : 'results'}
          </button>
        )}
      </div>

      {showOutput && toolCall.output && (
        <div className="rounded-md bg-muted/30">
          <pre className="max-h-[300px] cursor-text select-text overflow-auto px-4 py-3 font-mono text-[11px] leading-[1.65] text-foreground/70">
            {toolCall.output}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <pre className="whitespace-pre-wrap py-1 font-mono text-[11px] text-destructive/85">
          {toolCall.error}
        </pre>
      )}
    </div>
  );
}

// ─── Generic Tool Row (git, skill, mcp, etc.) ─────────────────────────────────

const GENERIC_ICONS: Record<string, LucideIcon> = {
  git_status: GitBranch,
  git_diff: GitBranch,
  git_commit: GitBranch,
  git_add: GitBranch,
  git_log: GitBranch,
  git_checkout: GitBranch,
  git_push: GitBranch,
  git_pull: GitBranch,
  git_fetch: GitBranch,
  git_stash: GitBranch,
  git_merge: GitBranch,
  git_reset: GitBranch,
  git_blame: GitBranch,
  git_show: GitBranch,
  activate_skill: Sparkles,
  list_skills: Zap,
  mcp_call: Globe,
  mcp_query: Network,
  database_query: Database,
  list_directory: FolderOpen,
  delete_file: Trash2,
  rename_file: FileText,
  copy_file: FileText,
  get_file_info: FileText,
  find_files: FolderOpen,
  read_multiple_files: FileText,
  run_code: Code2,
  detect_project_type: Zap,
  get_diagnostics: Code2,
  gather_context: FileText,
  drop_context: FileText,
  list_context: FileText,
  manage_tasks: CheckCircle2,
  request_mode_switch: Zap,
  ask_user: Sparkles,
  create_skill: Sparkles,
};

function getGenericLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getGenericSummary(toolCall: ToolCallDisplay): string {
  const q = toolCall.input.query as string | undefined;
  if (q) return q.length > 50 ? q.slice(0, 50) + '…' : q;
  const url = toolCall.input.url as string | undefined;
  if (url) return url.length > 50 ? url.slice(0, 50) + '…' : url;
  const skillName = toolCall.input.skill_name as string | undefined;
  if (skillName) return skillName;
  const p = toolCall.input.path as string | undefined;
  if (p) return p.split(/[\\/]/).slice(-2).join('/');
  const cmd = toolCall.input.command as string | undefined;
  if (cmd) return cmd.length > 50 ? cmd.slice(0, 50) + '…' : cmd;
  const paths = toolCall.input.paths as string[] | undefined;
  if (paths?.length) return `${paths.length} file${paths.length > 1 ? 's' : ''}`;
  return '';
}

function GenericToolRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const ToolIcon = GENERIC_ICONS[toolCall.name] ?? Wrench;
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const summary = getGenericSummary(toolCall);
  const [showOutput, setShowOutput] = useState(false);
  const hasOutput = !!toolCall.output && toolCall.output.length > 0;

  return (
    <div className="agent-fade-in my-0.5">
      <div className="flex items-center gap-2 py-1">
        {isRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
        ) : isDone ? (
          <Check className="h-3 w-3 shrink-0 text-green-400/70" />
        ) : isError ? (
          <X className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <Clock className="h-3 w-3 shrink-0 text-yellow-400/40" />
        )}
        <ToolIcon className="h-3 w-3 shrink-0 text-muted-foreground/35" />
        <span className="text-[11px] text-foreground/60">{getGenericLabel(toolCall.name)}</span>
        {summary && (
          <span className="ml-0.5 max-w-[160px] truncate font-mono text-[10px] text-muted-foreground/30">
            {summary}
          </span>
        )}
        {hasOutput && isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 transition-colors hover:bg-foreground/[0.03] hover:text-muted-foreground/70"
          >
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
      </div>

      {showOutput && hasOutput && (
        <div className="rounded-md bg-muted/30">
          <pre className="max-h-[180px] cursor-text select-text overflow-auto px-4 py-2 font-mono text-[11px] leading-[1.6] text-foreground/60">
            {toolCall.output}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <div className="py-1 text-[10px] text-destructive/85">{toolCall.error}</div>
      )}
    </div>
  );
}

// ─── Compact Diff Helpers ────────────────────────────────────────────────────

function computeLineDiffCounts(toolCall: ToolCallDisplay): { added: number; removed: number } {
  const name = toolCall.name;
  if (['write_file', 'create_file'].includes(name)) {
    const content = (toolCall.input.new_content ?? toolCall.input.content ?? '') as string;
    return { added: content.split('\n').length, removed: 0 };
  }
  if (['edit_file', 'replace_lines', 'insert_lines'].includes(name)) {
    const oldStr = (toolCall.input.old_string as string) ?? '';
    const newStr = (toolCall.input.new_string as string) ?? '';
    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;
    return {
      added: Math.max(0, newLines - oldLines),
      removed: Math.max(0, oldLines - newLines),
    };
  }
  return { added: 0, removed: 0 };
}

function getFileNameFromToolCall(toolCall: ToolCallDisplay): string {
  const p = (toolCall.input.path as string) ?? '';
  return p.split(/[\\/]/).pop() ?? p;
}

function getFullPathFromToolCall(toolCall: ToolCallDisplay): string {
  return (toolCall.input.path as string) ?? '';
}

// ─── Compact Tool Call Row ───────────────────────────────────────────────────

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  read_file: FileText,
  search_code: Search,
  find_files: FolderOpen,
  get_file_info: FileText,
  read_multiple_files: FileText,
  list_directory: FolderOpen,
  write_file: FileText,
  create_file: Plus,
  edit_file: Pencil,
  replace_lines: Pencil,
  insert_lines: Plus,
  web_search: Globe,
  web_fetch: Globe,
  run_code: Code2,
  run_terminal_command: Terminal,
  git_status: GitBranch,
  git_diff: GitBranch,
  git_commit: GitBranch,
  git_add: GitBranch,
  git_log: GitBranch,
  git_checkout: GitBranch,
  git_push: GitBranch,
  git_pull: GitBranch,
  git_fetch: GitBranch,
  git_stash: GitBranch,
  git_merge: GitBranch,
  git_reset: GitBranch,
  git_blame: GitBranch,
  git_show: GitBranch,
  activate_skill: Sparkles,
  list_skills: Zap,
  mcp_call: Globe,
  mcp_query: Network,
  database_query: Database,
  delete_file: Trash2,
  rename_file: FileText,
  copy_file: FileText,
  detect_project_type: Zap,
  get_diagnostics: Code2,
  gather_context: FileText,
  drop_context: FileText,
  list_context: FileText,
  manage_tasks: CheckCircle2,
  request_mode_switch: Zap,
  ask_user: Sparkles,
  create_skill: Sparkles,
};

export function CompactToolCallRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';

  const ToolIcon = TOOL_ICON_MAP[toolCall.name] ?? Wrench;
  const fileName = getFileNameFromToolCall(toolCall);
  const fullPath = getFullPathFromToolCall(toolCall);
  const { added, removed } = computeLineDiffCounts(toolCall);
  const isFileEdit = [
    'write_file',
    'create_file',
    'edit_file',
    'replace_lines',
    'insert_lines',
  ].includes(toolCall.name);
  const isFileRead = [
    'read_file',
    'search_code',
    'find_files',
    'get_file_info',
    'read_multiple_files',
    'list_directory',
  ].includes(toolCall.name);
  const isTerminal = /terminal|command/.test(toolCall.name);
  const isWeb = ['web_search', 'web_fetch'].includes(toolCall.name);

  return (
    <div className="agent-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-[3px] text-left transition-colors hover:bg-foreground/[0.03]"
      >
        {/* Status indicator */}
        {isRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
        ) : isDone ? (
          <Check className="h-3 w-3 shrink-0 text-green-400/70" />
        ) : isError ? (
          <X className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <Clock className="h-3 w-3 shrink-0 text-yellow-400/40" />
        )}

        {/* Tool icon */}
        <ToolIcon className="h-3 w-3 shrink-0 text-muted-foreground/35" />

        {/* Label */}
        {isFileEdit || isFileRead ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground/65">
            {fileName || fullPath}
          </span>
        ) : isTerminal ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground/65">
            {(toolCall.input.command as string) ?? ''}
          </span>
        ) : isWeb ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground/65">
            {(toolCall.input.query as string) ?? (toolCall.input.url as string) ?? ''}
          </span>
        ) : (
          <span className="truncate text-[11px] text-foreground/60">
            {getGenericLabel(toolCall.name)}
          </span>
        )}

        {/* Diff counts */}
        {(added > 0 || removed > 0) && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
            {added > 0 && <span className="text-green-400/80">+{added}</span>}
            {removed > 0 && <span className="text-red-400/80">-{removed}</span>}
          </span>
        )}

        {isFileEdit && !added && !removed && isDone && (
          <span className="ml-auto shrink-0 text-[9px] text-green-400/60">applied</span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="agent-fade-in ml-5">
          <ToolCallCard toolCall={toolCall} />
        </div>
      )}
    </div>
  );
}

// ─── ToolCallCard dispatcher ──────────────────────────────────────────────────

interface ToolCallCardProps {
  toolCall: ToolCallDisplay;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const { name } = toolCall;

  if (['write_file', 'create_file', 'edit_file', 'replace_lines', 'insert_lines'].includes(name)) {
    return <FileEditCard toolCall={toolCall} />;
  }
  if (
    [
      'read_file',
      'search_code',
      'find_files',
      'get_file_info',
      'read_multiple_files',
      'list_directory',
    ].includes(name)
  ) {
    return <FileReferenceRow toolCall={toolCall} />;
  }
  if (/terminal|command/.test(name)) {
    return <TerminalCard toolCall={toolCall} />;
  }
  if (['web_search', 'web_fetch'].includes(name)) {
    return <BrowserCard toolCall={toolCall} />;
  }
  if (name === 'run_code') {
    return <RunCodeCard toolCall={toolCall} />;
  }
  return <GenericToolRow toolCall={toolCall} />;
}

// ─── Tool Call Group ──────────────────────────────────────────────────────────

interface ToolCallGroupProps {
  toolCalls: ToolCallDisplay[];
}

export const ToolCallGroup = memo(function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  // spawn_subagent calls are rendered as SubAgentCard in agent-messages.tsx
  const filtered = toolCalls.filter((tc) => tc.name !== 'spawn_subagent');
  if (filtered.length === 0) return null;

  return (
    <div className="agent-fade-in my-1 flex flex-col">
      {filtered.map((tc) => (
        <CompactToolCallRow key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
});
