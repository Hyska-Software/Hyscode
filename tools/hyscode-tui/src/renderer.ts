import { DEFAULT_THEME_ID } from '@hyscode/tui-runtime';
import { COMMANDS, flowTitle, matchingCommands, selectionOptions } from './commands';
import { getCliLogo } from './logo';
import { dynamicAnsiToken, resolveAnsiTheme, type AnsiToken, type AnsiTheme } from './theme';
import type { CommandFlow, InteractionState, TranscriptItem, UiState } from './types';

let activeAnsiTheme: AnsiTheme = resolveAnsiTheme(DEFAULT_THEME_ID, []);

const RESET = dynamicAnsiToken(() => activeAnsiTheme.reset);
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const ITALIC = '\u001b[3m';
const UNDERLINE = '\u001b[4m';
const STRIKETHROUGH = '\u001b[9m';
const INVERSE = '\u001b[7m';
const ACCENT = dynamicAnsiToken(() => activeAnsiTheme.accent);
const MUTED = dynamicAnsiToken(() => activeAnsiTheme.muted);
const SOFT = dynamicAnsiToken(() => activeAnsiTheme.soft);
const WARNING = dynamicAnsiToken(() => activeAnsiTheme.warning);
const SUCCESS = dynamicAnsiToken(() => activeAnsiTheme.success);
const ERROR = dynamicAnsiToken(() => activeAnsiTheme.error);
const PANEL = dynamicAnsiToken(() => activeAnsiTheme.panel);

const SIDEBAR_WIDTH = 27;
const COMPOSER_HORIZONTAL_PADDING = 2;
const COMPOSER_SECTION_GAP = 1;
const WORKING_FRAME_INTERVAL_MS = 160;
const WORKING_FRAMES = ['·  ', '·· ', '···', ' ··', '  ·', ' ··'] as const;

export class TerminalRenderer {
  render(state: UiState): string {
    const previousTheme = activeAnsiTheme;
    activeAnsiTheme = resolveAnsiTheme(state.themeId, state.themes);
    try {
      const width = Math.max(60, state.width);
      const height = Math.max(16, state.height);
      const header = headerLines(state, width);
      const composer = composerLines(state, width);
      const panelBudget = Math.max(0, height - header.length - composer.length - 4);
      const rawPanel = this.overlayLines(state, width, panelBudget);
      const panel = rawPanel.slice(0, panelBudget);
      const bodyHeight = Math.max(3, height - header.length - panel.length - composer.length);
      const executionBanner = state.running ? [workingIndicator(), ''] : [];
      const transcriptHeight = Math.max(1, bodyHeight - executionBanner.length);
      const sidebarWidth = state.sidebarVisible && width >= 100 ? SIDEBAR_WIDTH : 0;
      const mainWidth = sidebarWidth > 0 ? width - sidebarWidth - 1 : width;
      const transcript = transcriptView(state.transcript, Math.max(20, mainWidth - 2), state);
      const start = Math.max(0, transcript.length - transcriptHeight - state.scroll);
      const visibleTranscript = transcript.slice(start, start + transcriptHeight);
      const body = layoutBody([...executionBanner, ...visibleTranscript], state, width, bodyHeight, sidebarWidth);
      const lines = [...header, ...body, ...panel, ...composer];
      while (lines.length < height) lines.push('');
      return `${activeAnsiTheme.reset}\u001b[2J\u001b[H${lines.slice(0, height).map((line) => fitAnsi(line, width)).join('\n')}${RESET}`;
    } finally {
      activeAnsiTheme = previousTheme;
    }
  }

  private overlayLines(state: UiState, width: number, maxHeight: number): string[] {
    if (state.interaction) return makePanel('ACTION REQUIRED', interactionLines(state.interaction, width), width);
    if (state.commandFlow) return makePanel(commandPanelTitle(state.commandFlow), commandFlowLines(state, width, maxHeight), width);
    if (state.overlay === 'help') return makePanel('HELP · KEYBOARD FIRST', helpLines(), width);
    if (state.overlay === 'sessions') {
      const items = state.sessions.map((session) => `${session.title}  ·  ${session.messageCount} messages  ·  ${shorten(session.id, 12)}`);
      return makePanel('SAVED SESSIONS', listLines(items, state.overlayIndex, width, maxHeight), width);
    }
    if (state.overlay === 'projects') {
      const items = state.projects.map((project) => `${shorten(project.workspacePath, width - 20)}  ·  ${project.sessionCount} sessions`);
      return makePanel('WORKSPACES', listLines(items, state.overlayIndex, width, maxHeight), width);
    }
    return [];
  }
}

function headerLines(state: UiState, width: number): string[] {
  const runtime = state.running ? `${WARNING}${BOLD}working${RESET}` : `${SUCCESS}${BOLD}ready${RESET}`;
  const connection = state.connectionState === 'connected' ? `${SUCCESS}● connected${RESET}` : `${WARNING}● ${state.connectionState}${RESET}`;
  const left = `${ACCENT}${BOLD}VORTEX${RESET} ${MUTED}·${RESET} ${shorten(state.workspace, Math.max(20, width - 42))}`;
  const model = state.provider && state.model ? `${state.provider}/${state.model}` : 'model not selected';
  const modelText = `${SOFT}${shorten(model, Math.max(12, Math.min(32, Math.floor(width * 0.28))))}${RESET}`;
  const gitText = gitSummaryLine(state.git, Math.max(14, Math.min(36, Math.floor(width * 0.32))));
  const right = `${modelText} ${MUTED}·${RESET} ${gitText}  ${runtime}  ${connection}`;
  const lines = [alignColumns(left, right, width)];
  if (state.tabs.length > 1) {
    lines.push(state.tabs.map((tab) => `${tab.active ? `${ACCENT}${BOLD}` : MUTED}${tab.active ? '●' : '○'} ${shorten(tab.title, 22)}${RESET}`).join('  '));
  }
  lines.push(`${PANEL}${'─'.repeat(width)}${RESET}`);
  return lines;
}

function gitSummaryLine(summary: UiState['git'], width: number): string {
  if (!summary.available) return `${MUTED}git unavailable${RESET}`;
  const branch = shorten(summary.branch || 'detached', Math.max(8, width - 16));
  const insertions = Number.isFinite(summary.insertions) ? Math.max(0, Math.floor(summary.insertions)) : 0;
  const deletions = Number.isFinite(summary.deletions) ? Math.max(0, Math.floor(summary.deletions)) : 0;
  return `${ACCENT}${branch}${RESET} ${MUTED}-${RESET} ${SUCCESS}+${insertions}${RESET} ${MUTED}-${RESET} ${ERROR}${deletions}${RESET}`;
}

