import { open, save } from '@tauri-apps/plugin-dialog';

export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === 'string') return selected;
  return null;
}

export async function pickFile(): Promise<string | null> {
  const selected = await open({ directory: false, multiple: false });
  if (typeof selected === 'string') return selected;
  return null;
}

export async function openFileDialog(options?: {
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const selected = await open({ directory: false, multiple: false, filters: options?.filters });
  if (typeof selected === 'string') return selected;
  return null;
}

export async function saveFileDialog(defaultName?: string): Promise<string | null> {
  const selected = await save({ defaultPath: defaultName });
  if (typeof selected === 'string') return selected;
  return null;
}
