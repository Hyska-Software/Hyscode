import { tauriInvoke } from './tauri-invoke';

export async function pickFolder(): Promise<string | null> {
  return tauriInvoke('workspace_pick_folder', {});
}

export async function pickFile(): Promise<string | null> {
  return tauriInvoke('workspace_pick_file', {});
}

export async function openFileDialog(options?: {
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  return tauriInvoke('workspace_pick_file', { filters: options?.filters });
}

export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  return tauriInvoke('workspace_save_file', { defaultName });
}
