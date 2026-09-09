import { DEFAULT_THEME_ID } from '@hyscode/tui-runtime';
import { inlineText, summarizeToolInput } from './controller';
import { COMMANDS, flowTitle, matchingCommands, selectionOptions } from './commands';
import { getCliLogo } from './logo';
import { dynamicAnsiToken, resolveAnsiTheme, type AnsiToken, type AnsiTheme } from './theme';
import type { CommandFlow, InteractionState, SubAgentView, TranscriptItem, ToolView, UiState } from './types';

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
const MAX_INPUT_ROWS = 7;
const TOOL_EXPANDED_LINE_CAP = 24;

export class TerminalRenderer {
  private lastFrameKey: string | null = null;
  private lastFrame: string | null = null;

  /** Forces the next render to repaint the whole screen (theme change, handoff resume, resize). */
  invalidate(): void {
    this.lastFrameKey = null;
    this.lastFrame = null;
  }

  render(state: UiState): string {
    const previousTheme = activeAnsiTheme;
    activeAnsiTheme = resolveAnsiTheme(state.themeId, state.themes);
    try {
      const width = Math.max(1, Math.floor(state.width));
      const height = Math.max(1, Math.floor(state.height));
      const header = headerLines(state, width);
      const composer = composerLines(state, width);
      const panelBudget = Math.max(0, height - header.length - composer.length - 4);
      const rawPanel = this.overlayLines(state, width, panelBudget);
      const panel = rawPanel.slice(0, panelBudget);
      const bodyHeight = Math.max(3, height - header.length - panel.length - composer.length);
      const executionBanner = state.running ? [workingIndicator(state), ''] : [];
      const transcriptHeight = Math.max(1, bodyHeight - executionBanner.length);
      const sidebarWidth = state.sidebarVisible && width >= 100 ? SIDEBAR_WIDTH : 0;
      const mainWidth = sidebarWidth > 0 ? width - sidebarWidth - 1 : width;
      const transcript = transcriptView(state.transcript, Math.max(1, mainWidth - 2), state);
      const start = Math.max(0, transcript.length - transcriptHeight - state.scroll);
      const visibleTranscript = transcript.slice(start, start + transcriptHeight);
      if (state.scroll > 0 && visibleTranscript.length > 0) {
        visibleTranscript[visibleTranscript.length - 1] = scrollHintLine(state, transcript.length);
      }
      const body = layoutBody([...executionBanner, ...visibleTranscript], state, width, bodyHeight, sidebarWidth);
      const lines = [...header, ...body, ...panel, ...composer];
      while (lines.length < height) lines.push('');
      const frame = lines
        .slice(0, height)
        .map((line) => `\u001b[2K\r${fitAnsi(line, width)}`)
        .join('\n');
      const frameKey = `${width}x${height}:${state.themeId}`;
      if (frameKey === this.lastFrameKey && frame === this.lastFrame) return '';
      const resetScreen = frameKey !== this.lastFrameKey;
      this.lastFrameKey = frameKey;
      this.lastFrame = frame;
      return `${activeAnsiTheme.reset}${resetScreen ? '\u001b[H\u001b[0J' : '\u001b[H'}${frame}${RESET}`;
    } finally {
      activeAnsiTheme = previousTheme;
    }
  }

