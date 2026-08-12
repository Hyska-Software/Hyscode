import type { TerminalFrameLanguage } from './types';

/** Hard bound on retained raw terminal output. Mirrors the Rust PTY buffer cap. */
export const MAX_CAPTURE_CHARS = 1024 * 1024;

/** Internal marker prefix used by framed capture. Must not collide with command output. */
export function frameMarker(kind: 'BEGIN' | 'END', nonce: string): string {
  return `__HYSCODE_${kind}_${nonce}__`;
}

export function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

export function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(-MAX_CAPTURE_CHARS);
}

/** Encode command source so PowerShell parses the wrapper, not the command itself. */
function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Quote arbitrary command source as a POSIX shell literal for deferred eval. */
function quotePosixLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Wrap a command so its output and exit code can be captured between markers.
 * The wrapper language must match the shell the runtime spawned
 * (`TerminalBinding.frameLanguage`).
 */
export function buildTerminalFrame(
  command: string,
  language: TerminalFrameLanguage,
  nonce: string,
): string {
  const begin = frameMarker('BEGIN', nonce);
  const end = frameMarker('END', nonce);
  if (language === 'powershell') {
    const encodedCommand = encodeUtf8Base64(command);
    return (
      `$global:LASTEXITCODE = 0; Write-Output '${begin}'; $hysCode = 0; ` +
      `$hysCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedCommand}')); ` +
      `try { & { $ErrorActionPreference = 'Stop'; Invoke-Expression -Command $hysCommand }; $hysOk = $?; ` +
      `$hysCode = if ($hysOk) { [int]$LASTEXITCODE } ` +
      `elseif ($LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 } } ` +
      `catch { $hysCode = if ($LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 }; Write-Error $_ } ` +
      `finally { Write-Output (\"${end}:{0}\" -f $hysCode) }\r\n`
    );
  }
  const commandLiteral = quotePosixLiteral(command);
  return `printf '\\n${begin}\\n'; hys_command=${commandLiteral}; (set +e; trap 'hys_code=$?; printf \"\\n${end}:%s\\n\" \"$hys_code\"; exit \"$hys_code\"' 0; eval \"$hys_command\")\n`;
}

export type ParsedTerminalFrame = {
  complete: boolean;
  output: string;
  exitCode: number | null;
  started: boolean;
};

export function parseTerminalFrame(raw: string, nonce: string): ParsedTerminalFrame {
  const begin = frameMarker('BEGIN', nonce);
  const end = frameMarker('END', nonce);
  const lines = stripAnsi(raw).split('\n');
  const beginIndex = lines.findIndex((line) => line.trim() === begin);
  if (beginIndex < 0) return { complete: false, output: '', exitCode: null, started: false };

  const endPattern = new RegExp(`^${end}:(-?\\d+)$`);
  for (let index = beginIndex + 1; index < lines.length; index++) {
    const match = lines[index].trim().match(endPattern);
    if (!match) continue;
    return {
      complete: true,
      output: lines
        .slice(beginIndex + 1, index)
        .join('\n')
        .trim(),
      exitCode: Number.parseInt(match[1], 10),
      started: true,
    };
  }
  return {
    complete: false,
    output: lines
      .slice(beginIndex + 1)
      .join('\n')
      .trim(),
    exitCode: null,
    started: true,
  };
}

/** Lines that only exist because the PowerShell wrapper was echoed into the shell. */
const INTERNAL_POWERSHELL_PATTERNS = [
  /\$global:LASTEXITCODE/i,
  /\$global:LAS\s*$/i,
  /\$hys(?:Ok|Code)\b/i,
  /(?:if|elseif).*\$LASTEXITCODE/i,
  /Write-Output\s*\(/i,
  /^\s*>+\s*$/,
];

/** Clean raw terminal output for display or context: strip ANSI, markers, wrapper noise. */
export function normalizeTerminalOutput(raw: string, maxChars: number): string {
  const normalized = stripAnsi(raw)
    .split('\n')
    .filter((line) => {
      if (line.includes('__HYSCODE_BEGIN_') || line.includes('__HYSCODE_END_')) return false;
      return !INTERNAL_POWERSHELL_PATTERNS.some((pattern) => pattern.test(line));
    })
    .join('\n')
    .trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(-maxChars);
}

export function looksLikeTerminalPrompt(output: string): boolean {
  const line = stripAnsi(output)
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return false;
  return /(?:\?|:\s*$|\[(?:y\/n|Y\/n|yes\/no)\]\s*$|\((?:y\/n|yes\/no)\)\s*$|password\s*:|passphrase\s*:|press (?:enter|return)|select (?:an? )?(?:option|choice)|enter (?:a )?(?:value|choice|number|name))/i.test(
    line,
  );
}

export function isSensitiveTerminalPrompt(output: string): boolean {
  const tail = stripAnsi(output).slice(-1_000);
  return /(?:password|passphrase|secret|api[_ -]?key|access[_ -]?token|mfa|one[- ]time|verification code|captcha)/i.test(
    tail,
  );
}