function layoutBody(lines: string[], state: UiState, width: number, height: number, sidebarWidth: number): string[] {
  const mainWidth = sidebarWidth > 0 ? width - sidebarWidth - 1 : width;
  const paddedMain = [...lines];
  while (paddedMain.length < height) paddedMain.push('');
  if (sidebarWidth === 0) return paddedMain.slice(0, height).map((line) => `  ${line}`);

  const sidebar = sidebarLines(state, sidebarWidth - 1, height);
  return Array.from({ length: height }, (_, index) => {
    const sidebarLine = padAnsi(sidebar[index] ?? '', sidebarWidth - 1);
    const mainLine = padAnsi(paddedMain[index] ?? '', mainWidth);
    return `${sidebarLine}${PANEL}│${RESET}${mainLine}`;
  });
}

function sidebarLines(state: UiState, width: number, height: number): string[] {
  const lines: string[] = [
    `${ACCENT}${BOLD}SESSION${RESET}`,
    ` ${shorten(state.sessionTitle, width - 1)}`,
    ` ${DIM}${shorten(state.currentSessionId ?? 'not saved yet', width - 1)}${RESET}`,
    '',
    `${MUTED}MODE${RESET}`,
    ` ${BOLD}${state.mode}${RESET}  ${DIM}Shift-Tab${RESET}`,
    '',
    `${MUTED}MODEL${RESET}`,
    ` ${shorten(state.provider || 'not configured', width - 1)}`,
    ` ${shorten(state.model || 'choose with /model', width - 1)}`,
    ` ${DIM}thinking ${state.thinking.enabled ? state.thinking.level ?? 'on' : 'off'}${RESET}`,
    ` ${DIM}approval ${shorten(state.approvalMode, width - 12)}${RESET}`,
    '',
    `${MUTED}CONTEXT${RESET}`,
    ` ${state.context.attachments.length} attachment(s)`,
    ` ${state.context.gatheredTokens.toLocaleString()} gathered tokens`,
    ` ${state.fileChanges.filter((change) => change.status === 'pending').length} pending change(s)`,
    '',
    `${MUTED}RUNTIME${RESET}`,
    ` ${state.running ? `${WARNING}working${RESET}` : `${SUCCESS}ready${RESET}`}`,
    ...wrapText(state.status, width - 1).slice(0, 2).map((line) => ` ${DIM}${line}${RESET}`),
    ...(state.recovery ? [` ${WARNING}/ ${state.recovery.action} available${RESET}`] : []),
    '',
    `${MUTED}SHORTCUTS${RESET}`,
    ` /  command palette`,
    ` Ctrl-K  command palette`,
    ` Ctrl-T  thinking`,
    ` Tab     focus`,
    ` Wheel   history scroll`,
    ` PgUp    scroll up`,
    ` Ctrl-C  cancel / quit`,
    ` !cmd    terminal command`,
    ` @path   attach context`,
  ];
  return lines.slice(0, height);
}

function transcriptView(items: TranscriptItem[], width: number, state: UiState): string[] {
  if (items.length === 0) return emptyTranscript(state, width);
  const lines: string[] = [];
  for (const item of items) {
    const [label, marker, color] = transcriptStyle(item.kind);
    lines.push(`${color}${BOLD}${marker} ${label}${RESET}`);
    const itemLines = renderMarkdown(item.text, item.kind, Math.max(12, width - 4));
    for (const itemLine of itemLines) {
      const prefix = item.kind === 'user' ? `${ACCENT}  ${itemLine}${RESET}` : `  ${itemLine}`;
      lines.push(prefix);
    }
    lines.push('');
  }
  if (state.mainPanel === 'terminal') lines.push(...terminalPanel(state, width));
  else if (state.mainPanel === 'sdd') lines.push(...sddPanel(state, width));
  else if (state.mainPanel === 'activity') lines.push(...activityPanel(state, width));
  if (state.scroll > 0) lines.push(`${MUTED}↑ ${state.scroll} line(s) above · Wheel/PgDn returns to live output${RESET}`);
  return lines;
}

function terminalPanel(state: UiState, width: number): string[] {
  const terminal = state.terminals.find((candidate) => candidate.terminalId === state.activeTerminalId) ?? state.terminals[0];
  if (!terminal) return [`${MUTED}No terminal open. Use /terminal to choose an action or !command.${RESET}`, ''];
  return [
    `${ACCENT}${BOLD}TERMINAL · ${shorten(terminal.name, width - 24)}${RESET} ${DIM}${terminal.frameLanguage} · ${terminal.alive ? 'alive' : 'exited'} · seq ${terminal.sequence}${RESET}`,
    ...wrapText(terminal.outputPreview || 'Terminal is ready for input.', Math.max(12, width - 4)).slice(-10).map((line) => `${SOFT}${line}${RESET}`),
    `${terminal.awaitingInput ? `${WARNING}Input is required${RESET} · type a response and press Enter` : `${DIM}Type !command to send input`}${RESET} · /terminal to focus · /attach terminal:${terminal.terminalId}${RESET}`,
    '',
  ];
}

function sddPanel(state: UiState, width: number): string[] {
  const sdd = state.sdd;
  if (!sdd.sessionId) return [`${MUTED}No SDD session. Use /sdd and choose Start.${RESET}`, ''];
  const lines = [`${ACCENT}${BOLD}SDD · ${sdd.phase ?? 'active'}${RESET} ${DIM}${shorten(sdd.sessionId, 18)}${RESET}`];
  if (sdd.spec) lines.push(...wrapText(sdd.spec, Math.max(12, width - 4)).slice(0, 6).map((line) => `${SOFT}${line}${RESET}`));
  if (sdd.tasks.length) {
    lines.push(`${MUTED}TASKS${RESET}`);
    for (const [index, task] of sdd.tasks.slice(0, 8).entries()) {
      const selected = index === sdd.selectedTask;
      const marker = task.status === 'completed' ? '✓' : task.status === 'failed' ? '×' : task.status === 'in_progress' ? '›' : '·';
      lines.push(`${selected ? ACCENT : MUTED}${selected ? '▸' : ' '} ${marker} ${shorten(task.title, width - 24)}${RESET} ${DIM}${task.status}${RESET}`);
    }
  }
  lines.push(`${DIM}/sdd approve-spec · /sdd approve-plan · /sdd resume${RESET}`, '');
  return lines;
}

