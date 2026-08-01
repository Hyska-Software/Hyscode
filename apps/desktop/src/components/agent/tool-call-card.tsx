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
  Maximize2,
  Minimize2,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { StatusIcon } from '@hyscode/ui';
import type { AgentStatus } from '@hyscode/ui';
import { useTerminalStore } from '@/stores/terminal-store';
import { useLayoutStore } from '@/stores/layout-store';
import type { ToolCallDisplay } from '@/stores/agent-store';
import { sanitizeTerminalOutput } from './terminal-output';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectLang(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript', py: 'python', rs: 'rust',
    css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', svg: 'xml',
    json: 'json', md: 'markdown', mdx: 'markdown', sh: 'bash', bash: 'bash',
    zsh: 'bash', yaml: 'yaml', yml: 'yaml', sql: 'sql', go: 'go',
    java: 'java', kt: 'kotlin', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
    c: 'c', h: 'c', hpp: 'cpp', rb: 'ruby', php: 'php', swift: 'swift',
    dart: 'dart', xml: 'xml', graphql: 'graphql', tf: 'hcl', hcl: 'hcl',
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

// ─── Status mapper ─────────────────────────────────────────────────────────────

function mapStatus(tc: ToolCallDisplay): AgentStatus {
  switch (tc.status) {
    case 'pending':
    case 'approved':
      return 'pending';
    case 'running':
    case 'cancelling':
      return 'running';
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
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
  let i = 0, j = 0;
  let oldNum = 1, newNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: 'ctx', line: oldLines[i], oldNum, newNum });
      i++; j++; oldNum++; newNum++;
    } else {
      const nextOldMatch = j + 1 < newLines.length && i < oldLines.length && oldLines[i] === newLines[j + 1];
      const nextNewMatch = i + 1 < oldLines.length && j < newLines.length && oldLines[i + 1] === newLines[j];

      if (nextOldMatch && !nextNewMatch) {
        result.push({ type: 'add', line: newLines[j], newNum });
        j++; newNum++;
      } else if (nextNewMatch && !nextOldMatch) {
        result.push({ type: 'del', line: oldLines[i], oldNum });
        i++; oldNum++;
      } else {
        if (i < oldLines.length) { result.push({ type: 'del', line: oldLines[i], oldNum }); i++; oldNum++; }
        if (j < newLines.length) { result.push({ type: 'add', line: newLines[j], newNum }); j++; newNum++; }
      }
    }
  }
  return result;
}

