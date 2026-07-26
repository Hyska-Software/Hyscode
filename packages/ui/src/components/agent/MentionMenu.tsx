import { type ReactNode } from "react";
import { ListboxMenu, type ListboxItem } from "./ListboxMenu";

export type MentionKind = "file" | "folder" | "symbol" | "doc" | "url";

export interface MentionItem extends ListboxItem {
  kind?: MentionKind;
  /** Full path/value inserted when selected. */
  value?: string;
}

export interface MentionMenuProps {
  items: MentionItem[];
  query?: string;
  onSelect: (item: MentionItem) => void;
  header?: ReactNode;
  className?: string;
}

/** `@`-mention menu for attaching context (files, symbols, docs) to a prompt. */
export function MentionMenu({ items, query, onSelect, header, className }: MentionMenuProps) {
  return (
    <ListboxMenu
      items={items}
      query={query}
      onSelect={(item) => onSelect(item as MentionItem)}
      emptyMessage="No matches"
      header={header}
      className={className}
    />
  );
}
