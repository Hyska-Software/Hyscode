import { useState } from 'react';
import { Check, FilePlus2, FileText, Loader2, Pencil, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react';
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
    return <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />;
  }
  if (isError) return <X className="size-3 shrink-0 text-destructive" />;
  return <Check className="size-3 shrink-0 text-emerald-400" />;
}

export function FileActivity({ toolCalls }: { toolCalls: ToolCallDisplay[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const fileOperations = toolCalls.filter(isFileMutation);
  if (fileOperations.length === 0) return null;

  const activeCount = fileOperations.filter((toolCall) =>
    ['pending', 'approved', 'running', 'cancelling'].includes(toolCall.status),
  ).length;
  const doneCount = fileOperations.length - activeCount;
  const isActive = activeCount > 0;

  const summary = isActive
    ? `${doneCount}/${fileOperations.length} files`
    : `${fileOperations.length} file${fileOperations.length === 1 ? '' : 's'}`;

  return (
    <div className="px-4 py-1">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-0.5 py-px text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        {isActive && (
          <span className="size-1.5 shrink-0 rounded-full bg-primary motion-reduce:animate-none" />
        )}
        <span>
          {isActive ? 'Updating workspace' : 'Workspace updated'}
          <span className="ml-1 tabular-nums text-muted-foreground/55">{summary}</span>
        </span>
      </button>

      {isExpanded && (
        <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded bg-card/60 px-2 py-1">
          {fileOperations.map((toolCall) => {
            const definition = FILE_ACTIVITY_DEFINITIONS[toolCall.name] ?? DEFAULT_ACTIVITY;
            const Icon = definition.icon;
            const isActive = ['pending', 'approved', 'running', 'cancelling'].includes(
              toolCall.status,
            );
            const label = isActive ? definition.activeLabel : definition.completedLabel;

            return (
              <div key={toolCall.id} className="flex min-w-0 items-center gap-1.5">
                <FileActivityStatus toolCall={toolCall} />
                <Icon className="size-2.5 shrink-0 text-muted-foreground/55" />
                <span className="shrink-0 text-[10px] text-muted-foreground/70">{label}</span>
                <span className="truncate font-mono text-[10px] text-foreground/70">
                  {getFileActivityPath(toolCall)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
