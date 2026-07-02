import { describe, expect, it } from 'vitest';

import type { ToolCallDisplay } from '@/stores/agent-store';

import { getFileActivityPath, isFileMutation } from './file-activity';

function toolCall(name: string, input: Record<string, unknown>): ToolCallDisplay {
  return { id: name, name, input, status: 'running' };
}

describe('file activity', () => {
  it('recognizes every workspace mutation shown in the live activity surface', () => {
    expect(
      [
        'write_file',
        'create_file',
        'edit_file',
        'replace_lines',
        'insert_lines',
        'delete_file',
        'rename_file',
        'copy_file',
      ].every((name) => isFileMutation(toolCall(name, {}))),
    ).toBe(true);
    expect(isFileMutation(toolCall('read_file', {}))).toBe(false);
  });

  it('uses the destination path for move and copy operations', () => {
    expect(getFileActivityPath(toolCall('rename_file', { from: 'old.ts', to: 'new.ts' }))).toBe(
      'new.ts',
    );
    expect(getFileActivityPath(toolCall('edit_file', { path: 'src/app.tsx' }))).toBe('src/app.tsx');
  });
});