function InlineDiff({ oldText, newText, lang }: { oldText: string; newText: string; lang: string }) {
  const lines = useMemo(() => computeInlineDiff(oldText, newText), [oldText, newText]);
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Diff ({lines.filter((l) => l.type !== 'ctx').length} changes)</span>
      </button>
      {expanded && (
        <div className="max-h-[320px] overflow-auto rounded-md bg-muted/50">
          <table className="w-full font-mono text-[11px] leading-[1.6]">
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className={cn(
                  l.type === 'add' && 'bg-success/10',
                  l.type === 'del' && 'bg-destructive/10',
                )}>
                  <td className="w-8 select-none pr-2 text-right text-muted-foreground">{l.oldNum ?? ''}</td>
                  <td className="w-8 select-none pr-2 text-right text-muted-foreground">{l.newNum ?? ''}</td>
                  <td className="w-4 select-none text-center">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</td>
                  <td className="pr-4">
                    <span
                      className={cn(
                        l.type === 'add' && 'text-success',
                        l.type === 'del' && 'text-destructive',
                        l.type === 'ctx' && 'text-foreground/60',
                      )}
                      dangerouslySetInnerHTML={{ __html: l.type === 'ctx' ? escapeHtml(l.line) : highlightCode(l.line, lang) }}
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

// ─── File Edit Card ────────────────────────────────────────────────────────────

function FileEditCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const path = (toolCall.input.path as string) ?? '';
  const rawContent = (toolCall.input.new_string ?? toolCall.input.new_content ?? toolCall.input.content ?? '') as string;
  const oldContent = (toolCall.input.old_string as string) ?? '';
  const lang = detectLang(path);
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const isEdit = toolCall.name === 'edit_file';
  const isCreate = toolCall.name === 'create_file';

  const highlightedCode = useMemo(() => highlightCode(rawContent, lang), [rawContent, lang]);

  let statusText: string | null = null;
  if (isDone) {
    if (isEdit) statusText = 'Edit applied successfully.';
    else if (isCreate) statusText = 'File created successfully.';
    else statusText = 'Write applied successfully.';
  } else if (isError) {
    statusText = toolCall.error ?? 'Operation failed.';
  }

  const OpIcon: LucideIcon = isEdit ? Pencil : isCreate ? Plus : FileText;

  return (
    <div className="agent-fade-in my-2 overflow-hidden">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}
      <div className="flex items-center gap-2 py-1.5">
        <OpIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{path}</span>
        {isCreate && <span className="shrink-0 rounded px-1 py-[1px] text-[9px] font-medium text-success">NEW</span>}
        {duration && <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{duration}</span>}
      </div>
      {statusText && (
        <div className={cn('py-1 text-[11px]', isError ? 'text-destructive' : 'text-muted-foreground')}>
          {statusText}
        </div>
      )}
      {isEdit && oldContent && isDone ? (
        <InlineDiff oldText={oldContent} newText={rawContent} lang={lang} />
      ) : rawContent ? (
        <div className="rounded-md bg-muted/50">
          <pre className="max-h-[280px] cursor-text select-text overflow-auto px-4 py-3 text-[11.5px] leading-[1.7]">
            <code className={cn('hljs', lang && `language-${lang}`)} dangerouslySetInnerHTML={{ __html: highlightedCode || escapeHtml(rawContent) }} />
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// ─── File Reference Row ────────────────────────────────────────────────────────

function FileReferenceRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const path = (toolCall.input.path as string) ?? (toolCall.input.query as string) ?? '';
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const [showOutput, setShowOutput] = useState(true);
  const hasOutput = !!toolCall.output && toolCall.output.length > 0;
  const isReadFile = toolCall.name === 'read_file';
  const isSearch = toolCall.name === 'search_code';
  const isFind = toolCall.name === 'find_files';

  const outputPreview = useMemo(() => {
    if (!hasOutput) return null;
    const lines = toolCall.output!.split('\n');
    if (isSearch || isFind) return lines.slice(0, 8).join('\n') + (lines.length > 8 ? `\n... ${lines.length - 8} more lines` : '');
    return lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n... ${lines.length - 6} more lines` : '');
  }, [hasOutput, toolCall.output, isSearch, isFind]);

  return (
    <div className="agent-fade-in my-0.5">
      <div className="flex items-center gap-2 py-1">
        {isRunning ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" /> : isError ? <X className="h-3 w-3 shrink-0 text-destructive" /> : isDone ? <CheckCircle2 className="h-3 w-3 shrink-0 text-success" /> : <Clock className="h-3 w-3 shrink-0 text-warning" />}
        {isReadFile ? <FileText className="h-3 w-3 shrink-0 text-muted-foreground" /> : isSearch ? <Search className="h-3 w-3 shrink-0 text-muted-foreground" /> : isFind ? <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" /> : <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
        {hasOutput && isDone && (
          <button onClick={() => setShowOutput(!showOutput)} className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {showOutput ? 'hide' : 'preview'}
          </button>
        )}
      </div>
      {showOutput && outputPreview && (
        <div className="rounded-md bg-muted/50">
          <pre className="max-h-[200px] cursor-text select-text overflow-auto px-4 py-2 font-mono text-[11px] leading-[1.6] text-foreground/60">{outputPreview}</pre>
        </div>
      )}
      {isError && toolCall.error && <div className="py-1 text-[10px] text-destructive">{toolCall.error}</div>}
    </div>
  );
}

// ─── Terminal Card ─────────────────────────────────────────────────────────────

function TerminalCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const command = (toolCall.input.command as string) ?? (toolCall.name === 'respond_terminal_input' ? `Respond: ${String(toolCall.input.input ?? '')}` : '');
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isWaiting = toolCall.terminalState === 'awaiting_input';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const rawVisibleOutput = isRunning ? toolCall.liveOutput : toolCall.output;
  const visibleOutput = sanitizeTerminalOutput(rawVisibleOutput);
  const outputVisible = Boolean((isRunning || isWaiting || showOutput) && visibleOutput);
  const lineCount = visibleOutput ? visibleOutput.split('\n').length : 0;

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCommandCopied(true);
      setTimeout(() => setCommandCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (!isRunning || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [isRunning, visibleOutput]);

  const focusTerminal = () => {
    if (!toolCall.terminalId) return;
    const layout = useLayoutStore.getState();
    layout.setTerminalVisible(true);
    if (layout.terminalLocation === 'sidebar') layout.setSidebarActiveTab('terminal');
    useTerminalStore.getState().setActiveSession(toolCall.terminalId);
  };

  return (
    <div className="agent-fade-in my-1.5">
      <div className="flex items-center gap-2 py-1.5">
        <Terminal className={cn('h-3.5 w-3.5 shrink-0', isRunning ? 'text-emerald-400' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{command}</span>
        {command && (
          <button
            onClick={handleCopyCommand}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Copy command"
          >
            {commandCopied ? (
              <Check className="h-2.5 w-2.5 text-success" />
            ) : (
              <Copy className="h-2.5 w-2.5" />
            )}
          </button>
        )}
        {duration && <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{duration}</span>}
        {isRunning && (
          <span className="flex shrink-0 items-center gap-1.5 text-[9px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Running
          </span>
        )}
        {isWaiting && <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-400">Waiting for input</span>}
        {isError && <X className="h-3 w-3 shrink-0 text-destructive" />}
        {isDone && (
          <button onClick={() => setShowOutput(!showOutput)} className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
        <button onClick={() => focusTerminal()} className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground" title="Jump to agent terminal">
          <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </div>
      {outputVisible && (
        <div className="ml-[6px] border-l border-border pl-[13px]">
          <div className="flex h-7 items-center gap-2 text-[9px] text-muted-foreground">
            <span className="font-mono tabular-nums">{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
            <span className="flex-1" />
            <button
              type="button" onClick={() => setIsExpanded((e) => !e)} aria-expanded={isExpanded}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          <pre ref={outputRef} className={cn(
            'cursor-text select-text overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-[1.7] text-foreground/70 transition-[max-height] duration-300',
            isExpanded ? 'max-h-[60vh] min-h-64' : 'max-h-44',
          )}>{visibleOutput}</pre>
        </div>
      )}
      {isError && toolCall.error && <pre className="whitespace-pre-wrap py-1 font-mono text-[11px] text-destructive">{toolCall.error}</pre>}
    </div>
  );
}

// ─── Other card types ──────────────────────────────────────────────────────────

function RunCodeCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const language = (toolCall.input.language as string) ?? '';
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(true);
  const code = (toolCall.input.code as string) ?? '';
  const codePreview = code.split('\n').slice(0, 3).join('\n') + (code.split('\n').length > 3 ? '...' : '');
  const highlighted = useMemo(() => highlightCode(codePreview, language), [codePreview, language]);

  return (
    <div className="agent-fade-in my-2">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}
      <div className="flex items-center gap-2 py-1.5">
        <Code2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-[11px] font-medium text-foreground">Run {language}</span>
        {duration && <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{duration}</span>}
        {isRunning && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
        {isError && <X className="h-3 w-3 shrink-0 text-destructive" />}
        {isDone && (
          <button onClick={() => setShowOutput(!showOutput)} className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
      </div>
      <div className="rounded-md bg-muted/50 px-3 py-2">
        <pre className="cursor-text select-text font-mono text-[10px] leading-[1.6] text-foreground/50">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
      {showOutput && toolCall.output && (
        <div className="mt-1 rounded-md bg-muted/50">
          <pre className="max-h-[200px] cursor-text select-text overflow-auto px-4 py-3 font-mono text-[11px] leading-[1.65] text-foreground/70">{toolCall.output}</pre>
        </div>
      )}
      {isError && toolCall.error && <pre className="whitespace-pre-wrap py-1 font-mono text-[11px] text-destructive">{toolCall.error}</pre>}
    </div>
  );
}

function BrowserCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(true);
  const query = (toolCall.input.query as string) ?? '';
  const url = (toolCall.input.url as string) ?? '';
  const label = toolCall.name === 'web_search' ? 'Web Search' : 'Web Fetch';
  const target = query || url || '';

  return (
    <div className="agent-fade-in my-2">
      {isRunning && <div className="agent-shimmer-bar h-[1.5px] w-full opacity-40" />}
      <div className="flex items-center gap-2 py-1.5">
        <Globe className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{target}</span>
        {duration && <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{duration}</span>}
        {isRunning && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
        {isError && <X className="h-3 w-3 shrink-0 text-destructive" />}
        {isDone && (
          <button onClick={() => setShowOutput(!showOutput)} className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {showOutput ? 'hide' : 'results'}
          </button>
        )}
      </div>
      {showOutput && toolCall.output && (
        <div className="rounded-md bg-muted/50">
          <pre className="max-h-[300px] cursor-text select-text overflow-auto px-4 py-3 font-mono text-[11px] leading-[1.65] text-foreground/70">{toolCall.output}</pre>
        </div>
      )}
      {isError && toolCall.error && <pre className="whitespace-pre-wrap py-1 font-mono text-[11px] text-destructive">{toolCall.error}</pre>}
    </div>
  );
}

const GENERIC_ICONS: Record<string, LucideIcon> = {
  git_status: GitBranch, git_diff: GitBranch, git_commit: GitBranch, git_add: GitBranch, git_log: GitBranch,
  git_checkout: GitBranch, git_push: GitBranch, git_pull: GitBranch, git_fetch: GitBranch, git_stash: GitBranch,
  git_merge: GitBranch, git_reset: GitBranch, git_blame: GitBranch, git_show: GitBranch,
  activate_skill: Sparkles, list_skills: Zap, mcp_call: Globe, mcp_query: Network,
  database_query: Database, list_directory: FolderOpen, delete_file: Trash2, rename_file: FileText,
  copy_file: FileText, get_file_info: FileText, find_files: FolderOpen, read_multiple_files: FileText,
  run_code: Code2, detect_project_type: Zap, get_diagnostics: Code2,
  gather_context: FileText, drop_context: FileText, list_context: FileText,
  manage_tasks: CheckCircle2, request_mode_switch: Zap, ask_user: Sparkles, create_skill: Sparkles,
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
  return '';
}

function GenericToolRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const ToolIcon = GENERIC_ICONS[toolCall.name] ?? Wrench;
  const isRunning = toolCall.status === 'running' || toolCall.status === 'cancelling';
  const isDone = toolCall.status === 'success';
  const isError = toolCall.status === 'error';
  const summary = getGenericSummary(toolCall);
  const [showOutput, setShowOutput] = useState(true);
  const hasOutput = !!toolCall.output && toolCall.output.length > 0;

  return (
    <div className="agent-fade-in my-0.5">
      <div className="flex items-center gap-2 py-1">
        {isRunning ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" /> : isDone ? <Check className="h-3 w-3 shrink-0 text-success" /> : isError ? <X className="h-3 w-3 shrink-0 text-destructive" /> : <Clock className="h-3 w-3 shrink-0 text-warning" />}
        <ToolIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-[11px] text-foreground/60">{getGenericLabel(toolCall.name)}</span>
        {summary && <span className="ml-0.5 max-w-[160px] truncate font-mono text-[10px] text-muted-foreground">{summary}</span>}
        {hasOutput && isDone && (
          <button onClick={() => setShowOutput(!showOutput)} className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
      </div>
      {showOutput && hasOutput && (
        <div className="rounded-md bg-muted/50">
          <pre className="max-h-[180px] cursor-text select-text overflow-auto px-4 py-2 font-mono text-[11px] leading-[1.6] text-foreground/60">{toolCall.output}</pre>
        </div>
      )}
      {isError && toolCall.error && <div className="py-1 text-[10px] text-destructive">{toolCall.error}</div>}
    </div>
  );
}

// ─── Helpers for tool call identity ────────────────────────────────────────────

const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  read_file: FileText, search_code: Search, find_files: FolderOpen, get_file_info: FileText,
  read_multiple_files: FileText, list_directory: FolderOpen,
  write_file: FileText, create_file: Plus, edit_file: Pencil, replace_lines: Pencil, insert_lines: Plus,
  web_search: Globe, web_fetch: Globe, run_code: Code2, run_terminal_command: Terminal,
  git_status: GitBranch, git_diff: GitBranch, git_commit: GitBranch, git_add: GitBranch, git_log: GitBranch,
  git_checkout: GitBranch, git_push: GitBranch, git_pull: GitBranch, git_fetch: GitBranch, git_stash: GitBranch,
  git_merge: GitBranch, git_reset: GitBranch, git_blame: GitBranch, git_show: GitBranch,
  activate_skill: Sparkles, list_skills: Zap, mcp_call: Globe, mcp_query: Network,
  database_query: Database, delete_file: Trash2, rename_file: FileText, copy_file: FileText,
  detect_project_type: Zap, get_diagnostics: Code2, gather_context: FileText, drop_context: FileText,
  list_context: FileText, manage_tasks: CheckCircle2, request_mode_switch: Zap, ask_user: Sparkles,
  create_skill: Sparkles,
};

function getFileNameFromToolCall(toolCall: ToolCallDisplay): string {
  const p = (toolCall.input.path as string) ?? '';
  return p.split(/[\\/]/).pop() ?? p;
}

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
    return { added: Math.max(0, newLines - oldLines), removed: Math.max(0, oldLines - newLines) };
  }
  return { added: 0, removed: 0 };
}

// ─── Tool Call Card dispatcher ───────────────────────────────────────────────

function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const { name } = toolCall;
  if (['write_file', 'create_file', 'edit_file', 'replace_lines', 'insert_lines'].includes(name)) return <FileEditCard toolCall={toolCall} />;
  if (['read_file', 'search_code', 'find_files', 'get_file_info', 'read_multiple_files', 'list_directory'].includes(name)) return <FileReferenceRow toolCall={toolCall} />;
  if (/terminal|command/.test(name)) return <TerminalCard toolCall={toolCall} />;
  if (['web_search', 'web_fetch'].includes(name)) return <BrowserCard toolCall={toolCall} />;
  if (name === 'run_code') return <RunCodeCard toolCall={toolCall} />;
  return <GenericToolRow toolCall={toolCall} />;
}

// ─── Compact Tool Call Row (Aurora ToolCall) ──────────────────────────────────

export const CompactToolCallRow = memo(function CompactToolCallRow({
  toolCall,
}: {
  toolCall: ToolCallDisplay;
}) {
  const [expanded, setExpanded] = useState(false);
  const ToolIcon = TOOL_ICON_MAP[toolCall.name] ?? Wrench;
  const fileName = getFileNameFromToolCall(toolCall);
  const { added, removed } = computeLineDiffCounts(toolCall);
  const isFileEdit = ['write_file', 'create_file', 'edit_file', 'replace_lines', 'insert_lines'].includes(toolCall.name);
  const isFileRead = ['read_file', 'search_code', 'find_files', 'get_file_info', 'read_multiple_files', 'list_directory'].includes(toolCall.name);
  const isTerminal = /terminal|command/.test(toolCall.name);
  const isWeb = ['web_search', 'web_fetch'].includes(toolCall.name);
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const status = mapStatus(toolCall);

  const summary = isFileEdit || isFileRead
    ? fileName
    : isTerminal ? ((toolCall.input.command as string) ?? '') : isWeb ? ((toolCall.input.query as string) ?? (toolCall.input.url as string) ?? '') : getGenericSummary(toolCall);

  const displayName = isFileEdit || isFileRead
    ? (isFileEdit ? (toolCall.name === 'create_file' ? 'Create' : toolCall.name === 'edit_file' ? 'Edit' : 'Write') : 'Read')
    : isTerminal ? 'Terminal' : isWeb ? (toolCall.name === 'web_search' ? 'Web Search' : 'Web Fetch') : toolCall.name === 'run_code' ? 'Run Code' : getGenericLabel(toolCall.name);

  return (
    <div className="agent-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-center gap-2 rounded-lg bg-card px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60"
      >
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="text-muted-foreground [&_svg]:size-3.5"><ToolIcon /></span>
        <span className="font-mono text-xs font-medium text-foreground">{displayName}</span>
        {summary && <span className="truncate font-mono text-xs text-muted-foreground">{summary}</span>}
        <span className="ml-auto flex items-center gap-2">
          {(added > 0 || removed > 0) && (
            <span className="flex items-center gap-1 text-xs tabular-nums">
              {added > 0 && <span className="text-success">+{added}</span>}
              {removed > 0 && <span className="text-destructive">-{removed}</span>}
            </span>
          )}
          {isFileEdit && !added && !removed && status === 'success' && (
            <span className="text-xs text-success">applied</span>
          )}
          {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
          <StatusIcon status={status} />
        </span>
      </button>
      {expanded && (
        <div className="agent-fade-in ml-5">
          <ToolCallCard toolCall={toolCall} />
        </div>
      )}
      {isTerminal && status === 'running' && toolCall.liveOutput && !expanded && (
        <pre className="ml-5 max-h-24 overflow-hidden whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 font-mono text-[10px] leading-relaxed text-foreground/55">
          {toolCall.liveOutput
            .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
            .split(/\r?\n/)
            .filter((line) => !line.includes('__HYSCODE_BEGIN_') && !line.includes('__HYSCODE_END_'))
            .join('\n')
            .slice(-4_000)}
        </pre>
      )}
    </div>
  );
});

// ─── Tool Call Group ──────────────────────────────────────────────────────────

export const ToolCallGroup = memo(function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  const filtered = toolCalls.filter((tc) => tc.name !== 'spawn_subagent');
  if (filtered.length === 0) return null;
  return (
    <div className="agent-fade-in my-1 flex flex-col gap-1">
      {filtered.map((tc) => (
        <CompactToolCallRow key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
});

interface ToolCallGroupProps {
  toolCalls: ToolCallDisplay[];
}
