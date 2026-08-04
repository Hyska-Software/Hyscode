/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VortexProjectSessionNavigator } from './vortex-project-session-navigator';
import { useAgentStore } from '@/stores/agent-store';
import { useLayoutStore } from '@/stores/layout-store';
import { useProjectStore } from '@/stores/project-store';

const { loadIndexMock, activateSessionMock, openProjectMock, invokeMock, pickFolderMock } = vi.hoisted(() => ({
  loadIndexMock: vi.fn(),
  activateSessionMock: vi.fn(),
  openProjectMock: vi.fn(),
  invokeMock: vi.fn(),
  pickFolderMock: vi.fn(),
}));

vi.mock('@/lib/vortex-project-sessions', () => ({
  loadVortexProjectSessionIndex: loadIndexMock,
  VORTEX_SESSION_INDEX_UPDATED_EVENT: 'hyscode:vortex-session-index-updated',
}));
vi.mock('@/lib/project-persistence', () => ({
  activateVortexSession: activateSessionMock,
  openProjectWorkspace: openProjectMock,
}));
vi.mock('@/lib/tauri-invoke', () => ({ tauriInvoke: invokeMock }));
vi.mock('@/lib/tauri-dialog', () => ({ pickFolder: pickFolderMock }));
vi.mock('@/lib/harness-bridge', () => ({
  HarnessBridge: { get: vi.fn(() => ({ restoreSession: vi.fn() })) },
}));
vi.mock('@/components/ui/dialogs', () => ({
  promptConfirm: vi.fn(async () => false),
  promptInput: vi.fn(async () => null),
}));

const session = {
  id: 'session-a',
  title: 'Target session',
  mode: 'build' as const,
  modelId: null,
  providerId: null,
  messageCount: 3,
  createdAt: '2026-08-04 10:00:00',
  updatedAt: '2026-08-04 10:01:00',
  projectId: 'project-a',
  projectName: 'Project A',
  projectPath: 'C:/project-a',
};

