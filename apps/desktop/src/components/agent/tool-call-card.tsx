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
    ts: 'typescript',  tsx: 'typescript',
    js: 'javascript',  jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript',
    py: 'python',      rs: 'rust',
    css: 'css',        scss: 'scss',    less: 'less',
    html: 'xml',       htm: 'xml',      svg: 'xml',
    json: 'json',
    md: 'markdown',    mdx: 'markdown',
    sh: 'bash',        bash: 'bash',    zsh: 'bash',
    yaml: 'yaml',      yml: 'yaml',
    sql: 'sql',        go: 'go',
    java: 'java',      kt: 'kotlin',
    cpp: 'cpp',        cc: 'cpp',       cxx: 'cpp',
    c: 'c',            h: 'c',          hpp: 'cpp',
    rb: 'ruby',        php: 'php',
    swift: 'swift',    dart: 'dart',
    xml: 'xml',        graphql: 'graphql',
    tf: 'hcl',         hcl: 'hcl',
  };
  return map[ext] ?? '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDuration(startedAt?: number, completedAt?: number): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = completedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── File Edit Card  (write_file / create_file / edit_file) ───────────────────
// Matches the IDE-style block in the image: header row + status line + code block

function FileEditCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const path = (toolCall.input.path as string) ?? '';
  const rawContent = ((toolCall.input.new_string ?? toolCall.input.content ?? '') as string);
  const lang = detectLang(path);
  const isRunning = toolCall.status === 'running';
  const isDone    = toolCall.status === 'success';
  const isError   = toolCall.status === 'error';
  const duration  = formatDuration(toolCall.startedAt, toolCall.completedAt);

  // Syntax-highlight
  const highlightedCode = useMemo(() => {
    if (!rawContent) return '';
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(rawContent, { language: lang, ignoreIllegals: true }).value;
      }
      return escapeHtml(rawContent);
    } catch {
      return escapeHtml(rawContent);
    }
  }, [rawContent, lang]);

  // Status text
  let statusText: string | null = null;
  if (isDone) {
    if (toolCall.name === 'edit_file')        statusText = 'Edit applied successfully.';
    else if (toolCall.name === 'create_file') statusText = 'File created successfully.';
    else                                       statusText = 'Write applied successfully.';
  } else if (isError) {
    statusText = toolCall.error ?? 'Operation failed.';
  }

  const OpIcon: LucideIcon =
    toolCall.name === 'edit_file'   ? Pencil :
    toolCall.name === 'create_file' ? Plus   : FileText;

  return (
    <div className="agent-fade-in my-2 overflow-hidden rounded-lg border border-border/20">
      {/* Running shimmer */}
      {isRunning && <div className="h-[2px] w-full agent-shimmer-bar opacity-30" />}

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/15 bg-surface-raised/30 px-3 py-[7px]">
        <OpIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground/65">{path}</span>
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">{duration}</span>
        )}
      </div>

      {/* Status line */}
      {statusText && (
        <div className={cn(
          'px-3 py-[5px] text-[11px]',
          isError ? 'text-red-400/70' : 'text-muted-foreground/50',
        )}>
          {statusText}
        </div>
      )}

      {/* Code block */}
      {rawContent && (
        <div className="bg-[#0d1117]/80">
          <pre className="max-h-[280px] overflow-auto px-4 py-3 text-[11.5px] leading-[1.7] select-text cursor-text">
            <code
              className={cn('hljs', lang && `language-${lang}`)}
              dangerouslySetInnerHTML={{ __html: highlightedCode || escapeHtml(rawContent) }}
            />
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── File Reference Row  (read_file / search_code) ────────────────────────────
// Single-line reference: icon + path, no card

function FileReferenceRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const path = (
    (toolCall.input.path as string) ??
    (toolCall.input.query as string) ??
    ''
  );
  const isRunning = toolCall.status === 'running';

  return (
    <div className="agent-fade-in flex items-center gap-2 py-[5px] pl-0.5">
      {isRunning ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
      ) : (
        <Search className="h-3 w-3 shrink-0 text-muted-foreground/35" />
      )}
      <span className="font-mono text-[11px] text-muted-foreground/55 truncate">{path}</span>
    </div>
  );
}

// ─── Terminal Card  (run_terminal_command / *command*) ────────────────────────

function TerminalCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const command  = (toolCall.input.command as string) ?? '';
  const isRunning = toolCall.status === 'running';
  const isDone    = toolCall.status === 'success';
  const isError   = toolCall.status === 'error';
  const duration  = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="agent-fade-in my-2 overflow-hidden rounded-lg border border-border/20">
      {isRunning && <div className="h-[2px] w-full agent-shimmer-bar opacity-30" />}

      {/* Header */}
      <div className="flex items-center gap-2 bg-surface-raised/30 px-3 py-[7px]">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-green-400/50" />
        <span className="flex-1 truncate font-mono text-[11px] text-foreground/65">{command}</span>
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">{duration}</span>
        )}
        {isRunning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 shrink-0" />}
        {isError && (
          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-500/15">
            <X className="h-2 w-2 text-red-400" />
          </div>
        )}
        {isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 hover:bg-white/[0.03] hover:text-muted-foreground/70 transition-colors"
          >
            {showOutput ? 'hide' : 'output'}
          </button>
        )}
        {/* Jump to agent terminal */}
        <button
          onClick={() => {
            const agentSession = useTerminalStore.getState().getAgentSession();
            if (agentSession) {
              useTerminalStore.getState().setActiveSession(agentSession.id);
            }
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
          title="Jump to agent terminal"
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </div>

      {/* Output */}
      {showOutput && toolCall.output && (
        <div className="bg-[#0d1117]/80 border-t border-border/15">
          <pre className="max-h-[200px] overflow-auto px-4 py-3 text-[11px] leading-[1.65] font-mono text-green-300/70 select-text cursor-text">
            {toolCall.output}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <div className="border-t border-red-500/10 bg-red-950/10 px-4 py-2">
          <pre className="text-[11px] font-mono text-red-300/70 whitespace-pre-wrap">{toolCall.error}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Browser Card  (web_search / web_fetch) ─────────────────────────────────

function BrowserCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const isRunning = toolCall.status === 'running';
  const isDone    = toolCall.status === 'success';
  const isError   = toolCall.status === 'error';
  const duration  = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const [showOutput, setShowOutput] = useState(false);

  const query = (toolCall.input.query as string) ?? '';
  const url   = (toolCall.input.url as string) ?? '';
  const label = toolCall.name === 'web_search' ? 'Web Search' : 'Web Fetch';
  const target = query || url || '';

  return (
    <div className="agent-fade-in my-2 overflow-hidden rounded-lg border border-border/20">
      {isRunning && <div className="h-[2px] w-full agent-shimmer-bar opacity-30" />}

      {/* Header */}
      <div className="flex items-center gap-2 bg-surface-raised/30 px-3 py-[7px]">
        <Globe className="h-3.5 w-3.5 shrink-0 text-sky-400/50" />
        <span className="text-[11px] font-medium text-foreground/65">{label}</span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground/55">{target}</span>
        {duration && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/30">{duration}</span>
        )}
        {isRunning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 shrink-0" />}
        {isError && (
          <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-500/15">
            <X className="h-2 w-2 text-red-400" />
          </div>
        )}
        {isDone && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground/40 hover:bg-white/[0.03] hover:text-muted-foreground/70 transition-colors"
          >
            {showOutput ? 'hide' : 'results'}
          </button>
        )}
      </div>

      {/* Output */}
      {showOutput && toolCall.output && (
        <div className="bg-[#0d1117]/80 border-t border-border/15">
          <pre className="max-h-[300px] overflow-auto px-4 py-3 text-[11px] leading-[1.65] font-mono text-foreground/70 select-text cursor-text">
            {toolCall.output}
          </pre>
        </div>
      )}
      {isError && toolCall.error && (
        <div className="border-t border-red-500/10 bg-red-950/10 px-4 py-2">
          <pre className="text-[11px] font-mono text-red-300/70 whitespace-pre-wrap">{toolCall.error}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Generic Tool Row  (git, skill, mcp, etc.) ────────────────────────────────

const GENERIC_ICONS: Record<string, LucideIcon> = {
  git_status:      GitBranch,
  git_diff:        GitBranch,
  git_commit:      GitBranch,
  activate_skill:  Sparkles,
  list_skills:     Zap,
  mcp_call:        Globe,
  mcp_query:       Network,
  database_query:  Database,
  list_directory:  FolderOpen,
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
  const isRunning = toolCall.status === 'running';
  const isDone    = toolCall.status === 'success';
  const isError   = toolCall.status === 'error';
  const summary   = getGenericSummary(toolCall);

  return (
    <div className="agent-fade-in flex items-center gap-2 py-[5px] pl-0.5">
      {isRunning ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/40" />
      ) : isDone ? (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500/10">
          <Check className="h-2 w-2 text-green-400" />
        </div>
      ) : isError ? (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500/10">
          <X className="h-2 w-2 text-red-400" />
        </div>
      ) : (
        <Clock className="h-3 w-3 text-yellow-400/40 shrink-0" />
      )}
      <ToolIcon className="h-3 w-3 shrink-0 text-muted-foreground/40" />
      <span className="text-[11px] text-foreground/60">{getGenericLabel(toolCall.name)}</span>
      {summary && (
        <span className="ml-0.5 max-w-[160px] truncate font-mono text-[10px] text-muted-foreground/35">{summary}</span>
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

  if (['write_file', 'create_file', 'edit_file'].includes(name)) {
    return <FileEditCard toolCall={toolCall} />;
  }
  if (['read_file', 'search_code'].includes(name)) {
    return <FileReferenceRow toolCall={toolCall} />;
  }
  if (/terminal|command/.test(name)) {
    return <TerminalCard toolCall={toolCall} />;
  }
  if (['web_search', 'web_fetch'].includes(name)) {
    return <BrowserCard toolCall={toolCall} />;
  }
  return <GenericToolRow toolCall={toolCall} />;
}

// ─── Tool Call Group ──────────────────────────────────────────────────────────
// Transparent wrapper — no header card, just renders tool calls inline

interface ToolCallGroupProps {
  toolCalls: ToolCallDisplay[];
}

export const ToolCallGroup = memo(function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  return (
    <div className="agent-fade-in">
      {toolCalls.map((tc) => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
});
