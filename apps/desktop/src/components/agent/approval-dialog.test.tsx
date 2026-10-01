/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDialog } from './approval-dialog';
import type { PendingApproval } from '@/stores/agent-store';

const { resolveApprovalMock, trustToolMock, confirmExternalPathAccessMock } = vi.hoisted(() => ({
  resolveApprovalMock: vi.fn(),
  trustToolMock: vi.fn(),
  confirmExternalPathAccessMock: vi.fn(async () => 'native-grant-1'),
}));

vi.mock('@/lib/active-agent-bridge', () => ({
  getActiveAgentBridge: () => ({
    resolveApproval: resolveApprovalMock,
    trustToolForSession: trustToolMock,
    confirmExternalPathAccess: confirmExternalPathAccessMock,
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
    confirmExternalPathAccessMock.mockReset().mockResolvedValue('native-grant-1');
  });

  it('shows the edit warning and requires native confirmation for a session-directory grant', async () => {
    render(<ApprovalDialog approval={externalApproval} />);

    expect(screen.getByText('External access required')).toBeTruthy();
    expect(screen.getByText(/This action will edit external data/)).toBeTruthy();
    expect(screen.queryByText('Approve all')).toBeNull();
    expect(screen.queryByText('Trust this tool')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Allow directory for this session' }));

    await waitFor(() => {
      expect(confirmExternalPathAccessMock).toHaveBeenCalledWith(
        externalApproval.externalAccess,
        'session-directory',
      );
      expect(resolveApprovalMock).toHaveBeenCalledWith('external-approval', {
        approved: true,
        externalGrant: 'session-directory',
        nativeGrantId: 'native-grant-1',
      });
    });
    expect(trustToolMock).not.toHaveBeenCalled();
  });
});
