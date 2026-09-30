import type { GitFile } from '../stores/git-store';

export interface GitFileDirectoryNode {
  kind: 'directory';
  id: string;
  name: string;
  path: string;
  fileCount: number;
  children: GitFileTreeNode[];
}

export interface GitFileLeafNode {
  kind: 'file';
  id: string;
  name: string;
  file: GitFile;
}

export type GitFileTreeNode = GitFileDirectoryNode | GitFileLeafNode;

export function buildGitFileTree(files: GitFile[]): GitFileTreeNode[] {
  const roots: GitFileTreeNode[] = [];
  const directories = new Map<string, GitFileDirectoryNode>();

  files.forEach((file, fileIndex) => {
    const segments = file.path.split(/[\\/]/).filter(Boolean);
    const fileName = segments.pop() ?? file.path;
    let siblings = roots;
    let directoryPath = '';

    for (const segment of segments) {
      directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
      let directory = directories.get(directoryPath);

      if (!directory) {
        directory = {
          kind: 'directory',
          id: `directory:${directoryPath}`,
          name: segment,
          path: directoryPath,
          fileCount: 0,
          children: [],
        };
        directories.set(directoryPath, directory);
        siblings.push(directory);
      }

      directory.fileCount += 1;
      siblings = directory.children;
    }

    siblings.push({
      kind: 'file',
      id: `file:${file.path}:${fileIndex}`,
      name: fileName,
      file,
    });
  });

  return sortTreeNodes(roots);
}

function sortTreeNodes(nodes: GitFileTreeNode[]): GitFileTreeNode[] {
  for (const node of nodes) {
    if (node.kind === 'directory') sortTreeNodes(node.children);
  }

  return nodes.sort((left, right) => {
    if (left.kind === 'directory' && right.kind === 'file') return -1;
    if (left.kind === 'file' && right.kind === 'directory') return 1;
    return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
  });
}
