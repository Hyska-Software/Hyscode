import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function writeClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    // Fallback to web API if Tauri plugin fails
    await navigator.clipboard.writeText(text);
  }
}

export type ViewerType =
  | 'code'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'spreadsheet'
  | 'docx'
  | 'pptx'
  | 'db-schema';

const VIEWER_MAP: Record<string, ViewerType> = {
  md: 'markdown',
  mdx: 'markdown',
  sql: 'code',
  prisma: 'code',
  db: 'code',
  sqlite: 'code',
  sqlite3: 'code',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'image',
  pdf: 'pdf',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  csv: 'spreadsheet',
  ods: 'spreadsheet',
  docx: 'docx',
  doc: 'docx',
  pptx: 'pptx',
  ppt: 'pptx',
};

export function getViewerType(filename: string): ViewerType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return VIEWER_MAP[ext] ?? 'code';
}
