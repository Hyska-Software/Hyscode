import { TitleBar } from './components/titlebar';
import { StatusBar } from './components/statusbar';
import { WelcomePage } from './components/welcome';
import { SettingsModal } from './components/settings';
import { ExtensionOverlays } from './components/editor/extension-overlays';
import { CommandPalette, openCommandPalette } from './components/editor/command-palette';
import { TooltipProvider } from './components/ui/tooltip';
import { DialogProvider } from './components/ui/dialogs';
import { EditorLayout, AgentLayout, ReviewLayout } from './components/layouts';
import { useProjectStore, useFileStore, useSettingsStore, useEditorStore } from './stores';
import { useLayoutStore } from './stores/layout-store';
import { useSkillsStore } from './stores/skills-store';
import { useRulesStore } from './stores/rules-store';
import { useExtensionStore } from './stores/extension-store';
import { useCommandStore } from './stores/command-store';
import { useKeybindingStore } from './stores/keybinding-store';
import { useGitStore } from './stores/git-store';
import { useTerminalStore } from './stores/terminal-store';
import { useUpdateStore } from './stores/update-store';
import { useEffect, useRef, useCallback } from 'react';
import { pickFolder, pickFile } from './lib/tauri-dialog';
import { initProviders } from './lib/init-providers';
import { HarnessBridge } from './lib/harness-bridge';
import { LspBridge } from './lib/lsp-bridge';
import { startExtensionLspSync } from './lib/extension-lsp-bridge';
import { getViewerType } from './lib/utils';
import { UpdateBanner } from './components/updater/update-banner';
import { UpdateDialog } from './components/updater/update-dialog';
import { saveProjectState, switchProject, closeCurrentProject } from './lib/project-persistence';

import { isLightTheme } from './lib/monaco-themes';

// ── Theme effect — applies CSS class on <html> whenever themeId changes ──────

function useThemeEffect() {
  const themeId = useSettingsStore((s) => s.themeId);
  useEffect(() => {
    const el = document.documentElement;
    // Remove any existing theme-* classes
    el.classList.forEach((cls) => {
      if (cls.startsWith('theme-')) el.classList.remove(cls);
    });
    el.classList.add(`theme-${themeId}`);
    // Toggle dark class for shadcn dark: variant support
    if (isLightTheme(themeId)) {
      el.classList.remove('dark');
    } else {
      el.classList.add('dark');
    }
  }, [themeId]);
}

function IDE() {
  const projectRootPath = useProjectStore((s) => s.rootPath);
  const fileRootPath = useFileStore((s) => s.rootPath);
  const openFolder = useFileStore((s) => s.openFolder);
  const bridgeInitRef = useRef(false);
  const lspInitRef = useRef(false);
  const extSyncRef = useRef<(() => void) | null>(null);
  const restoredRef = useRef(false);

  const workspaceMode = useLayoutStore((s) => s.workspaceMode);

  useThemeEffect();

  // On mount: if fileStore is empty but projectStore has a path (from persistence),
  // reload the directory tree and restore per-project state
  useEffect(() => {
    if (projectRootPath && !fileRootPath) {
      openFolder(projectRootPath).catch(console.error);
    }
    // Restore per-project state on first mount (startup)
    if (projectRootPath && !restoredRef.current) {
      restoredRef.current = true;
      switchProject(null, projectRootPath).catch(console.error);
    }
  }, []);

  // Save project state before the window unloads (IDE close / refresh)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentPath = useProjectStore.getState().rootPath;
      if (currentPath) {
        saveProjectState(currentPath);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Initialize HarnessBridge when project is open
  useEffect(() => {
    if (!projectRootPath || bridgeInitRef.current) return;
    bridgeInitRef.current = true;

    // HarnessBridge.init is async (resolves home dir via Rust)
    (async () => {
      try {
        const bridge = await HarnessBridge.init(projectRootPath, projectRootPath);
        const skills = await bridge.loadSkills();
        // Populate the skills store with discovered skills
        useSkillsStore.getState().setDiscoveredSkills(skills);
        await bridge.registerMcpTools();
      } catch (err) {
        console.warn('[App] Failed to initialize harness:', err);
      }
    })();

    return () => {
      HarnessBridge.destroy();
      bridgeInitRef.current = false;
    };
  }, [projectRootPath]);

  // Initialize LspBridge when project is open
  useEffect(() => {
    if (!projectRootPath || lspInitRef.current) return;
    lspInitRef.current = true;

    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        await LspBridge.init(
          invoke as Parameters<typeof LspBridge.init>[0],
          listen as unknown as Parameters<typeof LspBridge.init>[1],
          projectRootPath,
        );
        // Sync extension-contributed language servers
        extSyncRef.current = startExtensionLspSync();
      } catch (err) {
        console.warn('[App] Failed to initialize LSP bridge:', err);
      }
    })();

    return () => {
      extSyncRef.current?.();
      extSyncRef.current = null;
      LspBridge.destroy();
      lspInitRef.current = false;
    };
  }, [projectRootPath]);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden p-1.5 pt-0">
        {workspaceMode === 'editor' && <EditorLayout />}
        {workspaceMode === 'agent' && <AgentLayout />}
        {workspaceMode === 'review' && <ReviewLayout />}
      </div>

      <UpdateBanner />
      <StatusBar />
      <SettingsModal />
      <ExtensionOverlays />
      <CommandPalette />
      <UpdateDialog />
    </div>
  );
}

