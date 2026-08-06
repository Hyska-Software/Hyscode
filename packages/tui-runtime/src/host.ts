import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawn as spawnPtyProcess, type IDisposable, type IPty } from './pty';
import type { CliDataStore } from './data-store';
import type { SharedKeyStore } from './config';
import type { GitSummary } from './protocol';

type Listener = (payload: unknown) => void;

type PtyChunk = {
  sequence: number;
  data: string;
};

type PtySession = {
  id: string;
  terminal: IPty;
  dataSubscription: IDisposable;
  exitSubscription: IDisposable;
  chunks: PtyChunk[];
  sequence: number;
  outputSize: number;
  alive: boolean;
  exitCode: number | null;
};

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const MAX_PTY_OUTPUT = 512_000;
const MAX_SEARCH_FILES = 20_000;
const DEFAULT_COMMAND_TIMEOUT = 120_000;

export class CliHost {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly ptys = new Map<string, PtySession>();
  private readonly remotePtys = new Set<string>();

  constructor(
    private readonly workspacePath: string,
    private readonly dataStore: CliDataStore,
    private readonly keyStore: SharedKeyStore,
    private readonly requestPty?: (command: string, args: Record<string, unknown>) => Promise<unknown>,
  ) {}

  async shutdown(): Promise<void> {
    if (this.requestPty) {
      await Promise.all(Array.from(this.remotePtys, async (id) => {
        await this.requestPty?.('pty_kill', { ptyId: id }).catch(() => undefined);
      }));
      this.remotePtys.clear();
    }
    await Promise.all(Array.from(this.ptys.keys(), (id) => this.killPty(id)));
    this.ptys.clear();
  }

