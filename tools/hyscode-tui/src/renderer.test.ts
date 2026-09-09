import { describe, expect, it } from 'vitest';
import type { UiState } from './types';
import { TerminalRenderer, terminalCellWidth } from './renderer';
import { CLI_LOGO } from './logo';
import { BUILTIN_THEMES } from '@hyscode/tui-runtime';

function state(overrides: Partial<UiState> = {}): UiState {
  return {
    input: '',
    inputCursor: 0,
    inputHistory: [],
    historyIndex: null,
    workspace: 'C:/workspace/hyscode',
    projectId: 'C:/workspace/hyscode',
    provider: 'anthropic',
    model: 'claude-sonnet',
    git: { available: true, branch: 'main', insertions: 0, deletions: 0, changedFiles: 0 },
    themeId: 'hyscode-dark',
    themes: [...BUILTIN_THEMES],
    sidebarVisible: true,
    mode: 'build',
    sessionTitle: 'Refine the terminal experience',
    sessionMessageCount: 4,
    tabs: [],
    thinking: { enabled: true, level: 'medium' },
    approvalMode: 'manual',
    status: 'Ready · thinking medium',
    running: false,
    shouldQuit: false,
    interaction: null,
    transcript: [],
    tools: [],
    fileChanges: [],
    context: { attachments: [], gathered: [], gatheredTokens: 0, activeRulePaths: [], activeSkillNames: [], capabilities: null },
    terminals: [],
    activeTerminalId: null,
    sdd: { sessionId: null, session: null, tasks: [], phase: null, spec: null, review: null, failedTask: null, selectedTask: 0, expandedTask: false },
    selectedSubagent: 0,
    subagentDetail: null,
    agentTasks: [],
    subagents: [],
    usage: { current: null, session: null, requestCount: 0, estimatedCost: 0, contextWindow: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    notices: [],
    updates: { status: 'idle', channel: 'stable', checkForUpdatesOnStartup: true, autoDownload: false, release: null, progress: null, installation: null, error: null },
    connectionState: 'connected',
    recovery: null,
    mainPanel: 'chat',
    capabilities: null,
    rules: [],
    skills: [],
    memories: [],
    scroll: 0,
    lastError: null,
    currentSessionId: 'session-123456',
    sessions: [],
    projects: [],
    providers: [],
    models: [],
    overlay: 'none',
    overlayIndex: 0,
    commandFlow: null,
    focus: 'composer',
    width: 120,
    height: 32,
    ...overrides,
  };
}

describe('TUI renderer', () => {
  it('renders the mandatory external access warning and session-scoped actions', () => {
    const rendered = new TerminalRenderer().render(state({
      interaction: {
        kind: 'approval',
        requestId: 'external-1',
        toolName: 'write_file',
        toolCallId: 'call-external-1',
        description: 'edit external file',
        risk: 'destructive',
        input: { path: 'C:/external/file.txt' },
        externalAccess: {
          operation: 'write',
          paths: ['c:/external/file.txt'],
          directories: ['c:/external'],
          directoryScopes: [],
        },
      },
    }));

    expect(rendered).toContain('External access required');
    expect(rendered).toContain('This action will edit external data');
    expect(rendered).toContain('D allow directory for this session');
    expect(rendered).not.toContain('A approve all');
  });

  it('renders the contextual shell with an adaptive sidebar and persistent composer', () => {
    const rendered = new TerminalRenderer().render(state());

    expect(rendered).toContain('VORTEX');
    expect(rendered).toContain('SESSION');
    expect(rendered).toContain('SHORTCUTS');
    expect(rendered).toContain('MESSAGE');
    const composerHeader = rendered.split('\n').find((line) => line.includes('MESSAGE')) ?? '';
    expect(composerHeader).toContain('anthropic/claude-sonnet');
    expect(composerHeader.indexOf('anthropic/claude-sonnet')).toBeLessThan(composerHeader.indexOf('thinking medium'));
    expect(rendered).toContain('╰');
    expect(rendered).not.toContain('Enter send');

    const plainLines = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
    const plainComposerIndex = plainLines.findIndex((line) => line.includes('MESSAGE'));
    expect(plainLines[plainComposerIndex - 1]).toBe('');
    expect(plainLines[plainComposerIndex]).toMatch(/^\s{2}╭─ MESSAGE/);
    expect(plainLines[plainComposerIndex + 1]).toMatch(/^\s{2}│/);
  });

  it('keeps the header focused on global state while the sidebar owns session details', () => {
    const firstLine = new TerminalRenderer().render(state()).split('\n')[0];

    expect(firstLine).toContain('VORTEX');
    expect(firstLine).toContain('connected');
    expect(firstLine).toContain('anthropic/claude-sonnet');
    expect(firstLine).not.toContain('messages');
  });

  it('renders the active model beside Git branch and uncommitted line counts', () => {
    const rendered = new TerminalRenderer().render(state({
      git: { available: true, branch: 'feature/git-summary', insertions: 1213, deletions: 554, changedFiles: 8 },
    }));
    const firstLine = rendered.split('\n')[0].replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(firstLine).toContain('anthropic/claude-sonnet');
    expect(firstLine).toContain('feature/git-summary - +1213 - 554');
  });

  it('renders slash suggestions as a bottom command palette', () => {
    const rendered = new TerminalRenderer().render(state({
      input: '/mo',
      inputCursor: 3,
      commandFlow: { kind: 'root', query: '/mo', selected: 0, inputDriven: true },
      overlay: 'commands',
    }));

    expect(rendered).toContain('COMMAND PALETTE');
    expect(rendered).toContain('/mode');
    expect(rendered).not.toContain('Tab complete');
    expect(rendered).not.toContain('Enter run');
  });

  it('keeps the narrow terminal readable without forcing the sidebar', () => {
    const rendered = new TerminalRenderer().render(state({ width: 80, height: 24 }));

    expect(rendered).toContain('Ready in');
    expect(rendered).not.toContain('SHORTCUTS');
  });

  it('keeps every rendered row inside the real viewport and clears stale rows', () => {
    const rendered = new TerminalRenderer().render(state({
      width: 40,
      height: 12,
      sidebarVisible: false,
      transcript: [{ kind: 'assistant', text: '界界界界界界界界界界 🙂🙂🙂🙂🙂 long output that must be clipped' }],
    }));
    const rows = rendered.split('\n').map((row) => row.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '').replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/gu, '').replace(/\r/gu, ''));

    expect(terminalCellWidth('界🙂')).toBe(4);
    expect(terminalCellWidth('👩‍💻')).toBe(2);
    expect(terminalCellWidth('e\u0301')).toBe(1);
    expect(rows.every((row) => terminalCellWidth(row) <= 40)).toBe(true);
    expect(rendered).toContain('\u001b[2K\r');
  });

  it('uses a compact welcome layout instead of forcing a wide panel', () => {
    const rendered = new TerminalRenderer().render(state({ width: 40, height: 12, transcript: [] }));
    const rows = rendered.split('\n').map((row) => row.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '').replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/gu, '').replace(/\r/gu, ''));

    expect(rows.every((row) => terminalCellWidth(row) <= 40)).toBe(true);
    expect(rendered).toContain('VORTEX');
  });

  it('renders a structured startup welcome with the CLI logo and runtime details', () => {
    const rendered = new TerminalRenderer().render(state({
      sessions: [{
        id: 'session-123456',
        title: 'Refine the terminal experience',
        workspacePath: 'C:/workspace/hyscode',
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        agentType: 'build',
        updatedAt: '2026-08-06T12:00:00.000Z',
        messageCount: 4,
      }],
    }));

    expect(rendered).toContain('Welcome to VORTEX');
    expect(rendered).toContain('QUICK START');
    expect(rendered).toContain('RECENT SESSIONS');
    expect(rendered).toContain(CLI_LOGO[2]);
    expect(rendered).toContain('anthropic/claude-sonnet');
  });

  it('renders Markdown with readable blocks for prose, lists, quotes, links, tables, and code', () => {
    const rendered = new TerminalRenderer().render(state({
      width: 100,
      height: 70,
      sidebarVisible: false,
      transcript: [{
        kind: 'assistant',
        text: [
          '# Release notes',
          '',
          'Use **strong text**, *quiet emphasis*, `src/index.ts`, and [the docs](https://example.com/docs).',
          '',
          '- [x] Renderer shipped',
          '- [ ] Add more syntax coverage',
          '1. Keep the output calm',
          '2. Preserve the active theme',
          '',
          '> Markdown should feel like a document, not a raw stream.',
          '',
          '| Area | Status |',
          '| --- | --- |',
          '| renderer | ready |',
          '',
          '```ts',
          'const enabled = true;',
          '```',
        ].join('\n'),
      }],
    }));
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(plain).toContain('◆ Release notes');
    expect(plain).toContain('✓ Renderer shipped');
    expect(plain).toContain('○ Add more syntax coverage');
    expect(plain).toContain('1. Keep the output calm');
    expect(plain).toContain('│ Markdown should feel like a document');
    expect(plain).toContain('https://example.com/docs');
    expect(plain).toContain('┌──');
    expect(plain).toContain('renderer');
    expect(plain).not.toContain('| --- | --- |');
    expect(plain).toContain('╭─ ts');
    expect(plain).toContain('│ const enabled = true;');
    expect(plain).toContain('╰');
  });

  it('keeps inline code readable without reverse-video blocks', () => {
    const rendered = new TerminalRenderer().render(state({
      width: 100,
      height: 32,
      sidebarVisible: false,
      transcript: [{ kind: 'assistant', text: 'Inspect `apps/desktop/src` before changing the renderer.' }],
    }));
    const codeLine = rendered.split('\n').find((line) => line.includes('apps/desktop/src')) ?? '';

    expect(codeLine).toContain('apps/desktop/src');
    expect(codeLine).not.toContain('\u001b[7m');
  });

  it('does not render the tool activity card in the transcript', () => {
    const rendered = new TerminalRenderer().render(state({
      tools: [{
        id: 'tool-1',
        name: 'list_directory',
        input: {},
        status: 'success',
        liveOutput: '',
        outputSequence: 1,
        expanded: false,
      }],
    }));
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(plain).not.toContain('ACTIVITY');
    expect(plain).not.toContain('list_directory');
  });

  it('renders terminal tool command, state, terminal id, and focus action in activity', () => {
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'activity',
      transcript: [{ kind: 'assistant', text: 'The build is running.' }],
      tools: [{
        id: 'tool-terminal',
        name: 'run_terminal_command',
        input: { command: 'npm run build' },
        status: 'running',
        liveOutput: 'building',
        terminalId: 'terminal-agent-1',
        terminalState: 'running',
        outputSequence: 3,
        expanded: false,
      }],
    }));
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(plain).toContain('npm run build');
    expect(plain).toContain('terminal-agent-1');
    expect(plain).toContain('/terminal focus <id>');
  });

  it('renders a compact context meter from the active model window and current usage', () => {
    const rendered = new TerminalRenderer().render(state({
      usage: { current: null, session: null, requestCount: 1, estimatedCost: 0, contextWindow: 1000, inputTokens: 375, outputTokens: 20, totalTokens: 395 },
    }));

    expect(rendered).toContain('37.5%');
    expect(rendered).toContain('ctx');
    expect(rendered).toContain('━');
    expect(rendered.lastIndexOf('ctx')).toBeGreaterThan(rendered.indexOf('!command'));
  });

  it('scrolls long model flows so the selected option stays visible', () => {
    const models = Array.from({ length: 12 }, (_, index) => ({
      id: `model-${index}`,
      name: `Model ${index}`,
      provider: 'openai',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
    }));
    const rendered = new TerminalRenderer().render(state({
      height: 18,
      providers: [{ id: 'openai', name: 'OpenAI', configured: true, models }],
      commandFlow: { kind: 'model', providerIndex: 0, selected: 10 },
      overlay: 'commands',
    }));

    expect(rendered).toContain('Model 10');
    expect(rendered).toContain('/12 · PgUp/PgDn scroll');
    expect(rendered).not.toContain('Model 0');
  });

  it('renders keyboard-first action flows with contextual choices', () => {
    const rendered = new TerminalRenderer().render(state({
      commandFlow: { kind: 'action', action: 'approval', selected: 0 },
      overlay: 'commands',
    }));

    expect(rendered).toContain('APPROVAL');
    expect(rendered).toContain('Manual · ask before every protected tool');
    expect(rendered).toContain('Smart · ask only when risk requires it');
  });

  it('changes the terminal palette and background with the selected theme', () => {
    const renderer = new TerminalRenderer();
    const dark = renderer.render(state({ themeId: 'hyscode-dark' }));
    const light = renderer.render(state({ themeId: 'hyscode-light' }));

    expect(dark).toContain('\u001b[48;2;24;25;29m');
    expect(light).toContain('\u001b[48;2;241;242;244m');
    expect(light).not.toBe(dark);
  });

  it('colors the CLI logo with the active theme accent', () => {
    const renderer = new TerminalRenderer();
    const dark = renderer.render(state({ themeId: 'hyscode-dark' }));
    const light = renderer.render(state({ themeId: 'hyscode-light' }));
    const logoLine = CLI_LOGO[2];

    expect(dark).toContain(`\u001b[38;2;16;163;127m${logoLine}\u001b[0m`);
    expect(light).toContain(`\u001b[38;2;13;138;108m${logoLine}\u001b[0m`);
    expect(dark).not.toContain('\u001b[38;2;65;250;21m');
    expect(light).not.toContain('\u001b[38;2;65;250;21m');
  });

  it('removes the session sidebar when the persisted setting is disabled', () => {
    const rendered = new TerminalRenderer().render(state({ sidebarVisible: false }));
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(plain.split('\n').some((line) => line.trim() === 'SESSION')).toBe(false);
    expect(plain).not.toContain('SHORTCUTS');
    expect(rendered).toContain('MESSAGE');
  });

  it('wraps long prompts across the chat composer instead of truncating them', () => {
    const rendered = new TerminalRenderer().render(state({
      width: 80,
      input: 'Build a focused implementation plan for the TUI composer and preserve the existing runtime integration',
      inputCursor: 106,
    }));
    const promptLines = rendered.split('\n').filter((line) => line.includes('Build') || line.includes('runtime'));

    expect(promptLines.length).toBeGreaterThan(1);
    expect(rendered).not.toContain('Enter send');
    const plainLines = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
    const composerHeaderIndex = plainLines.findIndex((line) => line.includes('MESSAGE'));
    const composerBottom = plainLines.slice(composerHeaderIndex).find((line) => line.includes('╰'));
    expect(composerBottom?.startsWith('  ')).toBe(true);
    expect(composerBottom?.trim()).toMatch(/^╰─+╯$/);
  });

  it('masks sensitive terminal input and exposes the guarded terminal composer', () => {
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'terminal',
      input: 'secret-value',
      inputCursor: 12,
      terminalInput: { terminalId: 'term-1', masked: true },
      terminals: [{
        terminalId: 'term-1',
        ptyId: 'pty-1',
        name: 'Agent Terminal',
        alive: true,
        sequence: 4,
        outputPreview: 'Password:',
        frameLanguage: 'powershell',
        role: 'agent',
        awaitingInput: true,
        failure: null,
      }],
      activeTerminalId: 'term-1',
    }));
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(plain).toContain('TERMINAL INPUT');
    expect(plain).toContain('••••••••••••');
    expect(plain).not.toContain('secret-value');
  });

  it('renders terminal failures as final state instead of active work', () => {
    const failedState = state({
      mainPanel: 'activity',
      transcript: [{ kind: 'tool', text: 'npm test', toolId: 'terminal-tool' }],
      tools: [{
        id: 'terminal-tool',
        name: 'run_terminal_command',
        input: { command: 'npm test' },
        status: 'error',
        liveOutput: 'partial output',
        outputSequence: 4,
        expanded: false,
        terminalId: 'term-failed',
        terminalState: 'error',
        failure: { operation: 'reader', message: 'PTY reader failed' },
      }],
      terminals: [{
        terminalId: 'term-failed',
        ptyId: 'pty-failed',
        name: 'Failed terminal',
        alive: false,
        sequence: 4,
        outputPreview: 'partial output',
        frameLanguage: 'powershell',
        role: 'agent',
        awaitingInput: false,
        failure: { operation: 'reader', message: 'PTY reader failed' },
      }],
      activeTerminalId: 'term-failed',
    });
    const rendered = new TerminalRenderer().render(failedState);
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
    const terminalRendered = new TerminalRenderer().render({
      ...failedState,
      mainPanel: 'terminal',
      transcript: [{ kind: 'assistant', text: 'Terminal failure observed.' }],
    });
    const terminalPlain = terminalRendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

    expect(plain).toContain('failed');
    expect(plain).toContain('PTY reader failed');
    expect(terminalPlain).toContain('exited');
    expect(plain).not.toContain('· running');
  });

  it('shows an animated working indicator at the top of the execution chat area', () => {
    const rendered = new TerminalRenderer().render(state({
      running: true,
      status: 'Working…',
      sidebarVisible: false,
      transcript: [
        { kind: 'user', text: 'Build the requested change.' },
        { kind: 'assistant', text: 'I am executing the requested change.' },
      ],
    }));
    const plainLines = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
    const workingIndex = plainLines.findIndex((line) => line.includes('Working...'));
    const chatIndex = plainLines.findIndex((line) => line.includes('› you'));

    expect(workingIndex).toBeGreaterThan(-1);
    expect(plainLines[workingIndex].trimEnd()).toMatch(/^\s{2}[· ]+Working\.\.\.$/);
    expect(plainLines[workingIndex + 1].trim()).toBe('');
    expect(workingIndex).toBeLessThan(chatIndex);

    const composerWorkingLine = plainLines.find((line) => line.includes('╭─ WORKING')) ?? '';
    expect(composerWorkingLine).toMatch(/WORKING\s+[· ]+\s+Working/u);
  });
});


