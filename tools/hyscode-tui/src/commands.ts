import path from 'node:path';
import type { AgentType } from '@hyscode/agent-harness';
import { AGENT_TYPES, type CliParseResult, type CommandFlow, type SelectionFlowAction, type UiState } from './types';

export type CommandSpec = {
  name: string;
  aliases: readonly string[];
  category: 'session' | 'context' | 'model' | 'workspace' | 'runtime';
  description: string;
  usage: string;
};

export const COMMANDS: readonly CommandSpec[] = [
  { name: '/help', aliases: ['/?'], category: 'runtime', description: 'Show keyboard and command help', usage: '/help' },
  { name: '/mode', aliases: [], category: 'runtime', description: 'Choose chat, build, review, debug, or plan mode', usage: '/mode' },
  { name: '/thinking', aliases: ['/think'], category: 'model', description: 'Configure model thinking/reasoning', usage: '/thinking' },
  { name: '/approval', aliases: ['/approve'], category: 'runtime', description: 'Choose how tool approvals are handled', usage: '/approval' },
  { name: '/model', aliases: ['/m'], category: 'model', description: 'Open the provider and model selector', usage: '/model' },
  { name: '/models', aliases: [], category: 'model', description: 'Open the model selector', usage: '/models' },
  { name: '/new', aliases: ['/fresh'], category: 'session', description: 'Start a new saved session', usage: '/new' },
  { name: '/sessions', aliases: ['/resume'], category: 'session', description: 'List saved sessions for this workspace', usage: '/sessions' },
  { name: '/load', aliases: [], category: 'session', description: 'Choose a saved session to load', usage: '/load' },
  { name: '/rename', aliases: ['/title'], category: 'session', description: 'Edit the current session title', usage: '/rename' },
  { name: '/export', aliases: [], category: 'session', description: 'Export the current session as Markdown', usage: '/export' },
  { name: '/delete-session', aliases: ['/delete'], category: 'session', description: 'Choose a saved session to delete', usage: '/delete-session' },
  { name: '/tab', aliases: ['/tabs'], category: 'session', description: 'Choose a conversation tab action', usage: '/tab' },
  { name: '/subagents', aliases: ['/delegations'], category: 'session', description: 'Inspect delegated child agents', usage: '/subagents' },
  { name: '/usage', aliases: ['/tokens'], category: 'runtime', description: 'Show token usage and request telemetry', usage: '/usage' },
  { name: '/projects', aliases: ['/workspaces'], category: 'workspace', description: 'List workspaces with saved sessions', usage: '/projects' },
  { name: '/project', aliases: ['/cd'], category: 'workspace', description: 'Choose another workspace', usage: '/project' },
  { name: '/diagnostics', aliases: ['/diag'], category: 'workspace', description: 'Run workspace diagnostics', usage: '/diagnostics [file]' },
  { name: '/attach', aliases: ['/@'], category: 'context', description: 'Prepare a file, directory, terminal, or image attachment', usage: '/attach' },
  { name: '/context', aliases: ['/ctx'], category: 'context', description: 'Choose an attached-context action', usage: '/context' },
  { name: '/rules', aliases: [], category: 'context', description: 'Inspect active project and global rules', usage: '/rules' },
  { name: '/skills', aliases: [], category: 'context', description: 'Inspect loaded and active skills', usage: '/skills' },
  { name: '/memory', aliases: ['/memories'], category: 'context', description: 'Inspect persistent project memories', usage: '/memory' },
  { name: '/terminal', aliases: ['/term', '/!'], category: 'context', description: 'Choose a persistent-terminal action', usage: '/terminal' },
  { name: '/diffs', aliases: ['/changes'], category: 'context', description: 'Choose a file-change review action', usage: '/diffs' },
  { name: '/sdd', aliases: ['/spec'], category: 'runtime', description: 'Choose an SDD action or enter a description', usage: '/sdd' },
  { name: '/retry', aliases: ['/again'], category: 'session', description: 'Retry the last user message', usage: '/retry' },
  { name: '/continue', aliases: ['/resume-partial'], category: 'session', description: 'Continue a recoverable partial response', usage: '/continue' },
  { name: '/cancel', aliases: ['/stop'], category: 'runtime', description: 'Cancel the active turn', usage: '/cancel' },
  { name: '/clear', aliases: ['/wipe'], category: 'session', description: 'Clear the visible transcript', usage: '/clear' },
  { name: '/quit', aliases: ['/exit', '/q'], category: 'runtime', description: 'Exit the TUI', usage: '/quit' },
];

export const MODE_OPTIONS: readonly { value: AgentType; label: string }[] = [
  { value: 'chat', label: 'Chat — conversational assistance' },
  { value: 'build', label: 'Build — implement changes' },
  { value: 'review', label: 'Review — inspect and report' },
  { value: 'debug', label: 'Debug — diagnose failures' },
  { value: 'plan', label: 'Plan — produce an implementation plan' },
];

export type SelectionOption = { id: string; label: string };

