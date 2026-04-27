// ─── Built-in Tool Handlers ─────────────────────────────────────────────────
// Implementations for all built-in tools the agent can use.
// Each tool maps to Tauri backend commands via invoke().

import type { ToolDefinition } from '@hyscode/ai-providers';
import type { ToolHandler, ToolResult, ToolExecutionContext, ToolCategory, AgentQuestion } from './types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function defineTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  category: ToolCategory,
  requiresApproval: boolean,
  execute: (input: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>,
): ToolHandler {
  const definition: ToolDefinition = {
    name,
    description,
    inputSchema: { type: 'object', properties, required },
  };
  return { definition, category, requiresApproval, execute };
}

function normalizePath(path: string): string {
  // Normalize Windows backslashes to forward slashes for consistency
  return path.replace(/\\/g, '/');
}

function resolvePath(path: string, workspacePath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedWorkspace = normalizePath(workspacePath);

  // If already absolute, return normalized as-is
  if (normalizedPath.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedPath)) {
    return normalizedPath;
  }

  // Prevent path traversal: resolve .. segments and ensure result stays within workspace
  const combined = `${normalizedWorkspace}/${normalizedPath}`;
  const segments = combined.split('/');
  const resolved: string[] = [];
  let drivePrefix = '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === 0 && /^[a-zA-Z]:$/.test(seg)) {
      drivePrefix = seg + '/';
      continue;
    }
    if (seg === '..') {
      resolved.pop();
    } else if (seg !== '.' && seg !== '') {
      resolved.push(seg);
    }
  }

  // Ensure resolved path does not escape workspace root
  const workspaceSegments = normalizedWorkspace.split('/').filter((s) => s !== '' && s !== '.');
  if (resolved.length < workspaceSegments.length) {
    // Path traversal attempted — clamp to workspace root
    return drivePrefix + workspaceSegments.join('/');
  }

  return drivePrefix + resolved.join('/');
}

