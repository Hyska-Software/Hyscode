import { describe, expect, it } from 'vitest';
import type { UiState } from './types';
import { TerminalRenderer } from './renderer';

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

    expect(rendered).toContain('HysCode');
    expect(rendered).toContain('SESSION');
    expect(rendered).toContain('SHORTCUTS');
    expect(rendered).toContain('MESSAGE');
    expect(rendered).toContain('Enter send');
  });

  it('keeps the header focused on global state while the sidebar owns session details', () => {
    const firstLine = new TerminalRenderer().render(state()).split('\n')[0];

    expect(firstLine).toContain('HysCode');
    expect(firstLine).toContain('connected');
    expect(firstLine).not.toContain('claude-sonnet');
    expect(firstLine).not.toContain('messages');
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
    expect(rendered).toContain('Tab complete');
    expect(rendered).toContain('Enter run');
  });

  it('keeps the narrow terminal readable without forcing the sidebar', () => {
    const rendered = new TerminalRenderer().render(state({ width: 80, height: 24 }));

    expect(rendered).toContain('Ready in');
    expect(rendered).not.toContain('SHORTCUTS');
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
});
