import type { GitFileStatus } from '../../../lib/tauri-invoke';
import type { WorkspaceMode } from '../../../stores/layout-store';

export function canOpenGitFileInPreview(
  workspaceMode: WorkspaceMode,
  status: GitFileStatus,
): boolean {
  return workspaceMode === 'agent' && status !== 'D';
}
