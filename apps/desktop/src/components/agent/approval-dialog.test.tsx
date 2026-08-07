/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDialog } from './approval-dialog';
import type { PendingApproval } from '@/stores/agent-store';

const { resolveApprovalMock, trustToolMock } = vi.hoisted(() => ({
  resolveApprovalMock: vi.fn(),
  trustToolMock: vi.fn(),
}));

vi.mock('@/lib/active-agent-bridge', () => ({
  getActiveAgentBridge: () => ({
    resolveApproval: resolveApprovalMock,
    trustToolForSession: trustToolMock,
  }),
}));

const externalApproval: PendingApproval = {
  id: 'external-approval',
  toolName: 'write_file',
  input: { path: 'C:/external/file.txt', content: 'changed' },
  description: 'write external file',
  externalAccess: {
    operation: 'write',
    paths: ['c:/external/file.txt'],
    directories: ['c:/external'],
    directoryScopes: [],
  },
};

describe('ApprovalDialog external access', () => {
  afterEach(() => {
    cleanup();
    resolveApprovalMock.mockReset();
    trustToolMock.mockReset();
  });

  it('shows the edit warning and uses a session-directory grant', () => {
    render(<ApprovalDialog approval={externalApproval} />);

    expect(screen.getByText('External access required')).toBeTruthy();
    expect(screen.getByText(/This action will edit external data/)).toBeTruthy();
    expect(screen.queryByText('Approve all')).toBeNull();
    expect(screen.queryByText('Trust this tool')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Allow directory for this session' }));

    expect(resolveApprovalMock).toHaveBeenCalledWith('external-approval', {
      approved: true,
      externalGrant: 'session-directory',
    });
    expect(trustToolMock).not.toHaveBeenCalled();
  });
});
