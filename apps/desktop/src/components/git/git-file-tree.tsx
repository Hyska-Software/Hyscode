import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { GitFile } from '../../stores/git-store';
import { buildGitFileTree, type GitFileTreeNode } from '../../lib/git-file-tree';

interface GitFileTreeProps {
  files: GitFile[];
  renderFile: (file: GitFile, depth: number) => ReactNode;
}

interface GitFileLayoutProps extends GitFileTreeProps {
  mode: 'tree' | 'list';
}

export function GitFileLayout({ files, mode, renderFile }: GitFileLayoutProps) {
  if (mode === 'list') {
    return (
      <>
        {files.map((file, index) => (
          <Fragment key={`file:${file.path}:${index}`}>{renderFile(file, 0)}</Fragment>
        ))}
      </>
    );
  }

  return <GitFileTree files={files} renderFile={renderFile} />;
}

export function GitFileTree({ files, renderFile }: GitFileTreeProps) {
  const nodes = useMemo(() => buildGitFileTree(files), [files]);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());

  const toggleDirectory = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <GitFileTreeNodes
      nodes={nodes}
      depth={0}
      collapsedPaths={collapsedPaths}
      onToggleDirectory={toggleDirectory}
      renderFile={renderFile}
    />
  );
}

interface GitFileTreeNodesProps {
  nodes: GitFileTreeNode[];
  depth: number;
  collapsedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  renderFile: GitFileTreeProps['renderFile'];
}

function GitFileTreeNodes({
  nodes,
  depth,
  collapsedPaths,
  onToggleDirectory,
  renderFile,
}: GitFileTreeNodesProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'file') {
          return <Fragment key={node.id}>{renderFile(node.file, depth)}</Fragment>;
        }

        const isExpanded = !collapsedPaths.has(node.path);
        const DirectoryIcon = isExpanded ? FolderOpen : Folder;

        return (
          <div key={node.id}>
            <button
              type="button"
              aria-label={`Directory ${node.path}`}
              aria-expanded={isExpanded}
              onClick={() => onToggleDirectory(node.path)}
              className="flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
              <DirectoryIcon className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                {node.fileCount}
              </span>
            </button>
            {isExpanded && (
              <GitFileTreeNodes
                nodes={node.children}
                depth={depth + 1}
                collapsedPaths={collapsedPaths}
                onToggleDirectory={onToggleDirectory}
                renderFile={renderFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