  async listen(event: string, handler: Listener): Promise<() => void> {
    const handlers = this.listeners.get(event) ?? new Set<Listener>();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.listeners.delete(event);
    };
  }

  emitExternal(event: string, payload: unknown): void {
    this.emit(event, payload);
  }

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    if (command.startsWith('db_')) return this.dataStore.invoke<T>(command, args);

    switch (command) {
      case 'get_home_dir':
        return os.homedir() as T;
      case 'read_file':
        return readFile(String(args.path ?? ''), 'utf8') as Promise<T>;
      case 'write_file':
        await this.writeText(String(args.path ?? ''), String(args.content ?? ''));
        return undefined as T;
      case 'create_file':
        await this.writeText(String(args.path ?? ''), String(args.content ?? ''));
        return undefined as T;
      case 'delete_path':
        await rm(String(args.path ?? ''), { recursive: true, force: false });
        return undefined as T;
      case 'rename_path':
        await mkdir(path.dirname(String(args.to ?? '')), { recursive: true });
        await rename(String(args.from ?? ''), String(args.to ?? ''));
        return undefined as T;
      case 'copy_path':
        await mkdir(path.dirname(String(args.to ?? '')), { recursive: true });
        await copyFile(String(args.from ?? ''), String(args.to ?? ''));
        return undefined as T;
      case 'create_directory':
        await mkdir(String(args.path ?? ''), { recursive: true });
        return undefined as T;
      case 'stat_path':
        return this.statPath(String(args.path ?? '')) as T;
      case 'list_dir':
      case 'list_dir_all':
      case 'list_dir_with_stats':
        return this.listDirectory(command, args) as T;
      case 'search_files':
        return this.searchFiles(args) as T;
      case 'find_files':
        return this.findFiles(args) as T;
      case 'get_diagnostics':
        return this.getDiagnostics(args) as T;
      case 'run_code':
        return this.runCode(args) as T;
      case 'web_fetch':
        return this.webFetch(args) as T;
      case 'web_search':
        return this.webSearch(args) as T;
      case 'keychain_get':
        return (await this.keyStore.get(String(args.account ?? ''))) as T;
      case 'keychain_set':
        await this.keyStore.set(String(args.account ?? ''), String(args.password ?? ''));
        return undefined as T;
      case 'keychain_delete':
        await this.keyStore.delete(String(args.account ?? ''));
        return undefined as T;
      case 'keychain_has':
        return ((await this.keyStore.get(String(args.account ?? ''))) !== null) as T;
      case 'pty_spawn':
        if (this.requestPty) {
          const id = String(await this.requestPty('pty_spawn', args));
          this.remotePtys.add(id);
          return id as T;
        }
        return this.spawnPty(args) as T;
      case 'pty_write':
        if (this.requestPty) {
          await this.requestPty('pty_write', args);
          return undefined as T;
        }
        this.writePty(String(args.ptyId ?? args.id ?? ''), String(args.data ?? ''));
        return undefined as T;
      case 'pty_resize':
        if (this.requestPty) {
          await this.requestPty('pty_resize', args);
          return undefined as T;
        }
        this.resizePty(
          String(args.ptyId ?? args.id ?? ''),
          numberValue(args.cols, 120),
          numberValue(args.rows, 32),
        );
        return undefined as T;
      case 'pty_kill':
        if (this.requestPty) {
          const id = String(args.ptyId ?? args.id ?? '');
          await this.requestPty('pty_kill', args);
          this.remotePtys.delete(id);
          return undefined as T;
        }
        await this.killPty(String(args.ptyId ?? args.id ?? ''));
        return undefined as T;
      case 'pty_interrupt':
        if (this.requestPty) {
          await this.requestPty('pty_interrupt', args);
          return undefined as T;
        }
        this.interruptPty(String(args.ptyId ?? args.id ?? ''));
        return undefined as T;
      case 'pty_exists':
        if (this.requestPty) return await this.requestPty('pty_exists', args) as T;
        return (this.ptys.get(String(args.ptyId ?? args.id ?? ''))?.alive === true) as T;
      case 'pty_snapshot':
        if (this.requestPty) return await this.requestPty('pty_snapshot', args) as T;
        return this.snapshotPty(String(args.ptyId ?? args.id ?? ''), numberValue(args.afterSequence, 0)) as T;
      case 'git_is_repo':
        return this.isGitRepo(String(args.path ?? this.workspacePath)) as T;
      case 'git_summary':
        return this.gitSummary(String(args.repoPath ?? this.workspacePath)) as T;
      case 'git_status':
        return this.gitStatus(String(args.repoPath ?? this.workspacePath)) as T;
      case 'git_diff_file':
        return this.gitDiffFile(String(args.repoPath ?? this.workspacePath), String(args.filePath ?? ''), args.staged === true) as T;
      case 'git_uncommitted_diff':
        return this.gitDiff(String(args.repoPath ?? this.workspacePath), args.staged === true) as T;
      case 'git_add':
        await this.runGit(String(args.repoPath ?? this.workspacePath), ['add', '--', ...stringArray(args.paths)]);
        return undefined as T;
      case 'git_add_all':
        await this.runGit(String(args.repoPath ?? this.workspacePath), ['add', '-A']);
        return undefined as T;
      case 'git_commit':
        return this.gitCommit(String(args.repoPath ?? this.workspacePath), String(args.message ?? '')) as T;
      case 'git_log':
        return this.gitLog(String(args.repoPath ?? this.workspacePath), numberValue(args.limit, 20)) as T;
      case 'git_log_file':
        return this.gitLog(String(args.repoPath ?? this.workspacePath), numberValue(args.limit, 20), String(args.filePath ?? '')) as T;
      case 'git_branch_create':
        await this.runGit(String(args.repoPath ?? this.workspacePath), [args.checkout === false ? 'branch' : 'checkout', ...(args.checkout === false ? ['-f'] : ['-b']), String(args.name ?? '')]);
        return undefined as T;
      case 'git_checkout':
        await this.runGit(String(args.repoPath ?? this.workspacePath), ['checkout', String(args.branch ?? '')]);
        return undefined as T;
      case 'git_push':
        return this.gitRemoteCommand(String(args.repoPath ?? this.workspacePath), 'push', args) as T;
      case 'git_pull':
        return this.gitRemoteCommand(String(args.repoPath ?? this.workspacePath), 'pull', args) as T;
      case 'git_fetch':
        return this.gitRemoteCommand(String(args.repoPath ?? this.workspacePath), 'fetch', args) as T;
      case 'git_stash':
        return this.gitStash(String(args.repoPath ?? this.workspacePath), args) as T;
      case 'git_stash_pop':
        await this.runGit(String(args.repoPath ?? this.workspacePath), ['stash', 'pop', `stash@{${numberValue(args.index, 0)}}`]);
        return undefined as T;
      case 'git_merge':
        return this.gitCommandOutput(String(args.repoPath ?? this.workspacePath), ['merge', String(args.branch ?? '')]) as T;
      case 'git_reset':
        return this.gitCommandOutput(String(args.repoPath ?? this.workspacePath), ['reset', `--${String(args.mode ?? 'mixed')}`, String(args.target ?? 'HEAD')]) as T;
      case 'git_blame':
        return this.gitCommandOutput(String(args.repoPath ?? this.workspacePath), ['blame', ...(numberValue(args.line, 0) > 0 ? ['-L', `${args.line},${args.line}`] : []), '--', String(args.filePath ?? '')]) as T;
      case 'git_commit_detail':
        return this.gitCommitDetail(String(args.repoPath ?? this.workspacePath), String(args.hash ?? 'HEAD')) as T;
      case 'docker_list_containers':
        return this.dockerListContainers(args.all !== false) as T;
      case 'docker_list_images':
        return this.dockerListImages() as T;
      case 'docker_container_logs':
        return this.dockerCommand(['logs', '--tail', String(numberValue(args.tail, 100)), String(args.id ?? '')]) as T;
      case 'docker_pull_image':
        return this.dockerCommand(['pull', String(args.image ?? '')]) as T;
      case 'docker_start_container':
        await this.dockerCommand(['start', String(args.id ?? '')]);
        return undefined as T;
      case 'docker_stop_container':
        await this.dockerCommand(['stop', String(args.id ?? '')]);
        return undefined as T;
      case 'docker_restart_container':
        await this.dockerCommand(['restart', String(args.id ?? '')]);
        return undefined as T;
      case 'docker_remove_container':
        await this.dockerCommand(['rm', ...(args.force === true ? ['-f'] : []), String(args.id ?? '')]);
        return undefined as T;
      case 'docker_remove_image':
        await this.dockerCommand(['rmi', ...(args.force === true ? ['-f'] : []), String(args.id ?? '')]);
        return undefined as T;
      case 'docker_compose_up':
        return this.dockerCommand(['compose', '-f', String(args.composePath ?? ''), 'up', ...(args.detach === false ? [] : ['-d'])]) as T;
      case 'docker_compose_down':
        return this.dockerCommand(['compose', '-f', String(args.composePath ?? ''), 'down']) as T;
      case 'docker_is_available':
        return this.commandAvailable('docker') as T;
      default:
        throw new Error(`CLI host does not implement command "${command}"`);
    }
  }

  private async writeText(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }

  private async statPath(filePath: string): Promise<Record<string, unknown>> {
    const info = await stat(filePath);
    return {
      path: filePath,
      is_dir: info.isDirectory(),
      is_file: info.isFile(),
      size: info.size,
      modified: Math.floor(info.mtimeMs / 1000),
    };
  }

  private async listDirectory(command: string, args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const directory = String(args.path ?? '');
    const showHidden = command === 'list_dir_all' || args.show_hidden === true || args.showHidden === true;
    const includeStats = command === 'list_dir_with_stats';
    const entries = await readdir(directory, { withFileTypes: true });
    const result: Array<Record<string, unknown>> = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!showHidden && entry.name.startsWith('.')) continue;
      const item: Record<string, unknown> = { name: entry.name, is_dir: entry.isDirectory() };
      if (includeStats) {
        const info = await stat(path.join(directory, entry.name));
        item.size = info.size;
        item.modified = Math.floor(info.mtimeMs / 1000);
      }
      result.push(item);
    }
    return result;
  }

  private async searchFiles(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const root = String(args.root ?? this.workspacePath);
    const query = String(args.query ?? '');
    const includePattern = typeof args.includePattern === 'string' ? args.includePattern : undefined;
    const excludePattern = typeof args.excludePattern === 'string' ? args.excludePattern : undefined;
    const isRegex = args.isRegex === true;
    const caseSensitive = args.caseSensitive === true;
    const maxResults = Math.min(numberValue(args.maxResults, 50), 200);
    const contextLines = Math.min(Math.max(numberValue(args.contextLines, 0), 0), 5);
    const pattern = isRegex ? new RegExp(query, caseSensitive ? '' : 'i') : null;
    const results: Array<Record<string, unknown>> = [];
    const files = await collectFiles(root, (filePath) => {
      const relative = normalizeRelative(root, filePath);
      return (!includePattern || globMatches(relative, includePattern)) && (!excludePattern || !globMatches(relative, excludePattern));
    });
    for (const filePath of files) {
      if (results.length >= maxResults) break;
      let content: string;
      try {
        content = await readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
        const line = lines[index];
        const matches = pattern ? pattern.test(line) : (caseSensitive ? line.includes(query) : line.toLowerCase().includes(query.toLowerCase()));
        if (!matches) continue;
        results.push({
          path: normalizeRelative(root, filePath),
          line_number: index + 1,
          line_content: line,
          ...(contextLines > 0 ? { context_before: lines.slice(Math.max(0, index - contextLines), index), context_after: lines.slice(index + 1, index + 1 + contextLines) } : {}),
        });
      }
    }
    return results;
  }

  private async findFiles(args: Record<string, unknown>): Promise<string[]> {
    const basePath = String(args.basePath ?? this.workspacePath);
    const pattern = String(args.pattern ?? '*');
    const maxResults = Math.min(numberValue(args.maxResults, 50), 200);
    const files = await collectFiles(basePath, (filePath) => globMatches(normalizeRelative(basePath, filePath), pattern));
    return files.slice(0, maxResults).map((filePath) => normalizeRelative(this.workspacePath, filePath));
  }

  private async getDiagnostics(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const requestedPath = typeof args.path === 'string' && args.path
      ? path.resolve(args.path)
      : undefined;
    const requestedExtension = requestedPath ? path.extname(requestedPath).toLowerCase() : '';

    if (existsSync(path.join(this.workspacePath, 'Cargo.toml')) && (!requestedPath || requestedExtension === '.rs')) {
      const result = await runProcessRaw('cargo', ['check', '--message-format=json', '--workspace'], {
        cwd: this.workspacePath,
        timeout: DEFAULT_COMMAND_TIMEOUT,
      }).catch(() => null);
      return result ? parseRustDiagnostics(result.stdout, this.workspacePath, requestedPath) : [];
    }

    const tsConfig = path.join(this.workspacePath, 'tsconfig.json');
    if (existsSync(tsConfig) && (!requestedPath || ['.ts', '.tsx', '.js', '.jsx'].includes(requestedExtension))) {
      const localTsc = path.join(this.workspacePath, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
      const command = existsSync(localTsc) ? localTsc : 'tsc';
      const result = await runProcessRaw(command, ['--noEmit', '--pretty', 'false', '--project', tsConfig], {
        cwd: this.workspacePath,
        timeout: DEFAULT_COMMAND_TIMEOUT,
      }).catch(() => null);
      return result ? parseTypeScriptDiagnostics(`${result.stdout}\n${result.stderr}`, this.workspacePath, requestedPath) : [];
    }

    if (requestedPath && requestedExtension === '.py') {
      const result = await runProcessRaw('python', ['-m', 'py_compile', requestedPath], {
        cwd: this.workspacePath,
        timeout: 30_000,
      }).catch(() => null);
      return result ? parsePythonDiagnostics(result.stderr, requestedPath) : [];
    }
    return [];
  }

  private async runCode(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const language = String(args.language ?? 'javascript');
    const code = String(args.code ?? '');
    const timeout = Math.min(numberValue(args.timeout, 10000), 30000);
    const cwd = String(args.cwd ?? this.workspacePath);
    const command = language === 'python' ? 'python' : language === 'bash' ? 'bash' : language === 'typescript' ? 'bun' : 'node';
    const commandArgs = language === 'python' ? ['-c', code] : language === 'bash' ? ['-lc', code] : ['-e', code];
    const result = await runProcess(command, commandArgs, { cwd, timeout }).catch((error: unknown) => ({ stdout: '', stderr: String(error), exitCode: 1 }));
    return { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode };
  }

  private async webFetch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rawUrl = String(args.url ?? '');
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http and https URLs are allowed.');
    const maxLength = Math.min(Math.max(numberValue(args.maxLength, 10000), 100), 100000);
    const response = await fetch(parsed, { headers: { 'user-agent': 'HysCode-TUI/0.1' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${response.url}`);
    const html = await response.text();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    const text = stripHtml(html).slice(0, maxLength);
    return {
      title: title ? decodeEntities(title).trim() : undefined,
      url: response.url,
      text,
      length: text.length,
      truncated: stripHtml(html).length > maxLength,
      metadata: { content_type: response.headers.get('content-type') ?? undefined, status: response.status },
    };
  }

  private async webSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const query = String(args.query ?? '').trim();
    if (!query) return { query, results: [] };
    const maxResults = Math.min(Math.max(numberValue(args.maxResults, 5), 1), 10);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'HysCode-TUI/0.1' } });
    if (!response.ok) throw new Error(`Search request failed with HTTP ${response.status}`);
    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    for (const match of html.matchAll(resultPattern)) {
      if (results.length >= maxResults) break;
      results.push({ url: decodeEntities(match[1]), title: stripHtml(match[2]), snippet: stripHtml(match[3]) });
    }
    return { query, results };
  }

  private spawnPty(args: Record<string, unknown>): string {
    const id = String(args.id ?? args.ptyId ?? crypto.randomUUID());
    const shell = String(args.shell ?? defaultShell());
    const commandArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    const terminal = spawnPtyProcess(shell, commandArgs, {
      cwd: typeof args.cwd === 'string' ? args.cwd : this.workspacePath,
      env: { ...process.env, ...(isStringRecord(args.env) ? args.env : {}) },
      cols: numberValue(args.cols, 120),
      rows: numberValue(args.rows, 32),
      name: process.platform === 'win32' ? 'xterm-256color' : 'xterm-256color',
      // Winpty is the stable default for the standalone client on Windows.
      // ConPTY can be opted into for terminals that need its newer behavior;
      // keeping it opt-in avoids AttachConsole failures in service/CI hosts.
      ...(process.platform === 'win32' ? { useConpty: process.env.HYSCODE_TUI_USE_CONPTY === '1' } : {}),
    });
    const session: PtySession = {
      id,
      terminal,
      dataSubscription: null as unknown as IDisposable,
      exitSubscription: null as unknown as IDisposable,
      chunks: [],
      sequence: 0,
      outputSize: 0,
      alive: true,
      exitCode: null,
    };
    this.ptys.set(id, session);
    session.dataSubscription = terminal.onData((data) => this.emitPtyData(session, data));
    session.exitSubscription = terminal.onExit(({ exitCode }) => {
      session.alive = false;
      session.exitCode = exitCode;
      this.emit('pty:exit', { pty_id: id, code: exitCode, sequence: session.sequence });
    });
    return id;
  }

  private emitPtyData(session: PtySession, data: string): void {
    if (!data) return;
    session.sequence += 1;
    session.chunks.push({ sequence: session.sequence, data });
    session.outputSize += data.length;
    while (session.outputSize > MAX_PTY_OUTPUT && session.chunks.length > 1) {
      const removed = session.chunks.shift();
      session.outputSize -= removed?.data.length ?? 0;
    }
    this.emit('pty:data', { pty_id: session.id, data, sequence: session.sequence });
  }

  private writePty(id: string, data: string): void {
    const session = this.ptys.get(id);
    if (!session?.alive) throw new Error(`PTY "${id}" is not writable.`);
    session.terminal.write(data);
  }

  private resizePty(id: string, cols: number, rows: number): void {
    const session = this.ptys.get(id);
    if (!session?.alive) return;
    session.terminal.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  }

  private async killPty(id: string): Promise<void> {
    const session = this.ptys.get(id);
    if (!session) return;
    if (!session.alive) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const exitSubscription = session.terminal.onExit(finish);
      try {
        session.terminal.kill();
      } catch {
        finish();
      }
      setTimeout(() => exitSubscription.dispose(), 2000);
      setTimeout(finish, 2000);
    });
  }

  private interruptPty(id: string): void {
    const session = this.ptys.get(id);
    if (!session?.alive) return;
    session.terminal.write('\u0003');
  }

  private snapshotPty(id: string, afterSequence: number): Record<string, unknown> {
    const session = this.ptys.get(id);
    if (!session) throw new Error(`PTY "${id}" not found.`);
    const selected = session.chunks.filter((chunk) => chunk.sequence > afterSequence);
    return {
      data: selected.map((chunk) => chunk.data).join(''),
      from_sequence: selected[0]?.sequence ?? afterSequence,
      to_sequence: session.sequence,
      truncated: session.chunks[0]?.sequence !== undefined && session.chunks[0].sequence > afterSequence + 1,
      alive: session.alive,
      exit_code: session.exitCode,
    };
  }

  private async isGitRepo(repoPath: string): Promise<boolean> {
    return (await runProcess('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], { timeout: 10000 }).catch(() => null))?.stdout.trim() === 'true';
  }

  private async gitSummary(repoPath: string): Promise<GitSummary> {
    const status = await runProcess('git', ['-C', repoPath, 'status', '--porcelain=v1', '--branch'], { cwd: repoPath, timeout: 10000 }).catch(() => null);
    if (!status) return { available: false, branch: '', insertions: 0, deletions: 0, changedFiles: 0 };

    const lines = status.stdout.split(/\r?\n/).filter(Boolean);
    const branchHeader = lines.find((line) => line.startsWith('## '))?.slice(3).trim() ?? '';
    const branch = branchHeader === 'HEAD (no branch)'
      ? 'detached'
      : branchHeader.replace(/^No commits yet on\s+/, '').split('...')[0].replace(/\s+\[.*$/, '').trim() || 'detached';
    const changedFiles = lines.filter((line) => !line.startsWith('## ')).length;
    const diff = await runProcess('git', ['-C', repoPath, 'diff', '--numstat', 'HEAD'], { cwd: repoPath, timeout: 10000 }).catch(() => null);
    let insertions = 0;
    let deletions = 0;
    for (const line of diff?.stdout.split(/\r?\n/).filter(Boolean) ?? []) {
      const [added, removed] = line.split('\t');
      if (/^\d+$/.test(added ?? '')) insertions += Number(added);
      if (/^\d+$/.test(removed ?? '')) deletions += Number(removed);
    }
    return { available: true, branch, insertions, deletions, changedFiles };
  }

  private async gitStatus(repoPath: string): Promise<Record<string, Array<{ path: string; status: string }>>> {
    const result = await this.runGit(repoPath, ['status', '--porcelain=v1', '-uall']);
    const groups: Record<string, Array<{ path: string; status: string }>> = { staged: [], unstaged: [], untracked: [], conflicts: [] };
    for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      if (code === '??') groups.untracked.push({ path: filePath, status: '?' });
      else {
        if (code[0] !== ' ') groups.staged.push({ path: filePath, status: code[0] });
        if (code[1] !== ' ') groups.unstaged.push({ path: filePath, status: code[1] });
        if (code.includes('U')) groups.conflicts.push({ path: filePath, status: 'U' });
      }
    }
    return groups;
  }

  private async gitDiffFile(repoPath: string, filePath: string, staged: boolean): Promise<string> {
    return (await this.runGit(repoPath, ['diff', ...(staged ? ['--cached'] : []), '--', filePath])).stdout;
  }

  private async gitDiff(repoPath: string, staged: boolean): Promise<string> {
    return (await this.runGit(repoPath, ['diff', ...(staged ? ['--cached'] : [])])).stdout;
  }

  private async gitCommit(repoPath: string, message: string): Promise<string> {
    return (await this.runGit(repoPath, ['commit', '-m', message])).stdout || (await this.runGit(repoPath, ['log', '-1', '--oneline'])).stdout;
  }

  private async gitLog(repoPath: string, limit: number, filePath?: string): Promise<Array<Record<string, unknown>>> {
    const format = '%H%x1f%h%x1f%s%x1f%an%x1f%at';
    const result = await this.runGit(repoPath, ['log', `-${Math.max(1, Math.min(limit, 200))}`, `--pretty=format:${format}`, ...(filePath ? ['--', filePath] : [])]);
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, shortHash, message, author, timestamp] = line.split('\x1f');
      return { hash, short_hash: shortHash, message, author, timestamp: Number(timestamp) };
    });
  }

  private async gitRemoteCommand(repoPath: string, command: string, args: Record<string, unknown>): Promise<string> {
    const remote = typeof args.remote === 'string' && args.remote ? args.remote : undefined;
    const branch = typeof args.branch === 'string' && args.branch ? args.branch : undefined;
    return this.gitCommandOutput(repoPath, [command, ...(remote ? [remote] : []), ...(branch ? [branch] : [])]);
  }

  private async gitStash(repoPath: string, args: Record<string, unknown>): Promise<string> {
    const message = typeof args.message === 'string' && args.message ? args.message : undefined;
    return this.gitCommandOutput(repoPath, ['stash', 'push', ...(message ? ['-m', message] : [])]);
  }

  private async gitCommitDetail(repoPath: string, hash: string): Promise<Record<string, unknown>> {
    const result = await this.runGit(repoPath, ['show', '--no-renames', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%at', '--numstat', hash]);
    const lines = result.stdout.split(/\r?\n/);
    const [header = '', ...fileLines] = lines;
    const [fullHash, shortHash, message, author, timestamp] = header.split('\x1f');
    const files = fileLines.filter((line) => /^\d+\s+\d+\s+/.test(line)).map((line) => {
      const [insertions, deletions, ...parts] = line.split(/\s+/);
      return { path: parts.join(' '), status: 'modified', insertions: Number(insertions), deletions: Number(deletions) };
    });
    return { hash: fullHash, short_hash: shortHash, message, author, timestamp: Number(timestamp), files, total_insertions: files.reduce((sum, file) => sum + file.insertions, 0), total_deletions: files.reduce((sum, file) => sum + file.deletions, 0) };
  }

  private async gitCommandOutput(repoPath: string, args: string[]): Promise<string> {
    const result = await this.runGit(repoPath, args);
    return `${result.stdout}${result.stderr}`.trim();
  }

  private async runGit(repoPath: string, args: string[]): Promise<ProcessResult> {
    return runProcess('git', ['-C', repoPath, ...args], { cwd: repoPath, timeout: DEFAULT_COMMAND_TIMEOUT });
  }

  private async dockerListContainers(all: boolean): Promise<unknown[]> {
    const result = await this.dockerCommand(['ps', ...(all ? ['-a'] : []), '--format', '{{json .}}']);
    return result.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  }

  private async dockerListImages(): Promise<unknown[]> {
    const result = await this.dockerCommand(['images', '--format', '{{json .}}']);
    return result.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  }

  private async dockerCommand(args: string[]): Promise<string> {
    const result = await runProcess('docker', args, { cwd: this.workspacePath, timeout: DEFAULT_COMMAND_TIMEOUT });
    return `${result.stdout}${result.stderr}`.trim();
  }

  private commandAvailable(command: string): Promise<boolean> {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    return runProcess(probe, [command], { timeout: 10000 }).then(() => true).catch(() => false);
  }

  private emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

async function runProcess(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<ProcessResult> {
  const result = await runProcessRaw(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(`${command} exited with code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return result;
}

async function runProcessRaw(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Command timed out after ${options.timeout ?? DEFAULT_COMMAND_TIMEOUT}ms: ${command}`));
    }, options.timeout ?? DEFAULT_COMMAND_TIMEOUT);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => { stdout += data; });
    child.stderr.on('data', (data: string) => { stderr += data; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function parseRustDiagnostics(output: string, workspacePath: string, requestedPath?: string): Array<Record<string, unknown>> {
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (message.reason !== 'compiler-message') continue;
    const diagnostic = message.message as Record<string, unknown> | undefined;
    if (!diagnostic || !['error', 'warning'].includes(String(diagnostic.level))) continue;
    const spans = Array.isArray(diagnostic.spans) ? diagnostic.spans as Array<Record<string, unknown>> : [];
    const span = spans.find((candidate) => candidate.is_primary === true) ?? spans[0];
    const fileName = typeof span?.file_name === 'string' ? span.file_name : requestedPath ?? '';
    const file = path.isAbsolute(fileName) ? fileName : path.resolve(workspacePath, fileName);
    if (requestedPath && path.resolve(file) !== path.resolve(requestedPath)) continue;
    diagnostics.push({
      file,
      line: numberValue(span?.line_start, 1),
      col: numberValue(span?.column_start, 1),
      severity: String(diagnostic.level),
      message: String(diagnostic.message ?? diagnostic.rendered ?? 'Rust compiler diagnostic').trim(),
      source: 'rustc',
    });
  }
  return diagnostics;
}

function parseTypeScriptDiagnostics(output: string, workspacePath: string, requestedPath?: string): Array<Record<string, unknown>> {
  const diagnostics: Array<Record<string, unknown>> = [];
  const pattern = /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+([^:]+):\s*(.*)$/gm;
  for (const match of output.matchAll(pattern)) {
    const file = path.isAbsolute(match[1]) ? path.normalize(match[1]) : path.resolve(workspacePath, match[1]);
    if (requestedPath && file !== path.resolve(requestedPath)) continue;
    diagnostics.push({
      file,
      line: Number(match[2]),
      col: Number(match[3]),
      severity: match[4],
      message: match[6].trim(),
      source: match[5].trim(),
    });
  }
  return diagnostics;
}

function parsePythonDiagnostics(output: string, requestedPath: string): Array<Record<string, unknown>> {
  if (!output.trim()) return [];
  const line = /line (\d+)/i.exec(output)?.[1];
  const message = output.split(/\r?\n/).filter(Boolean).at(-1) ?? 'Python syntax error';
  return [{
    file: requestedPath,
    line: line ? Number(line) : 1,
    col: 1,
    severity: 'error',
    message: message.replace(/^\w+Error:\s*/, '').trim(),
    source: 'python',
  }];
}

async function collectFiles(root: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < MAX_SEARCH_FILES) {
    const directory = queue.shift();
    if (!directory) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'target') continue;
      if (entry.name.startsWith('.') && entry.name !== '.hyscode') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (predicate(fullPath)) files.push(fullPath);
      if (files.length >= MAX_SEARCH_FILES) break;
    }
  }
  return files;
}

function normalizeRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function globMatches(value: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/');
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  expression += '$';
  const regex = new RegExp(expression);
  return regex.test(value) || regex.test(value.split('/').pop() ?? value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && Object.values(value).every((item) => typeof item === 'string');
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec ?? 'cmd.exe';
  return process.env.SHELL ?? '/bin/sh';
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }[entity] ?? entity));
}
