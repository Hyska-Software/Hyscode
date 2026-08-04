import { FolderOpen } from 'lucide-react';
import { pickFolder } from '../../lib/tauri-dialog';
import { openProjectWorkspace } from '../../lib/project-persistence';
import { BrandMark } from '../brand-mark';

export function EditorWelcome() {
  const handleOpenFolder = async () => {
    const path = await pickFolder();
    if (path) {
      await openProjectWorkspace(path);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark className="h-12 w-12 rounded-xl opacity-80" />
        <p className="text-sm font-light tracking-tight text-foreground">HysCode</p>
        <p className="text-[11px] opacity-50">
          Open a file from the explorer or start a conversation with the agent
        </p>
        <button
          onClick={handleOpenFolder}
          className="mt-3 flex items-center gap-2 rounded-md bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open Folder
        </button>
        <div className="mt-4 flex flex-col gap-1.5 text-[11px] text-muted-foreground">
          <kbd className="rounded-md bg-surface-raised px-2 py-0.5">
            Ctrl+K Ctrl+O — Open Folder
          </kbd>
          <kbd className="rounded-md bg-surface-raised px-2 py-0.5">
            Ctrl+L — Focus Agent
          </kbd>
          <kbd className="rounded-md bg-surface-raised px-2 py-0.5">
            Ctrl+S — Save File
          </kbd>
        </div>
      </div>
    </div>
  );
}