function activityPanel(state: UiState, width: number): string[] {
  const lines = [`${ACCENT}${BOLD}SESSION ACTIVITY${RESET}`];
  const pending = state.fileChanges.filter((change) => change.status === 'pending');
  lines.push(`${DIM}Usage: ${state.usage.inputTokens.toLocaleString()} in · ${state.usage.outputTokens.toLocaleString()} out · ${state.usage.requestCount} request(s) · $${state.usage.estimatedCost.toFixed(4)}${RESET}`);
  if (pending.length) {
    lines.push(`${WARNING}FILE REVIEW · ${pending.length} pending${RESET}`);
    for (const change of pending.slice(0, 4)) {
      lines.push(`  ${WARNING}·${RESET} ${shorten(change.filePath, width - 8)}`);
      lines.push(...changeDiff(change.originalContent, change.newContent, width).slice(0, 5));
    }
    lines.push(`${DIM}Use /diffs to choose accept, reject, or bulk review actions.${RESET}`);
  }
  if (state.subagents.length) {
    lines.push(`${ACCENT}SUB-AGENTS · ${state.subagents.length}${RESET}`);
    for (const agent of state.subagents.slice(-6)) lines.push(`  ${agent.status === 'done' ? SUCCESS : agent.status === 'error' ? ERROR : WARNING}●${RESET} ${shorten(agent.task || agent.ownerId, width - 18)} ${DIM}${agent.status}${RESET}`);
  }
  const terminalTools = state.tools.filter((tool) => tool.terminalId);
  if (terminalTools.length) {
    lines.push(`${ACCENT}TERMINAL TOOLS · ${terminalTools.length}${RESET}`);
    for (const tool of terminalTools.slice(-6)) {
      const stateLabel = tool.terminalState ?? tool.status;
      const command = typeof tool.input.command === 'string' ? tool.input.command : '';
      const terminalLabel = tool.terminalId ? shorten(tool.terminalId, 24) : 'terminal';
      lines.push(`  ${tool.status === 'error' ? ERROR : tool.status === 'success' ? SUCCESS : WARNING}●${RESET} ${shorten(tool.name, width - 28)} ${DIM}${stateLabel} · ${terminalLabel}${RESET}`);
      if (command) lines.push(`    ${DIM}$ ${shorten(command, width - 8)}${RESET}`);
      if (tool.liveOutput) lines.push(`    ${shorten(tool.liveOutput.split(/\r?\n/u).at(-1) ?? '', width - 10)}`);
    }
    lines.push(`${DIM}Use /terminal focus <id> to inspect a terminal.${RESET}`);
  }
  if (state.rules.length) {
    lines.push(`${ACCENT}RULES · ${state.rules.length}${RESET}`);
    for (const rule of state.rules.slice(0, 4)) lines.push(`  ${rule.mandatory ? WARNING : rule.enabled ? SUCCESS : MUTED}●${RESET} ${shorten(rule.name || rule.filePath, width - 14)} ${DIM}${rule.enabled ? 'active' : 'off'}${RESET}`);
  }
  if (state.skills.length) {
    lines.push(`${ACCENT}SKILLS · ${state.skills.length}${RESET}`);
    for (const skill of state.skills.slice(0, 4)) lines.push(`  ${skill.active ? SUCCESS : MUTED}●${RESET} ${shorten(skill.name, width - 8)} ${DIM}${skill.scope}${RESET}`);
  }
  if (state.memories.length) {
    lines.push(`${ACCENT}MEMORY · ${state.memories.length}${RESET}`);
    for (const memory of state.memories.slice(0, 4)) lines.push(`  ${MUTED}◆${RESET} ${shorten(memory.title || memory.summary, width - 8)}`);
  }
  if (state.notices.length) {
    lines.push(`${MUTED}RECENT NOTICES${RESET}`);
    for (const notice of state.notices.slice(-4)) lines.push(`  ${shorten(notice.text, width - 5)}`);
  }
  return [...lines, ''];
}

function changeDiff(original: string | null, next: string, width: number): string[] {
  const before = (original ?? '').split(/\r?\n/);
  const after = next.split(/\r?\n/);
  const lines: string[] = [];
  const limit = Math.max(before.length, after.length);
  for (let index = 0; index < limit && lines.length < 8; index += 1) {
    if (before[index] === after[index]) continue;
    if (before[index] !== undefined) lines.push(`${ERROR}- ${shorten(before[index], width - 5)}${RESET}`);
    if (after[index] !== undefined) lines.push(`${SUCCESS}+ ${shorten(after[index], width - 5)}${RESET}`);
  }
  return lines.length ? lines : [`${DIM}  no textual diff${RESET}`];
}

function emptyTranscript(state: UiState, width: number): string[] {
  const panelWidth = Math.max(48, width);
  const innerWidth = Math.max(44, panelWidth - 2);
  const leftWidth = Math.min(32, Math.max(24, Math.floor((innerWidth - 1) * 0.35)));
  const rightWidth = Math.max(18, innerWidth - leftWidth - 1);
  const left = welcomeIdentityLines(state, leftWidth);
  const right = welcomeDetailsLines(state, rightWidth);
  const lines = [welcomeTopLine(state, panelWidth)];
  const rowCount = Math.max(left.length, right.length);
  for (let index = 0; index < rowCount; index += 1) {
    const leftLine = padAnsi(fitAnsi(left[index] ?? '', leftWidth), leftWidth);
    const rightLine = padAnsi(fitAnsi(right[index] ?? '', rightWidth), rightWidth);
    lines.push(`${PANEL}│${RESET}${leftLine}${PANEL}│${RESET}${rightLine}${PANEL}│${RESET}`);
  }
  lines.push(`${PANEL}╰${'─'.repeat(Math.max(0, panelWidth - 2))}╯${RESET}`);
  lines.push('');
  lines.push(`  ${fitAnsi(`${WARNING}${BOLD}Tip${RESET} ${DIM}Type / for commands · @path attaches context · !command opens a terminal${RESET}`, Math.max(20, panelWidth - 4))}`);
  lines.push(`  ${fitAnsi(`${MUTED}Ready in ${shorten(state.workspace, Math.max(18, panelWidth - 18))} ${PANEL}·${RESET} ${MUTED}${state.status}${RESET}`, Math.max(20, panelWidth - 4))}`);
  return lines;
}

function welcomeTopLine(state: UiState, width: number): string {
  const title = ` ${shorten(`VORTEX · ${state.workspace}`, Math.max(16, width - 10))} `;
  const ruleWidth = Math.max(1, width - visibleLength(title) - 3);
  return `${PANEL}╭─${title}${'─'.repeat(ruleWidth)}╮${RESET}`;
}

function welcomeIdentityLines(state: UiState, width: number): string[] {
  const logo = getCliLogo(width - 2).map((line) => ` ${ACCENT}${line}${RESET}`);
  const model = state.provider && state.model ? `${state.provider}/${state.model}` : 'No model selected';
  return [
    `${ACCENT}${BOLD}Welcome to VORTEX${RESET}`,
    '',
    ...logo,
    '',
    `${SOFT}${BOLD}VORTEX${RESET} ${DIM}CLI${RESET}`,
    `${MUTED}${state.mode} mode${RESET}`,
    `${DIM}${shorten(model, Math.max(12, width - 1))}${RESET}`,
  ];
}

function welcomeDetailsLines(state: UiState, width: number): string[] {
  const themeName = state.themes.find((theme) => theme.id === state.themeId)?.name ?? state.themeId;
  const model = state.provider && state.model ? `${state.provider}/${state.model}` : 'not configured';
  const lines = [
    `${ACCENT}${BOLD}QUICK START${RESET}`,
    `${MUTED}/${RESET}  command palette and actions`,
    `${MUTED}!${RESET}  send a terminal command`,
    `${MUTED}@${RESET}  attach workspace context`,
    `${MUTED}Ctrl-K${RESET}  open every command`,
    `${PANEL}${'─'.repeat(width)}${RESET}`,
    `${ACCENT}${BOLD}RUNTIME${RESET}`,
    startupDetail('status', state.connectionState, width),
    startupDetail('mode', state.mode, width),
    startupDetail('model', model, width),
    startupDetail('theme', themeName, width),
    `${PANEL}${'─'.repeat(width)}${RESET}`,
    `${ACCENT}${BOLD}RECENT SESSIONS${RESET}`,
  ];
  if (state.sessions.length === 0) {
    lines.push(`${MUTED}No previous sessions${RESET}`);
  } else {
    for (const session of state.sessions.slice(0, 3)) {
      const marker = session.id === state.currentSessionId ? `${SUCCESS}●${RESET}` : `${MUTED}○${RESET}`;
      lines.push(`${marker} ${shorten(`${session.title || 'Untitled session'} · ${session.messageCount} msg`, Math.max(12, width - 3))}`);
    }
  }
  return lines;
}

