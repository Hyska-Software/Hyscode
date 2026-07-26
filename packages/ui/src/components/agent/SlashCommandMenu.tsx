import { type ReactNode } from "react";
import { ListboxMenu, type ListboxItem } from "./ListboxMenu";

export interface SlashCommand extends ListboxItem {
  /** The command name without the leading slash, e.g. "explain". */
  command?: string;
}

export interface SlashCommandMenuProps {
  commands: SlashCommand[];
  query?: string;
  onSelect: (command: SlashCommand) => void;
  header?: ReactNode;
  className?: string;
}

/** `/`-command palette for chat inputs (Copilot / Codex slash commands). */
export function SlashCommandMenu({
  commands,
  query,
  onSelect,
  header,
  className,
}: SlashCommandMenuProps) {
  return (
    <ListboxMenu
      items={commands}
      query={query}
      onSelect={(item) => onSelect(item as SlashCommand)}
      emptyMessage="No commands"
      header={header}
      className={className}
    />
  );
}