export const APPROVAL_OPTIONS: readonly SelectionOption[] = [
  { id: 'manual', label: 'Manual · ask before every protected tool' },
  { id: 'smart', label: 'Smart · ask only when risk requires it' },
  { id: 'session-trust', label: 'Session trust · remember approved tools' },
  { id: 'notify', label: 'Notify · continue and show the decision' },
  { id: 'yolo', label: 'Yolo · allow tools automatically' },
  { id: 'custom', label: 'Custom · use the configured policy' },
];

const CONTEXT_ACTIONS: readonly SelectionOption[] = [
  { id: 'list', label: 'List attached context' },
  { id: 'attach', label: 'Attach a file or directory from the composer' },
  { id: 'attach-terminal', label: 'Attach a terminal' },
  { id: 'remove', label: 'Remove one attachment' },
  { id: 'clear', label: 'Clear all attachments' },
];

const TERMINAL_ACTIONS: readonly SelectionOption[] = [
  { id: 'list', label: 'List terminals' },
  { id: 'open', label: 'Open a new terminal' },
  { id: 'focus', label: 'Choose a terminal to focus' },
];

const DIFF_ACTIONS: readonly SelectionOption[] = [
  { id: 'list', label: 'Review pending file changes' },
  { id: 'accept', label: 'Accept one change' },
  { id: 'reject', label: 'Reject one change' },
  { id: 'accept-all', label: 'Accept all pending changes' },
  { id: 'reject-all', label: 'Reject all pending changes' },
];

const SDD_ACTIONS: readonly SelectionOption[] = [
  { id: 'approve-spec', label: 'Approve the specification' },
  { id: 'reject-spec', label: 'Reject the specification and add feedback' },
  { id: 'approve-plan', label: 'Approve the implementation plan' },
  { id: 'resume', label: 'Resume the SDD session' },
];

const TAB_ACTIONS: readonly SelectionOption[] = [
  { id: 'new', label: 'Open a new conversation tab' },
  { id: 'next', label: 'Switch to the next tab' },
  { id: 'close', label: 'Close the current tab' },
  { id: 'select', label: 'Choose a tab' },
];

const ACTION_FLOW_TITLES: Record<SelectionFlowAction, string> = {
  approval: 'APPROVAL',
  context: 'CONTEXT ACTION',
  terminal: 'TERMINAL ACTION',
  diffs: 'FILE CHANGES',
  sdd: 'SDD ACTION',
  tab: 'TAB ACTION',
};

export function selectionOptions(state: UiState, flow: CommandFlow): readonly SelectionOption[] {
  switch (flow.kind) {
    case 'mode':
      return MODE_OPTIONS.map((option) => ({ id: option.value, label: option.label }));
    case 'provider':
      return state.providers.map((provider) => ({
        id: provider.id,
        label: `${provider.name} (${provider.id})${provider.configured ? '' : ' · not configured'}`,
      }));
    case 'model':
      return state.providers[flow.providerIndex]?.models.map((model) => ({ id: model.id, label: `${model.name} (${model.id})` })) ?? [];
    case 'thinking': {
      const model = state.models.find((candidate) => candidate.provider === state.provider && candidate.id === state.model);
      return [
        { id: 'toggle', label: `${state.thinking.enabled ? 'Disable' : 'Enable'} thinking` },
        ...((model?.thinkingVariants?.levels ?? []) as string[]).map((level) => ({ id: level, label: `Use ${level} thinking` })),
      ];
    }
    case 'action':
      return actionOptions(state, flow.action);
    case 'context_remove':
      return state.context.attachments.map((attachment) => ({ id: attachment.id, label: `${attachment.kind} · ${attachment.label}` }));
    case 'terminal_attach':
      return state.terminals.map((terminal) => ({ id: terminal.terminalId, label: `${terminal.name} · ${terminal.alive ? 'running' : 'exited'}` }));
    case 'terminal_select':
      return state.terminals.map((terminal) => ({ id: terminal.terminalId, label: `${terminal.name} · ${terminal.alive ? 'running' : 'exited'}` }));
    case 'diff_file':
      return state.fileChanges
        .filter((change) => change.status === 'pending')
        .map((change) => ({ id: change.toolCallId, label: `${change.filePath} · ${change.toolName}` }));
    case 'tab_select':
      return state.tabs.map((tab) => ({ id: tab.sessionId, label: `${tab.active ? 'Current' : 'Tab'} · ${tab.title}` }));
    case 'session_delete':
      return state.sessions.map((session) => ({ id: session.id, label: `${session.title} · ${session.messageCount} message(s)` }));
    case 'root':
      return [];
  }
}

