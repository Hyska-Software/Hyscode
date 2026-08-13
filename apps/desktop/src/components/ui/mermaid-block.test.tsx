// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));
vi.mock('@/stores', () => ({
  useSettingsStore: (selector: (state: { themeId: string }) => unknown) =>
    selector({ themeId: 'hyscode-dark' }),
}));

import { MermaidBlock } from './mermaid-block';

afterEach(() => {
  cleanup();
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  document.body.innerHTML = '';
});

describe('MermaidBlock', () => {
  it('contains Mermaid syntax errors inside the preview block', async () => {
    mermaidMock.render.mockImplementation(async (id: string) => {
      const leakedMermaidNode = document.createElement('div');
      leakedMermaidNode.id = `d${id}`;
      leakedMermaidNode.innerHTML = '<svg><text>Syntax error in text</text></svg>';
      document.body.append(leakedMermaidNode);
      throw new Error('Parse error on line 3: unexpected end of input');
    });

    render(<MermaidBlock code={'flowchart TD\n  A -->'} />);

    const alert = await screen.findByRole('alert', {}, { timeout: 2_000 });

    expect(alert.textContent).toContain('Mermaid error');
    expect(alert.textContent).toContain('Parse error on line 3');
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ suppressErrorRendering: true }),
    );

    expect(document.body.querySelector('svg')).toBeNull();
  });

  it('keeps a previous diagram contained while reporting a later syntax error', async () => {
    mermaidMock.render
      .mockResolvedValueOnce({ svg: '<svg viewBox="0 0 10 10"><path /></svg>' })
      .mockRejectedValueOnce(new Error('Parse error on line 2: invalid token'));

    const { rerender } = render(<MermaidBlock code="flowchart TD\n  A --> B" />);
    await waitFor(() => expect(document.querySelector('.agent-mermaid svg')).toBeTruthy(), {
      timeout: 2_000,
    });

    rerender(<MermaidBlock code={'flowchart TD\n  A -->'} />);

    const alert = await screen.findByRole('alert', {}, { timeout: 2_000 });
    expect(alert.textContent).toContain('Parse error on line 2');
    expect(document.querySelectorAll('.agent-mermaid svg')).toHaveLength(1);
  });
});
