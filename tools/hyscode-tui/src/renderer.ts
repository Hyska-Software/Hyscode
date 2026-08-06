import { DEFAULT_THEME_ID } from '@hyscode/tui-runtime';
import { COMMANDS, flowTitle, matchingCommands, selectionOptions } from './commands';
import { dynamicAnsiToken, resolveAnsiTheme, type AnsiToken, type AnsiTheme } from './theme';
import type { CommandFlow, InteractionState, TranscriptItem, UiState } from './types';

let activeAnsiTheme: AnsiTheme = resolveAnsiTheme(DEFAULT_THEME_ID, []);

const RESET = dynamicAnsiToken(() => activeAnsiTheme.reset);
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const INVERSE = '\u001b[7m';
const ACCENT = dynamicAnsiToken(() => activeAnsiTheme.accent);
const MUTED = dynamicAnsiToken(() => activeAnsiTheme.muted);
const SOFT = dynamicAnsiToken(() => activeAnsiTheme.soft);
const WARNING = dynamicAnsiToken(() => activeAnsiTheme.warning);
const SUCCESS = dynamicAnsiToken(() => activeAnsiTheme.success);
const ERROR = dynamicAnsiToken(() => activeAnsiTheme.error);
const PANEL = dynamicAnsiToken(() => activeAnsiTheme.panel);

const SIDEBAR_WIDTH = 27;

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
      const sidebarWidth = state.sidebarVisible && width >= 100 ? SIDEBAR_WIDTH : 0;
      const mainWidth = sidebarWidth > 0 ? width - sidebarWidth - 1 : width;
      const transcript = transcriptView(state.transcript, Math.max(20, mainWidth - 2), state);
      const start = Math.max(0, transcript.length - bodyHeight - state.scroll);
      const visibleTranscript = transcript.slice(start, start + bodyHeight);
      const body = layoutBody(visibleTranscript, state, width, bodyHeight, sidebarWidth);
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
  const left = `${ACCENT}${BOLD}HysCode${RESET} ${MUTED}·${RESET} ${shorten(state.workspace, Math.max(20, width - 42))}`;
  const right = `${runtime}  ${connection}`;
  const lines = [alignColumns(left, right, width)];
  if (state.tabs.length > 1) {
    lines.push(state.tabs.map((tab) => `${tab.active ? `${ACCENT}${BOLD}` : MUTED}${tab.active ? '●' : '○'} ${shorten(tab.title, 22)}${RESET}`).join('  '));
  }
  lines.push(`${PANEL}${'─'.repeat(width)}${RESET}`);
  return lines;
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
  if (items.length === 0 && state.tools.length === 0) return emptyTranscript(state, width);
  const lines: string[] = [];
  for (const item of items) {
    const [label, marker, color] = transcriptStyle(item.kind);
    lines.push(`${color}${BOLD}${marker} ${label}${RESET}`);
    const itemLines = wrapText(stripAnsi(item.text), Math.max(12, width - 4));
    for (const itemLine of itemLines) {
      const formatted = markdownAnsi(itemLine, item.kind);
      const prefix = item.kind === 'user' ? `${ACCENT}  ${formatted}${RESET}` : `  ${formatted}`;
      lines.push(prefix);
    }
    lines.push('');
  }
  if (state.tools.length > 0) {
    lines.push(...toolCards(state, width));
  }
  if (state.mainPanel === 'terminal') lines.push(...terminalPanel(state, width));
  else if (state.mainPanel === 'sdd') lines.push(...sddPanel(state, width));
  else if (state.mainPanel === 'activity') lines.push(...activityPanel(state, width));
  if (state.scroll > 0) lines.push(`${MUTED}↑ ${state.scroll} line(s) above · Wheel/PgDn returns to live output${RESET}`);
  return lines;
}

function toolCards(state: UiState, width: number): string[] {
  const lines: string[] = [`${PANEL}┌─ ACTIVITY${RESET}`];
  for (const tool of state.tools.slice(-8)) {
    const color = tool.status === 'error' ? ERROR : tool.status === 'success' ? SUCCESS : tool.status === 'pending' ? WARNING : ACCENT;
    const marker = tool.status === 'success' ? '✓' : tool.status === 'error' ? '×' : tool.status === 'pending' ? '!' : '›';
    const duration = tool.durationMs ? ` · ${tool.durationMs}ms` : '';
    lines.push(`${color}${marker}${RESET} ${BOLD}${shorten(tool.name, Math.max(12, width - 48))}${RESET} ${DIM}${tool.status}${duration}${RESET}`);
    if (tool.description) lines.push(`  ${DIM}${shorten(tool.description, width - 5)}${RESET}`);
    if (tool.liveOutput) lines.push(...wrapText(stripAnsi(tool.liveOutput.slice(-600)), Math.max(12, width - 6)).slice(-3).map((line) => `  ${SOFT}${line}${RESET}`));
    if (tool.output && tool.status !== 'success') lines.push(...wrapText(stripAnsi(tool.output.slice(-600)), Math.max(12, width - 6)).slice(-2).map((line) => `  ${SOFT}${line}${RESET}`));
  }
  lines.push(`${PANEL}└${'─'.repeat(Math.max(0, Math.min(width - 2, 20)))}${RESET}`, '');
  return lines;
}