function startupDetail(label: string, value: string, width: number): string {
  const labelText = `${label.padEnd(8, ' ')}`;
  return `${MUTED}${labelText}${RESET}${shorten(value, Math.max(8, width - 10))}`;
}

function transcriptStyle(kind: TranscriptItem['kind']): [string, string, AnsiToken] {
  switch (kind) {
    case 'user': return [ 'you', '›', ACCENT ];
    case 'assistant': return [ 'agent', '◇', ACCENT ];
    case 'thinking': return [ 'thinking', '·', WARNING ];
    case 'tool': return [ 'tool', '>', WARNING ];
    case 'result': return [ 'result', '+', SUCCESS ];
    case 'error': return [ 'error', 'x', ERROR ];
    default: return [ 'note', 'i', MUTED ];
  }
}

function composerLines(state: UiState, width: number): string[] {
  const composerWidth = Math.max(12, width - COMPOSER_HORIZONTAL_PADDING * 2);
  const label = state.terminalInput
    ? 'TERMINAL INPUT'
    : state.interaction?.kind === 'approval' || state.interaction?.kind === 'mode_switch'
    ? 'CONFIRM'
    : state.interaction?.kind === 'question'
      ? 'ANSWER'
      : state.commandFlow?.kind === 'root'
        ? 'COMMAND'
        : state.running
          ? 'WORKING'
          : 'MESSAGE';
  const prompt = state.terminalInput ? '$' : state.interaction?.kind === 'question' ? '?' : state.input.startsWith('/') ? '/' : '>';
  const status = shorten(composerStatus(state), Math.max(20, composerWidth - label.length - 10));
  const chips = state.context.attachments.map((attachment) => `${attachment.kind}:${attachment.label}`).join('  ');
  const rawContextDetails = chips ? `context ${chips}` : 'context none · /attach path · @path · !command';
  const meter = contextMeter(state, Math.min(24, Math.max(14, composerWidth - 4)));
  const contextDetails = shorten(rawContextDetails, Math.max(12, composerWidth - visibleLength(meter) - 2));
  const contextLine = `${chips ? MUTED : DIM}${contextDetails}${RESET}  ${meter}`;
  const inputWidth = Math.max(12, composerWidth - 6);
  const inputRows = renderInputRows(state, inputWidth);
  const workingFrameText = state.running ? `${WARNING}${workingFrame()}${RESET} ` : '';
  const composerHeader = `${ACCENT}╭─ ${label}${RESET} ${workingFrameText}${DIM}${status}${RESET}`;
  const composerTop = `${composerHeader}${ACCENT}${'─'.repeat(Math.max(0, composerWidth - visibleLength(composerHeader) - 1))}╮${RESET}`;
  const frame = (line: string): string => insetComposerLine(line, width, composerWidth);
  return [
    `${PANEL}${'─'.repeat(width)}${RESET}`,
    frame(contextLine),
    ...Array.from({ length: COMPOSER_SECTION_GAP }, () => ''),
    frame(composerTop),
    ...inputRows.map((line, index) => index === 0
      ? frame(`${ACCENT}│${RESET} ${BOLD}${prompt}${RESET} ${padAnsi(fitAnsi(line, inputWidth), inputWidth)} ${ACCENT}│${RESET}`)
      : frame(`${ACCENT}│${RESET}   ${padAnsi(fitAnsi(line, inputWidth), inputWidth)} ${ACCENT}│${RESET}`)),
    frame(`${ACCENT}╰${'─'.repeat(Math.max(0, composerWidth - 2))}╯${RESET}`),
  ];
}

function workingIndicator(): string {
  return `${ACCENT}${workingFrame()}${RESET} ${SOFT}Working...${RESET}`;
}

function workingFrame(): string {
  return WORKING_FRAMES[Math.floor(Date.now() / WORKING_FRAME_INTERVAL_MS) % WORKING_FRAMES.length];
}

function insetComposerLine(line: string, width: number, composerWidth: number): string {
  const fitted = padAnsi(fitAnsi(line, composerWidth), composerWidth);
  return `${' '.repeat(COMPOSER_HORIZONTAL_PADDING)}${fitted}${' '.repeat(Math.max(0, width - COMPOSER_HORIZONTAL_PADDING - visibleLength(fitted)))}`;
}

function composerStatus(state: UiState): string {
  const currentStatus = state.status.replace(/\s*·\s*thinking(?:\s+\S+)?\s*$/i, '').trim();
  const model = state.provider && state.model ? `${state.provider}/${state.model}` : 'model not selected';
  const thinking = `thinking ${state.thinking.enabled ? state.thinking.level ?? 'on' : 'off'}`;
  return [currentStatus, model, thinking].filter(Boolean).join(' · ');
}

type InputUnit = { value: string; index: number };
type InputLine = { units: InputUnit[]; segmentStart: number; segmentEnd: number; lastInSegment: boolean };

function renderInputRows(state: UiState, width: number): string[] {
  const characters = Array.from(state.input).map((value) => state.terminalInput?.masked && value !== '\n' ? '•' : value);
  if (characters.length === 0) return [`${MUTED}Describe what you want to build or investigate${RESET}`];
  const cursor = Math.min(state.inputCursor, characters.length);
  const lines: InputLine[] = [];
  let segmentStart = 0;
  for (let index = 0; index <= characters.length; index += 1) {
    if (index === characters.length || characters[index] === '\n') {
      appendInputSegment(lines, characters, segmentStart, index, width);
      segmentStart = index + 1;
    }
  }

  const rendered = lines.map((line) => {
    const lineStart = line.units[0]?.index ?? line.segmentStart;
    const lineEnd = line.units.at(-1)?.index !== undefined ? (line.units.at(-1)?.index ?? 0) + 1 : line.segmentStart;
    const cursorBelongs = cursor >= lineStart && (cursor < lineEnd || (line.lastInSegment && cursor <= line.segmentEnd));
    const content = line.units.map((unit) => unit.index === cursor ? `${INVERSE}${unit.value}${RESET}` : unit.value).join('');
    if (!cursorBelongs || line.units.some((unit) => unit.index === cursor)) return content;
    if (cursor === line.segmentEnd && line.segmentEnd < characters.length && characters[line.segmentEnd] === '\n') return `${content}${INVERSE}↵${RESET}`;
    return `${INVERSE} ${RESET}${content}`;
  });

  return rendered.length > 0 ? rendered : [`${INVERSE} ${RESET}`];
}

