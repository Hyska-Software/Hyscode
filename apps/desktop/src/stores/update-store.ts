import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from './settings-store';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface ReleaseInfo {
  version: string;
  body: string;
  publishedAt: string;
  assetUrl: string;
  assetName: string;
  assetSize: number;
  currentVersion: string;
  commits: CommitInfo[];
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

// ── State ────────────────────────────────────────────────────────────────────

interface UpdateState {
  status: UpdateStatus;
  releaseInfo: ReleaseInfo | null;
  downloadProgress: DownloadProgress | null;
  installerPath: string | null;
  error: string | null;
  dismissed: boolean;
  dialogOpen: boolean;

  // Actions
  checkForUpdates: () => Promise<void>;
  startDownload: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
  openDialog: () => void;
  closeDialog: () => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useUpdateStore = create<UpdateState>()(
  immer((set, get) => ({
    status: 'idle',
    releaseInfo: null,
    downloadProgress: null,
    installerPath: null,
    error: null,
    dismissed: false,
    dialogOpen: false,

    checkForUpdates: async () => {
      set((s) => {
        s.status = 'checking';
        s.error = null;
        s.dismissed = false;
      });

      try {
        const { updateChannel, autoDownload } = useSettingsStore.getState();
        const result = await invoke<ReleaseInfo | null>('updater_check', { channel: updateChannel });

        if (result) {
          set((s) => {
            s.status = 'available';
            s.releaseInfo = result;
          });
          // Auto-download if the setting is enabled
          if (autoDownload) {
            await useUpdateStore.getState().startDownload();
          }
        } else {
          set((s) => {
            s.status = 'up-to-date';
          });
        }
      } catch (err) {
        set((s) => {
          s.status = 'error';
          s.error = String(err);
        });
      }
    },

    startDownload: async () => {
      const { releaseInfo } = get();
      if (!releaseInfo) return;

      set((s) => {
        s.status = 'downloading';
        s.downloadProgress = { downloaded: 0, total: releaseInfo.assetSize, percent: 0 };
        s.error = null;
      });

      let unlisten: UnlistenFn | null = null;

      try {
        // Listen for download progress events from Rust
        unlisten = await listen<DownloadProgress>('update:progress', (event) => {
          set((s) => {
            s.downloadProgress = event.payload;
          });
        });

        const path = await invoke<string>('updater_download', {
          assetUrl: releaseInfo.assetUrl,
          assetName: releaseInfo.assetName,
        });

        set((s) => {
          s.status = 'ready';
          s.installerPath = path;
          s.downloadProgress = { downloaded: releaseInfo.assetSize, total: releaseInfo.assetSize, percent: 100 };
        });
      } catch (err) {
        set((s) => {
          s.status = 'error';
          s.error = String(err);
        });
      } finally {
        unlisten?.();
      }
    },

    installUpdate: async () => {
      const { installerPath } = get();
      if (!installerPath) return;

      try {
        await invoke('updater_install', { installerPath });
      } catch (err) {
        set((s) => {
          s.status = 'error';
          s.error = String(err);
        });
      }
    },

    dismiss: () => {
      set((s) => {
        s.dismissed = true;
      });
    },

    openDialog: () => {
      set((s) => {
        s.dialogOpen = true;
      });
    },

    closeDialog: () => {
      set((s) => {
        s.dialogOpen = false;
      });
    },
  })),
);