  private overlayLines(state: UiState, width: number, maxHeight: number): string[] {
    if (state.interaction) return makePanel('ACTION REQUIRED', interactionLines(state.interaction, state, width), width);
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
  const delegation = activeDelegationChip(state);
  const right = `${modelText} ${MUTED}·${RESET} ${gitText}  ${delegation}${delegation ? '  ' : ''}${runtime}  ${connection}`;
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
  if (sidebarWidth === 0) return paddedMain.slice(0, height).map((line) => `  ${fitAnsi(line, Math.max(1, width - 2))}`);

  const sidebar = sidebarLines(state, sidebarWidth - 1, height);
  return Array.from({ length: height }, (_, index) => {
    const sidebarLine = padAnsi(sidebar[index] ?? '', sidebarWidth - 1);
    const mainLine = padAnsi(paddedMain[index] ?? '', mainWidth);
    return `${sidebarLine}${state.focus === 'sidebar' ? ACCENT : PANEL}│${RESET}${mainLine}`;
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
    ...(activeSubAgentCount(state) ? [` ${WARNING}⚙ ${activeSubAgentCount(state)} sub-agent(s) active${RESET}`] : []),
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
    ` Ctrl-O   expand last tool`,
    ` Ctrl-C  cancel / quit`,
    ` !cmd    terminal command`,
    ` @path   attach context`,
  ];
  return lines.slice(0, height);
}

function scrollHintLine(state: UiState, totalLines: number): string {
  const hint = `↑ ${state.scroll}/${totalLines} line(s) above · PgDn/Wheel returns to live output`;
  const color = state.focus === 'transcript' ? ACCENT : MUTED;
  return `${color}${hint}${RESET}`;
}

type MarkdownCacheEntry = { sig: string; lines: string[] };

const markdownCache = new WeakMap<TranscriptItem, MarkdownCacheEntry>();

function cachedMarkdownLines(item: TranscriptItem, width: number): string[] {
  const sig = `${item.kind}|${item.toolId ?? ''}|${width}|${item.text.length}|${item.text.slice(-80)}`;
  const hit = markdownCache.get(item);
  if (hit && hit.sig === sig) return hit.lines;
  const lines = renderMarkdown(item.text, item.kind, width);
  markdownCache.set(item, { sig, lines });
  return lines;
}

function transcriptView(items: TranscriptItem[], width: number, state: UiState): string[] {
  if (items.length === 0) return emptyTranscript(state, width);
  const lines: string[] = [];
  // Keep rendering resilient if replay or an older client supplied duplicate cards.
  const renderedToolIds = new Set<string>();
  for (const item of items) {
    const tool = item.toolId ? state.tools.find((candidate) => candidate.id === item.toolId) : undefined;
    if (tool) {
      if (renderedToolIds.has(tool.id)) continue;
      renderedToolIds.add(tool.id);
      lines.push(...toolCardLines(tool, width));
      lines.push('');
      continue;
    }
    const [label, marker, color] = transcriptStyle(item.kind);
    lines.push(`${color}${BOLD}${marker} ${label}${RESET}`);
    const itemLines = item.kind === 'tool'
      ? wrapText(item.text, Math.max(12, width - 4))
      : cachedMarkdownLines(item, Math.max(12, width - 4));
    for (const itemLine of itemLines) {
      const prefix = item.kind === 'user' ? `${ACCENT}  ${itemLine}${RESET}` : `  ${itemLine}`;
      lines.push(prefix);
    }
    lines.push('');
  }
  if (state.mainPanel === 'terminal') lines.push(...terminalPanel(state, width));
  else if (state.mainPanel === 'sdd') lines.push(...sddPanel(state, width));
  else if (state.mainPanel === 'activity') lines.push(...activityPanel(state, width));
  else if (state.mainPanel === 'subagents') lines.push(...subagentsPanel(state, width));
  return lines;
}

function roundedFrame(title: string, bodyLines: string[], width: number): string[] {
  const safeWidth = Math.max(12, width);
  const innerWidth = Math.max(6, safeWidth - 4);
  const titleText = fitAnsi(title, Math.max(4, innerWidth - 2));
  const dashCount = Math.max(1, innerWidth - visibleLength(titleText) - 1);
  const lines = [`${PANEL}╭─${RESET} ${titleText} ${PANEL}${'─'.repeat(dashCount)}╮${RESET}`];
  for (const body of bodyLines) {
    lines.push(`${PANEL}│${RESET} ${padAnsi(fitAnsi(body, innerWidth), innerWidth)} ${PANEL}│${RESET}`);
  }
  lines.push(`${PANEL}╰${'─'.repeat(innerWidth + 2)}╯${RESET}`);
  return lines;
}

function terminalPanel(state: UiState, width: number): string[] {
  const terminal = state.terminals.find((candidate) => candidate.terminalId === state.activeTerminalId) ?? state.terminals[0];
  if (!terminal) return [`${MUTED}No terminal open. Use /terminal to choose an action or !command.${RESET}`, ''];
  const innerWidth = Math.max(6, Math.max(12, width) - 4);
  const title = [
    `${SOFT}${BOLD}TERMINAL${RESET}`,
    `${MUTED}·${RESET}`,
    shorten(terminal.name, Math.max(8, innerWidth - 14)),
    `${DIM}· ${terminal.frameLanguage} · ${terminal.alive ? 'alive' : 'exited'} · seq ${terminal.sequence}${RESET}`,
  ].join(' ');
  const outputRows = wrapText(terminal.outputPreview || 'Terminal is ready for input.', innerWidth)
    .slice(-10)
    .map((line) => `${SOFT}${line}${RESET}`);
  const failureRows = terminal.failure
    ? [`${ERROR}Failure · ${shorten(terminal.failure.message, innerWidth - 12)}${RESET}`]
    : [];
  const hint = terminal.awaitingInput
    ? `${WARNING}Input is required${RESET} · type a response and press Enter`
    : `${DIM}Type !command to send input${RESET}`;
  const hints = `${hint} ${DIM}· /terminal focus preview · /terminal attach ${shorten(terminal.terminalId ?? '', 18)} for fullscreen · Ctrl-] detaches${RESET}`;
  return [...roundedFrame(title, [...outputRows, ...failureRows, hints], width), ''];
}

function sddPanel(state: UiState, width: number): string[] {
  const sdd = state.sdd;
  if (!sdd.sessionId) return [`${MUTED}No SDD session. Use /sdd and choose Start.${RESET}`, ''];
  const lines = [`${ACCENT}${BOLD}SDD · ${sdd.phase ?? 'active'}${RESET} ${DIM}${shorten(sdd.sessionId, 18)}${RESET}`];
  if (sdd.spec) {
    lines.push(`${MUTED}SPEC${RESET}`);
    lines.push(...wrapText(sdd.spec, Math.max(12, width - 4)).slice(0, 6).map((line) => `${SOFT}${line}${RESET}`));
    if (sdd.phase === 'specifying' || sdd.phase === 'planning') lines.push(`${DIM}/sdd approve-spec · reject with feedback${RESET}`);
    else if (sdd.phase === 'describing') lines.push(`${DIM}/sdd approve-plan once the plan is ready${RESET}`);
  }
  if (sdd.tasks.length) {
    const completed = sdd.tasks.filter((task) => task.status === 'completed').length;
    const active = sdd.tasks.filter((task) => task.status === 'in_progress').length;
    lines.push(`${MUTED}TASKS · ${completed}/${sdd.tasks.length} completed${active ? ` · ${active} active` : ''}${RESET}`);
    for (const row of windowedRows(sdd.tasks.length, sdd.selectedTask, SDD_VISIBLE_TASKS)) {
      if (row.ellipsis) {
        lines.push(`  ${DIM}⋯ ${row.above ? `${row.count} above` : `${row.count} below`} ${row.count === 1 ? 'task' : 'tasks'}${RESET}`);
        continue;
      }
      const task = sdd.tasks[row.index];
      renderSddTaskRow(lines, task, row.index === sdd.selectedTask && state.focus !== 'transcript', width);
    }
    const selected = sdd.tasks[Math.min(sdd.selectedTask, sdd.tasks.length - 1)];
    if (selected && sdd.expandedTask) appendSddTaskDetail(lines, selected, width);
  }
  if (sdd.failedTask) {
    lines.push(`${ERROR}FAILED · ${shorten(`#${sdd.failedTask.ordinal} ${sdd.failedTask.title}`, Math.max(12, width - 14))}${RESET}`);
    lines.push(`${DIM}/sdd resume to retry the failed task${RESET}`);
  }
  if (sdd.review) {
    lines.push(`${MUTED}REVIEW${RESET}`);
    lines.push(...wrapText(sdd.review, Math.max(12, width - 4)).slice(0, 5).map((line) => `${SOFT}${line}${RESET}`));
  }
  lines.push(`${DIM}/sdd approve-spec · approve-plan · resume · ↑↓ select · enter details${RESET}`, '');
  return lines;
}

const SDD_VISIBLE_TASKS = 8;

type WindowedRow = { index: number; ellipsis: boolean; above?: boolean; count?: number };

/** Sliding window over a list with `⋯ N above/below` ellipsis rows. */
function windowedRows(total: number, selected: number, maxVisible: number): WindowedRow[] {
  if (total <= maxVisible) return Array.from({ length: total }, (_, index) => ({ index, ellipsis: false }));
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, selected - half);
  const end = Math.min(total, start + maxVisible - 2);
  start = end - (maxVisible - 2);
  const rows: WindowedRow[] = [];
  if (start > 0) rows.push({ index: 0, ellipsis: true, above: true, count: start });
  for (let index = start; index < end; index += 1) rows.push({ index, ellipsis: false });
  if (end < total) rows.push({ index: total - 1, ellipsis: true, above: false, count: total - end });
  return rows;
}

function renderSddTaskRow(lines: string[], task: UiState['sdd']['tasks'][number], isSelected: boolean, width: number): void {
  const marker = task.status === 'completed'
    ? `${SUCCESS}✓${RESET}`
    : task.status === 'failed'
      ? `${ERROR}×${RESET}`
      : task.status === 'in_progress'
        ? `${WARNING}›${RESET}`
        : task.status === 'skipped'
          ? `${MUTED}○${RESET}`
          : `${MUTED}·${RESET}`;
  const pointer = isSelected ? `${ACCENT}▸${RESET}` : ' ';
  const titleColor = isSelected ? ACCENT : SOFT;
  lines.push(`${pointer} ${marker} ${titleColor}${shorten(task.title, Math.max(10, width - 24))}${RESET} ${DIM}${task.status}${RESET}`);
}

function appendSddTaskDetail(lines: string[], task: UiState['sdd']['tasks'][number], width: number): void {
  const innerWidth = Math.max(12, width - 8);
  if (task.description.trim()) {
    lines.push(...wrapText(task.description, innerWidth).slice(0, 6).map((line) => `      ${SOFT}${line}${RESET}`));
  }
  if (task.files.length) {
    lines.push(`      ${DIM}files · ${shorten(task.files.slice(0, 3).join(', '), innerWidth)}${task.files.length > 3 ? ` +${task.files.length - 3}` : ''}${RESET}`);
  }
  if (task.dependencies.length) {
    lines.push(`      ${DIM}depends on ${task.dependencies.length} task(s)${RESET}`);
  }
  if (task.agentOutput) {
    lines.push(`      ${MUTED}output${RESET}`);
    lines.push(...appendTailLines(task.agentOutput.split(/\r?\n/u), innerWidth, 4));
  }
}

const ACTIVITY_ROW_CAP = 4;
const SUBAGENT_SUMMARY_ROWS = 6;
const SUBAGENT_DETAIL_TAIL = 12;
const SUBAGENT_DETAIL_THINKING = 5;

function activityPanel(state: UiState, width: number): string[] {
  const lines = [`${ACCENT}${BOLD}SESSION ACTIVITY${RESET}`];
  const pending = state.fileChanges.filter((change) => change.status === 'pending');
  lines.push(`${DIM}Usage: ${state.usage.inputTokens.toLocaleString()} in · ${state.usage.outputTokens.toLocaleString()} out · ${state.usage.requestCount} request(s) · $${state.usage.estimatedCost.toFixed(4)}${RESET}`);
  if (state.agentTasks.length) appendTaskListSection(lines, state.agentTasks, width);
  if (pending.length) {
    lines.push(`${WARNING}FILE REVIEW · ${pending.length} pending${RESET}`);
    for (const change of pending.slice(0, ACTIVITY_ROW_CAP)) {
      lines.push(`  ${WARNING}·${RESET} ${shorten(change.filePath, width - 8)}`);
      lines.push(...changeDiff(change.originalContent, change.newContent, width).slice(0, 5));
    }
    lines.push(`${DIM}Use /diffs to choose accept, reject, or bulk review actions.${RESET}`);
  }
  if (state.subagents.length) {
    const active = state.subagents.filter((agent) => agent.status === 'queued' || agent.status === 'running').length;
    lines.push(`${ACCENT}SUB-AGENTS · ${active} active of ${state.subagents.length}${RESET}`);
    const visible = state.subagents.slice(-SUBAGENT_SUMMARY_ROWS);
    if (visible.length < state.subagents.length) {
      lines.push(`  ${DIM}⋯ ${state.subagents.length - visible.length} earlier sub-agent(s) · /subagents for the full list${RESET}`);
    }
    for (const agent of visible) lines.push(subAgentRow(agent, state, width));
    lines.push(`${DIM}/subagents opens the panel with details and cancellation.${RESET}`);
  }
  const terminalToolIds = new Set<string>();
  const terminalTools = state.tools.filter((tool) => {
    if (!tool.terminalId || terminalToolIds.has(tool.id)) return false;
    terminalToolIds.add(tool.id);
    return true;
  });
  if (terminalTools.length) {
    lines.push(`${ACCENT}TERMINAL TOOLS · ${terminalTools.length}${RESET}`);
    for (const tool of terminalTools.slice(-ACTIVITY_ROW_CAP + 2)) {
      const ownerLabel = tool.ownerId ? `${DIM}↳ sub-agent${RESET} ` : '';
      const stateLabel = tool.terminalState ?? tool.status;
      const command = typeof tool.input.command === 'string' ? tool.input.command : '';
      const terminalLabel = tool.terminalId ? shorten(tool.terminalId, 24) : 'terminal';
      lines.push(`  ${ownerLabel}${tool.status === 'error' ? ERROR : tool.status === 'success' ? SUCCESS : WARNING}●${RESET} ${shorten(tool.name, width - 28)} ${DIM}${stateLabel} · ${terminalLabel}${RESET}`);
      if (command) lines.push(`    ${DIM}$ ${shorten(command, width - 8)}${RESET}`);
      if (tool.liveOutput) lines.push(`    ${shorten(tool.liveOutput.split(/\r?\n/u).at(-1) ?? '', width - 10)}`);
      if (tool.failure) lines.push(`    ${ERROR}failure · ${shorten(tool.failure.message, width - 18)}${RESET}`);
    }
    lines.push(`${DIM}Use /terminal focus <id> to preview, or /terminal attach <id> for a manual fullscreen terminal.${RESET}`);
  }
  if (state.rules.length) {
    lines.push(`${ACCENT}RULES · ${state.rules.length}${RESET}`);
    for (const rule of state.rules.slice(0, ACTIVITY_ROW_CAP)) lines.push(`  ${rule.mandatory ? WARNING : rule.enabled ? SUCCESS : MUTED}●${RESET} ${shorten(rule.name || rule.filePath, width - 14)} ${DIM}${rule.enabled ? 'active' : 'off'}${RESET}`);
  }
  if (state.skills.length) {
    lines.push(`${ACCENT}SKILLS · ${state.skills.length}${RESET}`);
    for (const skill of state.skills.slice(0, ACTIVITY_ROW_CAP)) lines.push(`  ${skill.active ? SUCCESS : MUTED}●${RESET} ${shorten(skill.name, width - 8)} ${DIM}${skill.scope}${RESET}`);
  }
  if (state.memories.length) {
    lines.push(`${ACCENT}MEMORY · ${state.memories.length}${RESET}`);
    for (const memory of state.memories.slice(0, ACTIVITY_ROW_CAP)) lines.push(`  ${MUTED}◆${RESET} ${shorten(memory.title || memory.summary, width - 8)}`);
  }
  if (state.notices.length) {
    lines.push(`${MUTED}RECENT NOTICES${RESET}`);
    for (const notice of state.notices.slice(-ACTIVITY_ROW_CAP)) lines.push(`  ${shorten(notice.text, width - 5)}`);
  }
  return [...lines, ''];
}

function appendTaskListSection(lines: string[], tasks: UiState['agentTasks'], width: number): void {
  const completed = tasks.filter((task) => task.status === 'completed').length;
  lines.push(`${ACCENT}TASK LIST · ${completed}/${tasks.length} done${RESET}`);
  for (const task of tasks.slice(0, 6)) {
    const marker = task.status === 'completed'
      ? `${SUCCESS}✓${RESET}`
      : task.status === 'in_progress'
        ? `${WARNING}›${RESET}`
        : task.status === 'blocked'
          ? `${ERROR}×${RESET}`
          : `${MUTED}·${RESET}`;
    lines.push(`  ${marker} ${SOFT}${shorten(task.title, Math.max(10, width - 10))}${RESET}`);
  }
  if (tasks.length > 6) lines.push(`  ${DIM}⋯ +${tasks.length - 6} more task(s)${RESET}`);
}

function subAgentStatusPresentation(status: SubAgentView['status']): { glyph: string; color: AnsiToken } {
  switch (status) {
    case 'done': return { glyph: '●', color: SUCCESS };
    case 'error': return { glyph: '×', color: ERROR };
    case 'cancelled': return { glyph: '○', color: MUTED };
    case 'queued': return { glyph: '◌', color: WARNING };
    default: return { glyph: '●', color: ACCENT };
  }
}

function subAgentElapsed(agent: SubAgentView, now: number): string {
  return formatToolDuration(Math.max(0, (agent.endedAt ?? now) - agent.startedAt));
}

function shortTokens(totalTokens: number | undefined): string {
  if (!totalTokens || totalTokens <= 0) return '';
  return totalTokens < 10_000 ? String(totalTokens) : `${(totalTokens / 1000).toFixed(1)}k`;
}

/** One-line projection used by both the activity summary and the panel list. */
function subAgentRow(agent: SubAgentView, state: UiState, width: number): string {
  const { glyph, color } = subAgentStatusPresentation(agent.status);
  const runningCount = state.subagents.filter((candidate) => candidate.status === 'running').length;
  const maxConcurrent = state.capabilities?.subAgentMaxConcurrent ?? 0;
  const metaParts: string[] = [];
  if (agent.status === 'queued') metaParts.push(`slot wait · ${runningCount}/${maxConcurrent ?? '?'} active`);
  else metaParts.push(subAgentElapsed(agent, Date.now()));
  if (agent.toolIds.length) metaParts.push(`${agent.toolIds.length} tool(s)`);
  const tokens = shortTokens(agent.tokenUsage?.totalTokens);
  if (tokens) metaParts.push(`${tokens} tok`);
  if (agent.status !== 'running' && agent.status !== 'queued') metaParts.push(agent.stopReason ?? agent.status);
  if (agent.status === 'running') metaParts.push('running');
  const label = agent.task || agent.ownerId;
  return `  ${color}${glyph}${RESET} ${BOLD}${shorten(String(agent.mode), 9)}${RESET} ${SOFT}${shorten(label, Math.max(10, width - 30))}${RESET} ${DIM}${metaParts.join(' · ')}${RESET}`;
}

function subagentsPanel(state: UiState, width: number): string[] {
  if (state.subagents.length === 0) return [`${MUTED}No delegated agents in this session. The agent delegates with spawn_subagent.${RESET}`, ''];
  if (state.subagentDetail !== null) {
    const agent = state.subagents[Math.min(state.subagentDetail, state.subagents.length - 1)];
    if (agent) return [...subAgentDetailFrame(agent, state, width), ''];
  }
  const selected = Math.min(state.selectedSubagent, state.subagents.length - 1);
  const lines = [`${ACCENT}${BOLD}SUB-AGENTS · ${state.subagents.length}${RESET}`];
  for (const row of windowedRows(state.subagents.length, selected, SUBAGENT_SUMMARY_ROWS)) {
    if (row.ellipsis) {
      lines.push(`  ${DIM}⋯ ${row.above ? `${row.count} above` : `${row.count} below`} · /subagents ${row.count ?? 1} jumps by number${RESET}`);
      continue;
    }
    const pointer = row.index === selected ? `${ACCENT}▸${RESET}` : ' ';
    const body = subAgentRow(state.subagents[row.index], state, width).trimStart();
    lines.push(`${pointer} ${body}`);
  }
  lines.push(`${DIM}↑↓ select · enter details · esc close · /subagents cancel stops a run${RESET}`, '');
  return lines;
}

function subAgentDetailFrame(agent: SubAgentView, state: UiState, width: number): string[] {
  const innerWidth = Math.max(16, width - 8);
  const { glyph, color } = subAgentStatusPresentation(agent.status);
  const title = [
    `${color}${BOLD}${glyph}${RESET}`,
    `${SOFT}${BOLD}SUB-AGENT${RESET}`,
    `${BOLD}${agent.mode}${RESET}`,
    `${DIM}${agent.status}${agent.stopReason && agent.status !== 'done' ? ` (${agent.stopReason})` : ''}${RESET}`,
  ].join(' ');
  const body: string[] = [];
  const meta = [`elapsed ${subAgentElapsed(agent, Date.now())}`, `${agent.toolIds.length} tool call(s)`];
  const tokens = shortTokens(agent.tokenUsage?.totalTokens);
  if (tokens) meta.push(`${tokens} tokens`);
  body.push(`${MUTED}${meta.join(' · ')}${RESET}`);
  if (agent.task) body.push(...wrapText(agent.task, innerWidth).slice(0, 4).map((line) => `${SOFT}${line}${RESET}`));
  if (agent.thinking.trim()) {
    body.push(`${MUTED}thinking${RESET}`);
    body.push(...appendTailLines(agent.thinking.split(/\r?\n/u), innerWidth, SUBAGENT_DETAIL_THINKING));
  }
  if (agent.output.trim()) {
    body.push(`${MUTED}output${RESET}`);
    body.push(...appendTailLines(agent.output.split(/\r?\n/u), innerWidth, SUBAGENT_DETAIL_TAIL));
  } else if (agent.status === 'running') {
    body.push(`${DIM}streaming… output appears as the child produces it${RESET}`);
  }
  const uniqueToolIds = [...new Set(agent.toolIds)];
  const tools = uniqueToolIds
    .map((toolId) => state.tools.find((tool) => tool.id === toolId))
    .filter((tool): tool is ToolView => Boolean(tool))
    .slice(-8);
  if (tools.length) {
    body.push(`${MUTED}tools${RESET}`);
    for (const tool of tools) {
      const { glyph: toolGlyph, color: toolColor } = toolStatusPresentation(tool.status);
      body.push(`  ${toolColor}${toolGlyph}${RESET} ${shorten(inlineText(summarizeToolInput(tool.name, tool.input)) || tool.name, innerWidth - 6)} ${DIM}${formatToolDuration(tool.durationMs)}${RESET}`);
    }
    const hiddenTools = uniqueToolIds.length - tools.length;
    if (hiddenTools > 0) body.push(`  ${DIM}⋯ +${hiddenTools} earlier tool call(s)${RESET}`);
  }
  const cancellable = agent.status === 'running' || agent.status === 'queued';
  body.push(cancellable
    ? `${DIM}/subagents cancel to stop this run${RESET}`
    : `${DIM}esc back to list${RESET}`);
  return roundedFrame(title, body, width);
}

function appendTailLines(source: string[], width: number, cap: number): string[] {
  const meaningful = source.filter((line) => line.trim() !== '');
  const visible = meaningful.slice(-cap);
  const lines = visible.map((line) => `  ${SOFT}${shorten(line.trimEnd(), width)}${RESET}`);
  if (meaningful.length > visible.length) lines.push(`  ${DIM}⋯ first ${(meaningful.length - visible.length).toLocaleString()} line(s) hidden${RESET}`);
  return lines;
}

type DiffRow = { type: 'context' | 'add' | 'del'; text: string };

const DIFF_ALIGNMENT_CAP = 600;

function diffLines(before: string[], after: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    rows.push({ type: 'context', text: before[start] });
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  const tail: DiffRow[] = [];
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    tail.unshift({ type: 'context', text: before[endBefore - 1] });
    endBefore -= 1;
    endAfter -= 1;
  }
  rows.push(...alignDiffMiddle(before.slice(start, endBefore), after.slice(start, endAfter)), ...tail);
  return rows;
}

function alignDiffMiddle(before: string[], after: string[]): DiffRow[] {
  if (before.length === 0) return after.map((text) => ({ type: 'add' as const, text }));
  if (after.length === 0) return before.map((text) => ({ type: 'del' as const, text }));
  if (before.length > DIFF_ALIGNMENT_CAP || after.length > DIFF_ALIGNMENT_CAP) {
    return [
      ...before.map((text) => ({ type: 'del' as const, text })),
      ...after.map((text) => ({ type: 'add' as const, text })),
    ];
  }
  const stride = after.length + 1;
  const table = new Uint32Array((before.length + 1) * stride);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * stride + j] = before[i] === after[j]
        ? table[(i + 1) * stride + j + 1] + 1
        : Math.max(table[(i + 1) * stride + j], table[i * stride + j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ type: 'context', text: before[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * stride + j] >= table[i * stride + j + 1]) {
      rows.push({ type: 'del', text: before[i] });
      i += 1;
    } else {
      rows.push({ type: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < before.length) { rows.push({ type: 'del', text: before[i] }); i += 1; }
  while (j < after.length) { rows.push({ type: 'add', text: after[j] }); j += 1; }
  return rows;
}

function changeDiff(original: string | null, next: string, width: number): string[] {
  const rows = diffLines((original ?? '').split(/\r?\n/), next.split(/\r?\n/));
  const changedIndexes = rows.reduce<number[]>((indexes, row, index) => {
    if (row.type !== 'context') indexes.push(index);
    return indexes;
  }, []);
  if (changedIndexes.length === 0) return [`${DIM}  no textual diff${RESET}`];
  const output: string[] = [];
  let previousChangedIndex = -2;
  for (const index of changedIndexes) {
    if (output.length >= 8) {
      output.push(`${DIM}  ⋯ ${changedIndexes.length - 8} more changed line(s)${RESET}`);
      break;
    }
    const row = rows[index];
    if (index !== previousChangedIndex + 1 && output.length > 0) output.push(`${PANEL}  ⋯${RESET}`);
    const color = row.type === 'del' ? ERROR : SUCCESS;
    output.push(`${color}${row.type === 'del' ? '-' : '+'} ${shorten(row.text, Math.max(8, width - 4))}${RESET}`);
    previousChangedIndex = index;
  }
  return output;
}

function emptyTranscript(state: UiState, width: number): string[] {
  const panelWidth = Math.max(1, width);
  if (panelWidth < 48) {
    const model = state.provider && state.model ? `${state.provider}/${state.model}` : 'model not selected';
    return [
      `${ACCENT}${BOLD}VORTEX${RESET} · ${shorten(state.workspace, Math.max(1, panelWidth - 9))}`,
      `${MUTED}${shorten(state.mode, Math.max(1, panelWidth - 2))}${RESET} · ${shorten(model, Math.max(1, panelWidth - 4))}`,
      `${DIM}/ commands · ! terminal · @ context${RESET}`,
      `${MUTED}${shorten(state.status, Math.max(1, panelWidth))}${RESET}`,
    ].map((line) => fitAnsi(line, panelWidth));
  }
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

function toolStatusPresentation(status: ToolView['status']): { glyph: string; color: AnsiToken; label: string } {
  switch (status) {
    case 'success': return { glyph: '✓', color: SUCCESS, label: '' };
    case 'error': return { glyph: '×', color: ERROR, label: 'failed' };
    case 'cancelled': return { glyph: '○', color: MUTED, label: 'cancelled' };
    case 'awaiting_input': return { glyph: '›', color: WARNING, label: 'awaiting input' };
    case 'pending': return { glyph: '›', color: WARNING, label: 'approval required' };
    case 'approved': return { glyph: '›', color: WARNING, label: 'approved' };
    default: return { glyph: '›', color: WARNING, label: 'running' };
  }
}

function formatToolDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return '';
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return seconds ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${minutes}m`;
}

function toolCardLines(tool: ToolView, width: number): string[] {
  const { glyph, color, label } = toolStatusPresentation(tool.status);
  const duration = formatToolDuration(tool.durationMs);
  const meta = [label, duration].filter(Boolean).join(' · ');
  const innerWidth = Math.max(6, Math.max(12, width) - 4);
  const headline = shorten(inlineText(summarizeToolInput(tool.name, tool.input)), innerWidth);
  const title = [
    `${color}${BOLD}${glyph}${RESET}`,
    `${SOFT}${BOLD}${tool.name}${RESET}`,
    headline ? `${MUTED}·${RESET} ${headline}` : '',
    meta ? `${DIM}${meta}${RESET}` : '',
  ].filter(Boolean)
    .join(' ');
  const body = tool.expanded ? expandedToolBody(tool, innerWidth) : collapsedToolTail(tool, innerWidth);
  return roundedFrame(title, body, width);
}

function collapsedToolTail(tool: ToolView, innerWidth: number): string[] {
  const tailSource = tool.error || tool.output || tool.liveOutput;
  const tailLines = tailSource.split(/\r?\n/u);
  for (let index = tailLines.length - 1; index >= 0; index -= 1) {
    if (tailLines[index].trim() !== '') {
      return [`${MUTED}${shorten(inlineText(tailLines[index]), innerWidth)}${RESET}`];
    }
  }
  return [];
}

function expandedToolBody(tool: ToolView, width: number): string[] {
  const lines: string[] = [];
  let inputJson = '';
  try {
    inputJson = JSON.stringify(tool.input, null, 2) ?? '';
  } catch {
    inputJson = '<unserializable>';
  }
  if (inputJson && inputJson !== '{}') {
    lines.push(`${MUTED}input${RESET}`);
    appendCapped(lines, inputJson.split(/\r?\n/u), width, SOFT);
  }
  if (tool.output) {
    lines.push(`${MUTED}output${RESET}`);
    appendTail(lines, tool.output.split(/\r?\n/u), width, SOFT);
  }
  if (tool.error) {
    lines.push(`${ERROR}error${RESET}`);
    appendTail(lines, tool.error.split(/\r?\n/u), width, ERROR);
  } else if (!tool.output && tool.liveOutput) {
    lines.push(`${MUTED}live output${RESET}`);
    appendTail(lines, tool.liveOutput.split(/\r?\n/u), width, SOFT);
  }
  return lines;
}

function appendCapped(target: string[], source: string[], width: number, color: AnsiToken): void {
  const visible = source.slice(0, TOOL_EXPANDED_LINE_CAP);
  for (const line of visible) target.push(`${color}${shorten(line, width)}${RESET}`);
  if (source.length > visible.length) target.push(`${DIM}⋯ +${source.length - visible.length} line(s)${RESET}`);
}

function appendTail(target: string[], source: string[], width: number, color: AnsiToken): void {
  const meaningful = source.filter((line, index) => line.trim() !== '' || (index > 0 && index < source.length - 1));
  const visible = meaningful.slice(-TOOL_EXPANDED_LINE_CAP);
  for (const line of visible) target.push(`${color}${shorten(line, width)}${RESET}`);
  if (meaningful.length > visible.length) target.push(`${DIM}⋯ first ${meaningful.length - visible.length} line(s) hidden${RESET}`);
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
  const frameColor = state.focus === 'composer' ? ACCENT : PANEL;
  const composerHeader = `${frameColor}╭─ ${RESET}${ACCENT}${label}${RESET} ${workingFrameText}${DIM}${status}${RESET}`;
  const composerTop = `${composerHeader}${frameColor}${'─'.repeat(Math.max(0, composerWidth - visibleLength(composerHeader) - 1))}╮${RESET}`;
  const frame = (line: string): string => insetComposerLine(line, width, composerWidth);
  const noticeStrip = noticeStripLine(state, width);
  return [
    ...(noticeStrip ? [noticeStrip] : []),
    `${PANEL}${'─'.repeat(width)}${RESET}`,
    frame(contextLine),
    ...Array.from({ length: COMPOSER_SECTION_GAP }, () => ''),
    frame(composerTop),
    ...inputRows.map((line, index) => index === 0
      ? frame(`${frameColor}│${RESET} ${BOLD}${prompt}${RESET} ${padAnsi(fitAnsi(line, inputWidth), inputWidth)} ${frameColor}│${RESET}`)
      : frame(`${frameColor}│${RESET}   ${padAnsi(fitAnsi(line, inputWidth), inputWidth)} ${frameColor}│${RESET}`)),
    frame(`${frameColor}╰${'─'.repeat(Math.max(0, composerWidth - 2))}╯${RESET}`),
  ];
}

function workingIndicator(state: UiState): string {
  const activeCount = activeSubAgentCount(state);
  return `${ACCENT}${workingFrame()}${RESET} ${SOFT}${activeCount ? `Working · ${activeCount} sub-agent(s) active` : 'Working...'}${RESET}`;
}

function activeSubAgentCount(state: UiState): number {
  return state.subagents.filter((agent) => agent.status === 'running' || agent.status === 'queued').length;
}

function activeDelegationChip(state: UiState): string {
  const count = activeSubAgentCount(state);
  return count ? `${WARNING}${BOLD}⚙${count}${RESET}` : '';
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

const COMPOSER_PLACEHOLDERS: Record<UiState['mode'], string> = {
  chat: 'Describe what you want to build or investigate',
  build: 'Describe the change to implement in this workspace',
  review: 'Point at the code or diff that should be reviewed',
  debug: 'Describe the failure and the expected behavior',
  plan: 'Describe the goal to turn into an implementation plan',
};

function composerPlaceholder(state: UiState): string {
  if (state.terminalInput?.masked) return 'Type the sensitive value the terminal is asking for';
  if (state.terminalInput) return 'Respond to the terminal prompt and press Enter';
  return COMPOSER_PLACEHOLDERS[state.mode];
}

function noticeStripLine(state: UiState, width: number): string | null {
  const latestAttention = [...state.notices].reverse().find((notice) => notice.level !== 'info');
  const errorText = latestAttention?.level === 'error' || !latestAttention ? state.lastError : null;
  const text = latestAttention?.text ?? errorText;
  if (!text) return null;
  const color = latestAttention?.level === 'error' || (!latestAttention && errorText) ? ERROR : WARNING;
  const glyph = color === ERROR ? '×' : '▲';
  return `${color}${glyph} ${shorten(inlineText(text), Math.max(12, width - 6))}${RESET}`;
}

function renderInputRows(state: UiState, width: number): string[] {
  const characters = Array.from(state.input).map((value) => state.terminalInput?.masked && value !== '\n' ? '•' : value);
  if (characters.length === 0) return [`${MUTED}${composerPlaceholder(state)}${RESET}`];
  const cursor = Math.min(state.inputCursor, characters.length);
  const lines: InputLine[] = [];
  let segmentStart = 0;
  for (let index = 0; index <= characters.length; index += 1) {
    if (index === characters.length || characters[index] === '\n') {
      appendInputSegment(lines, characters, segmentStart, index, width);
      segmentStart = index + 1;
    }
  }

  const containsCursor = (line: InputLine): boolean => {
    const lineStart = line.units[0]?.index ?? line.segmentStart;
    const lastIndex = line.units.at(-1)?.index;
    const lineEnd = lastIndex !== undefined ? lastIndex + 1 : line.segmentStart;
    return cursor >= lineStart && (cursor < lineEnd || (line.lastInSegment && cursor <= line.segmentEnd));
  };
  const renderSegment = (line: InputLine): string => {
    const content = line.units.map((unit) => unit.index === cursor ? `${INVERSE}${unit.value}${RESET}` : unit.value).join('');
    if (line.units.some((unit) => unit.index === cursor) || !containsCursor(line)) return content;
    if (cursor === line.segmentEnd && line.segmentEnd < characters.length && characters[line.segmentEnd] === '\n') return `${content}${INVERSE}↵${RESET}`;
    return `${INVERSE} ${RESET}${content}`;
  };

  const cursorLineIndex = lines.findIndex(containsCursor);
  const totalLines = lines.length;
  let windowStart = 0;
  let windowEnd = totalLines;
  if (totalLines > MAX_INPUT_ROWS) {
    const anchor = cursorLineIndex >= 0 ? cursorLineIndex : totalLines - 1;
    windowStart = Math.min(Math.max(0, anchor - Math.floor(MAX_INPUT_ROWS / 2)), totalLines - MAX_INPUT_ROWS);
    windowEnd = windowStart + MAX_INPUT_ROWS;
  }

  const rendered = lines.slice(windowStart, windowEnd).map(renderSegment);
  if (windowStart > 0) rendered.unshift(`${DIM}⋯ +${windowStart} line(s) above${RESET}`);
  if (windowEnd < totalLines) rendered.push(`${DIM}⋯ +${totalLines - windowEnd} line(s) below${RESET}`);
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
    let length = 0;
    let usedWidth = 0;
    while (length < remaining.length) {
      const characterWidth = characterCellWidth(remaining[length]);
      if (length > 0 && usedWidth + characterWidth > width) break;
      usedWidth += characterWidth;
      length += 1;
      if (usedWidth >= width) break;
    }
    if (length < remaining.length) {
      for (let index = length - 1; index >= Math.floor(length * 0.55); index -= 1) {
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
    if (release.installation) {
      const writableSuffix = release.installation.writable ? '' : ' (not writable — uses installer)';
      lines.push(`${MUTED}Install${RESET} ${release.installation.kind} · ${release.installation.mode}${writableSuffix}`);
    }
    if (release.releaseUrl) lines.push(`${MUTED}Release${RESET} ${SOFT}${shorten(release.releaseUrl, width - 8)}${RESET}`);
    if (release.manualReason) lines.push(...wrapText(release.manualReason, Math.max(20, width - 8)).slice(0, 2).map((line) => `${WARNING}${line}${RESET}`));
  }
  if (update.progress && (update.status === 'downloading' || update.status === 'ready' || update.status === 'applying')) {
    const progressWidth = Math.max(10, Math.min(width - 20, 36));
    const percent = update.status === 'applying' ? (update.progress.percent ?? 100) : update.progress.percent;
    const filled = Math.round((percent / 100) * progressWidth);
    lines.push(`${ACCENT}${'━'.repeat(filled)}${MUTED}${'─'.repeat(Math.max(0, progressWidth - filled))}${RESET} ${Math.round(percent)}%`);
  } else if (update.status === 'applying') {
    lines.push(`${WARNING}applying…${RESET}`);
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

function interactionLines(interaction: InteractionState, state: UiState, width: number): string[] {
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
        ...interaction.externalAccess.paths.map((path) => `  ${ACCENT}${shorten(path, Math.max(12, width - 6))}${RESET}`),
        `${DIM}Session directories: ${interaction.externalAccess.directories.join(', ')}${RESET}`,
        `${WARNING}Y allow once   D allow directory for this session   N deny${RESET}`,
      ].flatMap((line) => wrapText(line, Math.max(20, width - 8)));
    }
    return [
      `${WARNING}${BOLD}The agent wants to use ${interaction.toolName}${RESET}`,
      ...wrapText(interaction.description, Math.max(20, width - 8)).map((line) => `${SOFT}${line}${RESET}`),
      ...approvalDetailLines(interaction, state, width),
      `${DIM}Risk level: ${interaction.risk}${RESET}`,
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
    `${WARNING}Type the answer below and press Enter.${RESET}`,
  ];
}

const APPROVAL_PATH_KEYS = ['filePath', 'file_path', 'path', 'notebookPath', 'notebook_path'] as const;

function approvalDetailLines(interaction: Extract<InteractionState, { kind: 'approval' }>, state: UiState, width: number): string[] {
  const contentWidth = Math.max(16, width - 10);
  const paths = [...new Set(APPROVAL_PATH_KEYS
    .map((key) => interaction.input[key])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))];
  const command = typeof interaction.input.command === 'string' ? interaction.input.command.trim() : '';
  const detailLines: string[] = [];
  for (const path of paths) detailLines.push(`  ${ACCENT}${shorten(inlineText(path), contentWidth)}${RESET}`);
  if (command) detailLines.push(`  ${SOFT}$ ${shorten(inlineText(command), contentWidth - 2)}${RESET}`);
  const change = state.fileChanges.find((candidate) => candidate.toolCallId === interaction.toolCallId)
    ?? null;
  const before = change?.originalContent ?? stringInput(interaction.input.old_string);
  const after = change?.newContent ?? stringInput(interaction.input.new_string) ?? stringInput(interaction.input.content);
  if ((before !== null || after !== null) && !command) {
    const diffPreview = changeDiff(before, after ?? '', width).slice(0, 10);
    if (!(diffPreview.length === 1 && diffPreview[0].includes('no textual diff'))) {
      detailLines.push(`${DIM}  proposed change${RESET}`, ...diffPreview.map((line) => `  ${line.trimEnd()}`));
    }
  }
  if (detailLines.length > 0) return detailLines;
  let serialized = '';
  try {
    serialized = JSON.stringify(interaction.input, null, 2) ?? '';
  } catch {
    serialized = '<unserializable>';
  }
  const jsonLines = serialized.split(/\r?\n/u).slice(0, 8);
  return jsonLines.map((line) => `${DIM}  ${shorten(line, contentWidth)}${RESET}`);
}

function stringInput(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function helpLines(): string[] {
  const groups = ['runtime', 'session', 'context', 'workspace', 'model'] as const;
  const lines: string[] = [
    `${DIM}Slash commands are searchable. Type / in the composer, Tab completes, Enter executes.${RESET}`,
    `${DIM}Shift-Tab cycles modes · Ctrl-T cycles thinking · Ctrl-K opens the palette · Ctrl-O expands the latest tool card.${RESET}`,
    `${DIM}/subagents and /sdd open panels: ↑↓ select, Enter toggles details, Esc goes back. /subagents cancel stops a run.${RESET}`,
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
  const innerWidth = Math.max(1, width - 6);
  const titleText = ` ${title} `;
  const top = `${PANEL}╭─${titleText}${'─'.repeat(Math.max(0, width - visibleLength(titleText) - 4))}╮${RESET}`;
  const lines = [top];
  for (const contentLine of content) {
    const wrapped = wrapText(contentLine, innerWidth);
    for (const line of wrapped) lines.push(`${PANEL}│${RESET} ${fitAnsi(line, innerWidth)} ${PANEL}│${RESET}`);
  }
  lines.push(`${PANEL}╰${'─'.repeat(Math.max(0, width - 2))}╯${RESET}`);
  return lines;
}

function alignColumns(left: string, right: string, width: number): string {
  const safeWidth = Math.max(1, width);
  if (visibleLength(left) + visibleLength(right) + 1 <= safeWidth) {
    return `${left}${' '.repeat(safeWidth - visibleLength(left) - visibleLength(right))}${right}`;
  }
  const rightWidth = Math.max(1, Math.min(visibleLength(right), Math.floor(safeWidth * 0.45)));
  const leftWidth = Math.max(1, safeWidth - rightWidth - 1);
  return `${fitAnsi(left, leftWidth)} ${fitAnsi(right, rightWidth)}`;
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
    while (terminalCellWidth(remaining) > safeWidth) {
      const cut = findWrapCut(remaining, safeWidth);
      const line = takeAnsiCells(remaining, cut).trimEnd();
      output.push(line);
      remaining = dropAnsiCells(remaining, cut).trimStart();
    }
    output.push(remaining);
  }
  return output;
}

function shorten(value: string, width: number): string {
  if (width <= 0) return '';
  return fitAnsi(value, width);
}

export function terminalCellWidth(value: string): number {
  return cellSegments(stripAnsi(value)).reduce((total, segment) => total + segment.width, 0);
}

function stripAnsi(value: string): string {
  return tokenizeAnsi(value)
    .filter((token) => !token.control)
    .map((token) => token.value)
    .join('');
}

function visibleLength(value: string): number {
  return terminalCellWidth(value);
}

type AnsiControlToken = { value: string; control: boolean };

function tokenizeAnsi(value: string): AnsiControlToken[] {
  const tokens: AnsiControlToken[] = [];
  let textStart = 0;
  let index = 0;
  while (index < value.length) {
    const length = ansiSequenceLength(value, index);
    if (length === 0) {
      index += Array.from(value.slice(index, index + 1))[0]?.length ?? 1;
      continue;
    }
    if (textStart < index) tokens.push({ value: value.slice(textStart, index), control: false });
    tokens.push({ value: value.slice(index, index + length), control: true });
    index += length;
    textStart = index;
  }
  if (textStart < value.length) tokens.push({ value: value.slice(textStart), control: false });
  return tokens;
}

function ansiSequenceLength(value: string, start: number): number {
  const first = value[start];
  if (first !== '\u001b' && first !== '\u009b') return 0;
  if (first === '\u009b') {
    const final = value.slice(start + 1).search(/[\u0040-\u007e]/u);
    return final >= 0 ? final + 2 : value.length - start;
  }
  const next = value[start + 1];
  if (next === '[') {
    const final = value.slice(start + 2).search(/[\u0040-\u007e]/u);
    return final >= 0 ? final + 3 : value.length - start;
  }
  if (next === ']') {
    const rest = value.slice(start + 2);
    const bell = rest.indexOf('\u0007');
    const stringTerminator = rest.indexOf('\u001b\\');
    if (bell < 0 && stringTerminator < 0) return value.length - start;
    const end = bell >= 0 && (stringTerminator < 0 || bell < stringTerminator) ? bell + 1 : stringTerminator + 2;
    return end + 2;
  }
  return Math.min(2, value.length - start);
}

function findWrapCut(value: string, width: number): number {
  let used = 0;
  let lastWhitespaceCells = -1;
  for (const token of tokenizeAnsi(value)) {
    if (token.control) continue;
    for (const segment of cellSegments(token.value)) {
      if (/\s/u.test(segment.value)) lastWhitespaceCells = used + segment.width;
      if (used + segment.width > width) {
        if (used === 0) return segment.width;
        return lastWhitespaceCells > Math.floor(width * 0.55) ? lastWhitespaceCells : used;
      }
      used += segment.width;
    }
  }
  return used;
}

function takeAnsiCells(value: string, width: number): string {
  let used = 0;
  let output = '';
  for (const token of tokenizeAnsi(value)) {
    if (token.control) {
      output += token.value;
      continue;
    }
    for (const segment of cellSegments(token.value)) {
      if (used + segment.width > width) return output;
      output += segment.value;
      used += segment.width;
    }
  }
  return output;
}

function dropAnsiCells(value: string, width: number): string {
  let used = 0;
  let output = '';
  let dropping = true;
  for (const token of tokenizeAnsi(value)) {
    if (token.control) {
      if (!dropping) output += token.value;
      continue;
    }
    for (const segment of cellSegments(token.value)) {
      if (dropping && used + segment.width <= width) {
        used += segment.width;
        continue;
      }
      dropping = false;
      output += segment.value;
    }
  }
  return output;
}

type CellSegment = { value: string; width: number };

function cellSegments(value: string): CellSegment[] {
  const segments: CellSegment[] = [];
  let current = '';
  let currentWidth = 0;
  let joinNext = false;
  const flush = (): void => {
    if (!current) return;
    segments.push({ value: current, width: currentWidth });
    current = '';
    currentWidth = 0;
  };

  for (const character of Array.from(value)) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x200d) {
      current += character;
      joinNext = true;
      continue;
    }
    const width = characterCellWidth(character);
    if (width === 0) {
      current += character;
      continue;
    }
    if (joinNext) {
      current += character;
      currentWidth = Math.max(currentWidth, width);
      joinNext = false;
      continue;
    }
    flush();
    current = character;
    currentWidth = width;
  }
  flush();
  return segments;
}

function characterCellWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (isCombiningCodePoint(codePoint) || codePoint === 0x200d) return 0;
  if (isWideCodePoint(codePoint)) return 2;
  return 1;
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x0483 && codePoint <= 0x0489)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
    || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
}

function isWideCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2329 && codePoint <= 0x232a)
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd);
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

  if (kind === 'thinking' || kind === 'tool') return wrapText(text, width).map((line) => `${WARNING}${line}${RESET}`);
  if (kind === 'error') return wrapText(text, width).map((line) => `${ERROR}${line}${RESET}`);

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
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return '';
  if (visibleLength(value) <= safeWidth) return value;
  if (safeWidth === 1) return '…';
  return `${takeAnsiCells(value, safeWidth - 1)}…${RESET}`;
}