function actionOptions(state: UiState, action: SelectionFlowAction): readonly SelectionOption[] {
  switch (action) {
    case 'approval':
      return APPROVAL_OPTIONS;
    case 'context':
      return CONTEXT_ACTIONS.filter((option) => {
        if (option.id === 'remove' || option.id === 'clear') return state.context.attachments.length > 0;
        if (option.id === 'attach-terminal') return state.terminals.length > 0;
        return true;
      });
    case 'terminal':
      return TERMINAL_ACTIONS.filter((option) => option.id !== 'focus' || state.terminals.length > 0);
    case 'diffs': {
      const hasPendingChanges = state.fileChanges.some((change) => change.status === 'pending');
      return DIFF_ACTIONS.filter((option) => option.id === 'list' || hasPendingChanges);
    }
    case 'sdd':
      return state.sdd.sessionId ? SDD_ACTIONS : [{ id: 'start', label: 'Start an SDD session · describe it next' }];
    case 'tab':
      return state.tabs.length > 0 ? TAB_ACTIONS : [TAB_ACTIONS[0]];
  }
}

export function matchingCommands(query: string): CommandSpec[] {
  const normalized = query.trim().toLowerCase();
  return COMMANDS
    .map((command, index) => ({ command, index }))
    .filter(({ command }) => !normalized || command.name.startsWith(normalized) || command.aliases.some((alias) => alias.startsWith(normalized)) || command.description.toLowerCase().includes(normalized))
    .sort((left, right) => commandMatchRank(left.command, normalized) - commandMatchRank(right.command, normalized) || left.index - right.index)
    .map(({ command }) => command);
}

export function resolveCommandName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return COMMANDS.find((command) => command.name === normalized || command.aliases.includes(normalized))?.name ?? normalized;
}

export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const match = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return { name: trimmed, args: '' };
  return { name: match[1].toLowerCase(), args: match[2]?.trim() ?? '' };
}

export function commandArgument(args: string): string {
  return args.trim().replace(/^['"]|['"]$/g, '');
}

export function flowTitle(flow: CommandFlow | null): string {
  switch (flow?.kind) {
    case 'mode': return 'MODE';
    case 'provider': return 'PROVIDER';
    case 'model': return 'MODEL';
    case 'thinking': return 'THINKING';
    case 'action': return ACTION_FLOW_TITLES[flow.action];
    case 'context_remove': return 'REMOVE CONTEXT';
    case 'terminal_select': return 'FOCUS TERMINAL';
    case 'terminal_attach': return 'ATTACH TERMINAL';
    case 'diff_file': return `${flow.action.toUpperCase()} FILE CHANGE`;
    case 'tab_select': return 'SELECT TAB';
    case 'session_delete': return 'DELETE SESSION';
    case 'root': return 'COMMANDS';
    default: return 'COMMANDS';
  }
}

export function parseCliArgs(args: readonly string[], cwd = process.cwd(), version = '0.1.0'): CliParseResult {
  let workspace: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let mode: AgentType | undefined;
  let configPath: string | undefined;

  const nextValue = (index: number, option: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '-h':
      case '--help':
        return { kind: 'help', text: helpText() };
      case '-V':
      case '--version':
        return { kind: 'version', text: `hyscode-tui ${version}` };
      case '--workspace':
        workspace = nextValue(index, argument);
        index += 1;
        break;
      case '--provider':
        provider = nextValue(index, argument);
        index += 1;
        break;
      case '--model':
        model = nextValue(index, argument);
        index += 1;
        break;
      case '--mode': {
        const value = nextValue(index, argument);
        if (!AGENT_TYPES.includes(value as AgentType)) throw new Error(`Invalid mode "${value}". Expected ${AGENT_TYPES.join(', ')}.`);
        mode = value as AgentType;
        index += 1;
        break;
      }
      case '--config':
        configPath = nextValue(index, argument);
        index += 1;
        break;
      default:
        if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}. Use --help for usage.`);
        if (workspace) throw new Error(`Unexpected argument: ${argument}. Use --help for usage.`);
        workspace = argument;
    }
  }

  return {
    kind: 'run',
    options: {
      workspace: path.resolve(cwd, workspace ?? process.env.HYSCODE_WORKSPACE ?? '.'),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(mode ? { mode } : {}),
      ...(configPath ? { configPath: path.resolve(cwd, configPath) } : {}),
    },
  };
}

export function helpText(): string {
  const commandLines = COMMANDS.map((command) => `  ${command.usage.padEnd(30)} ${command.description}`);
  return [
    'HysCode TUI',
    '',
    'Usage: hyscode-tui [workspace] [options]',
    '',
    'Options:',
    '  -h, --help                 Show this help',
    '  -V, --version              Show the client version',
    '      --workspace <path>     Workspace to open',
    '      --provider <id>        Override the shared active provider',
    '      --model <id>           Override the shared active model',
    '      --mode <mode>          Start in chat, build, review, debug, or plan mode',
    '      --config <path>        Read shared settings JSON from this path',
    '',
    'Slash commands:',
    ...commandLines,
    '',
    'The TUI uses the same TypeScript harness, providers, MCP servers, memory,',
    'skills, rules, keychain, tools, sessions, and terminal runtime as HysCode Desktop.',
  ].join('\n');
}

function commandMatchRank(command: CommandSpec, query: string): number {
  if (!query) return 0;
  if (command.name === query) return 0;
  if (command.name.startsWith(query)) return 1;
  if (command.aliases.some((alias) => alias === query)) return 2;
  if (command.aliases.some((alias) => alias.startsWith(query))) return 3;
  return 4;
}
