import { describe, expect, it } from 'vitest';
import { compactToolOutput } from './middleware';

describe('compactToolOutput', () => {
  it('keeps terminal diagnostics and omits noise', () => {
    const output = `${Array.from({ length: 800 }, (_, index) => `progress ${index}`).join('\n')}\nERROR: build failed\nexit code 1`;
    const compacted = compactToolOutput(output, 'run_terminal_command');
    expect(compacted).toContain('ERROR: build failed');
    expect(compacted).toContain('exit code 1');
    expect(compacted.length).toBeLessThan(output.length);
  });

  it('directs large file reads to ranged retrieval', () => {
    const output = Array.from(
      { length: 800 },
      (_, index) => `${index + 1}: line with enough content to exceed the compaction threshold`,
    ).join('\n');
    const compacted = compactToolOutput(output, 'read_file');
    expect(compacted).toContain('line_start/line_end');
    expect(compacted).toContain('1: line');
    expect(compacted).toContain('800: line');
  });
});
