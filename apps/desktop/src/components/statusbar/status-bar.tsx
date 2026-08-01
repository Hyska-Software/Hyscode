import { useRef, useState, useEffect } from 'react';
import { GitBranch, Circle, Blocks, Zap, Smartphone, Github } from 'lucide-react';
import { useGitStore, useEditorStore, useExtensionStore } from '../../stores';
import { useGithubStore } from '../../stores/github-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useLspStore } from '../../stores/lsp-store';
import { useDeviceStore } from '../../stores/device-store';
import { detectLanguage } from '../../lib/lsp-bridge';
import { BranchPicker } from '../git/branch-picker';
import { useAgentStore } from '../../stores/agent-store';
import { getGitStatusBarPresentation } from '../../lib/git-workflow';

export function StatusBar() {
  const repositoryState = useGitStore((s) => s.repositoryState);
  const repositoryError = useGitStore((s) => s.repositoryError);
  const repositoryOperation = useGitStore((s) => s.repositoryOperation);
  const headState = useGitStore((s) => s.headState);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const upstream = useGitStore((s) => s.upstream);
  const staged = useGitStore((s) => s.staged);
  const unstaged = useGitStore((s) => s.unstaged);
  const untracked = useGitStore((s) => s.untracked);
  const conflicts = useGitStore((s) => s.conflicts);

  const githubAuthStatus = useGithubStore((s) => s.authStatus);
  const githubUser = useGithubStore((s) => s.user);
  const githubCheckAuth = useGithubStore((s) => s.checkAuth);
  const openSettingsOnTab = useSettingsStore((s) => s.openSettingsOnTab);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const extensionCount = useExtensionStore((s) => s.extensions.filter((e) => e.enabled).length);

  const serverStatuses = useLspStore((s) => s.serverStatuses);
  const activeLang = activeTab?.filePath ? detectLanguage(activeTab.filePath) : undefined;
  const lspInfo = activeLang ? serverStatuses[activeLang] : undefined;

  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const connectionState = useAgentStore((state) => state.connectionState);
  const connectionMessage = useAgentStore((state) => state.connectionMessage);

  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const branchRef = useRef<HTMLButtonElement>(null);

  const totalChanges = staged.length + unstaged.length + untracked.length + conflicts.length;
  const gitPresentation = getGitStatusBarPresentation({
    repositoryState,
    repositoryError,
    headState,
    currentBranch,
    repositoryOperation,
  });

  // Resolve the GitHub auth state once on mount so the indicator is accurate.
  useEffect(() => {
    if (githubAuthStatus === 'unknown') {
      void githubCheckAuth();
    }
  }, [githubAuthStatus, githubCheckAuth]);

  return (
    <>
      <footer className="flex h-5 items-center justify-between border-t border-border/50 bg-background px-3 text-[10px]">
        <div className="flex items-center gap-3">
          {gitPresentation.interactive ? (
            <button
              ref={branchRef}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setBranchPickerOpen(!branchPickerOpen)}
              title={gitPresentation.title}
            >
              <GitBranch className="h-2.5 w-2.5" />
              <span>{gitPresentation.label}</span>
              {ahead > 0 && <span className="text-success">↑{ahead}</span>}
              {behind > 0 && <span className="text-warning">↓{behind}</span>}
              {!upstream && currentBranch && <span className="text-warning">Publish</span>}
              {totalChanges > 0 && <span className="text-primary">{totalChanges}⨉</span>}
            </button>
          ) : (
            <span
              className={`flex items-center gap-1.5 ${
                repositoryState === 'error' ? 'text-destructive' : 'text-muted-foreground'
              }`}
              title={gitPresentation.title}
            >
              <GitBranch className="h-2.5 w-2.5" />
              <span>{gitPresentation.label}</span>
            </span>
          )}
          <div
            className={`flex items-center gap-1.5 ${connectionState === 'degraded' || connectionState === 'offline' || connectionState === 'retry_wait' ? 'text-warning' : 'text-muted-foreground'}`}
            title={connectionMessage ?? `Agent connection: ${connectionState}`}
          >
            <Circle
              className={`h-1.5 w-1.5 ${connectionState === 'degraded' || connectionState === 'offline' || connectionState === 'retry_wait' ? 'fill-warning text-warning' : 'fill-success text-success'}`}
            />
            <span>
              {connectionState === 'idle' ? 'Ready' : (connectionMessage ?? connectionState)}
            </span>
          </div>
          {githubAuthStatus === 'signed-in' && githubUser && (
            <button
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              title={`GitHub: @${githubUser.login} — click to manage`}
              onClick={() => openSettingsOnTab('git')}
            >
              <img
                src={githubUser.avatar_url}
                alt=""
                className="h-3 w-3 rounded-full"
              />
              <span className="max-w-[90px] truncate">@{githubUser.login}</span>
            </button>
          )}
          {githubAuthStatus === 'signed-out' && (
            <button
              className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
              title="Sign in with GitHub — clone, publish and manage repositories"
              onClick={() => openSettingsOnTab('git')}
            >
              <Github className="h-2.5 w-2.5" />
              <span>Sign in</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          {extensionCount > 0 && (
            <span
              className="flex items-center gap-1"
              title={`${extensionCount} extension(s) active`}
            >
              <Blocks className="h-2.5 w-2.5" />
              <span>{extensionCount}</span>
            </span>
          )}
          {selectedDevice && (
            <span
               className="flex items-center gap-1 text-primary"
              title={`Target: ${selectedDevice.name} (${selectedDevice.platform})`}
            >
              <Smartphone className="h-2.5 w-2.5" />
              <span className="max-w-[120px] truncate">{selectedDevice.name}</span>
            </span>
          )}
          <span>UTF-8</span>
          <span>{activeTab?.language ?? 'Plain Text'}</span>
          {lspInfo && (
            <span
              className={`flex items-center gap-1 ${
                lspInfo.status === 'ready'
                  ? 'text-success'
                  : lspInfo.status === 'starting'
                    ? 'text-warning'
                    : lspInfo.status === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
              }`}
              title={`${lspInfo.displayName}: ${lspInfo.status}`}
            >
              <Zap className="h-2.5 w-2.5" />
              <span>{lspInfo.status === 'ready' ? 'LSP' : lspInfo.status}</span>
            </span>
          )}
        </div>
      </footer>
      <BranchPicker
        open={branchPickerOpen}
        onClose={() => setBranchPickerOpen(false)}
        anchorRef={branchRef as React.RefObject<HTMLElement>}
      />
    </>
  );
}