describe('VortexProjectSessionNavigator', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    loadIndexMock.mockReset().mockResolvedValue({
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          path: 'C:/project-a',
          lastActivityAt: '2026-08-04 10:01:00',
          lastOpened: Date.now(),
          sessions: [session],
        },
        {
          id: 'empty-project',
          name: 'Empty Project',
          path: 'C:/empty-project',
          lastActivityAt: null,
          lastOpened: Date.now() - 1000,
          sessions: [],
        },
      ],
      recentSessions: [session],
    });
    activateSessionMock.mockReset().mockResolvedValue(undefined);
    openProjectMock.mockReset().mockResolvedValue(undefined);
    invokeMock.mockReset().mockResolvedValue(undefined);
    pickFolderMock.mockReset().mockResolvedValue(null);

    useProjectStore.setState({
      rootPath: 'C:/project-a',
      name: 'Project A',
      isLoading: false,
      recentProjects: [{ name: 'Project A', path: 'C:/project-a', lastOpened: Date.now() }],
      vortexHiddenProjectPaths: [],
    });
    useAgentStore.setState({
      conversationId: null,
      messages: [],
      isStreaming: false,
      pendingApprovals: [],
      pendingUserQuestion: null,
    });
    useLayoutStore.setState({ workspaceMode: 'agent' });
  });

  it('renders recent sessions, project groups, and empty projects', async () => {
    render(<VortexProjectSessionNavigator />);

    expect(await screen.findByText('Recent')).toBeTruthy();
    expect(screen.getAllByText('Target session').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Project A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Empty Project')).toBeTruthy();
    expect(screen.getByText('No sessions in this workspace yet.')).toBeTruthy();
    expect(screen.queryByText('Vortex · one active project runtime')).toBeNull();
  });

  it('hides and restores recent sessions from the discreet section control', async () => {
    render(<VortexProjectSessionNavigator />);

    const hideRecentButton = await screen.findByRole('button', { name: 'Hide recent sessions' });
    expect(document.getElementById('vortex-recent-content')).toBeTruthy();

    fireEvent.click(hideRecentButton);

    const showRecentButton = screen.getByRole('button', { name: 'Show recent sessions' });
    expect(showRecentButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('vortex-recent-content')).toBeNull();

    fireEvent.click(showRecentButton);

    expect(screen.getByRole('button', { name: 'Hide recent sessions' })).toBeTruthy();
    expect(document.getElementById('vortex-recent-content')).toBeTruthy();
  });

  it('offers useful project actions from the context menu', async () => {
    render(<VortexProjectSessionNavigator />);

    const projectActions = await screen.findByRole('button', { name: 'Actions for Empty Project' });
    const newSessionButton = screen.getByRole('button', { name: 'New session in Empty Project' });
    expect(projectActions.compareDocumentPosition(newSessionButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(projectActions);

    expect(await screen.findByRole('menuitem', { name: 'New session' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy project path' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reveal in File Explorer' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Hide from Vortex' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in File Explorer' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('reveal_path', { path: 'C:/empty-project' });
    });

    const activeProjectActions = screen.getByRole('button', { name: 'Actions for Project A' });
    expect((activeProjectActions as HTMLButtonElement).disabled).toBe(false);
  });

  it('activates the selected session through the guarded lifecycle', async () => {
    render(<VortexProjectSessionNavigator />);

    fireEvent.click((await screen.findAllByText('Target session'))[0]);

    await waitFor(() => {
      expect(activateSessionMock).toHaveBeenCalledWith('C:/project-a', 'session-a');
    });
  });

  it('refreshes the index and shows the working indicator for the active turn', async () => {
    render(<VortexProjectSessionNavigator />);
    await screen.findByText('Recent');
    const initialLoadCount = loadIndexMock.mock.calls.length;

    useAgentStore.setState({
      conversationId: 'session-a',
      messages: [{ id: 'message-a', role: 'user', content: 'Hello', timestamp: Date.now() }],
      isStreaming: true,
    });

    await waitFor(() => {
      expect(loadIndexMock.mock.calls.length).toBeGreaterThan(initialLoadCount);
      expect(screen.getAllByRole('status', { name: /Agent working/i }).length).toBeGreaterThan(0);
    });

    const eventLoadCount = loadIndexMock.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('hyscode:vortex-session-index-updated'));
    });
    await waitFor(() => {
      expect(loadIndexMock.mock.calls.length).toBeGreaterThan(eventLoadCount);
    });
  });

  it('shows a newly started session in Recent and its project after refresh', async () => {
    const newSession = { ...session, id: 'new-session', title: 'New session', messageCount: 1 };
    let refreshCount = 0;
    loadIndexMock.mockImplementation(async () => {
      refreshCount += 1;
      const sessions = refreshCount > 1 ? [newSession] : [];
      return {
        projects: [
          {
            id: 'project-a',
            name: 'Project A',
            path: 'C:/project-a',
            lastActivityAt: '2026-08-04 10:01:00',
            lastOpened: Date.now(),
            sessions,
          },
        ],
        recentSessions: sessions,
      };
    });

    render(<VortexProjectSessionNavigator />);
    await screen.findByText('Recent');
    expect(screen.queryAllByTitle('New session')).toHaveLength(0);

    useAgentStore.setState({
      conversationId: 'new-session',
      messages: [{ id: 'message-new', role: 'user', content: 'Hello', timestamp: Date.now() }],
      isStreaming: true,
    });

    await waitFor(() => {
      expect(screen.getAllByTitle('New session').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByRole('status', { name: /Agent working/i }).length).toBeGreaterThan(0);
    });
  });

  it('expands and collapses a project from its project header', async () => {
    render(<VortexProjectSessionNavigator />);

    const projectName = await screen.findByText('Empty Project');
    expect(screen.getByText('No sessions in this workspace yet.')).toBeTruthy();

    fireEvent.click(projectName);
    expect(screen.queryByText('No sessions in this workspace yet.')).toBeNull();

    fireEvent.click(projectName);
    expect(screen.getByText('No sessions in this workspace yet.')).toBeTruthy();
    expect(openProjectMock).not.toHaveBeenCalled();
  });

  it('opens a project and starts a new session from its project action', async () => {
    render(<VortexProjectSessionNavigator />);

    fireEvent.click(await screen.findByRole('button', { name: 'New session in Empty Project' }));

    await waitFor(() => {
      expect(openProjectMock).toHaveBeenCalledWith('C:/empty-project', { workspaceMode: 'agent' });
    });
  });
});
