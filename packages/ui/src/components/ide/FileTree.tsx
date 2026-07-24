import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "../../lib/cn";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
  /** Override the default icon derived from the extension. */
  icon?: ReactNode;
}

function iconForFile(name: string): ReactNode {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <FileCode className="size-4 text-primary" />;
    case "json":
      return <FileJson className="size-4 text-warning-500" />;
    case "md":
    case "mdx":
    case "txt":
      return <FileText className="size-4 text-neutral-400" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "gif":
    case "webp":
      return <ImageIcon className="size-4 text-info-500" />;
    default:
      return <FileIcon className="size-4 text-neutral-400" />;
  }
}

interface TreeItemProps {
  node: FileNode;
  depth: number;
  selectedId?: string;
  defaultExpanded?: boolean;
  onSelect?: (node: FileNode) => void;
}

function TreeItem({ node, depth, selectedId, defaultExpanded, onSelect }: TreeItemProps) {
  const [open, setOpen] = useState(defaultExpanded ?? depth === 0);
  const isFolder = node.type === "folder";
  const selected = node.id === selectedId;

  return (
    <li role="treeitem" aria-expanded={isFolder ? open : undefined} aria-selected={selected}>
      <button
        type="button"
        onClick={() => (isFolder ? setOpen((o) => !o) : onSelect?.(node))}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm text-foreground transition-colors hover:bg-muted",
          selected && "bg-primary/15 text-foreground",
        )}
      >
        {isFolder ? (
          <>
            <ChevronRight
              className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            />
            {open ? (
              <FolderOpen className="size-4 text-primary" />
            ) : (
              <Folder className="size-4 text-primary" />
            )}
          </>
        ) : (
          <>
            <span className="size-3.5 shrink-0" />
            {node.icon ?? iconForFile(node.name)}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isFolder && open && node.children && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              defaultExpanded={defaultExpanded}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface FileTreeProps {
  nodes: FileNode[];
  selectedId?: string;
  onSelect?: (node: FileNode) => void;
  defaultExpanded?: boolean;
  className?: string;
}

/** VS Code-style file explorer tree. */
export function FileTree({ nodes, selectedId, onSelect, defaultExpanded, className }: FileTreeProps) {
  return (
    <ul role="tree" className={cn("select-none py-1", className)}>
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          defaultExpanded={defaultExpanded}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