function appendInputSegment(lines: InputLine[], characters: string[], start: number, end: number, width: number): void {
  if (start === end) {
    lines.push({ units: [], segmentStart: start, segmentEnd: end, lastInSegment: true });
    return;
  }

  let offset = start;
  while (offset < end) {
    const remaining = characters.slice(offset, end);
    let length = Math.min(width, remaining.length);
    if (remaining.length > width) {
      for (let index = length - 1; index >= Math.floor(width * 0.55); index -= 1) {
        if (/\s/.test(remaining[index] ?? '')) {
          length = index + 1;
          break;
        }
      }
    }
    const lineEnd = offset + length;
    lines.push({
      units: characters.slice(offset, lineEnd).map((value, index) => ({ value, index: offset + index })),
      segmentStart: offset,
      segmentEnd: lineEnd,
      lastInSegment: lineEnd >= end,
    });
    offset = lineEnd;
  }
}

function commandPanelTitle(flow: CommandFlow): string {
  if (flow.kind === 'root') return `COMMAND PALETTE · ${flow.query}`;
  return flowTitle(flow);
}

function commandFlowLines(state: UiState, width: number, maxHeight: number): string[] {
  const flow = state.commandFlow;
  if (!flow) return [];
  if (flow.kind === 'root') {
    const commands = matchingCommands(flow.query);
    const lines = [`${DIM}Type a slash command · matching actions stay visible while you compose${RESET}`];
    if (commands.length === 0) return [...lines, `${WARNING}No command matches "${flow.query}". Press Esc to keep editing.${RESET}`];
    const range = listRange(flow.selected, commands.length, maxHeight, 1);
    for (let index = range.start; index < range.end; index += 1) {
      const command = commands[index];
      const selected = index === flow.selected;
      const marker = selected ? `${ACCENT}${BOLD}›${RESET}` : ' ';
      const category = `${MUTED}[${command.category}]${RESET}`;
      lines.push(`${marker} ${selected ? BOLD : ''}${command.name}${selected ? RESET : ''}  ${SOFT}${shorten(command.description, Math.max(18, width - 32))}${RESET} ${category}`);
    }
    if (range.scrollable) lines.push(`${DIM}↑ ${range.start + 1}-${range.end}/${commands.length} · PgUp/PgDn scroll${RESET}`);
    return lines;
  }

  if (flow.kind === 'update') return updateFlowLines(state, width, maxHeight);

  const lines = [`${DIM}↑↓ select · PgUp/PgDn scroll · Enter apply · Esc back${RESET}`];
  const options = flowOptions(state, flow);
  if (options.length === 0) return [...lines, `${WARNING}No options available for the current runtime.${RESET}`];
  const range = listRange(flow.selected, options.length, maxHeight, 1);
  for (let index = range.start; index < range.end; index += 1) {
    const option = options[index];
    const selected = index === flow.selected;
    const marker = selected ? `${ACCENT}${BOLD}›${RESET}` : ' ';
    lines.push(`${marker} ${selected ? BOLD : ''}${shorten(option, width - 8)}${selected ? RESET : ''}`);
  }
  if (range.scrollable) lines.push(`${DIM}↑ ${range.start + 1}-${range.end}/${options.length} · PgUp/PgDn scroll${RESET}`);
  return lines;
}

function updateFlowLines(state: UiState, width: number, maxHeight: number): string[] {
  const update = state.updates;
  const release = update.release;
  const lines = [
    `${DIM}↑↓ select · Enter apply · Esc back${RESET}`,
    `${MUTED}Current${RESET} ${SOFT}${release?.currentVersion ?? 'installed version'}${RESET}  ${MUTED}Channel${RESET} ${ACCENT}${update.channel}${RESET}`,
    `${MUTED}Status${RESET} ${updateStatusLabel(update.status)}`,
  ];
  if (release) {
    lines.push(`${MUTED}Available${RESET} ${ACCENT}${BOLD}${release.version}${RESET}  ${MUTED}${release.asset ? `${formatBytes(release.asset.size)} · ${release.asset.kind}` : 'manual installation'}${RESET}`);
    if (release.body) lines.push(...wrapText(release.body.replace(/\r?\n/gu, ' '), Math.max(20, width - 8)).slice(0, 2).map((line) => `${SOFT}${line}${RESET}`));
    if (release.installation) lines.push(`${MUTED}Install${RESET} ${release.installation.kind} · ${release.installation.mode}`);
    if (release.manualReason) lines.push(...wrapText(release.manualReason, Math.max(20, width - 8)).slice(0, 2).map((line) => `${WARNING}${line}${RESET}`));
  }
  if (update.progress && (update.status === 'downloading' || update.status === 'ready')) {
    const progressWidth = Math.max(10, Math.min(width - 20, 36));
    const filled = Math.round((update.progress.percent / 100) * progressWidth);
    lines.push(`${ACCENT}${'━'.repeat(filled)}${MUTED}${'─'.repeat(Math.max(0, progressWidth - filled))}${RESET} ${Math.round(update.progress.percent)}%`);
  }
  if (update.error) lines.push(`${ERROR}${shorten(update.error, width - 8)}${RESET}`);
  const options = selectionOptions(state, { kind: 'update', selected: 0 });
  const range = listRange(state.commandFlow?.kind === 'update' ? state.commandFlow.selected : 0, options.length, maxHeight, lines.length + 1);
  for (let index = range.start; index < range.end; index += 1) {
    const option = options[index];
    const selected = state.commandFlow?.kind === 'update' && index === state.commandFlow.selected;
    lines.push(`${selected ? `${ACCENT}${BOLD}›${RESET}` : ' '} ${selected ? BOLD : ''}${shorten(option.label, width - 8)}${selected ? RESET : ''}`);
  }
  return lines;
}

