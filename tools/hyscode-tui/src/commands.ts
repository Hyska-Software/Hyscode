import path from 'node:path';
import type { AgentType } from '@hyscode/agent-harness';
import { AGENT_TYPES, type CliParseResult, type CommandFlow } from './types';

export type CommandSpec = {
  name: string;
  aliases: readonly string[];
  category: 'session' | 'context' | 'model' | 'workspace' | 'runtime';
  description: string;
  usage: string;
};

export const COMMANDS: readonly CommandSpec[] = [
  { name: '/help', aliases: ['/?'], category: 'runtime', description: 'Show keyboard and command help', usage: '/help' },
  { name: '/mode', aliases: [], category: 'runtime', description: 'Switch chat, build, review, debug, or plan mode', usage: '/mode <mode>' },
  { name: '/thinking', aliases: ['/think'], category: 'model', description: 'Configure model thinking/reasoning', usage: '/thinking' },
  { name: '/approval', aliases: ['/approve'], category: 'runtime', description: 'Choose manual, smart, trust, notify, or yolo approvals', usage: '/approval <mode>' },
  { name: '/model', aliases: ['/m'], category: 'model', description: 'Select a configured provider and model', usage: '/model <provider> <model>' },
  { name: '/models', aliases: [], category: 'model', description: 'Open the model selector', usage: '/models' },
  { name: '/new', aliases: ['/fresh'], category: 'session', description: 'Start a new saved session', usage: '/new' },
  { name: '/sessions', aliases: ['/resume'], category: 'session', description: 'List saved sessions for this workspace', usage: '/sessions' },
  { name: '/load', aliases: [], category: 'session', description: 'Load a saved session', usage: '/load <session-id>' },
  { name: '/rename', aliases: ['/title'], category: 'session', description: 'Rename the current session', usage: '/rename <title>' },
  { name: '/export', aliases: [], category: 'session', description: 'Export the current session as Markdown', usage: '/export' },
  { name: '/delete-session', aliases: ['/delete'], category: 'session', description: 'Delete a saved session', usage: '/delete-session [session-id]' },
  { name: '/tab', aliases: ['/tabs'], category: 'session', description: 'Create, switch, or close conversation tabs', usage: '/tab <new|next|close|id>' },
  { name: '/subagents', aliases: ['/delegations'], category: 'session', description: 'Inspect delegated child agents', usage: '/subagents' },
  { name: '/usage', aliases: ['/tokens'], category: 'runtime', description: 'Show token usage and request telemetry', usage: '/usage' },
  { name: '/projects', aliases: ['/workspaces'], category: 'workspace', description: 'List workspaces with saved sessions', usage: '/projects' },
  { name: '/project', aliases: ['/cd'], category: 'workspace', description: 'Switch to another workspace', usage: '/project <workspace-path>' },
  { name: '/diagnostics', aliases: ['/diag'], category: 'workspace', description: 'Run workspace diagnostics', usage: '/diagnostics [file]' },
  { name: '/attach', aliases: ['/@'], category: 'context', description: 'Attach a file, directory, terminal, or image', usage: '/attach <path|terminal-id>' },
  { name: '/context', aliases: ['/ctx'], category: 'context', description: 'Inspect, remove, or clear attached context', usage: '/context [list|clear|remove <id>]' },
  { name: '/rules', aliases: [], category: 'context', description: 'Inspect active project and global rules', usage: '/rules' },
  { name: '/skills', aliases: [], category: 'context', description: 'Inspect loaded and active skills', usage: '/skills' },
  { name: '/memory', aliases: ['/memories'], category: 'context', description: 'Inspect persistent project memories', usage: '/memory' },
  { name: '/terminal', aliases: ['/term', '/!'], category: 'context', description: 'Open and interact with a persistent terminal', usage: '/terminal [open|list|focus]' },
  { name: '/diffs', aliases: ['/changes'], category: 'context', description: 'Review, accept, or revert file changes', usage: '/diffs [accept|reject|accept-all|reject-all]' },
  { name: '/sdd', aliases: ['/spec'], category: 'runtime', description: 'Start or advance a spec-driven development session', usage: '/sdd <description|action>' },
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
