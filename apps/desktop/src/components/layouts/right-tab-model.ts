import type { LucideIcon } from 'lucide-react';
import { Eye, Folder, GitCompare, Layers, Terminal } from 'lucide-react';
import type { RightTab } from '@/stores/layout-store';

export type RightTabDescriptor = {
  id: RightTab;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const RIGHT_TAB_DESCRIPTORS: Record<RightTab, RightTabDescriptor> = {
  changes: {
    id: 'changes',
    label: 'Changes',
    description: 'Review agent and Git changes.',
    icon: GitCompare,
  },
  context: {
    id: 'context',
    label: 'Context',
    description: 'Inspect the active session context.',
    icon: Layers,
  },
  files: {
    id: 'files',
    label: 'Files',
    description: 'Browse files in this workspace.',
    icon: Folder,
  },
  preview: {
    id: 'preview',
    label: 'Preview',
    description: 'Preview the selected workspace file.',
    icon: Eye,
  },
  terminal: {
    id: 'terminal',
    label: 'Terminal',
    description: 'Run a shell in this workspace.',
    icon: Terminal,
  },
};
