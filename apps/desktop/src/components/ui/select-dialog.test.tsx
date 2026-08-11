/* @vitest-environment jsdom */

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger, Select } from '@hyscode/ui';

afterEach(() => {
  cleanup();
});

function DialogSelectFixture() {
  const [priority, setPriority] = useState('medium');

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">Open task form</button>
      </DialogTrigger>
      <DialogContent showClose={false}>
        <DialogTitle>New task</DialogTitle>
        <label htmlFor="priority">Priority</label>
        <Select
          id="priority"
          value={priority}
          size="sm"
          aria-label="Priority"
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="urgent">Urgent</option>
        </Select>
      </DialogContent>
    </Dialog>
  );
}

describe('Select inside a modal dialog', () => {
  it('keeps the modal mounted while the priority is changed', async () => {
    render(<DialogSelectFixture />);

    fireEvent.click(screen.getByRole('button', { name: 'Open task form' }));
    const priorityTrigger = await screen.findByRole('combobox', { name: 'Priority' });

    fireEvent.change(priorityTrigger, { target: { value: 'urgent' } });

    await waitFor(() => expect((priorityTrigger as HTMLSelectElement).value).toBe('urgent'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
