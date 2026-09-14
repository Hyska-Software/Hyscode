/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalModeToggle } from './goal-mode-toggle';

describe('GoalModeToggle', () => {
  afterEach(() => {
    cleanup();
  });

  it('is unavailable outside Build mode', () => {
    const onChange = vi.fn();
    render(<GoalModeToggle mode="chat" enabled={false} onChange={onChange} />);

    const button = screen.getByRole('button', { name: 'Goal mode is available in Build only' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggles Goal mode in Build mode', () => {
    const onChange = vi.fn();
    render(<GoalModeToggle mode="build" enabled={false} onChange={onChange} />);

    const button = screen.getByRole('button', { name: 'Enable Goal mode' });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('exposes the active state to assistive technology', () => {
    render(<GoalModeToggle mode="build" enabled onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Disable Goal mode' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
