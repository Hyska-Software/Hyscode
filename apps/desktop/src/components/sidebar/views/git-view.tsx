import { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, FileText, Plus, Minus, Pencil, Loader2, AlertTriangle } from 'lucide-react';
import { useFileStore } from '../../../stores';

interface GitFileStatus {
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  path: string;
}

const STATUS_COLORS: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
  R: 'text-blue-400',
  U: 'text-orange-400',
  '?': 'text-muted-foreground',
};

const STATUS_ICONS: Record<string, typeof Pencil> = {
  M: Pencil,
  A: Plus,
  D: Minus,
  R: FileText,
  U: AlertTriangle,
  '?': Plus,
};

function parseGitStatus(output: string): GitFileStatus[] {
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const statusChar = line.substring(0, 2).trim();
      const filePath = line.substring(3).trim();
      let status: GitFileStatus['status'] = 'M';
      if (statusChar === '??') status = '?';
      else if (statusChar.includes('A')) status = 'A';
      else if (statusChar.includes('D')) status = 'D';
      else if (statusChar.includes('R')) status = 'R';
      else if (statusChar.includes('U')) status = 'U';
      else if (statusChar.includes('M')) status = 'M';
      return { status, path: filePath };
    });
}

async function runGit(rootPath: string, args: string[]): Promise<string> {
  // Use Tauri shell plugin to run git
  const { Command } = await import('@tauri-apps/plugin-shell');
  const cmd = Command.create('git', args, { cwd: rootPath });
  const output = await cmd.execute();
  if (output.code !== 0) {
    throw new Error(output.stderr || `git exited with code ${output.code}`);
  }
  return output.stdout;
}

export function GitView() {
  const rootPath = useFileStore((s) => s.rootPath);
  const [branch, setBranch] = useState<string>('');
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(true);

  const refresh = useCallback(async () => {
    if (!rootPath) return;

    setIsLoading(true);
    setError(null);

    try {
      const branchOutput = await runGit(rootPath, ['branch', '--show-current']);
      setBranch(branchOutput.trim() || 'HEAD');

      const statusOutput = await runGit(rootPath, ['status', '--porcelain']);
      setFiles(parseGitStatus(statusOutput));
      setIsGitRepo(true);
    } catch (err: any) {
      if (err.message?.includes('not a git repository')) {
        setIsGitRepo(false);
      } else {
        setError(err.message || 'Git error');
      }
    } finally {
      setIsLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <GitBranch className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-xs">Open a folder to view source control</p>
      </div>
    );
  }

  if (!isGitRepo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <GitBranch className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-xs">Not a Git repository</p>
        <p className="mt-1 text-[10px] opacity-60">Initialize with `git init`</p>
      </div>
    );
  }

  const staged = files.filter((f) => f.status === 'A');
  const changed = files.filter((f) => f.status !== 'A' && f.status !== '?');
  const untracked = files.filter((f) => f.status === '?');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between bg-surface-raised px-2 py-1">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-primary" />
          <span className="text-[11px] font-medium text-foreground">{branch}</span>
        </div>
        <button
          onClick={refresh}
          className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Refresh"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-2 py-1 text-[10px] text-destructive bg-destructive/5">
          {error}
        </div>
      )}

      {/* File lists */}
      <div className="flex-1 overflow-auto">
        {files.length === 0 && !isLoading && (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            No changes detected
          </div>
        )}

        {changed.length > 0 && (
          <FileGroup title="Changes" files={changed} rootPath={rootPath} />
        )}
        {staged.length > 0 && (
          <FileGroup title="Staged" files={staged} rootPath={rootPath} />
        )}
        {untracked.length > 0 && (
          <FileGroup title="Untracked" files={untracked} rootPath={rootPath} />
        )}
      </div>
    </div>
  );
}

function FileGroup({
  title,
  files,
  rootPath: _rootPath,
}: {
  title: string;
  files: GitFileStatus[];
  rootPath: string;
}) {
  return (
    <div className="">
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="ml-1.5 text-[10px] font-normal">{files.length}</span>
      </div>
      {files.map((f) => {
        const fileName = f.path.split(/[\\/]/).pop() ?? f.path;
        const Icon = STATUS_ICONS[f.status] ?? FileText;
        return (
          <div
            key={f.path}
            className="flex items-center gap-1.5 px-2 py-[3px] text-[11px] hover:bg-muted transition-colors"
          >
            <Icon className={`h-3 w-3 shrink-0 ${STATUS_COLORS[f.status] ?? 'text-muted-foreground'}`} />
            <span className="truncate text-foreground">{fileName}</span>
            <span className={`ml-auto shrink-0 text-[10px] font-mono ${STATUS_COLORS[f.status]}`}>
              {f.status === '?' ? 'U' : f.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
