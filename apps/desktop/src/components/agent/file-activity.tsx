import { Check, FilePlus2, FileText, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ToolCallDisplay } from '@/stores/agent-store';

const FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'create_file',
  'edit_file',
  'replace_lines',
  'insert_lines',
  'delete_file',
  'rename_file',
  'copy_file',
]);

type FileActivityDefinition = {
  icon: LucideIcon;
  activeLabel: string;
  completedLabel: string;
};

const DEFAULT_ACTIVITY: FileActivityDefinition = {
  icon: FileText,
  activeLabel: 'Updating',
  completedLabel: 'Updated',
};

const FILE_ACTIVITY_DEFINITIONS: Record<string, FileActivityDefinition> = {
  create_file: { icon: FilePlus2, activeLabel: 'Creating', completedLabel: 'Created' },
  write_file: { icon: FileText, activeLabel: 'Writing', completedLabel: 'Written' },
  edit_file: { icon: Pencil, activeLabel: 'Editing', completedLabel: 'Edited' },
  replace_lines: { icon: Pencil, activeLabel: 'Replacing lines in', completedLabel: 'Updated' },
  insert_lines: { icon: Pencil, activeLabel: 'Inserting lines in', completedLabel: 'Updated' },
  delete_file: { icon: Trash2, activeLabel: 'Deleting', completedLabel: 'Deleted' },
  rename_file: { icon: Pencil, activeLabel: 'Renaming', completedLabel: 'Renamed' },
  copy_file: { icon: FilePlus2, activeLabel: 'Copying', completedLabel: 'Copied' },
};

export function isFileMutation(toolCall: ToolCallDisplay): boolean {
  return FILE_MUTATION_TOOLS.has(toolCall.name);
}

export function getFileActivityPath(toolCall: ToolCallDisplay): string {
  const input = toolCall.input;
  return String(input.path ?? input.to ?? input.from ?? 'file');
}

function FileActivityStatus({ toolCall }: { toolCall: ToolCallDisplay }) {
  const isActive = ['pending', 'approved', 'running', 'cancelling'].includes(toolCall.status);
  const isError = toolCall.status === 'error';

  if (isActive) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />;
  }
  if (isError) return <X className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
}

export function FileActivity({ toolCalls }: { toolCalls: ToolCallDisplay[] }) {
  const fileOperations = toolCalls.filter(isFileMutation);
  if (fileOperations.length === 0) return null;

  const activeCount = fileOperations.filter((toolCall) =>
    ['pending', 'approved', 'running', 'cancelling'].includes(toolCall.status),
  ).length;

  return (
    <section
      aria-atomic="false"
      aria-live="polite"
      aria-label="Agent file activity"
      className="agent-fade-in my-3 overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.035] shadow-sm"
    >
      <div className="relative flex items-center gap-2 border-b border-border/40 px-3 py-2">
        {activeCount > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-primary/10">
            <div className="agent-shimmer-bar h-full w-full motion-reduce:hidden" />
          </div>
        )}
        <span className="agent-breathe h-1.5 w-1.5 rounded-full bg-primary motion-reduce:animate-none" />
        <span className="text-[10px] font-medium text-foreground/75">
          {activeCount > 0 ? 'Updating workspace' : 'Workspace updated'}
        </span>
        <span className="ml-auto text-[9px] tabular-nums text-muted-foreground/55">
          {fileOperations.length} {fileOperations.length === 1 ? 'file' : 'files'}
        </span>
      </div>

      <div className="divide-y divide-border/30 px-3">
        {fileOperations.map((toolCall) => {
          const definition = FILE_ACTIVITY_DEFINITIONS[toolCall.name] ?? DEFAULT_ACTIVITY;
          const Icon = definition.icon;
          const isActive = ['pending', 'approved', 'running', 'cancelling'].includes(
            toolCall.status,
          );
          const label = isActive ? definition.activeLabel : definition.completedLabel;

          return (
            <div key={toolCall.id} className="flex min-w-0 items-center gap-2 py-2">
              <FileActivityStatus toolCall={toolCall} />
              <Icon className="h-3 w-3 shrink-0 text-muted-foreground/55" />
              <span className="shrink-0 text-[10px] text-muted-foreground/70">{label}</span>
              <span className="truncate font-mono text-[10.5px] text-foreground/70">
                {getFileActivityPath(toolCall)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
