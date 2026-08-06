import { describe, expect, it } from 'vitest';
import type { UiState } from './types';
import { TerminalRenderer } from './renderer';
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
    sdd: { sessionId: null, session: null, tasks: [], phase: null, spec: null, review: null, failedTask: null, selectedTask: 0 },
    subagents: [],
    usage: { current: null, session: null, requestCount: 0, estimatedCost: 0, contextWindow: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    notices: [],
    updates: { status: 'idle', channel: 'stable', checkForUpdatesOnStartup: true, autoDownload: false, release: null, progress: null, installation: null, error: null },
    connectionState: 'connected',
    recovery: null,
    mainPanel: 'chat',
    capabilities: null,
    selectedToolIndex: 0,
    rules: [],
    skills: [],
    memories: [],
    scroll: 0,
    lastError: null,
    currentSessionId: 'session-123456',
    lastUserMessage: null,
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

    const plainLines = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split('\n');
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
    const firstLine = rendered.split('\n')[0].replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

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
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

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
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

    expect(plain).not.toContain('ACTIVITY');
    expect(plain).not.toContain('list_directory');
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
    const plain = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

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
    const plainLines = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split('\n');
    const composerHeaderIndex = plainLines.findIndex((line) => line.includes('MESSAGE'));
    const composerBottom = plainLines.slice(composerHeaderIndex).find((line) => line.includes('╰'));
    expect(composerBottom?.startsWith('  ')).toBe(true);
    expect(composerBottom?.trim()).toMatch(/^╰─+╯$/);
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
    const plainLines = rendered.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split('\n');
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