function updateStatusLabel(status: UiState['updates']['status']): string {
  if (status === 'checking') return `${WARNING}checking…${RESET}`;
  if (status === 'available') return `${ACCENT}update available${RESET}`;
  if (status === 'downloading') return `${WARNING}downloading…${RESET}`;
  if (status === 'ready') return `${SUCCESS}ready to install${RESET}`;
  if (status === 'applying') return `${WARNING}applying…${RESET}`;
  if (status === 'up-to-date') return `${SUCCESS}up to date${RESET}`;
  if (status === 'unsupported') return `${WARNING}unsupported${RESET}`;
  if (status === 'error') return `${ERROR}error${RESET}`;
  return `${MUTED}not checked${RESET}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function flowOptions(state: UiState, flow: CommandFlow): string[] {
  if (flow.kind === 'root') return matchingCommands(flow.query).map((command) => `${command.name}  ${command.description}`);
  return selectionOptions(state, flow).map((option) => option.label);
}

function interactionLines(interaction: InteractionState, width: number): string[] {
  if (interaction.kind === 'approval') {
    if (interaction.externalAccess) {
      const operation = interaction.externalAccess.operation === 'write'
        ? 'edit external files or directories'
        : interaction.externalAccess.operation === 'execute'
          ? 'execute a command with an external working directory'
          : 'read external files or directories';
      return [
        `${WARNING}${BOLD}External access required${RESET}`,
        `${SOFT}The agent wants to ${operation}.${RESET}`,
        ...(interaction.externalAccess.operation === 'write'
          ? [`${ERROR}This action will edit external data.${RESET}`]
          : []),
        `${DIM}Tool: ${interaction.toolName} · risk: ${interaction.risk}${RESET}`,
        `${DIM}Paths:${RESET}`,
        ...interaction.externalAccess.paths.map((path) => `  ${path}`),
        `${DIM}Session directories: ${interaction.externalAccess.directories.join(', ')}${RESET}`,
        `${WARNING}Y allow once   D allow directory for this session   N deny${RESET}`,
      ].flatMap((line) => wrapText(line, Math.max(20, width - 8)));
    }
    return [
      `${WARNING}${BOLD}The agent wants to use ${interaction.toolName}${RESET}`,
      ...wrapText(interaction.description, Math.max(20, width - 8)).map((line) => `${SOFT}${line}${RESET}`),
      `${DIM}Risk level: ${interaction.risk}${RESET}`,
      `${DIM}Input: ${shorten(formatValue(interaction.input), width - 8)}${RESET}`,
      `${WARNING}Y allow   N deny   T trust   A approve all${RESET}`,
    ];
  }
  if (interaction.kind === 'mode_switch') {
    return [
      `${WARNING}${BOLD}Mode change requested${RESET}`,
      `${interaction.from} → ${interaction.to}`,
      ...wrapText(interaction.reason, Math.max(20, width - 8)),
      ...wrapText(interaction.contextSummary, Math.max(20, width - 8)).map((line) => `${DIM}${line}${RESET}`),
      `${WARNING}Y allow   N deny${RESET}`,
    ];
  }
  const questionIndex = interaction.questionIndex;
  const questionState = interaction.questions[questionIndex];
  const question = questionState?.question ?? 'The agent is waiting for an answer.';
  return [
    `${WARNING}${BOLD}${shorten(interaction.title, width - 8)}${RESET} ${DIM}${questionIndex + 1}/${interaction.questions.length}${RESET}`,
    ...wrapText(question, Math.max(20, width - 8)),
    ...(questionState?.options ?? []).map((option, index) => `${index === interaction.selectedOption ? `${ACCENT}${BOLD}›${RESET}` : ' '} ${index === interaction.selectedOption ? BOLD : ''}${shorten(option.label, width - 10)}${index === interaction.selectedOption ? RESET : ''}`),
    `${WARNING}Type the answer below and press Enter.${RESET}`,
  ];
}

function helpLines(): string[] {
  const groups = ['runtime', 'session', 'context', 'workspace', 'model'] as const;
  const lines: string[] = [
    `${DIM}Slash commands are searchable. Type / in the composer, Tab completes, Enter executes.${RESET}`,
    `${DIM}Shift-Tab cycles modes · Ctrl-T cycles thinking · Ctrl-K opens the palette anywhere.${RESET}`,
  ];
  for (const group of groups) {
    lines.push(`${ACCENT}${BOLD}${group.toUpperCase()}${RESET}`);
    for (const command of COMMANDS.filter((candidate) => candidate.category === group)) {
      const aliases = command.aliases.length ? ` ${DIM}(${command.aliases.join(', ')})${RESET}` : '';
      lines.push(`  ${command.usage}  ${SOFT}${command.description}${RESET}${aliases}`);
    }
  }
  lines.push(`${MUTED}Esc closes · F1 reopens · PgUp/PgDn scroll transcript${RESET}`);
  return lines;
}

function listLines(items: string[], selected: number, width: number, maxHeight: number): string[] {
  if (items.length === 0) return [`${MUTED}No entries available.${RESET}`, `${DIM}Esc closes this view.${RESET}`];
  const range = listRange(selected, items.length, maxHeight, 1);
  const lines = [
    `${DIM}↑↓ select · PgUp/PgDn scroll · Enter open · Esc close${RESET}`,
    ...items.slice(range.start, range.end).map((item, offset) => {
      const index = range.start + offset;
      const active = index === selected;
      return `${active ? `${ACCENT}${BOLD}›${RESET}` : ' '} ${active ? BOLD : ''}${shorten(item, width - 8)}${active ? RESET : ''}`;
    }),
  ];
  if (range.scrollable) lines.push(`${DIM}↑ ${range.start + 1}-${range.end}/${items.length} · PgUp/PgDn scroll${RESET}`);
  return lines;
}

type ListRange = { start: number; end: number; scrollable: boolean };

function listRange(selected: number, total: number, maxHeight: number, fixedLines: number): ListRange {
  const contentBudget = Math.max(0, maxHeight - 2);
  const baseVisible = Math.max(1, contentBudget - fixedLines);
  const canShowScrollHint = contentBudget >= fixedLines + 2;
  const visible = canShowScrollHint && total > baseVisible ? Math.max(1, baseVisible - 1) : baseVisible;
  const safeVisible = Math.min(Math.max(1, visible), Math.max(1, total));
  const safeSelected = Math.min(Math.max(0, selected), Math.max(0, total - 1));
  const maxStart = Math.max(0, total - safeVisible);
  const start = Math.min(Math.max(0, safeSelected - safeVisible + 1), maxStart);
  const end = Math.min(total, start + safeVisible);
  return { start, end, scrollable: canShowScrollHint && total > safeVisible };
}

function makePanel(title: string, content: string[], width: number): string[] {
  const innerWidth = Math.max(24, width - 6);
  const titleText = ` ${title} `;
  const top = `${PANEL}╭─${titleText}${'─'.repeat(Math.max(0, width - visibleLength(titleText) - 4))}╮${RESET}`;
  const lines = [top];
  for (const contentLine of content) {
    const wrapped = wrapText(stripAnsi(contentLine), innerWidth);
    for (const line of wrapped) lines.push(`${PANEL}│${RESET} ${fitAnsi(line, innerWidth)} ${PANEL}│${RESET}`);
  }
  lines.push(`${PANEL}╰${'─'.repeat(Math.max(0, width - 2))}╯${RESET}`);
  return lines;
}

function alignColumns(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - visibleLength(left) - visibleLength(right));
  return `${left}${' '.repeat(gap)}${right}`;
}

function padAnsi(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - visibleLength(value)))}`;
}

function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  if (!text) return [''];
  const output: string[] = [];
  for (const segment of text.split(/\r?\n/)) {
    if (!segment) {
      output.push('');
      continue;
    }
    let remaining = segment;
    while (Array.from(remaining).length > safeWidth) {
      const characters = Array.from(remaining);
      let cut = safeWidth;
      const whitespace = remaining.slice(0, characters.length).lastIndexOf(' ', safeWidth);
      if (whitespace > Math.floor(safeWidth * 0.55)) cut = whitespace;
      output.push(characters.slice(0, cut).join('').trimEnd());
      remaining = characters.slice(cut).join('').trimStart();
    }
    output.push(remaining);
  }
  return output;
}

