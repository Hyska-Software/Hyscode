import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../ui/dropdown-menu';
import { useEditorStore, useFileStore, useProjectStore, useSettingsStore } from '../../stores';
import { pickFile, pickFolder, saveFileDialog } from '../../lib/tauri-dialog';
import { tauriFs } from '../../lib/tauri-fs';
import { closeProjectWorkspace, openProjectWorkspace } from '../../lib/project-persistence';
import { getViewerType } from '../../lib/utils';
import { promptInput } from '../ui/dialogs';
import { detectLanguage } from '../../lib/lsp-bridge';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Home } from 'lucide-react';

export function FileMenu() {
  const openTab = useEditorStore((s) => s.openTab);
  const openUntitled = useEditorStore((s) => s.openUntitled);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const markDirty = useEditorStore((s) => s.markDirty);

  const rootPath = useFileStore((s) => s.rootPath);
  const setFileContent = useFileStore((s) => s.setFileContent);

  const recentProjects = useProjectStore((s) => s.recentProjects);

  const autoSave = useSettingsStore((s) => s.autoSave);
  const setSetting = useSettingsStore((s) => s.set);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleNewTextFile = () => {
    openUntitled();
  };

  const handleNewFile = async () => {
    if (!rootPath) return;
    const name = await promptInput({ title: 'New File', placeholder: 'Enter file name' });
    if (!name?.trim()) return;
    const sep = rootPath.includes('/') ? '/' : '\\';
    const fullPath = rootPath + sep + name.trim();
    try {
      await tauriFs.createFile(fullPath, '');
      // Open the new file in a tab
      const fileName = name.trim();
      openTab({
        id: fullPath,
        filePath: fullPath,
        fileName,
        language: detectLanguage(fullPath),
        viewerType: getViewerType(fileName),
      });
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  };

  const handleOpenFile = async () => {
    const path = await pickFile();
    if (!path) return;
    const sep = path.includes('/') ? '/' : '\\';
    const fileName = path.split(sep).pop() ?? 'file';
    openTab({
      id: path,
      filePath: path,
      fileName,
      language: detectLanguage(path),
      viewerType: getViewerType(fileName),
    });
  };

  const handleOpenFolder = async () => {
    const path = await pickFolder();
    if (path) {
      await openProjectWorkspace(path);
    }
  };

  const handleOpenRecent = async (path: string) => {
    await openProjectWorkspace(path);
  };

  const handleAutoSaveToggle = () => {
    setSetting('autoSave', autoSave === 'off' ? 'afterDelay' : 'off');
  };

  const handlePreferences = () => {
    setSetting('settingsOpen', true);
  };

  const handleRevertFile = async () => {
    if (!activeTab || activeTab.filePath.startsWith('untitled:')) return;
    try {
      const content = await tauriFs.readFile(activeTab.filePath);
      setFileContent(activeTab.filePath, content);
      markDirty(activeTab.id, false);
    } catch (err) {
      console.error('Failed to revert file:', err);
    }
  };

  const handleCloseEditor = () => {
    if (activeTabId) closeTab(activeTabId);
  };

  const handleCloseFolder = async () => {
    await closeProjectWorkspace();
  };

  const handleGoHome = async () => {
    await closeProjectWorkspace();
  };

  const handleSave = async () => {
    if (!activeTab) return;
    const content = useFileStore.getState().fileCache.get(activeTab.filePath);
    if (content === undefined) return;

    if (activeTab.filePath.startsWith('untitled:')) {
      const path = await saveFileDialog(activeTab.fileName);
      if (!path) return;
      try {
        await tauriFs.writeFile(path, content);
        markDirty(activeTab.id, false);
      } catch (err) {
        console.error('Failed to save file:', err);
      }
      return;
    }

    try {
      await tauriFs.writeFile(activeTab.filePath, content);
      markDirty(activeTab.id, false);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  };

  const handleSaveAs = async () => {
    if (!activeTab) return;
    const content = useFileStore.getState().fileCache.get(activeTab.filePath) ?? '';
    const path = await saveFileDialog(activeTab.fileName);
    if (!path) return;
    try {
      await tauriFs.writeFile(path, content);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  };

  const handleSaveAll = async () => {
    const { tabs: allTabs } = useEditorStore.getState();
    const cache = useFileStore.getState().fileCache;
    for (const tab of allTabs) {
      if (tab.isDirty && !tab.filePath.startsWith('untitled:')) {
        const content = cache.get(tab.filePath);
        if (content !== undefined) {
          try {
            await tauriFs.writeFile(tab.filePath, content);
            markDirty(tab.id, false);
          } catch (err) {
            console.error('Failed to save:', tab.filePath, err);
          }
        }
      }
    }
  };

  const handleExit = async () => {
    await getCurrentWindow().close();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 cursor-pointer items-center rounded-md px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none">
        File
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-64">
        {/* Home */}
        <DropdownMenuItem onClick={handleGoHome}>
          <Home className="mr-2 h-3.5 w-3.5" />
          Home
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* New */}
        <DropdownMenuItem onClick={handleNewTextFile}>
          New Text File
          <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleNewFile} disabled={!rootPath}>
          New File...
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Open */}
        <DropdownMenuItem onClick={handleOpenFile}>
          Open File...
          <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleOpenFolder}>
          Open Folder...
          <DropdownMenuShortcut>Ctrl+K Ctrl+O</DropdownMenuShortcut>
        </DropdownMenuItem>

        {/* Open Recent submenu */}
        {recentProjects.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Open Recent</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {recentProjects.map((p) => (
                <DropdownMenuItem key={p.path} onClick={() => handleOpenRecent(p.path)}>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    <span className="truncate text-[11px]">{p.name}</span>
                    <span className="truncate text-[9px] text-muted-foreground">{p.path}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        {/* Save */}
        <DropdownMenuItem onClick={handleSave} disabled={!activeTab}>
          Save
          <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSaveAs} disabled={!activeTab}>
          Save As...
          <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSaveAll}>
          Save All
          <DropdownMenuShortcut>Ctrl+K S</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Auto Save */}
        <DropdownMenuCheckboxItem
          checked={autoSave !== 'off'}
          onCheckedChange={handleAutoSaveToggle}
        >
          Auto Save
        </DropdownMenuCheckboxItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Preferences</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuItem onClick={handlePreferences}>
              Settings
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Revert / Close */}
        <DropdownMenuItem
          onClick={handleRevertFile}
          disabled={!activeTab || activeTab.filePath.startsWith('untitled:')}
        >
          Revert File
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCloseEditor} disabled={!activeTabId}>
          Close Editor
          <DropdownMenuShortcut>Ctrl+F4</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCloseFolder} disabled={!rootPath}>
          Close Folder
          <DropdownMenuShortcut>Ctrl+K F</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleExit}>
          Exit
          <DropdownMenuShortcut>Alt+F4</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
