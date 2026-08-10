const MAX_COMPLETION_CHARACTERS = 4_096;
const INLINE_MARKER_PATTERN = /<\|(?:cursor|prefix|suffix)\|>/g;

export type InlineCompletionOutput =
  | { status: 'ready'; text: string }
  | { status: 'empty'; text: '' };

function stripCompleteCodeFence(value: string): string {
  const trimmedStart = value.trimStart();
  if (!trimmedStart.startsWith('```')) return value;

  const lines = trimmedStart.split('\n');
  const lastLine = lines.at(-1)?.trim();
  if (lines.length < 3 || lastLine !== '```') return '';

  lines.shift();
  lines.pop();
  return lines.join('\n');
}

function removeLeadingOverlap(value: string, prefix: string): string {
  const maximum = Math.min(value.length, prefix.length, 256);
  for (let length = maximum; length > 0; length -= 1) {
    if (prefix.endsWith(value.slice(0, length))) return value.slice(length);
  }
  return value;
}

function removeTrailingOverlap(value: string, suffix: string): string {
  const maximum = Math.min(value.length, suffix.length, 256);
  for (let length = maximum; length > 0; length -= 1) {
    if (suffix.startsWith(value.slice(-length))) return value.slice(0, -length);
  }
  return value;
}

export function normalizeInlineCompletion(options: {
  rawText: string;
  prefix: string;
  suffix: string;
  maxCharacters?: number;
}): InlineCompletionOutput {
  if (!options.rawText) return { status: 'empty', text: '' };

  let text = options.rawText.replace(/\r\n/g, '\n').replace(INLINE_MARKER_PATTERN, '');
  text = stripCompleteCodeFence(text);
  if (!text) return { status: 'empty', text: '' };

  text = removeLeadingOverlap(text, options.prefix);
  text = removeTrailingOverlap(text, options.suffix);
  text = text.slice(
    0,
    Math.min(options.maxCharacters ?? MAX_COMPLETION_CHARACTERS, MAX_COMPLETION_CHARACTERS),
  );

  return text.trim().length > 0
    ? { status: 'ready', text }
    : { status: 'empty', text: '' };
}
