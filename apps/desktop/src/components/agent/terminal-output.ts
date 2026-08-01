import { MAX_CAPTURE_CHARS, normalizeTerminalOutput } from '@hyscode/agent-harness';

export function sanitizeTerminalOutput(rawOutput: string | undefined): string {
  if (!rawOutput) return '';
  return normalizeTerminalOutput(rawOutput, MAX_CAPTURE_CHARS);
}
