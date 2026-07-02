const ANSI_PATTERN = /\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~])/g;

const INTERNAL_POWERSHELL_PATTERNS = [
  /\$global:LASTEXITCODE/i,
  /\$global:LAS\s*$/i,
  /\$hys(?:Ok|Code)\b/i,
  /(?:if|elseif).*\$LASTEXITCODE/i,
  /Write-Output\s*\(/i,
  /^\s*>+\s*$/,
];

export function sanitizeTerminalOutput(rawOutput: string | undefined): string {
  if (!rawOutput) return '';
  return rawOutput
    .replace(ANSI_PATTERN, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => {
      if (line.includes('__HYSCODE_BEGIN_') || line.includes('__HYSCODE_END_')) return false;
      return !INTERNAL_POWERSHELL_PATTERNS.some((pattern) => pattern.test(line));
    })
    .join('\n')
    .replace(/^\s*\n+|\n+\s*$/g, '');
}
