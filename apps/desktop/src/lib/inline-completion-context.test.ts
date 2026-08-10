import { describe, expect, it } from 'vitest';
import {
  buildInlineCompletionContext,
  INLINE_COMPLETION_CONTEXT_LIMITS,
} from './inline-completion-context';

describe('buildInlineCompletionContext', () => {
  it('keeps a bounded window and hides absolute path details', () => {
    const result = buildInlineCompletionContext({
      text: `${'a'.repeat(20_000)}${'cursor'}${'b'.repeat(10_000)}`,
      offset: 20_000,
      language: 'typescript',
      filePath: 'C:\\Users\\developer\\workspace\\src\\feature.ts',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.context.prefix).toHaveLength(INLINE_COMPLETION_CONTEXT_LIMITS.maxPrefixCharacters);
    expect(result.context.suffix).toHaveLength(INLINE_COMPLETION_CONTEXT_LIMITS.maxSuffixCharacters);
    expect(result.context.filePath).toBe('workspace/src/feature.ts');
  });

  it('suppresses secret and generated files', () => {
    expect(
      buildInlineCompletionContext({
        text: 'TOKEN=secret',
        offset: 12,
        language: 'dotenv',
        filePath: 'C:\\workspace\\.env.local',
      }),
    ).toMatchObject({ status: 'suppressed' });

    expect(
      buildInlineCompletionContext({
        text: `const apiKey = '123456789';\nconst value = `,
        offset: 39,
        language: 'typescript',
        filePath: 'src/config.ts',
      }),
    ).toMatchObject({ status: 'suppressed' });

    expect(
      buildInlineCompletionContext({
        text: 'minified code',
        offset: 4,
        language: 'javascript',
        filePath: 'C:\\workspace\\dist\\app.min.js',
      }),
    ).toMatchObject({ status: 'suppressed' });
  });

  it('suppresses oversized and binary buffers', () => {
    expect(
      buildInlineCompletionContext({
        text: 'x'.repeat(INLINE_COMPLETION_CONTEXT_LIMITS.maxSourceCharacters + 1),
        offset: 0,
        language: 'text',
        filePath: 'large.txt',
      }),
    ).toMatchObject({ status: 'suppressed' });

    expect(
      buildInlineCompletionContext({
        text: 'valid\u0000binary',
        offset: 5,
        language: 'text',
        filePath: 'data.txt',
      }),
    ).toMatchObject({ status: 'suppressed' });
  });
});