describe('TUI renderer improvements', () => {
  const plainOf = (rendered: string): string =>
    rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

  it('renders linked tool cards with status glyph, semantic headline, and duration', () => {
    const rendered = new TerminalRenderer().render(state({
      transcript: [{ kind: 'tool', text: 'npm test', toolId: 't1' }],
      tools: [{
        id: 't1',
        name: 'run_terminal_command',
        input: { command: 'npm test' },
        status: 'success',
        liveOutput: '',
        outputSequence: 0,
        durationMs: 1500,
        expanded: false,
      }],
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('✓');
    expect(plain).toContain('run_terminal_command');
    expect(plain).toContain('npm test');
    expect(plain).toContain('1.5s');
  });

  it('renders one linked card when duplicate transcript entries share a tool identity', () => {
    const rendered = new TerminalRenderer().render(state({
      transcript: [
        { kind: 'tool', text: 'npm test', toolId: 'duplicate-tool' },
        { kind: 'tool', text: 'npm test', toolId: 'duplicate-tool' },
      ],
      tools: [{
        id: 'duplicate-tool',
        name: 'run_terminal_command',
        input: { command: 'npm test' },
        status: 'running',
        liveOutput: '',
        outputSequence: 0,
        expanded: false,
      }],
    }));
    const plain = plainOf(rendered);

    expect((plain.match(/run_terminal_command/g) ?? []).length).toBe(1);
  });

  it('deduplicates terminal tools in the activity panel by tool identity', () => {
    const tool = {
      id: 'activity-tool',
      name: 'run_terminal_command',
      input: { command: 'npm test' },
      status: 'running' as const,
      liveOutput: '',
      outputSequence: 0,
      terminalId: 'terminal-1',
      expanded: false,
    };
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'activity',
      transcript: [{ kind: 'assistant', text: 'working' }],
      tools: [tool, { ...tool }],
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('TERMINAL TOOLS · 1');
    expect((plain.match(/run_terminal_command/g) ?? []).length).toBe(1);
  });

  it('expands the tool card body with input and tail output', () => {
    const rendered = new TerminalRenderer().render(state({
      transcript: [{ kind: 'tool', text: 'src/a.ts', toolId: 't2' }],
      tools: [{
        id: 't2',
        name: 'edit_file',
        input: { path: 'src/a.ts', old_string: 'a', new_string: 'b' },
        status: 'success',
        output: 'first line\nsecond line',
        liveOutput: '',
        outputSequence: 2,
        expanded: true,
      }],
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('input');
    expect(plain).toContain('output');
    expect(plain).toContain('second line');
    expect(plain).toContain('"old_string"');
  });

  it('routes standalone result items through the markdown pipeline', () => {
    const rendered = new TerminalRenderer().render(state({
      sidebarVisible: false,
      transcript: [{ kind: 'result', text: '```ts\nconst value = 1;\n```' }],
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('╭─ ts');
    expect(plain).toContain('const value = 1;');
  });

  it('aligns diff previews instead of pairing lines by index', () => {
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'activity',
      transcript: [{ kind: 'assistant', text: 'reviewing' }],
      fileChanges: [{
        toolCallId: 'c1',
        toolName: 'edit_file',
        filePath: 'src/a.ts',
        originalContent: 'a\nb\nc',
        newContent: 'a\nx\nb\nc',
        status: 'pending',
        expanded: false,
      }],
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('+ x');
    expect(plain).not.toContain('- b');
    expect(plain).not.toContain('- c');
  });

  it('presents approval inputs semantically with a proposed-change preview', () => {
    const rendered = new TerminalRenderer().render(state({
      interaction: {
        kind: 'approval',
        requestId: 'approval-1',
        toolName: 'edit_file',
        toolCallId: 'call-edit-1',
        description: 'update greeting',
        risk: 'moderate',
        input: { path: 'src/greet.ts', old_string: 'Hello', new_string: 'Hi' },
      },
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('src/greet.ts');
    expect(plain).toContain('proposed change');
    expect(plain).toContain('+ Hi');
    expect(plain).not.toContain('"old_string"');
  });

  it('skips identical frames until the renderer is invalidated', () => {
    const renderer = new TerminalRenderer();
    const first = renderer.render(state());
    expect(first).not.toBe('');
    expect(renderer.render(state())).toBe('');
    renderer.invalidate();
    expect(renderer.render(state())).not.toBe('');
  });

  it('repaints when theme or viewport changes between frames', () => {
    const renderer = new TerminalRenderer();
    expect(renderer.render(state({ themeId: 'hyscode-dark' }))).not.toBe('');
    expect(renderer.render(state({ themeId: 'hyscode-light' }))).not.toBe('');
    expect(renderer.render(state({ width: 90, height: 24, sidebarVisible: false }))).not.toBe('');
  });

  it('colors the composer frame by focus so the active pane is visible', () => {
    const accent = '\u001b[38;2;16;163;127m';
    const headerOf = (focus: UiState['focus']): string => {
      const rendered = new TerminalRenderer().render(state({ focus }));
      const rawLines = rendered.split('\n');
      const index = rawLines.findIndex((line) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').includes('╭─ MESSAGE'));
      return index >= 0 ? rawLines[index] : '';
    };
    const composerLine = headerOf('composer');
    const transcriptLine = headerOf('transcript');

    expect(composerLine).toContain(`${accent}╭─ `);
    expect(transcriptLine).not.toContain(`${accent}╭─ `);
    expect(composerLine).not.toEqual(transcriptLine);
  });

  it('shows a scroll position hint anchored to the viewport while scrolled', () => {
    const rendered = new TerminalRenderer().render(state({
      height: 40,
      scroll: 5,
      transcript: Array.from({ length: 60 }, (_, index) => ({ kind: 'assistant' as const, text: `paragraph ${index}` })),
    }));
    const plain = plainOf(rendered);

    expect(plain).toContain('↑ 5/');
    expect(plain).toContain('line(s) above · PgDn/Wheel returns to live output');
  });

  it('adapts the composer placeholder to the active mode and terminal guard', () => {
    const review = plainOf(new TerminalRenderer().render(state({ mode: 'review' })));
    const maskedTerminal = plainOf(new TerminalRenderer().render(state({
      input: '',
      terminalInput: { terminalId: 'term-1', masked: true },
    })));

    expect(review).toContain('Point at the code or diff that should be reviewed');
    expect(maskedTerminal).toContain('Type the sensitive value the terminal is asking for');
  });

  it('windows very large prompts around the cursor with overflow markers', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`);
    const rendered = new TerminalRenderer().render(state({
      width: 80,
      input: lines.join('\n'),
      inputCursor: 150,
    }));
    const plain = plainOf(rendered);

    expect(plain).toMatch(/⋯ \+\d+ line\(s\) above/);
    expect(plain).toContain(`line-${20 - 1}`);
    expect(plain).not.toContain('line-0\n');
  });

  it('surfaces the latest attention notice or last error above the composer', () => {
    const noticed = plainOf(new TerminalRenderer().render(state({
      notices: [{ id: 'n1', level: 'warning', text: 'Runtime reconnected', createdAt: Date.now() }],
    })));
    const errored = plainOf(new TerminalRenderer().render(state({ lastError: 'boom' })));

    expect(noticed).toContain('▲ Runtime reconnected');
    expect(errored).toContain('× boom');
  });

  it('wraps file tool cards and the terminal panel in a discreet rounded frame', () => {
    const rendered = new TerminalRenderer().render(state({
      transcript: [{ kind: 'tool', text: 'src/app.ts', toolId: 'f1' }],
      tools: [{
        id: 'f1',
        name: 'read_file',
        input: { path: 'src/app.ts' },
        status: 'success',
        output: 'export const app = 1;',
        liveOutput: '',
        outputSequence: 1,
        expanded: false,
      }],
      mainPanel: 'terminal',
      terminals: [{
        terminalId: 'term-1',
        ptyId: 'pty-1',
        name: 'Agent Terminal',
        alive: true,
        sequence: 2,
        outputPreview: 'build ok',
        frameLanguage: 'powershell' as const,
        role: 'agent' as const,
        awaitingInput: false,
        failure: null,
      }],
      activeTerminalId: 'term-1',
    }));
    const rawLines = rendered.split('\n');
    const stripped = rawLines.map((line) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, ''));

    const cardIndex = stripped.findIndex((line) => line.includes('read_file'));
    expect(cardIndex).toBeGreaterThan(-1);
    expect(stripped[cardIndex]).toContain('╭─');
    expect(stripped[cardIndex]).toContain('src/app.ts');
    expect(stripped.slice(cardIndex, cardIndex + 3).some((line) => line.trimEnd().endsWith('╯'))).toBe(true);
    expect(stripped.some((line) => line.includes('│') && line.includes('export const app = 1;'))).toBe(true);

    const terminalIndex = stripped.findIndex((line) => line.includes('TERMINAL'));
    expect(terminalIndex).toBeGreaterThan(cardIndex);
    expect(stripped[terminalIndex]).toContain('╭─');
    expect(stripped.slice(terminalIndex).some((line) => line.includes('build ok'))).toBe(true);
    expect(stripped.every((line) => terminalCellWidth(line) <= 120)).toBe(true);
  });

  function subAgentFixture(overrides: Partial<UiState['subagents'][number]> = {}): UiState['subagents'][number] {
    const now = Date.now();
    return {
      ownerId: 'tool-call-1',
      mode: 'review',
      task: 'Audit the auth middleware for token expiry bugs',
      status: 'running',
      stopReason: undefined,
      output: 'Found two issues:\n1. expiry skew ignored\n2. default leeway 0',
      thinking: 'Considering clock skew between services',
      toolIds: ['child-tool-1'],
      startedAt: now - 1500,
      endedAt: null,
      tokenUsage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200 },
      ...overrides,
    };
  }

  it('renders rich sub-agent rows with mode, tools, tokens, and queue metadata', () => {
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'activity',
      transcript: [{ kind: 'assistant', text: 'delegating' }],
      capabilities: { slashCommands: true, contextMentions: true, fileAttachments: true, directoryAttachments: true, terminalAttachments: true, imageAttachments: true, interactiveTerminal: true, approvals: true, fileReview: true, sdd: true, subAgents: true, sessionManagement: true, subAgentMaxConcurrent: 2 },
      subagents: [
        subAgentFixture({ status: 'queued' }),
        subAgentFixture({ ownerId: 'tool-call-2', status: 'done', endedAt: Date.now() - 500 }),
      ],
    }));
    const plain = plainOf(rendered);
    expect(plain).toContain('SUB-AGENTS · 1 active of 2');
    expect(plain).toContain('review');
    expect(plain).toContain('slot wait · 0/2 active');
    expect(plain).toContain('1200 tok');
    expect(plain).toContain('/subagents opens the panel');
  });

  it('marks hidden older sub-agents instead of silently truncating the list', () => {
    const agents = Array.from({ length: 8 }, (_, index) => subAgentFixture({ ownerId: `agent-${index}`, task: `Task ${index}` }));
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'activity',
      transcript: [{ kind: 'assistant', text: 'delegating' }],
      subagents: agents,
    }));
    const plain = plainOf(rendered);
    expect(plain).toContain('⋯ 2 earlier sub-agent(s)');
    expect(plain).toContain('Task 7');
    expect(plain).not.toContain('Task 1 ·');
  });

  it('opens a sub-agents panel with selection and a detail frame with tails and tool rows', () => {
    const tool = {
      id: 'child-tool-1',
      name: 'read_file',
      input: { path: 'src/auth/middleware.ts' },
      status: 'success' as const,
      liveOutput: '',
      outputSequence: 1,
      expanded: false,
      ownerId: 'tool-call-1',
      durationMs: 12,
    };
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'subagents',
      transcript: [{ kind: 'assistant', text: 'delegating' }],
      tools: [tool],
      subagents: [subAgentFixture({ status: 'done', endedAt: Date.now() - 100 })],
      selectedSubagent: 0,
      subagentDetail: 0,
    }));
    const plain = plainOf(rendered);
    expect(plain).toContain('SUB-AGENT');
    expect(plain).toContain('elapsed');
    expect(plain).toContain('expiry skew ignored');
    expect(plain).toContain('src/auth/middleware.ts');
    expect(plain).toContain('Considering clock skew');
  });

  it('deduplicates repeated sub-agent tool identities in the detail panel', () => {
    const tool = {
      id: 'child-tool-1',
      name: 'read_file',
      input: { path: 'src/auth/middleware.ts' },
      status: 'success' as const,
      liveOutput: '',
      outputSequence: 1,
      expanded: false,
      ownerId: 'tool-call-1',
      durationMs: 12,
    };
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'subagents',
      transcript: [{ kind: 'assistant', text: 'delegating' }],
      tools: [tool],
      subagents: [subAgentFixture({ status: 'done', endedAt: Date.now() - 100, toolIds: ['child-tool-1', 'child-tool-1'] })],
      selectedSubagent: 0,
      subagentDetail: 0,
    }));
    const plain = plainOf(rendered);

    expect((plain.match(/src\/auth\/middleware\.ts/g) ?? []).length).toBe(1);
  });

  it('shows sdd progress counts, failed task, review, and expanded task detail', () => {
    const baseTask = { id: 't1', sessionId: 's1', ordinal: 1, title: 'Wire the store', description: 'Create the reducer and wire it into the panel.', files: ['src/store.ts'], dependencies: [], status: 'completed' as const, agentOutput: null, toolCalls: [], createdAt: '', updatedAt: '' };
    const failed = { ...baseTask, id: 't2', ordinal: 2, title: 'Render tasks', status: 'failed' as const };
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'sdd',
      transcript: [{ kind: 'assistant', text: 'executing' }],
      sdd: {
        sessionId: 'sdd-1',
        session: null,
        phase: 'executing',
        spec: null,
        review: 'Overall the plan is sound but the retry path is untested.',
        failedTask: failed,
        tasks: [baseTask, failed],
        selectedTask: 0,
        expandedTask: true,
      },
    }));
    const plain = plainOf(rendered);
    expect(plain).toContain('TASKS · 1/2 completed');
    expect(plain).toContain('FAILED · #2 Render tasks');
    expect(plain).toContain('REVIEW');
    expect(plain).toContain('retry path is untested');
    expect(plain).toContain('Create the reducer and wire it into the panel.');
    expect(plain).toContain('files · src/store.ts');
  });

  it('windows long sdd task lists with ellipsis rows around the selection', () => {
    const tasks = Array.from({ length: 14 }, (_, index) => ({
      id: `t${index}`,
      sessionId: 's1',
      ordinal: index + 1,
      title: `Task number ${index}`,
      description: '',
      files: [],
      dependencies: [],
      status: 'pending' as const,
      agentOutput: null,
      toolCalls: [],
      createdAt: '',
      updatedAt: '',
    }));
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'sdd',
      transcript: [{ kind: 'assistant', text: 'plan' }],
      sdd: { sessionId: 'sdd-1', session: null, phase: 'executing', spec: null, review: null, failedTask: null, tasks, selectedTask: 7, expandedTask: false },
    }));
    const plain = plainOf(rendered);
    expect(plain).toMatch(/⋯ \d+ above/);
    expect(plain).toMatch(/below/);
    expect(plain).toContain('Task number 7');
    expect(plain).not.toContain('Task number 13\n');
  });

  it('attributes terminal tools owned by sub-agents and renders the turn-local task list', () => {
    const rendered = new TerminalRenderer().render(state({
      mainPanel: 'activity',
      transcript: [{ kind: 'assistant', text: 'running suite' }],
      tools: [{
        id: 'term-tool',
        name: 'run_terminal_command',
        input: {},
        status: 'running',
        liveOutput: '',
        outputSequence: 1,
        expanded: false,
        ownerId: 'sub-agent-owner',
        terminalId: 'term-9',
      }],
      agentTasks: [
        { id: 1, title: 'Reproduce bug', status: 'completed' },
        { id: 2, title: 'Patch parser', status: 'in_progress' },
      ],
    }));
    const plain = plainOf(rendered);
    expect(plain).toContain('↳ sub-agent');
    expect(plain).toContain('TASK LIST · 1/2 done');
    expect(plain).toContain('Patch parser');
  });

  it('surfaces delegation pressure in the header chip and working banner', () => {
    const runningState = state({
      running: true,
      transcript: [],
      subagents: [subAgentFixture(), subAgentFixture({ ownerId: 'second', status: 'queued' })],
    });
    const rendered = new TerminalRenderer().render(runningState);
    const plain = plainOf(rendered);
    expect(plain).toContain('⚙2');
    expect(plain).toContain('Working · 2 sub-agent(s) active');
  });
});