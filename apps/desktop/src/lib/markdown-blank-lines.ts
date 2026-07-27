export const MARKDOWN_BLANK_LINES_ATTRIBUTE = 'data-markdown-blank-lines';

type MarkdownPosition = {
  start: { line: number };
  end: { line: number };
};

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  position?: MarkdownPosition;
  data?: {
    hProperties?: Record<string, string>;
  };
  value?: string;
};

function createBlankLinesNode(count: number): MarkdownNode {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: '\u200B' }],
    data: {
      hProperties: {
        [MARKDOWN_BLANK_LINES_ATTRIBUTE]: String(count),
      },
    },
  };
}

function preserveChildGaps(parent: MarkdownNode): void {
  const children = parent.children;
  if (!children?.length) return;

  for (const child of children) {
    if (child.type === 'blockquote' || child.type === 'listItem') {
      preserveChildGaps(child);
    }
  }

  const withBlankLines: MarkdownNode[] = [];
  for (const child of children) {
    const previous = withBlankLines.at(-1);
    const previousEndLine = previous?.position?.end.line;
    const nextStartLine = child.position?.start.line;
    if (previousEndLine && nextStartLine) {
      const blankLineCount = nextStartLine - previousEndLine - 1;
      if (blankLineCount > 0) {
        withBlankLines.push(createBlankLinesNode(blankLineCount));
      }
    }
    withBlankLines.push(child);
  }
  parent.children = withBlankLines;
}

export function remarkPreserveBlankLines(): (
  tree: MarkdownNode,
  file: { value?: unknown },
) => void {
  return (tree: MarkdownNode, file: { value?: unknown }): void => {
    const originalChildren = tree.children ?? [];
    preserveChildGaps(tree);

    const firstLine = originalChildren[0]?.position?.start.line;
    if (firstLine && firstLine > 1) {
      tree.children?.unshift(createBlankLinesNode(firstLine - 1));
    }

    const lastLine = originalChildren.at(-1)?.position?.end.line;
    if (!lastLine) return;

    const sourceLineCount = String(file.value ?? '').split(/\r?\n/).length;
    const trailingBlankLineCount = sourceLineCount - lastLine;
    if (trailingBlankLineCount > 0) {
      tree.children?.push(createBlankLinesNode(trailingBlankLineCount));
    }
  };
}