function shorten(value: string, width: number): string {
  const characters = Array.from(stripAnsi(value));
  if (width <= 0) return '';
  if (characters.length <= width) return characters.join('');
  return `${characters.slice(0, Math.max(0, width - 1)).join('')}…`;
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).length;
}

function formatValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value) ?? 'null';
    return serialized.length > 500 ? `${serialized.slice(0, 500)}…` : serialized;
  } catch {
    return '<unserializable>';
  }
}

function contextMeter(state: UiState, width: number): string {
  const contextWindow = state.usage.contextWindow;
  const contextTokens = Math.max(0, state.usage.inputTokens, state.context.gatheredTokens);
  const barWidth = Math.max(6, Math.min(14, width - 12));
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return `${MUTED}ctx${RESET} ${DIM}${'─'.repeat(barWidth)} —${RESET}`;
  }

  const percentage = Math.min(100, Math.max(0, contextTokens / contextWindow * 100));
  const filledWidth = percentage === 0 ? 0 : Math.max(1, Math.round(barWidth * percentage / 100));
  const color = percentage >= 85 ? ERROR : percentage >= 60 ? WARNING : ACCENT;
  const bar = `${color}${'━'.repeat(filledWidth)}${RESET}${PANEL}${'─'.repeat(barWidth - filledWidth)}${RESET}`;
  return `${MUTED}ctx${RESET} ${bar} ${DIM}${formatContextPercentage(percentage)}${RESET}`;
}

function formatContextPercentage(value: number): string {
  if (value === 0) return '0%';
  if (value >= 100) return '100%';
  return `${value.toFixed(1)}%`;
}

type MarkdownFence = {
  marker: '`' | '~';
  language: string;
  lines: string[];
};

type MarkdownListItem = {
  indent: string;
  marker: string;
  content: string;
  task: 'checked' | 'unchecked' | null;
  ordered: boolean;
};

type MarkdownTable = {
  end: number;
  rows: string[][];
};

type MarkdownInlineSegment = {
  plain: string;
  render: (value: string) => string;
};