/** SSRF protection: check if a hostname resolves to a private/internal address. */
function isPrivateHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return true;
  }

  // IPv4 private ranges (RFC1918 + loopback + link-local)
  if (hostname.startsWith('127.')) return true;
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  if (hostname.startsWith('169.254.')) return true;
  if (hostname.startsWith('172.')) {
    const secondOctet = parseInt(hostname.split('.')[1] || '0', 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  // IPv6 unique local addresses (fc00::/7)
  if (hostname.toLowerCase().startsWith('fc') || hostname.toLowerCase().startsWith('fd')) {
    return true;
  }

  return false;
}

// ─── Filesystem Tools ───────────────────────────────────────────────────────

export const readFileTool = defineTool(
  'read_file',
  'Read the contents of a file. You can specify a line range to read only part of the file. Line numbers are 1-indexed.',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
    start_line: { type: 'integer', description: 'Starting line number (1-indexed, inclusive). Omit to read from beginning.' },
    end_line: { type: 'integer', description: 'Ending line number (1-indexed, inclusive). Omit to read to end.' },
  },
  ['path'],
  'filesystem',
  false,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const content = await ctx.invoke<string>('read_file', { path: filePath });

      // Apply line range if specified
      if (input.start_line || input.end_line) {
        const lines = content.split('\n');
        const start = ((input.start_line as number) || 1) - 1;
        const end = (input.end_line as number) || lines.length;
        const sliced = lines.slice(start, end);
        const numbered = sliced.map((line, i) => `${start + i + 1} | ${line}`).join('\n');
        return { success: true, output: numbered };
      }

      // Add line numbers
      const numbered = content.split('\n').map((line, i) => `${i + 1} | ${line}`).join('\n');
      return { success: true, output: numbered };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const writeFileTool = defineTool(
  'write_file',
  'Write content to a file. If the file exists, it will be overwritten. If parent directories don\'t exist, they will be created.',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
    content: { type: 'string', description: 'The full content to write to the file' },
  },
  ['path', 'content'],
  'filesystem',
  true,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const newContent = input.content as string;

      // Capture original content before overwriting (null if file doesn't exist)
      let originalContent: string | null = null;
      try {
        originalContent = await ctx.invoke<string>('read_file', { path: filePath });
      } catch { /* file doesn't exist yet */ }

      await ctx.invoke('write_file', { path: filePath, content: newContent });

      // Notify UI about the file change
      ctx.onFileChange?.({
        toolCallId: ctx.toolCallId,
        toolName: 'write_file',
        filePath,
        originalContent,
        newContent,
      });

      return { success: true, output: `File written: ${input.path}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const editFileTool = defineTool(
  'edit_file',
  'Make a targeted edit to a file by replacing an exact string with a new string. The old_string must match exactly (including whitespace and indentation). Include enough context lines to uniquely identify the location.',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
    old_string: { type: 'string', description: 'The exact text to find and replace. Must match exactly one location in the file.' },
    new_string: { type: 'string', description: 'The text to replace old_string with' },
  },
  ['path', 'old_string', 'new_string'],
  'filesystem',
  true,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const rawContent = await ctx.invoke<string>('read_file', { path: filePath });
      const oldStr = input.old_string as string;
      const newStr = input.new_string as string;

      // Normalize line endings to LF for matching (files may have CRLF on Windows)
      const content = rawContent.replace(/\r\n/g, '\n');
      const normalizedOldStr = oldStr.replace(/\r\n/g, '\n');

      // Find occurrences
      const occurrences = content.split(normalizedOldStr).length - 1;
      if (occurrences === 0) {
        return {
          success: false,
          output: '',
          error: `old_string not found in file. Make sure the string matches the file content exactly (including whitespace and indentation). Read the file first to confirm the exact content.`,
        };
      }
      if (occurrences > 1) {
        return {
          success: false,
          output: '',
          error: `old_string matches ${occurrences} locations. Include more surrounding context lines to make it unique.`,
        };
      }

      const newContent = content.replace(normalizedOldStr, newStr.replace(/\r\n/g, '\n'));
      await ctx.invoke('write_file', { path: filePath, content: newContent });

      // Notify UI about the file change
      ctx.onFileChange?.({
        toolCallId: ctx.toolCallId,
        toolName: 'edit_file',
        filePath,
        originalContent: content,
        newContent,
      });

      // Find the line range affected
      const beforeLines = content.slice(0, content.indexOf(normalizedOldStr)).split('\n').length;
      const newLines = newStr.split('\n').length;
      return {
        success: true,
        output: `File edited: ${input.path} (lines ${beforeLines}-${beforeLines + newLines - 1})`,
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const createFileTool = defineTool(
  'create_file',
  'Create a new file with the specified content. Fails if the file already exists. Parent directories are created automatically.',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path for the new file' },
    content: { type: 'string', description: 'The content for the new file' },
  },
  ['path', 'content'],
  'filesystem',
  true,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const newContent = input.content as string;
      await ctx.invoke('create_file', { path: filePath, content: newContent });

      // Notify UI — originalContent is null for brand-new files
      ctx.onFileChange?.({
        toolCallId: ctx.toolCallId,
        toolName: 'create_file',
        filePath,
        originalContent: null,
        newContent,
      });

      return { success: true, output: `File created: ${input.path}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const listDirectoryTool = defineTool(
  'list_directory',
  'List the contents of a directory. Returns file and folder names. Folders end with /. Supports recursive listing.',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path to the directory' },
    recursive: { type: 'boolean', description: 'If true, list all files recursively (default: false)' },
    max_depth: { type: 'integer', description: 'Maximum depth for recursive listing (default: 3)' },
  },
  ['path'],
  'filesystem',
  false,
  async (input, ctx) => {
    try {
      const dirPath = resolvePath(input.path as string, ctx.workspacePath);
      const recursive = (input.recursive as boolean) ?? false;
      const maxDepth = Math.min((input.max_depth as number) || 3, 10);

      if (!recursive) {
        const entries = await ctx.invoke<Array<{ name: string; is_dir: boolean }>>(
          'list_dir',
          { path: dirPath },
        );
        const formatted = entries
          .map((e) => (e.is_dir ? `${e.name}/` : e.name))
          .join('\n');
        return { success: true, output: formatted };
      }

      // Recursive listing
      const lines: string[] = [];
      async function walk(currentPath: string, depth: number, prefix: string) {
        if (depth > maxDepth) return;
        const entries = await ctx.invoke<Array<{ name: string; is_dir: boolean }>>(
          'list_dir',
          { path: currentPath },
        );
        for (const e of entries) {
          lines.push(`${prefix}${e.name}${e.is_dir ? '/' : ''}`);
          if (e.is_dir && depth < maxDepth) {
            await walk(`${currentPath}/${e.name}`, depth + 1, `${prefix}  `);
          }
        }
      }
      await walk(dirPath, 1, '');
      return { success: true, output: lines.join('\n') || '(empty directory)' };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const searchCodeTool = defineTool(
  'search_code',
  'Search for text or regex patterns across files in the workspace. Returns matching lines with file paths and line numbers.',
  {
    pattern: { type: 'string', description: 'Text or regex pattern to search for (case-insensitive by default)' },
    include_pattern: { type: 'string', description: "Glob pattern to filter files (e.g., '**/*.ts')" },
    is_regex: { type: 'boolean', description: 'Whether pattern is a regex (default: false)' },
    max_results: { type: 'integer', description: 'Maximum number of matches to return (default: 50)' },
  },
  ['pattern'],
  'filesystem',
  false,
  async (input, ctx) => {
    try {
      const results = await ctx.invoke<Array<{ path: string; line_number: number; line_content: string }>>(
        'search_files',
        {
          root: ctx.workspacePath,
          query: input.pattern as string,
          includePattern: (input.include_pattern as string) ?? undefined,
          isRegex: (input.is_regex as boolean) ?? false,
          maxResults: (input.max_results as number) ?? 50,
        },
      );
      if (!results.length) {
        return { success: true, output: 'No matches found.' };
      }
      const formatted = results
        .map((r) => `${r.path}:${r.line_number}: ${r.line_content}`)
        .join('\n');
      return { success: true, output: formatted };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

// ─── Terminal Tools ─────────────────────────────────────────────────────────

export const runTerminalCommandTool = defineTool(
  'run_terminal_command',
  'Execute a command in the terminal. The command runs in the visible Agent Terminal so the user can watch it live. Returns stdout and stderr. Use for running tests, installing packages, running scripts, etc.',
  {
    command: { type: 'string', description: 'The command to execute' },
    cwd: { type: 'string', description: 'Working directory (default: workspace root)' },
    timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default: 30000)' },
    new_terminal: { type: 'boolean', description: 'If true, forces creation of a new terminal session instead of reusing the existing Agent Terminal.' },
    session_name: { type: 'string', description: 'Optional name for the terminal session (used when new_terminal is true).' },
  },
  ['command'],
  'terminal',
  true,
  async (input, ctx) => {
    try {
      const cwd = input.cwd
        ? resolvePath(input.cwd as string, ctx.workspacePath)
        : ctx.workspacePath;
      const command = input.command as string;
      const timeoutMs = (input.timeout_ms as number) || 30_000;
      const forceNewTerminal = !!input.new_terminal;

      // If no event listener available, return a clear error
      if (!ctx.listen) {
        return {
          success: false,
          output: '',
          error: 'Terminal execution requires event listener support. The listen callback is not available.',
        };
      }

      const isWin = typeof navigator !== 'undefined' && navigator.userAgent?.includes('Win');
      let ptyId: string;
      let useSharedPty = false;

      // Decide whether to use the shared agent terminal or spawn a disposable one
      if (!forceNewTerminal && ctx.agentTerminalPtyId) {
        // Health-check the shared PTY before committing to it
        const alive = await ctx.invoke<boolean>('pty_exists', { ptyId: ctx.agentTerminalPtyId }).catch(() => false);
        if (alive) {
          ptyId = ctx.agentTerminalPtyId;
          useSharedPty = true;
        } else {
          // Shared PTY died — fall back to a disposable one for this command
          ptyId = await ctx.invoke<string>('pty_spawn', { cwd });
        }
      } else {
        ptyId = await ctx.invoke<string>('pty_spawn', { cwd });
      }

      // Collect output via pty:data events
      let output = '';
      let exited = false;
      let exitCode: number | null = null;
      let markerFound = false;

      const unlisten = await ctx.listen('pty:data', (payload: unknown) => {
        const data = payload as { pty_id: string; data: string };
        if (data.pty_id === ptyId) {
          output += data.data;
        }
      });

      const unlistenExit = await ctx.listen('pty:exit', (payload: unknown) => {
        const data = payload as { pty_id: string; code: number | null };
        if (data.pty_id === ptyId) {
          exited = true;
          exitCode = data.code ?? null;
        }
      });

      // For the shared PTY, cd into the target cwd first if it differs from workspace root
      if (useSharedPty && cwd !== ctx.workspacePath) {
        const cdCmd = isWin ? `cd "${cwd}"\r\n` : `cd "${cwd}"\n`;
        await ctx.invoke('pty_write', { ptyId, data: cdCmd });
        // Small delay so the cd completes before we send the real command
        await new Promise((r) => setTimeout(r, 150));
        // Reset output to avoid capturing the cd noise
        output = '';
      }

      // Write command followed by an exit marker
      // Use a marker that is extremely unlikely to appear in normal output
      const exitMarker = `__HYSCODE_EXIT_${crypto.randomUUID()}__`;
      const exitCodeVar = isWin ? '$LASTEXITCODE' : '$?';

      // On Windows/PowerShell, wrap in a script block to avoid ; conflicts in the user's command
      const wrappedCommand = isWin
        ? `& { ${command} }; Write-Output '${exitMarker}'; Write-Output "EXIT_CODE:$${exitCodeVar}"\r\n`
        : `${command}; echo '${exitMarker}'; echo "EXIT_CODE:${exitCodeVar}"\n`;

      try {
        await ctx.invoke('pty_write', { ptyId, data: wrappedCommand });
      } catch (writeErr) {
        // If the PTY vanished between our health-check and the write, try one last disposable fallback
        const errMsg = String(writeErr);
        if (errMsg.includes('not found') && useSharedPty) {
          useSharedPty = false;
          ptyId = await ctx.invoke<string>('pty_spawn', { cwd });
          await ctx.invoke('pty_write', { ptyId, data: wrappedCommand });
        } else {
          throw writeErr;
        }
      }

      // Wait for exit marker or timeout
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs && !exited && !markerFound) {
        // Check if we've received the exit marker
        if (output.includes(exitMarker)) {
          const exitMatch = output.match(/EXIT_CODE:(-?\d+)/);
          exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;
          const markerIdx = output.indexOf(exitMarker);
          output = output.slice(0, markerIdx).trim();
          markerFound = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // Cleanup listeners
      unlisten();
      unlistenExit();

      // Only kill the PTY if we spawned a disposable one
      if (!useSharedPty) {
        try {
          await ctx.invoke('pty_kill', { ptyId });
        } catch {
          // Ignore kill errors if PTY already exited
        }
      }

      // For the shared PTY, cd back to workspace root after command (keep cwd stable)
      if (useSharedPty && cwd !== ctx.workspacePath) {
        const cdBack = isWin ? `cd "${ctx.workspacePath}"\r\n` : `cd "${ctx.workspacePath}"\n`;
        await ctx.invoke('pty_write', { ptyId, data: cdBack });
      }

      // Trim PTY noise (echoed command prompt)
      const lines = output.split('\n');
      const cmdIdx = lines.findIndex((l) => l.includes(command.slice(0, 40)));
      if (cmdIdx >= 0 && cmdIdx < 3) {
        output = lines.slice(cmdIdx + 1).join('\n').trim();
      }

      const timedOut = !markerFound && !exited && Date.now() - startTime >= timeoutMs;
      if (timedOut) {
        ctx.onTerminalCommand?.(command, output || '', null);
        return {
          success: false,
          output: output || '',
          error: `Command timed out after ${Math.round(timeoutMs / 1000)}s`,
          metadata: { cwd, timeoutMs, timedOut: true },
        };
      }

      // Notify bridge about the completed terminal command (for context tracking)
      ctx.onTerminalCommand?.(command, output || '', exitCode);

      return {
        success: exitCode === 0 || exitCode === null,
        output: output || `Command completed with exit code ${exitCode}`,
        error: exitCode !== null && exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
        metadata: { cwd, exitCode, timeoutMs, usedSharedPty: useSharedPty },
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

// ─── Git Tools ──────────────────────────────────────────────────────────────

export const gitStatusTool = defineTool(
  'git_status',
  'Get the current git status of the workspace. Shows modified, added, deleted, and untracked files.',
  {},
  [],
  'git',
  false,
  async (_input, ctx) => {
    try {
      const result = await ctx.invoke<{
        staged: Array<{ path: string; status: string }>;
        unstaged: Array<{ path: string; status: string }>;
        untracked: Array<{ path: string; status: string }>;
        conflicts: Array<{ path: string; status: string }>;
      }>(
        'git_status',
        { repoPath: ctx.workspacePath },
      );

      const lines: string[] = [];
      for (const f of result.staged) lines.push(`staged    ${f.status} ${f.path}`);
      for (const f of result.unstaged) lines.push(`unstaged  ${f.status} ${f.path}`);
      for (const f of result.untracked) lines.push(`untracked ? ${f.path}`);
      for (const f of result.conflicts) lines.push(`conflict  U ${f.path}`);

      if (lines.length === 0) {
        return { success: true, output: 'Working tree clean.' };
      }
      return { success: true, output: lines.join('\n') };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const gitDiffTool = defineTool(
  'git_diff',
  'Get the git diff of uncommitted changes.',
  {
    staged: { type: 'boolean', description: 'If true, show diff of staged changes only (default: false)' },
    path: { type: 'string', description: 'Optional: diff only this file' },
  },
  [],
  'git',
  false,
  async (input, ctx) => {
    try {
      const staged = (input.staged as boolean) ?? false;
      const filePath = input.path
        ? resolvePath(input.path as string, ctx.workspacePath)
        : undefined;

      if (filePath) {
        const diff = await ctx.invoke<string>('git_diff_file', {
          repoPath: ctx.workspacePath,
          filePath,
          staged,
        });
        return { success: true, output: diff || 'No changes.' };
      }

      // Full diff — get status then diff each file
      const result = await ctx.invoke<{
        staged: Array<{ path: string }>;
        unstaged: Array<{ path: string }>;
      }>(
        'git_status',
        { repoPath: ctx.workspacePath },
      );

      const filesToDiff = staged ? result.staged : result.unstaged;
      const diffs: string[] = [];
      for (const file of filesToDiff) {
        try {
          const diff = await ctx.invoke<string>('git_diff_file', {
            repoPath: ctx.workspacePath,
            filePath: file.path,
            staged,
          });
          if (diff) diffs.push(diff);
        } catch {
          // Skip files that can't be diffed
        }
      }

      return { success: true, output: diffs.join('\n') || 'No changes.' };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const gitCommitTool = defineTool(
  'git_commit',
  'Stage files and create a git commit with the specified message.',
  {
    message: { type: 'string', description: 'Commit message (follow conventional commits format)' },
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Files to stage and commit. If empty, commits all staged changes.',
    },
  },
  ['message'],
  'git',
  true,
  async (input, ctx) => {
    try {
      const paths = input.paths as string[] | undefined;

      if (paths && paths.length > 0) {
        const resolved = paths.map((p) => resolvePath(p, ctx.workspacePath));
        await ctx.invoke('git_add', {
          repoPath: ctx.workspacePath,
          paths: resolved,
        });
      }

      const result = await ctx.invoke<string>('git_commit', {
        repoPath: ctx.workspacePath,
        message: input.message,
      });

      return { success: true, output: result || `Committed: ${input.message}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const gitAddTool = defineTool(
  'git_add',
  'Stage files for commit.',
  {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'File paths to stage. If empty, stages all changes.',
    },
  },
  [],
  'git',
  true,
  async (input, ctx) => {
    try {
      const paths = input.paths as string[] | undefined;
      if (paths && paths.length > 0) {
        const resolved = paths.map((p) => resolvePath(p, ctx.workspacePath));
        await ctx.invoke('git_add', {
          repoPath: ctx.workspacePath,
          paths: resolved,
        });
        return { success: true, output: `Staged: ${paths.join(', ')}` };
      } else {
        await ctx.invoke('git_add_all', { repoPath: ctx.workspacePath });
        return { success: true, output: 'Staged all changes.' };
      }
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

// ─── Extended Git Tools ─────────────────────────────────────────────────────

export const gitLogTool = defineTool(
  'git_log',
  'Show recent git commit history.',
  {
    max_count: {
      type: 'number',
      description: 'Max number of commits to return (default: 20).',
    },
    file: {
      type: 'string',
      description: 'Optionally limit to commits affecting this file path.',
    },
  },
  [],
  'git',
  false,
  async (input, ctx) => {
    try {
      const limit = (input.max_count as number) || 20;
      const file = input.file ? resolvePath(input.file as string, ctx.workspacePath) : undefined;

      if (file) {
        const commits = await ctx.invoke<Array<{ short_hash: string; message: string; author: string; timestamp: number }>>(
          'git_log_file',
          { repoPath: ctx.workspacePath, filePath: file, limit },
        );
        if (!commits.length) return { success: true, output: 'No commits found.' };
        const formatted = commits.map(c => `${c.short_hash} ${c.message.split('\n')[0]} (${c.author})`).join('\n');
        return { success: true, output: formatted };
      }

      const commits = await ctx.invoke<Array<{ short_hash: string; message: string; author: string; timestamp: number }>>(
        'git_log',
        { repoPath: ctx.workspacePath, limit },
      );
      if (!commits.length) return { success: true, output: 'No commits found.' };
      const formatted = commits.map(c => `${c.short_hash} ${c.message.split('\n')[0]} (${c.author})`).join('\n');
      return { success: true, output: formatted };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const gitCheckoutTool = defineTool(
  'git_checkout',
  'Switch to a branch or create a new branch.',
  {
    branch: { type: 'string', description: 'Branch name to switch to.' },
    create: {
      type: 'boolean',
      description: 'If true, create the branch before switching (git checkout -b).',
    },
  },
  ['branch'],
  'git',
  true,
  async (input, ctx) => {
    try {
      const branch = input.branch as string;
      const create = input.create as boolean | undefined;

      if (create) {
        await ctx.invoke('git_branch_create', {
          repoPath: ctx.workspacePath,
          name: branch,
          checkout: true,
        });
        return { success: true, output: `Created and switched to branch: ${branch}` };
      }

      await ctx.invoke('git_checkout', {
        repoPath: ctx.workspacePath,
        branch,
      });
      return { success: true, output: `Switched to branch: ${branch}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

// ─── Code Tools ─────────────────────────────────────────────────────────────

export const getDiagnosticsTool = defineTool(
  'get_diagnostics',
  'Get compiler/linter diagnostics (errors and warnings) from the editor for a file or the entire workspace.',
  {
    file: {
      type: 'string',
      description: 'File path to get diagnostics for. Omit for all workspace diagnostics.',
    },
  },
  [],
  'code',
  false,
  async (input, ctx) => {
    try {
      const file = input.file ? resolvePath(input.file as string, ctx.workspacePath) : undefined;
      const diagnostics = await ctx.invoke<Array<{
        file: string;
        line: number;
        col: number;
        severity: string;
        message: string;
        source?: string;
      }>>('get_diagnostics', { path: file });

      if (!diagnostics || diagnostics.length === 0) {
        return { success: true, output: file ? 'No diagnostics for this file.' : 'No diagnostics in workspace.' };
      }

      const formatted = diagnostics.map(
        (d) => `${d.file}:${d.line}:${d.col} [${d.severity}] ${d.message}${d.source ? ` (${d.source})` : ''}`,
      ).join('\n');

      return {
        success: true,
        output: `${diagnostics.length} diagnostic(s):\n${formatted}`,
        metadata: { count: diagnostics.length },
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

// ─── Browser Tools ──────────────────────────────────────────────────────────

export const webFetchTool = defineTool(
  'web_fetch',
  'Fetch and read the full content of any web page or API endpoint. Extracts clean readable text (removes ads, scripts, nav). Returns title, URL, HTTP status, and the page text. Use this to read documentation, blog posts, GitHub source code, Stack Overflow answers, or any web content. Call this tool directly — it works.',
  {
    url: { type: 'string', description: 'The full URL to fetch (e.g. https://docs.python.org/3/library/os.html).' },
    max_length: {
      type: 'number',
      description: 'Maximum characters to return (default: 10000). Increase if the page is long.',
    },
  },
  ['url'],
  'browser',
  false,
  async (input, ctx) => {
    try {
      const url = input.url as string;
      const maxLen = (input.max_length as number) || 10_000;

      // Validate URL to prevent SSRF — only allow http/https
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { success: false, output: '', error: 'Invalid URL format.' };
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, output: '', error: 'Only http and https URLs are allowed.' };
      }

      // Block internal/private IPs (SSRF protection)
      const hostname = parsed.hostname;
      if (isPrivateHost(hostname)) {
        return { success: false, output: '', error: 'Fetching internal/private addresses is not allowed.' };
      }

      const result = await ctx.invoke<{
        title?: string;
        url: string;
        text: string;
        length: number;
        truncated: boolean;
        metadata?: { content_type?: string; status: number };
      }>('web_fetch', { url, maxLength: maxLen });

      const lines: string[] = [];
      if (result.title) {
        lines.push(`Title: ${result.title}`);
      }
      lines.push(`URL: ${result.url}`);
      if (result.metadata) {
        lines.push(`Status: ${result.metadata.status}${result.metadata.content_type ? ` | ${result.metadata.content_type}` : ''}`);
      }
      lines.push('---');
      lines.push(result.text);

      return {
        success: true,
        output: lines.join('\n'),
        metadata: { url, length: result.length, truncated: result.truncated },
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

export const webSearchTool = defineTool(
  'web_search',
  'Search the web using DuckDuckGo. Returns a list of search results with titles, URLs, and snippets. Use this to find documentation, error solutions, API references, or general information. This tool is fully functional — call it directly. After getting results, use web_fetch to read the full content of a specific page.',
  {
    query: { type: 'string', description: 'The search query. Be specific for better results.' },
    max_results: {
      type: 'number',
      description: 'Maximum number of results to return (default: 5, max: 10).',
    },
  },
  ['query'],
  'browser',
  false,
  async (input, ctx) => {
    try {
      const query = input.query as string;
      const maxResults = Math.min(Math.max(1, (input.max_results as number) || 5), 10);

      const result = await ctx.invoke<{
        query: string;
        results: Array<{ title: string; url: string; snippet: string }>;
      }>('web_search', { query, maxResults });

      if (result.results.length === 0) {
        return { success: true, output: `No results found for "${query}".` };
      }

      const lines: string[] = [
        `Search: "${result.query}"`,
        `Results: ${result.results.length}`,
        '',
      ];

      result.results.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}`);
        lines.push(`   URL: ${r.url}`);
        if (r.snippet) {
          lines.push(`   ${r.snippet}`);
        }
        lines.push('');
      });

      return {
        success: true,
        output: lines.join('\n'),
        metadata: { query: result.query, resultCount: result.results.length },
      };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  },
);

// ─── Meta Tools ─────────────────────────────────────────────────────────────

export const activateSkillTool = defineTool(
  'activate_skill',
  'Activate a skill to enhance your capabilities for the current conversation. Skills provide domain-specific instructions and best practices. Use this BEFORE performing specialized tasks like testing, security review, performance optimization, documentation, or git workflows.',
  {
    skill_name: { type: 'string', description: 'Name of the skill to activate (use list_skills to discover available names)' },
  },
  ['skill_name'],
  'meta',
  false,
  async (input, _ctx) => {
    return {
      success: true,
      output: `Skill activation requested: ${input.skill_name}`,
      metadata: { action: 'activate_skill', skillName: input.skill_name },
    };
  },
);

export const listSkillsTool = defineTool(
  'list_skills',
  'List all available skills with their names, descriptions, scope, and activation status. Use this to discover which skills you can activate for the current task. Always check available skills before specialized work.',
  {},
  [],
  'meta',
  false,
  async (_input, _ctx) => {
    // The harness intercepts this via metadata action and injects the real skill list.
    return {
      success: true,
      output: 'Skills list requested.',
      metadata: { action: 'list_skills' },
    };
  },
);

export const createSkillTool = defineTool(
  'create_skill',
  'Create a new skill file in the workspace. Skills are markdown files with YAML frontmatter that provide domain-specific instructions to the agent. The skill will be saved to .agents/skills/ in the workspace.',
  {
    name: { type: 'string', description: 'Skill name (kebab-case, e.g. "react-patterns")' },
    description: { type: 'string', description: 'One-line description of the skill' },
    content: { type: 'string', description: 'Full markdown content including YAML frontmatter (---\\nname: ...\\n---) and instructions' },
    scope: { type: 'string', description: 'Where to save: "workspace" (project .agents/skills/) or "global" (~/.agents/skills/). Default: workspace' },
  },
  ['name', 'content'],
  'meta',
  true, // requires approval since it writes files
  async (input, _ctx) => {
    const name = String(input.name);
    const description = String(input.description ?? '');
    const content = String(input.content);
    const scope = String(input.scope ?? 'workspace');

    return {
      success: true,
      output: `Skill creation requested: "${name}" (${scope})`,
      metadata: {
        action: 'create_skill',
        skillName: name,
        skillDescription: description,
        skillContent: content,
        skillScope: scope,
      },
    };
  },
);

// ─── Task Management Tool ───────────────────────────────────────────────────

export const manageTasksTool = defineTool(
  'manage_tasks',
  'Create, update, and track a task list for the current conversation. Use this to plan multi-step work, track progress, and give the user visibility into what you are doing. Provide the FULL task list each time (existing + new items). Mark tasks in_progress before starting, completed when done.',
  {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Sequential task ID (1, 2, 3...)' },
          title: { type: 'string', description: 'Short task title (3-7 words)' },
          status: {
            type: 'string',
            description: 'not_started | in_progress | completed | blocked',
          },
        },
        required: ['id', 'title', 'status'],
      },
      description: 'The complete list of tasks. Must include ALL items (existing and new).',
    },
  },
  ['tasks'],
  'meta',
  false,
  async (input, _ctx) => {
    const tasks = input.tasks as Array<{ id: number; title: string; status: string }>;
    // The harness bridge reads the metadata action and forwards to the store
    return {
      success: true,
      output: `Task list updated (${tasks.length} tasks, ${tasks.filter((t) => t.status === 'completed').length} completed).`,
      metadata: { action: 'manage_tasks', tasks },
    };
  },
);

// ─── Mode Switch Tool ───────────────────────────────────────────────────────

export const requestModeSwitchTool = defineTool(
  'request_mode_switch',
  `Request switching to a different agent mode to delegate work. This requires user approval.
Use this when the current task is better handled by another agent:
- Switch to "build" to implement code changes (from plan or review)
- Switch to "review" to get a code review (from build or debug)
- Switch to "debug" to diagnose and fix bugs (from review or build)
- Switch to "plan" to create a detailed implementation plan
The target agent will receive your context summary to continue the work seamlessly.`,
  {
    target_mode: {
      type: 'string',
      description: 'The agent mode to switch to: "chat" | "build" | "review" | "debug" | "plan"',
    },
    reason: {
      type: 'string',
      description: 'Why this switch is needed — explain clearly so the user can decide.',
    },
    context_summary: {
      type: 'string',
      description: 'Summary of relevant context, findings, and instructions for the target agent. Be detailed — this is the handoff document.',
    },
  },
  ['target_mode', 'reason', 'context_summary'],
  'meta',
  true, // always requires user approval
  async (input, _ctx) => {
    const targetMode = String(input.target_mode);
    const reason = String(input.reason);
    const contextSummary = String(input.context_summary);

    const validModes = ['chat', 'build', 'review', 'debug', 'plan'];
    if (!validModes.includes(targetMode)) {
      return {
        success: false,
        output: '',
        error: `Invalid target mode "${targetMode}". Must be one of: ${validModes.join(', ')}`,
      };
    }

    return {
      success: true,
      output: `Mode switch requested: → ${targetMode}. Awaiting user approval.`,
      metadata: {
        action: 'mode_switch',
        targetMode,
        reason,
        contextSummary,
      },
    };
  },
);

// ─── Context Gathering Tools ────────────────────────────────────────────────

export const gatherContextTool = defineTool(
  'gather_context',
  `Gather a file into the agent's working memory so its contents persist across tool calls.
Use this to keep important reference files in context without re-reading them each iteration.
Gathered files survive across iterations within the same turn.
Assign relevance: 0.8-1.0 = files you will modify, 0.5-0.7 = important references, 0.2-0.4 = background context.`,
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path to the file to gather' },
    relevance: {
      type: 'number',
      description: 'Relevance score 0-1. 0.8-1.0 = will modify, 0.5-0.7 = reference, 0.2-0.4 = background',
    },
    reason: { type: 'string', description: 'Why this file is important for the current task' },
  },
  ['path', 'relevance', 'reason'],
  'filesystem',
  false,
  async (input, ctx) => {
    try {
      if (!ctx.gatheredContext) {
        return { success: false, output: '', error: 'Gathered context is not available in this execution context.' };
      }
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const relevance = Math.max(0, Math.min(1, Number(input.relevance) || 0.5));
      const reason = String(input.reason || 'Agent gathered this file');

      // Read file content
      const content = await ctx.invoke<string>('read_file', { path: filePath });
      const tokenEstimate = ctx.gatheredContext.add(filePath, content, relevance, reason);

      const totalTokens = ctx.gatheredContext.getTokens();
      const totalFiles = ctx.gatheredContext.getAll().length;

      return {
        success: true,
        output: `Gathered "${filePath}" (relevance: ${relevance.toFixed(2)}, ~${tokenEstimate} tokens). Working memory: ${totalFiles} file(s), ~${totalTokens} tokens total.`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Failed to gather file: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const dropContextTool = defineTool(
  'drop_context',
  `Remove a file from the agent's working memory. Use this to free up context budget when a file is no longer needed.`,
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path of the file to remove from working memory' },
  },
  ['path'],
  'filesystem',
  false,
  async (input, ctx) => {
    if (!ctx.gatheredContext) {
      return { success: false, output: '', error: 'Gathered context is not available in this execution context.' };
    }
    const filePath = resolvePath(input.path as string, ctx.workspacePath);
    const removed = ctx.gatheredContext.remove(filePath);
    if (removed) {
      const totalTokens = ctx.gatheredContext.getTokens();
      const totalFiles = ctx.gatheredContext.getAll().length;
      return {
        success: true,
        output: `Dropped "${filePath}" from working memory. Remaining: ${totalFiles} file(s), ~${totalTokens} tokens.`,
      };
    }
    return {
      success: false,
      output: '',
      error: `File "${filePath}" was not in working memory.`,
    };
  },
);

export const listContextTool = defineTool(
  'list_context',
  `List all files currently in the agent's working memory with their relevance scores and token estimates.`,
  {},
  [],
  'filesystem',
  false,
  async (_input, ctx) => {
    if (!ctx.gatheredContext) {
      return { success: false, output: '', error: 'Gathered context is not available in this execution context.' };
    }
    const files = ctx.gatheredContext.getAll();
    if (files.length === 0) {
      return { success: true, output: 'Working memory is empty. No files gathered.' };
    }
    const totalTokens = ctx.gatheredContext.getTokens();
    const lines = files.map(
      (f, i) => `${i + 1}. ${f.path} (relevance: ${f.relevance.toFixed(2)}, ~${f.tokenEstimate} tokens) — ${f.reason}`
    );
    return {
      success: true,
      output: `Working memory: ${files.length} file(s), ~${totalTokens} tokens total:\n${lines.join('\n')}`,
    };
  },
);

export const findFilesTool = defineTool(
  'find_files',
  `Search for files by name pattern using glob matching. Returns matching file paths without reading content.
Useful for discovering files before deciding which ones to gather or read.
Use simple glob patterns: "*.tsx", "**/*.test.ts", "src/**/index.ts".`,
  {
    pattern: { type: 'string', description: 'Glob pattern to match file names/paths (e.g. "*.tsx", "**/*.test.ts")' },
    base_path: { type: 'string', description: 'Directory to search in. Defaults to workspace root.' },
    max_results: { type: 'integer', description: 'Maximum number of results to return. Default: 50.' },
  },
  ['pattern'],
  'filesystem',
  false,
  async (input, ctx) => {
    try {
      const basePath = input.base_path
        ? resolvePath(input.base_path as string, ctx.workspacePath)
        : ctx.workspacePath;
      const pattern = String(input.pattern);
      const maxResults = Math.min(Number(input.max_results) || 50, 200);

      const results = await ctx.invoke<string[]>('find_files', {
        basePath,
        pattern,
        maxResults,
      });

      if (results.length === 0) {
        return { success: true, output: `No files matching "${pattern}" found in ${basePath}.` };
      }

      const truncated = results.length >= maxResults ? `\n(limited to ${maxResults} results)` : '';
      return {
        success: true,
        output: `Found ${results.length} file(s) matching "${pattern}":${truncated}\n${results.join('\n')}`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Failed to find files: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

// ─── Ask User Tool ──────────────────────────────────────────────────────────

export const askUserTool = defineTool(
  'ask_user',
  `Ask the user one or more clarifying questions before proceeding. Use this when you need specific information to make better decisions — for example layout preferences, technology choices, scope clarifications, or design trade-offs.
Each question can have predefined options (numbered choices) and/or allow free-form text input. The agent loop pauses until the user answers.`,
  {
    title: {
      type: 'string',
      description: 'Short heading for the question card (e.g. "Let me ask a few questions to shape the layout")',
    },
    questions: {
      type: 'array',
      description: 'Array of questions to present to the user',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for this question (e.g. "q1", "layout")' },
          question: { type: 'string', description: 'The question text to display' },
          options: {
            type: 'array',
            description: 'Optional predefined answer choices',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Display label for the option' },
                description: { type: 'string', description: 'Optional description shown below the label' },
              },
              required: ['label'],
            },
          },
          allow_freeform: {
            type: 'boolean',
            description: 'Whether the user can type a custom answer. Defaults to true.',
          },
        },
        required: ['id', 'question'],
      },
    },
  },
  ['questions'],
  'meta',
  false,
  async (input, ctx) => {
    if (!ctx.askUser) {
      return {
        success: false,
        output: '',
        error: 'ask_user is not available in this environment. Proceed with your best judgment instead.',
      };
    }

    const rawQuestions = input.questions as Array<{
      id: string;
      question: string;
      options?: Array<{ label: string; description?: string }>;
      allow_freeform?: boolean;
    }>;

    if (!rawQuestions || rawQuestions.length === 0) {
      return { success: false, output: '', error: 'No questions provided.' };
    }

    const questions: AgentQuestion[] = rawQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      allowFreeform: q.allow_freeform !== false,
    }));

    const title = (input.title as string) || undefined;

    try {
      const answers = await ctx.askUser(questions, title);

      if (answers.length === 0) {
        return {
          success: true,
          output: 'The user skipped the questions without answering. Proceed with your best judgment based on available context.',
        };
      }

      const formatted = answers
        .map((a) => `Q: ${questions.find((q) => q.id === a.id)?.question ?? a.id}\nA: ${a.answer}`)
        .join('\n\n');

      return {
        success: true,
        output: `User answers:\n\n${formatted}`,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Failed to get user answers: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
);

// ─── Docker Tools ───────────────────────────────────────────────────────────

export const dockerListContainersTool = defineTool(
  'docker_list_containers',
  'List all Docker containers on the system, including running and stopped ones. Returns container id, name, image, status, state, ports, and creation time.',
  {
    all: { type: 'boolean', description: 'Include stopped containers (default: true)' },
  },
  [],
  'docker',
  false,
  async (input, ctx) => {
    try {
      const containers = await ctx.invoke<unknown[]>('docker_list_containers', {
        all: input.all !== false,
      });
      return { success: true, output: JSON.stringify(containers, null, 2) };
    } catch (err) {
      return { success: false, output: '', error: `Failed to list containers: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const dockerListImagesTool = defineTool(
  'docker_list_images',
  'List all Docker images available locally. Returns image id, repository, tag, size, and creation time.',
  {},
  [],
  'docker',
  false,
  async (_input, ctx) => {
    try {
      const images = await ctx.invoke<unknown[]>('docker_list_images', {});
      return { success: true, output: JSON.stringify(images, null, 2) };
    } catch (err) {
      return { success: false, output: '', error: `Failed to list images: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const dockerContainerLogsTool = defineTool(
  'docker_container_logs',
  'Fetch logs from a Docker container. Returns the last N lines of logs.',
  {
    id: { type: 'string', description: 'Container ID or name' },
    tail: { type: 'integer', description: 'Number of lines from the end to show (default: 100)' },
  },
  ['id'],
  'docker',
  false,
  async (input, ctx) => {
    try {
      const logs = await ctx.invoke<string>('docker_container_logs', {
        id: input.id as string,
        tail: (input.tail as number) || 100,
      });
      return { success: true, output: logs };
    } catch (err) {
      return { success: false, output: '', error: `Failed to fetch logs: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const dockerRunTool = defineTool(
  'docker_run',
  'Pull and start a Docker image. This will pull the image if not present locally, then the user can start a container from it via the UI.',
  {
    image: { type: 'string', description: 'Docker image to pull (e.g., "nginx:latest", "postgres:16")' },
  },
  ['image'],
  'docker',
  true, // requires approval — mutating action
  async (input, ctx) => {
    try {
      const result = await ctx.invoke<string>('docker_pull_image', {
        image: input.image as string,
      });
      return { success: true, output: `Image pulled successfully.\n${result}` };
    } catch (err) {
      return { success: false, output: '', error: `Failed to pull image: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

// ─── Additional Filesystem Tools ────────────────────────────────────────────

export const deleteFileTool = defineTool(
  'delete_file',
  'Delete a file or directory. Use with caution — this action is destructive.',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path to delete' },
  },
  ['path'],
  'filesystem',
  true,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      await ctx.invoke('delete_path', { path: filePath });
      return { success: true, output: `Deleted: ${input.path}` };
    } catch (err) {
      return { success: false, output: '', error: `Failed to delete: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const renameFileTool = defineTool(
  'rename_file',
  'Rename or move a file or directory.',
  {
    from: { type: 'string', description: 'Source path (absolute or workspace-relative)' },
    to: { type: 'string', description: 'Destination path (absolute or workspace-relative)' },
  },
  ['from', 'to'],
  'filesystem',
  true,
  async (input, ctx) => {
    try {
      const fromPath = resolvePath(input.from as string, ctx.workspacePath);
      const toPath = resolvePath(input.to as string, ctx.workspacePath);
      await ctx.invoke('rename_path', { from: fromPath, to: toPath });
      return { success: true, output: `Renamed: ${input.from} → ${input.to}` };
    } catch (err) {
      return { success: false, output: '', error: `Failed to rename: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const copyFileTool = defineTool(
  'copy_file',
  'Copy a file or directory.',
  {
    from: { type: 'string', description: 'Source path (absolute or workspace-relative)' },
    to: { type: 'string', description: 'Destination path (absolute or workspace-relative)' },
  },
  ['from', 'to'],
  'filesystem',
  true,
  async (input, ctx) => {
    try {
      const fromPath = resolvePath(input.from as string, ctx.workspacePath);
      const toPath = resolvePath(input.to as string, ctx.workspacePath);
      await ctx.invoke('copy_path', { from: fromPath, to: toPath });
      return { success: true, output: `Copied: ${input.from} → ${input.to}` };
    } catch (err) {
      return { success: false, output: '', error: `Failed to copy: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const getFileInfoTool = defineTool(
  'get_file_info',
  'Get metadata about a file or directory (size, type, modification time).',
  {
    path: { type: 'string', description: 'Absolute or workspace-relative path' },
  },
  ['path'],
  'filesystem',
  false,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const info = await ctx.invoke<{ path: string; is_dir: boolean; is_file: boolean; size: number; modified?: number }>(
        'stat_path',
        { path: filePath },
      );
      const modified = info.modified
        ? new Date(info.modified * 1000).toISOString()
        : 'unknown';
      return {
        success: true,
        output: `${info.path}\nType: ${info.is_dir ? 'directory' : info.is_file ? 'file' : 'other'}\nSize: ${info.size} bytes\nModified: ${modified}`,
        metadata: info,
      };
    } catch (err) {
      return { success: false, output: '', error: `Failed to stat: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

// ─── Additional Git Tools ───────────────────────────────────────────────────

export const gitPushTool = defineTool(
  'git_push',
  'Push commits to a remote repository.',
  {
    remote: { type: 'string', description: 'Remote name (default: origin)' },
    branch: { type: 'string', description: 'Branch to push (default: current branch)' },
  },
  [],
  'git',
  true,
  async (input, ctx) => {
    try {
      const result = await ctx.invoke<string>('git_push', {
        repoPath: ctx.workspacePath,
        remote: (input.remote as string) || undefined,
        branch: (input.branch as string) || undefined,
      });
      return { success: true, output: result || 'Push completed.' };
    } catch (err) {
      return { success: false, output: '', error: `Push failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitPullTool = defineTool(
  'git_pull',
  'Pull changes from a remote repository.',
  {
    remote: { type: 'string', description: 'Remote name (default: origin)' },
  },
  [],
  'git',
  true,
  async (input, ctx) => {
    try {
      const result = await ctx.invoke<string>('git_pull', {
        repoPath: ctx.workspacePath,
        remote: (input.remote as string) || undefined,
      });
      return { success: true, output: result || 'Pull completed.' };
    } catch (err) {
      return { success: false, output: '', error: `Pull failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitFetchTool = defineTool(
  'git_fetch',
  'Fetch changes from a remote repository without merging.',
  {
    remote: { type: 'string', description: 'Remote name (default: origin)' },
  },
  [],
  'git',
  false,
  async (input, ctx) => {
    try {
      const result = await ctx.invoke<string>('git_fetch', {
        repoPath: ctx.workspacePath,
        remote: (input.remote as string) || undefined,
      });
      return { success: true, output: result || 'Fetch completed.' };
    } catch (err) {
      return { success: false, output: '', error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitStashTool = defineTool(
  'git_stash',
  'Stash current changes.',
  {
    message: { type: 'string', description: 'Optional stash message' },
    pop: { type: 'boolean', description: 'If true, pop the most recent stash instead of creating one' },
    index: { type: 'integer', description: 'Stash index to pop (default: 0, most recent)' },
  },
  [],
  'git',
  true,
  async (input, ctx) => {
    try {
      if (input.pop) {
        const idx = (input.index as number) || 0;
        await ctx.invoke('git_stash_pop', { repoPath: ctx.workspacePath, index: idx });
        return { success: true, output: `Stash popped (index: ${idx}).` };
      }
      await ctx.invoke('git_stash', {
        repoPath: ctx.workspacePath,
        message: (input.message as string) || undefined,
      });
      return { success: true, output: `Changes stashed.${input.message ? ` Message: ${input.message}` : ''}` };
    } catch (err) {
      return { success: false, output: '', error: `Stash failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitMergeTool = defineTool(
  'git_merge',
  'Merge a branch into the current branch.',
  {
    branch: { type: 'string', description: 'Branch to merge' },
  },
  ['branch'],
  'git',
  true,
  async (input, ctx) => {
    try {
      const result = await ctx.invoke<string>('git_merge', {
        repoPath: ctx.workspacePath,
        branch: input.branch as string,
      });
      return { success: true, output: result || `Merged branch: ${input.branch}` };
    } catch (err) {
      return { success: false, output: '', error: `Merge failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitResetTool = defineTool(
  'git_reset',
  'Reset current HEAD to a specific state. This is destructive — use with caution.',
  {
    mode: { type: 'string', description: 'Reset mode: soft, mixed, hard (default: mixed)' },
    target: { type: 'string', description: 'Commit hash, branch, or HEAD~N to reset to (default: HEAD)' },
  },
  [],
  'git',
  true,
  async (input, ctx) => {
    try {
      const mode = (input.mode as string) || 'mixed';
      const target = (input.target as string) || 'HEAD';
      const result = await ctx.invoke<string>('git_reset', {
        repoPath: ctx.workspacePath,
        mode,
        target,
      });
      return { success: true, output: result || `Reset completed: ${mode} → ${target}` };
    } catch (err) {
      return { success: false, output: '', error: `Reset failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitBlameTool = defineTool(
  'git_blame',
  'Show who last modified each line of a file.',
  {
    path: { type: 'string', description: 'File path' },
    line: { type: 'integer', description: 'Optional: blame only a specific line number' },
  },
  ['path'],
  'git',
  false,
  async (input, ctx) => {
    try {
      const filePath = resolvePath(input.path as string, ctx.workspacePath);
      const result = await ctx.invoke<string>('git_blame', {
        repoPath: ctx.workspacePath,
        filePath,
        line: (input.line as number) || undefined,
      });
      return { success: true, output: result };
    } catch (err) {
      return { success: false, output: '', error: `Blame failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

export const gitShowTool = defineTool(
  'git_show',
  'Show details about a specific commit (diff, files changed, stats).',
  {
    hash: { type: 'string', description: 'Commit hash (default: HEAD)' },
  },
  [],
  'git',
  false,
  async (input, ctx) => {
    try {
      const hash = (input.hash as string) || 'HEAD';
      const detail = await ctx.invoke<{
        hash: string;
        short_hash: string;
        message: string;
        author: string;
        timestamp: number;
        files: Array<{ path: string; status: string; insertions: number; deletions: number }>;
        total_insertions: number;
        total_deletions: number;
      }>('git_commit_detail', { repoPath: ctx.workspacePath, hash });

      const lines = [
        `${detail.short_hash} — ${detail.message}`,
        `Author: ${detail.author}`,
        `Date: ${new Date(detail.timestamp * 1000).toISOString()}`,
        `Files changed: ${detail.files.length} (+${detail.total_insertions} / -${detail.total_deletions})`,
        ...detail.files.map((f) => `  ${f.status} ${f.path} (+${f.insertions}/-${f.deletions})`),
      ];
      return { success: true, output: lines.join('\n'), metadata: detail };
    } catch (err) {
      return { success: false, output: '', error: `git show failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

// ─── Project Tools ──────────────────────────────────────────────────────────

export const detectProjectTypeTool = defineTool(
  'detect_project_type',
  'Detect the type of project in the workspace and list available scripts/dependencies.',
  {},
  [],
  'meta',
  false,
  async (_input, ctx) => {
    try {
      const files = await ctx.invoke<Array<{ name: string; is_dir: boolean }>>('list_dir', { path: ctx.workspacePath });
      const names = new Set(files.map((f) => f.name));

      let type = 'unknown';
      let scripts: string[] = [];

      if (names.has('package.json')) {
        type = 'node';
        try {
          const content = await ctx.invoke<string>('read_file', { path: `${ctx.workspacePath}/package.json` });
          const pkg = JSON.parse(content);
          scripts = Object.keys(pkg.scripts || {});
        } catch {
          // ignore parse errors
        }
      } else if (names.has('Cargo.toml')) {
        type = 'rust';
      } else if (names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')) {
        type = 'python';
      } else if (names.has('go.mod')) {
        type = 'go';
      } else if (names.has('pom.xml') || names.has('build.gradle')) {
        type = 'java';
      } else if (names.has('composer.json')) {
        type = 'php';
      }

      return {
        success: true,
        output: `Project type: ${type}${scripts.length > 0 ? `\nScripts: ${scripts.join(', ')}` : ''}`,
        metadata: { type, scripts },
      };
    } catch (err) {
      return { success: false, output: '', error: `Detection failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
);

// ─── Export All Tools ───────────────────────────────────────────────────────

export function getAllBuiltinTools(): ToolHandler[] {
  return [
    // Filesystem
    readFileTool,
    writeFileTool,
    editFileTool,
    createFileTool,
    deleteFileTool,
    renameFileTool,
    copyFileTool,
    listDirectoryTool,
    searchCodeTool,
    findFilesTool,
    getFileInfoTool,
    // Context gathering
    gatherContextTool,
    dropContextTool,
    listContextTool,
    // Terminal
    runTerminalCommandTool,
    // Git
    gitStatusTool,
    gitDiffTool,
    gitCommitTool,
    gitAddTool,
    gitLogTool,
    gitCheckoutTool,
    gitPushTool,
    gitPullTool,
    gitFetchTool,
    gitStashTool,
    gitMergeTool,
    gitResetTool,
    gitBlameTool,
    gitShowTool,
    // Code
    getDiagnosticsTool,
    // Browser
    webFetchTool,
    webSearchTool,
    // Meta
    activateSkillTool,
    listSkillsTool,
    createSkillTool,
    manageTasksTool,
    requestModeSwitchTool,
    askUserTool,
    detectProjectTypeTool,
    // Docker
    dockerListContainersTool,
    dockerListImagesTool,
    dockerContainerLogsTool,
    dockerRunTool,
  ];
}