export function App() {
  const rootPath = useProjectStore((s) => s.rootPath);
  const openProject = useProjectStore((s) => s.openProject);
  const closeProject = useProjectStore((s) => s.closeProject);
  const openFolder = useFileStore((s) => s.openFolder);
  const closeFolder = useFileStore((s) => s.closeFolder);
  const openUntitled = useEditorStore((s) => s.openUntitled);
  const openTab = useEditorStore((s) => s.openTab);
  const closeTab = useEditorStore((s) => s.closeTab);

  // Project lifecycle: open a new project with state save/restore
  const handleOpenProject = useCallback(async (path: string) => {
    const currentPath = useProjectStore.getState().rootPath;
    await switchProject(currentPath, path);
    openProject(path);
    await openFolder(path);
  }, [openProject, openFolder]);

  // Project lifecycle: close current project with state save
  const handleCloseProject = useCallback(() => {
    const currentPath = useProjectStore.getState().rootPath;
    if (currentPath) {
      closeCurrentProject(currentPath);
    }
    closeProject();
    closeFolder();
  }, [closeProject, closeFolder]);

  // Initialize AI providers on app startup (once)
  useEffect(() => {
    initProviders().catch(console.error);
  }, []);


  // Check for updates silently after a short delay (non-blocking)
  useEffect(() => {
    if (!useSettingsStore.getState().checkForUpdatesOnStartup) return;
    const timer = setTimeout(() => {
      useUpdateStore.getState().checkForUpdates().catch(console.error);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  // Load extensions on startup (once) so contributions + activation run
  // regardless of whether the user ever opens the Extensions panel
  useEffect(() => {
    useExtensionStore.getState().loadExtensions().catch(console.error);
  }, []);

  // ── Register built-in IDE commands ───────────────────────────────────────
  useEffect(() => {
    const cmdStore = useCommandStore.getState();
    const kbStore = useKeybindingStore.getState();
    const disposers: Array<() => void> = [];

    // Helper to register a built-in command + optional keybinding
    function builtin(
      id: string,
      title: string,
      handler: () => void | Promise<void>,
      opts?: { category?: string; key?: string },
    ) {
      disposers.push(cmdStore.registerCommand(id, handler, { title, category: opts?.category ?? 'General' }));
      if (opts?.key) {
        disposers.push(kbStore.register({ command: id, key: opts.key }));
      }
    }

    builtin('workbench.action.showCommands', 'Show Command Palette', () => {
      openCommandPalette();
    }, { key: 'ctrl+shift+p' });

    builtin('workbench.action.openFolder', 'Open Folder...', async () => {
      const path = await pickFolder();
      if (path) await handleOpenProject(path);
    }, { category: 'File', key: 'ctrl+k ctrl+o' });

    builtin('workbench.action.closeFolder', 'Close Folder', () => {
      handleCloseProject();
    }, { category: 'File' });

    builtin('workbench.action.newUntitledFile', 'New File', () => {
      openUntitled();
    }, { category: 'File', key: 'ctrl+n' });

    builtin('workbench.action.openFile', 'Open File...', async () => {
      const path = await pickFile();
      if (path) {
        const sep = path.includes('/') ? '/' : '\\';
        const fileName = path.split(sep).pop() ?? 'file';
        const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
        openTab({
          id: path,
          filePath: path,
          fileName,
          language: ext || 'plaintext',
          viewerType: getViewerType(fileName),
        });
      }
    }, { category: 'File', key: 'ctrl+o' });

    builtin('workbench.action.closeActiveEditor', 'Close Editor', () => {
      const activeId = useEditorStore.getState().activeTabId;
      if (activeId) closeTab(activeId);
    }, { category: 'View', key: 'ctrl+f4' });

    builtin('workbench.action.toggleTerminal', 'Toggle Terminal', () => {
      useLayoutStore.getState().toggleTerminal();
    }, { category: 'View', key: 'ctrl+`' });

    builtin('workbench.action.toggleSidebar', 'Toggle Sidebar', () => {
      useLayoutStore.getState().toggleSidebar();
    }, { category: 'View', key: 'ctrl+b' });

    builtin('workbench.action.focusExplorer', 'Focus Explorer', () => {
      useLayoutStore.getState().focusSidebarView('files');
    }, { category: 'View', key: 'ctrl+shift+e' });

    builtin('workbench.action.focusSearch', 'Focus Search', () => {
      useLayoutStore.getState().focusSidebarView('search');
    }, { category: 'View', key: 'ctrl+shift+f' });

    builtin('workbench.action.focusSourceControl', 'Focus Source Control', () => {
      useLayoutStore.getState().focusSidebarView('git');
    }, { category: 'View', key: 'ctrl+shift+g' });

    builtin('workbench.action.focusExtensions', 'Focus Extensions', () => {
      useLayoutStore.getState().focusSidebarView('extensions');
    }, { category: 'View' });

    builtin('workbench.action.focusSkills', 'Focus Skills', () => {
      useLayoutStore.getState().focusSidebarView('skills');
    }, { category: 'View' });

    builtin('workbench.action.focusDevices', 'Focus Devices', () => {
      useLayoutStore.getState().focusSidebarView('devices');
    }, { category: 'View' });

    builtin('workbench.action.focusDocker', 'Focus Docker', () => {
      useLayoutStore.getState().focusSidebarView('docker');
    }, { category: 'View' });

    builtin('workbench.action.switchToEditorMode', 'Switch to Editor Mode', () => {
      useLayoutStore.getState().setWorkspaceMode('editor');
    }, { category: 'View' });

    builtin('workbench.action.switchToAgentMode', 'Switch to Agent Mode', () => {
      useLayoutStore.getState().setWorkspaceMode('agent');
    }, { category: 'View' });

    builtin('workbench.action.switchToReviewMode', 'Switch to Review Mode', () => {
      useLayoutStore.getState().setWorkspaceMode('review');
    }, { category: 'View' });

    builtin('workbench.action.reloadExtensions', 'Reload Extensions', () => {
      useExtensionStore.getState().loadExtensions().catch(console.error);
    }, { category: 'Extensions' });

    // ── Git commands ─────────────────────────────────────────────────────
    builtin('git.init', 'Initialize Repository', async () => {
      await useGitStore.getState().initRepo();
    }, { category: 'Git' });

    builtin('git.refresh', 'Refresh Status', async () => {
      await useGitStore.getState().refresh();
    }, { category: 'Git' });

    builtin('git.stageAll', 'Stage All Changes', async () => {
      await useGitStore.getState().stageAll();
    }, { category: 'Git' });

    builtin('git.unstageAll', 'Unstage All', async () => {
      await useGitStore.getState().unstageAll();
    }, { category: 'Git' });

    builtin('git.discardAll', 'Discard All Changes', async () => {
      await useGitStore.getState().discardAll();
    }, { category: 'Git' });

    builtin('git.commit', 'Commit Staged', async () => {
      try {
        await useGitStore.getState().commit();
      } catch (err) {
        console.warn('[Git] Commit failed:', err);
      }
    }, { category: 'Git' });

    builtin('git.push', 'Push', async () => {
      try {
        await useGitStore.getState().push();
      } catch (err) {
        console.warn('[Git] Push failed:', err);
      }
    }, { category: 'Git' });

    builtin('git.pull', 'Pull', async () => {
      try {
        await useGitStore.getState().pull();
      } catch (err) {
        console.warn('[Git] Pull failed:', err);
      }
    }, { category: 'Git' });

    builtin('git.fetch', 'Fetch', async () => {
      try {
        await useGitStore.getState().fetch();
      } catch (err) {
        console.warn('[Git] Fetch failed:', err);
      }
    }, { category: 'Git' });

    builtin('git.stash', 'Stash Changes', async () => {
      await useGitStore.getState().stashChanges();
    }, { category: 'Git' });

    builtin('git.stashPop', 'Pop Latest Stash', async () => {
      await useGitStore.getState().popStash(0);
    }, { category: 'Git' });

    builtin('git.fetchLog', 'Show Commit Log', async () => {
      await useGitStore.getState().fetchLog();
    }, { category: 'Git' });

    builtin('git.fetchBranches', 'List Branches', async () => {
      await useGitStore.getState().fetchBranches();
    }, { category: 'Git' });

    // ── Editor / Tab commands ────────────────────────────────────────────
    builtin('workbench.action.closeOtherEditors', 'Close Other Editors', () => {
      const activeId = useEditorStore.getState().activeTabId;
      if (activeId) useEditorStore.getState().closeOtherTabs(activeId);
    }, { category: 'View' });

    builtin('workbench.action.closeEditorsToTheRight', 'Close Editors to the Right', () => {
      const activeId = useEditorStore.getState().activeTabId;
      if (activeId) useEditorStore.getState().closeTabsToTheRight(activeId);
    }, { category: 'View' });

    builtin('workbench.action.closeSavedEditors', 'Close Saved Editors', () => {
      useEditorStore.getState().closeSavedTabs();
    }, { category: 'View' });

    builtin('workbench.action.closeAllEditors', 'Close All Editors', () => {
      useEditorStore.getState().closeAllTabs();
    }, { category: 'View' });

    builtin('workbench.action.pinEditor', 'Pin Editor', () => {
      const activeId = useEditorStore.getState().activeTabId;
      if (activeId) useEditorStore.getState().pinTab(activeId);
    }, { category: 'View' });

    builtin('workbench.action.unpinEditor', 'Unpin Editor', () => {
      const activeId = useEditorStore.getState().activeTabId;
      if (activeId) useEditorStore.getState().unpinTab(activeId);
    }, { category: 'View' });

    // ── Settings / Preferences ───────────────────────────────────────────
    builtin('workbench.action.openSettings', 'Open Settings', () => {
      useSettingsStore.getState().openSettings();
    }, { category: 'Preferences', key: 'ctrl+,' });

    // ── Rules commands ─────────────────────────────────────────────────────
    builtin('agent.rules.openPanel', 'Open Rules Panel', () => {
      useLayoutStore.getState().setRulesPanelOpen(true);
    }, { category: 'Agent' });

    builtin('agent.rules.closePanel', 'Close Rules Panel', () => {
      useLayoutStore.getState().setRulesPanelOpen(false);
    }, { category: 'Agent' });

    builtin('agent.rules.togglePanel', 'Toggle Rules Panel', () => {
      const s = useLayoutStore.getState();
      s.setRulesPanelOpen(!s.rulesPanelOpen);
    }, { category: 'Agent', key: 'ctrl+shift+r' });

    builtin('agent.rules.openSettings', 'Open Rules Settings', () => {
      useSettingsStore.getState().openSettings();
    }, { category: 'Agent' });

    builtin('agent.rules.createGlobal', 'Create Global Rule', () => {
      useLayoutStore.getState().setWorkspaceMode('agent');
      useLayoutStore.getState().setRulesPanelOpen(true);
      useRulesStore.getState().openRuleEditor({ scope: 'global' });
    }, { category: 'Agent' });

    builtin('agent.rules.createWorkspace', 'Create Workspace Rule', () => {
      useLayoutStore.getState().setWorkspaceMode('agent');
      useLayoutStore.getState().setRulesPanelOpen(true);
      useRulesStore.getState().openRuleEditor({ scope: 'workspace' });
    }, { category: 'Agent' });

    builtin('agent.rules.reload', 'Reload Rules from Disk', async () => {
      try {
        const discovered = await HarnessBridge.get().loadRules();
        useRulesStore.getState().setDiscoveredRules(discovered);
      } catch (err) {
        console.error('[Rules] Reload failed:', err);
      }
    }, { category: 'Agent' });

    // ── Terminal commands ─────────────────────────────────────────────────
    builtin('workbench.action.terminal.new', 'New Terminal', () => {
      useTerminalStore.getState().createSession();
      useLayoutStore.getState().setTerminalVisible(true);
    }, { category: 'Terminal', key: 'ctrl+shift+`' });

    builtin('workbench.action.terminal.newInEditor', 'New Terminal in Editor', () => {
      const sessionId = useTerminalStore.getState().createSession(undefined, false, undefined, 'editor');
      const session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId);
      useEditorStore.getState().openTerminalTab(sessionId, session?.name ?? 'Terminal');
    }, { category: 'Terminal' });

    builtin('workbench.action.terminal.moveToBottom', 'Move Terminal to Bottom', () => {
      useLayoutStore.getState().moveTerminalToBottom();
    }, { category: 'Terminal' });

    builtin('workbench.action.terminal.moveToSidebar', 'Move Terminal to Sidebar', () => {
      useLayoutStore.getState().moveTerminalToSidebar();
    }, { category: 'Terminal' });

    // ── File Tree commands ───────────────────────────────────────────────
    builtin('workbench.action.toggleHiddenFiles', 'Toggle Hidden Files', async () => {
      await useFileStore.getState().toggleShowHidden();
    }, { category: 'Explorer' });

    builtin('workbench.action.refreshExplorer', 'Refresh Explorer', async () => {
      await useFileStore.getState().refreshExpandedDirs();
    }, { category: 'Explorer' });

    // ── Theme ────────────────────────────────────────────────────────────
    builtin('workbench.action.selectTheme', 'Change Color Theme', () => {
      useSettingsStore.getState().openSettings();
    }, { category: 'Preferences', key: 'ctrl+k ctrl+t' });

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [handleOpenProject, handleCloseProject, openUntitled, openTab, closeTab]);

  // ── Global keybinding dispatch ─────────────────────────────────────────
  useEffect(() => {
    let waitingForSecond: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearChord = () => {
      waitingForSecond = null;
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const handler = async (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // ── Ctrl+K chord sequences (handled specially) ──
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        waitingForSecond = 'k';
        timer = setTimeout(clearChord, 1000);
        return;
      }

      if (waitingForSecond === 'k' && ctrl) {
        if (e.key === 'o') {
          e.preventDefault();
          clearChord();
          await useCommandStore.getState().executeCommand('workbench.action.openFolder');
          return;
        }
        if (e.key === 'f') {
          e.preventDefault();
          clearChord();
          await useCommandStore.getState().executeCommand('workbench.action.closeFolder');
          return;
        }
      }

      // Reset chord if a non-chord key was pressed
      if (waitingForSecond) {
        clearChord();
      }

      // ── Match against keybinding store (built-in + extension keybindings) ──
      const matched = useKeybindingStore.getState().match(e);
      if (matched) {
        e.preventDefault();
        try {
          await useCommandStore.getState().executeCommand(matched);
        } catch (err) {
          console.error(`[Keybinding] Failed to execute "${matched}":`, err);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <TooltipProvider>
      {!rootPath ? <WelcomePage /> : <IDE />}
      <DialogProvider />
    </TooltipProvider>
  );
}