function renderMarkdown(value: string, kind: TranscriptItem['kind'], width: number): string[] {
  const text = stripAnsi(value).replace(/\r\n/g, '\n');
  if (!text) return [''];

  const solidColor = kind === 'thinking' || kind === 'tool'
    ? WARNING
    : kind === 'result'
      ? SUCCESS
      : kind === 'error'
        ? ERROR
        : null;
  if (solidColor) return wrapText(text, width).map((line) => `${solidColor}${line}${RESET}`);

  const source = text.split('\n');
  const lines: string[] = [];
  const paragraph: string[] = [];
  let fence: MarkdownFence | null = null;
  let listActive = false;

  const separate = (): void => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  };

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const content = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph.length = 0;
    if (!content) return;
    lines.push(...renderMarkdownInlineLines(content, width));
  };

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];

    if (fence) {
      if (isFenceClose(line, fence.marker)) {
        lines.push(...renderCodeBlock(fence.lines, fence.language, width));
        fence = null;
        separate();
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    const fenceStart = parseFenceStart(line);
    if (fenceStart) {
      flushParagraph();
      listActive = false;
      separate();
      fence = { ...fenceStart, lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      listActive = false;
      separate();
      continue;
    }

    const table = findMarkdownTable(source, index);
    if (table) {
      flushParagraph();
      listActive = false;
      separate();
      lines.push(...renderMarkdownTable(table.rows, width));
      separate();
      index = table.end - 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      listActive = false;
      separate();
      lines.push(renderMarkdownHeading(heading[1].length, heading[2].replace(/\s+#+\s*$/, '')));
      separate();
      continue;
    }

    if (isHorizontalRule(line)) {
      flushParagraph();
      listActive = false;
      separate();
      lines.push(`${PANEL}${'─'.repeat(Math.max(1, width))}${RESET}`);
      separate();
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      listActive = false;
      const quoteLines: string[] = [];
      let quoteIndex = index;
      while (quoteIndex < source.length && /^\s*>/.test(source[quoteIndex])) {
        quoteLines.push(/^\s*>\s?(.*)$/.exec(source[quoteIndex])?.[1] ?? '');
        quoteIndex += 1;
      }
      separate();
      lines.push(...renderBlockquote(quoteLines, width));
      separate();
      index = quoteIndex - 1;
      continue;
    }

    const listItem = parseMarkdownListItem(line);
    if (listItem) {
      flushParagraph();
      if (!listActive) separate();
      lines.push(...renderMarkdownListItem(listItem, width));
      listActive = true;
      continue;
    }

    listActive = false;
    paragraph.push(line.trim());
  }

  if (fence) {
    lines.push(...renderCodeBlock(fence.lines, fence.language, width));
    separate();
  }
  flushParagraph();

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length > 0 ? lines : [''];
}

function parseFenceStart(value: string): Omit<MarkdownFence, 'lines'> | null {
  const match = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+.#-]+)?\s*$/.exec(value);
  if (!match) return null;
  return { marker: match[1][0] as '`' | '~', language: match[2] ?? '' };
}

function isFenceClose(value: string, marker: MarkdownFence['marker']): boolean {
  return marker === '`' ? /^\s*`{3,}\s*$/.test(value) : /^\s*~{3,}\s*$/.test(value);
}

function renderMarkdownHeading(level: number, value: string): string {
  const marker = level === 1 ? '◆' : level === 2 ? '▌' : '·';
  const color = level <= 2 ? ACCENT : SOFT;
  return `${color}${BOLD}${marker} ${markdownInline(value)}${RESET}`;
}

function isHorizontalRule(value: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(value);
}

function parseMarkdownListItem(value: string): MarkdownListItem | null {
  const unordered = /^(\s*)[-+*]\s+(.+)$/.exec(value);
  const ordered = /^(\s*)(\d+)[.)]\s+(.+)$/.exec(value);
  if (!unordered && !ordered) return null;

  const indent = (unordered?.[1] ?? ordered?.[1] ?? '').slice(0, 8);
  const rawContent = unordered?.[2] ?? ordered?.[3] ?? '';
  const task = /^\[( |x|X)\]\s+(.+)$/.exec(rawContent);
  return {
    indent,
    marker: ordered ? `${ordered[2]}.` : '•',
    content: task?.[2] ?? rawContent,
    task: task ? task[1].toLowerCase() === 'x' ? 'checked' : 'unchecked' : null,
    ordered: ordered !== null,
  };
}

function renderMarkdownListItem(item: MarkdownListItem, width: number): string[] {
  const marker = item.task === 'checked'
    ? `${SUCCESS}✓${RESET}`
    : item.task === 'unchecked'
      ? `${MUTED}○${RESET}`
      : item.ordered
        ? `${MUTED}${item.marker}${RESET}`
        : `${ACCENT}${item.marker}${RESET}`;
  const prefixWidth = item.indent.length + item.marker.length + 1;
  const contentWidth = Math.max(8, width - prefixWidth);
  const contentLines = renderMarkdownInlineLines(item.content, contentWidth);
  return contentLines.map((line, index) => {
    const prefix = index === 0 ? `${item.indent}${marker} ` : ' '.repeat(prefixWidth);
    return `${prefix}${markdownInline(line)}`;
  });
}

function renderBlockquote(values: string[], width: number): string[] {
  const contentWidth = Math.max(8, width - 4);
  const output: string[] = [];
  for (const value of values) {
    if (!value.trim()) {
      output.push(`${PANEL}│${RESET}`);
      continue;
    }
    for (const line of renderMarkdownInlineLines(value.trim(), contentWidth)) {
      output.push(`${PANEL}│${RESET} ${SOFT}${markdownInline(line)}${RESET}`);
    }
  }
  return output;
}

function renderCodeBlock(values: string[], language: string, width: number): string[] {
  const codeWidth = Math.max(8, width - 4);
  const label = shorten(language || 'code', Math.max(4, codeWidth - 4));
  const title = ` ${label} `;
  const top = `${PANEL}╭─${MUTED}${title}${RESET}${PANEL}${'─'.repeat(Math.max(1, width - visibleLength(title) - 3))}╮${RESET}`;
  const output = [top];
  const source = values.length > 0 ? values : [''];
  for (const value of source) {
    const codeLines = wrapText(value, codeWidth);
    for (const line of codeLines) {
      const styled = `${SOFT}${highlightCode(line)}${RESET}`;
      output.push(`${PANEL}│${RESET} ${padAnsi(fitAnsi(styled, codeWidth), codeWidth)} ${PANEL}│${RESET}`);
    }
  }
  output.push(`${PANEL}╰${'─'.repeat(Math.max(1, width - 2))}╯${RESET}`);
  return output;
}

function highlightCode(value: string): string {
  if (/^\s*(?:\/\/|#)/.test(value)) return `${MUTED}${value}${RESET}`;
  return value.replace(
    /\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|from|export|async|await|def|fn|pub|struct|use|true|false|null|None)\b/g,
    `${ACCENT}$&${RESET}`,
  );
}

function findMarkdownTable(values: string[], start: number): MarkdownTable | null {
  if (!values[start].includes('|') || start + 1 >= values.length || !isTableSeparator(values[start + 1])) return null;
  const rows = [splitTableRow(values[start])];
  if (rows[0].length < 2) return null;
  let end = start + 2;
  while (end < values.length && values[end].trim() && values[end].includes('|')) {
    rows.push(splitTableRow(values[end]));
    end += 1;
  }
  return { end, rows };
}

function isTableSeparator(value: string): boolean {
  const cells = splitTableRow(value);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(value: string): string[] {
  const trimmed = value.trim();
  const content = trimmed.startsWith('|') && trimmed.endsWith('|')
    ? trimmed.slice(1, -1)
    : trimmed.startsWith('|')
      ? trimmed.slice(1)
      : trimmed.endsWith('|')
        ? trimmed.slice(0, -1)
        : trimmed;
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const character of content) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function renderMarkdownTable(rows: string[][], width: number): string[] {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
  const columnWidths = normalized[0].map((_, column) => Math.min(28, Math.max(3, ...normalized.map((row) => visibleLength(row[column])))));
  const widthBudget = Math.max(columnCount * 3, width - columnCount * 3 - 1);
  while (columnWidths.reduce((sum, value) => sum + value, 0) > widthBudget) {
    const largest = columnWidths.reduce((candidate, value, index) => value > columnWidths[candidate] ? index : candidate, 0);
    if (columnWidths[largest] <= 3) break;
    columnWidths[largest] -= 1;
  }

  const border = (left: string, middle: string, right: string): string => `${PANEL}${left}${columnWidths.map((value) => '─'.repeat(value + 2)).join(middle)}${right}${RESET}`;
  const output = [border('┌', '┬', '┐')];
  normalized.forEach((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const content = fitAnsi(markdownInline(shorten(value, columnWidths[column])), columnWidths[column]);
      const styled = rowIndex === 0 ? `${ACCENT}${BOLD}${content}${RESET}` : `${SOFT}${content}${RESET}`;
      return ` ${padAnsi(styled, columnWidths[column])} `;
    });
    output.push(`${PANEL}│${RESET}${cells.join(`${PANEL}│${RESET}`)}${PANEL}│${RESET}`);
    if (rowIndex === 0) output.push(border('├', '┼', '┤'));
  });
  output.push(border('└', '┴', '┘'));
  return output;
}

function renderMarkdownInlineLines(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];
  let current = '';
  let currentLength = 0;
  const pushCurrent = (): void => {
    if (currentLength > 0 || lines.length === 0) lines.push(current.trimEnd());
    current = '';
    currentLength = 0;
  };

  for (const segment of markdownInlineSegments(value)) {
    for (const part of segment.plain.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (currentLength > 0 && currentLength + part.length <= safeWidth) {
          current += segment.render(part);
          currentLength += part.length;
        }
        continue;
      }

      let remaining = part;
      while (remaining.length > 0) {
        if (currentLength > 0 && currentLength + remaining.length > safeWidth) pushCurrent();
        const capacity = safeWidth - currentLength;
        const chunk = remaining.slice(0, Math.max(1, capacity));
        current += segment.render(chunk);
        currentLength += chunk.length;
        remaining = remaining.slice(chunk.length);
        if (currentLength >= safeWidth && remaining.length > 0) pushCurrent();
      }
    }
  }
  if (currentLength > 0 || lines.length === 0) pushCurrent();
  return lines;
}

function markdownInlineSegments(value: string): MarkdownInlineSegment[] {
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const segments: MarkdownInlineSegment[] = [];
  const add = (plain: string, render: (value: string) => string = (part) => part): void => {
    if (plain) segments.push({ plain, render });
  };
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    add(value.slice(cursor, match.index));
    const [, code, linkLabel, url, boldA, boldB, strike, italicA, italicB] = match;
    if (code !== undefined) {
      add(code, (part) => `${MUTED}${BOLD}${part}${RESET}`);
    } else if (linkLabel !== undefined && url !== undefined) {
      add(linkLabel, (part) => `${ACCENT}${UNDERLINE}${part}${RESET}`);
      if (linkLabel !== url) add(` (${shorten(url, 24)})`, (part) => `${DIM}${part}${RESET}`);
    } else if (boldA !== undefined || boldB !== undefined) {
      add(boldA ?? boldB, (part) => `${BOLD}${part}${RESET}`);
    } else if (strike !== undefined) {
      add(strike, (part) => `${DIM}${STRIKETHROUGH}${part}${RESET}`);
    } else if (italicA !== undefined || italicB !== undefined) {
      add(italicA ?? italicB, (part) => `${ITALIC}${part}${RESET}`);
    } else {
      add(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  add(value.slice(cursor));
  return segments;
}

function markdownInline(value: string): string {
  return markdownInlineSegments(value).map((segment) => segment.render(segment.plain)).join('');
}

function fitAnsi(value: string, width: number): string {
  if (visibleLength(value) <= width) return value;
  return shorten(value, width);
}
