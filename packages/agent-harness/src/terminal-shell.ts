import type { TerminalFrameLanguage } from './types';

export type TerminalShellPlatform = 'windows' | 'posix';

export type TerminalShell = {
  command: string;
  frameLanguage: TerminalFrameLanguage;
};

function shellName(command: string): string {
  const normalized = command.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1).replace(/\.exe$/iu, '').toLowerCase();
}

/** Resolve the executable and framing dialect as one runtime contract. */
export function resolveTerminalShell(
  configuredShell: string | null | undefined,
  platform: TerminalShellPlatform,
  posixDefault = '/bin/sh',
): TerminalShell {
  const command = configuredShell?.trim() || (platform === 'windows' ? 'powershell.exe' : posixDefault);
  const name = shellName(command);
  if (name === 'powershell' || name === 'pwsh') return { command, frameLanguage: 'powershell' };
  if (name === 'bash' || name === 'sh' || name === 'zsh' || name === 'dash') {
    return { command, frameLanguage: 'bash' };
  }
  throw new Error(`Unsupported terminal shell "${command}". Configure PowerShell, bash, sh, zsh, or dash.`);
}
