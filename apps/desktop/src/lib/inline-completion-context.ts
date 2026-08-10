export const INLINE_COMPLETION_CONTEXT_LIMITS = {
  maxPrefixCharacters: 12_000,
  maxSuffixCharacters: 4_000,
  maxSourceCharacters: 2_000_000,
} as const;

const BLOCKED_PATH_PATTERN = /(^|\/)(?:\.env(?:\..*)?|node_modules|vendor|dist|build|coverage|target)(?:\/|$)/i;
const BLOCKED_EXTENSION_PATTERN = /\.(?:pem|key|p12|pfx|crt|cer|der|jks|keystore)$/i;
const GENERATED_FILE_PATTERN = /(?:\.min|\.bundle)\.(?:js|css)$|\.map$/i;
const UNSAFE_SOURCE_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SECRET_CONTENT_PATTERN = /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/i;

export type InlineCompletionContext = {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
};

export type InlineCompletionContextResult =
  | { status: 'ready'; context: InlineCompletionContext }
  | { status: 'suppressed'; reason: string };

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('untitled:')) return 'untitled';

  const segments = normalized.split('/').filter(Boolean);
  return segments.slice(-3).join('/') || 'untitled';
}

function shouldSuppressFile(filePath: string): string | null {
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (BLOCKED_PATH_PATTERN.test(normalizedPath)) {
    return 'This file is excluded from AI inline completion.';
  }
  if (BLOCKED_EXTENSION_PATTERN.test(normalizedPath)) {
    return 'This file type is excluded from AI inline completion.';
  }
  if (GENERATED_FILE_PATTERN.test(normalizedPath)) {
    return 'Generated files are excluded from AI inline completion.';
  }
  return null;
}

export function buildInlineCompletionContext(options: {
  text: string;
  offset: number;
  language: string | null;
  filePath: string;
}): InlineCompletionContextResult {
  const fileSuppression = shouldSuppressFile(options.filePath);
  if (fileSuppression) return { status: 'suppressed', reason: fileSuppression };
  if (options.text.length > INLINE_COMPLETION_CONTEXT_LIMITS.maxSourceCharacters) {
    return {
      status: 'suppressed',
      reason: 'This file is too large for AI inline completion.',
    };
  }
  if (UNSAFE_SOURCE_CHARACTER_PATTERN.test(options.text)) {
    return {
      status: 'suppressed',
      reason: 'This buffer contains unsupported binary content.',
    };
  }
  if (SECRET_CONTENT_PATTERN.test(options.text)) {
    return {
      status: 'suppressed',
      reason: 'This buffer appears to contain a secret.',
    };
  }

  const offset = Math.min(Math.max(options.offset, 0), options.text.length);
  const prefixStart = Math.max(
    0,
    offset - INLINE_COMPLETION_CONTEXT_LIMITS.maxPrefixCharacters,
  );
  const suffixEnd = Math.min(
    options.text.length,
    offset + INLINE_COMPLETION_CONTEXT_LIMITS.maxSuffixCharacters,
  );

  return {
    status: 'ready',
    context: {
      prefix: options.text.slice(prefixStart, offset),
      suffix: options.text.slice(offset, suffixEnd),
      language: options.language?.trim() || 'plaintext',
      filePath: normalizePath(options.filePath),
    },
  };
}
