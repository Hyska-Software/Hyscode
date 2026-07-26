import { describe, expect, it } from 'vitest';
import type { GraphCommit } from '../../stores/git-store';
import { computeRows, formatMermaid } from './git-graph-view';

function commit(hash: string, parents: string[], refs: string[] = [], message = hash): GraphCommit {
  return {
    hash,
    short_hash: hash.slice(0, 7),
    message,
    author: 'Test Author',
    email: 'test@example.invalid',
    timestamp: 1,
    parents,
    refs,
  };
}

describe('Git graph presentation', () => {
  it('allocates lanes for a merge without dropping either parent edge', () => {
    const commits = [
      commit('merge000', ['main002', 'side002'], ['main']),
      commit('side002', ['base000'], ['feature']),
      commit('main002', ['base000']),
      commit('base000', []),
    ];

    const { rows, maxLane } = computeRows(commits);

    expect(rows).toHaveLength(4);
    expect(rows[0].botSegs).toHaveLength(2);
    expect(maxLane).toBeGreaterThan(0);
  });

  it('represents merged branch history in Mermaid and caps truncated histories', () => {
    const commits = [
      commit('merge000', ['main002', 'side002'], ['main'], 'merge feature'),
      commit('side002', ['base000'], ['feature'], 'feature change'),
      commit('main002', ['base000'], [], 'main change'),
      commit('base000', [], [], 'base'),
    ];

    const diagram = formatMermaid(commits);

    expect(diagram).toContain('branch feature');
    expect(diagram).toContain('merge feature');

    const longHistory = Array.from({ length: 60 }, (_, index) =>
      commit(`hash${String(index).padStart(4, '0')}`, [], [], `commit ${index}`),
    );
    expect(formatMermaid(longHistory).match(/commit id:/g)).toHaveLength(50);
  });
});