function terminalPanel(state: UiState, width: number): string[] {
  const terminal = state.terminals.find((candidate) => candidate.terminalId === state.activeTerminalId) ?? state.terminals[0];
  if (!terminal) return [`${MUTED}No terminal open. Use /terminal to choose an action or !command.${RESET}`, ''];
  return [
    `${ACCENT}${BOLD}TERMINAL · ${shorten(terminal.name, width - 24)}${RESET} ${DIM}${terminal.frameLanguage} · ${terminal.alive ? 'alive' : 'exited'} · seq ${terminal.sequence}${RESET}`,
    ...wrapText(terminal.outputPreview || 'Terminal is ready for input.', Math.max(12, width - 4)).slice(-10).map((line) => `${SOFT}${line}${RESET}`),
    `${DIM}Type !command to send input · /terminal to focus · /attach terminal:${terminal.terminalId}${RESET}`,
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
  const providerMessage = state.provider ? 'Ask for an explanation, a change, or a review.' : 'Select a provider with /model before sending a request.';
  return [
    `${ACCENT}${BOLD}Ready in ${shorten(state.workspace, Math.max(20, width - 12))}${RESET}`,
    '',
    `${SOFT}The conversation will appear here as the agent works.${RESET}`,
    `${MUTED}${providerMessage}${RESET}`,
    '',
    `${DIM}Type / for commands · Ctrl-K for the full palette${RESET}`,
  ];
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
  const label = state.interaction?.kind === 'approval' || state.interaction?.kind === 'mode_switch'
    ? 'CONFIRM'
    : state.interaction?.kind === 'question'
      ? 'ANSWER'
      : state.commandFlow?.kind === 'root'
        ? 'COMMAND'
        : state.running
          ? 'WORKING'
          : 'MESSAGE';
  const prompt = state.interaction?.kind === 'question' ? '?' : state.input.startsWith('/') ? '/' : '>';
  const status = shorten(composerStatus(state), Math.max(20, width - label.length - 10));
  const chips = state.context.attachments.map((attachment) => `${attachment.kind}:${attachment.label}`).join('  ');
  const rawContextDetails = chips ? `context ${chips}` : 'context none · /attach path · @path · !command';
  const meter = contextMeter(state, Math.min(24, Math.max(14, width - 4)));
  const contextDetails = shorten(rawContextDetails, Math.max(12, width - visibleLength(meter) - 2));
  const contextLine = `${chips ? MUTED : DIM}${contextDetails}${RESET}  ${meter}`;
  const inputRows = renderInputRows(state, Math.max(12, width - 6));
  return [
    `${PANEL}${'─'.repeat(width)}${RESET}`,
    contextLine,
    `${ACCENT}╭─ ${label}${RESET} ${DIM}${status}${RESET}`,
    ...inputRows.map((line, index) => index === 0
      ? `${ACCENT}│${RESET} ${BOLD}${prompt}${RESET} ${fitAnsi(line, Math.max(12, width - 6))}`
      : `${ACCENT}│${RESET}   ${fitAnsi(line, Math.max(12, width - 6))}`),
    `${ACCENT}╰${'─'.repeat(Math.max(0, width - 2))}╯${RESET}`,
  ];
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
  const characters = Array.from(state.input);
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

function flowOptions(state: UiState, flow: CommandFlow): string[] {
  if (flow.kind === 'root') return matchingCommands(flow.query).map((command) => `${command.name}  ${command.description}`);
  return selectionOptions(state, flow).map((option) => option.label);
}

function interactionLines(interaction: InteractionState, width: number): string[] {
  if (interaction.kind === 'approval') {
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

function markdownAnsi(value: string, kind: TranscriptItem['kind']): string {
  if (kind === 'thinking') return `${WARNING}${value}${RESET}`;
  if (kind === 'tool') return `${WARNING}${value}${RESET}`;
  if (kind === 'result') return `${SUCCESS}${value}${RESET}`;
  const heading = /^(#{1,6})\s+(.+)$/.exec(value);
  if (heading) return `${ACCENT}${BOLD}${heading[2]}${RESET}`;
  if (/^\s*(```|~~~)/.test(value)) return `${MUTED}${value}${RESET}`;
  const code = value.replace(/`([^`]+)`/g, `${MUTED}$1${RESET}`);
  const bold = code.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  return bold.replace(/\*([^*]+)\*/g, `${BOLD}$1${RESET}`);
}

function fitAnsi(value: string, width: number): string {
  if (visibleLength(value) <= width) return value;
  return shorten(value, width);
}
