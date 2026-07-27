import { useEffect, useMemo, useRef, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { MARKDOWN_COMPONENTS } from '../../agent/markdown-renderer';
import {
  getImageMimeType,
  resolveMarkdownLink,
  slugifyMarkdownHeading,
} from '../../../lib/markdown-document';
import {
  MARKDOWN_BLANK_LINES_ATTRIBUTE,
  remarkPreserveBlankLines,
} from '../../../lib/markdown-blank-lines';

interface MarkdownDocumentPreviewProps {
  content: string;
  filePath: string;
  rootPath: string | null;
  requestedAnchor?: string;
  onAnchorHandled?: () => void;
  onOpenWorkspaceFile?: (path: string, anchor: string | null) => void;
}

interface LocalMarkdownImageProps {
  src?: string;
  alt?: string;
  documentPath: string;
  rootPath: string | null;
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function sanitizeSvg(svg: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(svg, 'image/svg+xml');
  document.querySelectorAll('script, foreignObject').forEach((element) => element.remove());
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value.trim().toLowerCase();
      if (
        attribute.name.toLowerCase().startsWith('on') ||
        ((attribute.name === 'href' || attribute.name === 'xlink:href') &&
          value.startsWith('javascript:'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return new XMLSerializer().serializeToString(document.documentElement);
}

function LocalMarkdownImage({
  src,
  alt,
  documentPath,
  rootPath,
}: LocalMarkdownImageProps) {
  const [resolvedSource, setResolvedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!src || !rootPath) {
      setResolvedSource(src ?? null);
      return;
    }

    const target = resolveMarkdownLink(src, documentPath, rootPath);
    if (target.kind === 'external') {
      setResolvedSource(target.url);
      return;
    }
    if (target.kind !== 'workspace') {
      setResolvedSource(null);
      return;
    }

    const mimeType = getImageMimeType(target.path);
    if (!mimeType) {
      setResolvedSource(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    void readFile(target.path)
      .then((bytes) => {
        if (cancelled) return;
        const content =
          mimeType === 'image/svg+xml'
            ? sanitizeSvg(new TextDecoder().decode(bytes))
            : bytes;
        objectUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
        setResolvedSource(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedSource(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentPath, rootPath, src]);

  if (!resolvedSource) {
    return <span className="text-xs text-muted-foreground">Image unavailable: {alt ?? src}</span>;
  }

  return (
    <img
      src={resolvedSource}
      alt={alt ?? ''}
      className="my-2 max-w-full rounded-lg object-contain"
      loading="lazy"
    />
  );
}

function headingComponent(
  level: 1 | 2 | 3 | 4 | 5 | 6,
): React.ComponentType<{ children?: React.ReactNode }> {
  const classes: Record<number, string> = {
    1: 'mb-3 mt-6 text-2xl font-semibold text-foreground',
    2: 'mb-2 mt-5 text-xl font-semibold text-foreground',
    3: 'mb-2 mt-4 text-lg font-semibold text-foreground',
    4: 'mb-1.5 mt-3 text-base font-semibold text-foreground',
    5: 'mb-1 mt-3 text-sm font-semibold text-foreground',
    6: 'mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-foreground/80',
  };
  return function MarkdownHeading({ children }) {
    const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
    const id = slugifyMarkdownHeading(extractText(children));
    return (
      <Tag id={id || undefined} className={`scroll-mt-4 ${classes[level]}`}>
        {children}
      </Tag>
    );
  };
}

export function MarkdownDocumentPreview({
  content,
  filePath,
  rootPath,
  requestedAnchor,
  onAnchorHandled,
  onOpenWorkspaceFile,
}: MarkdownDocumentPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!requestedAnchor) return;
    const frame = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`#${CSS.escape(slugifyMarkdownHeading(requestedAnchor))}`)
        ?.scrollIntoView({ block: 'start' });
      onAnchorHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [content, onAnchorHandled, requestedAnchor]);

  const components = useMemo(
    () => ({
      ...MARKDOWN_COMPONENTS,
      h1: headingComponent(1),
      h2: headingComponent(2),
      h3: headingComponent(3),
      h4: headingComponent(4),
      h5: headingComponent(5),
      h6: headingComponent(6),
      p: (props: React.HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) => {
        const blankLineCount = Number(
          (props as Record<string, unknown>)[MARKDOWN_BLANK_LINES_ATTRIBUTE],
        );
        if (Number.isInteger(blankLineCount) && blankLineCount > 0) {
          return (
            <div
              aria-hidden="true"
              data-markdown-blank-lines={blankLineCount}
              style={{ height: `calc(${blankLineCount} * 1.75em)` }}
            />
          );
        }
        const Paragraph = MARKDOWN_COMPONENTS.p;
        return <Paragraph>{props.children}</Paragraph>;
      },
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          className="text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:text-primary/90 hover:decoration-primary"
          onClick={(event) => {
            event.preventDefault();
            if (!href || !rootPath) return;
            const target = resolveMarkdownLink(href, filePath, rootPath);
            if (target.kind === 'anchor') {
              containerRef.current
                ?.querySelector<HTMLElement>(`#${CSS.escape(slugifyMarkdownHeading(target.anchor))}`)
                ?.scrollIntoView({ block: 'start' });
            } else if (target.kind === 'workspace') {
              onOpenWorkspaceFile?.(target.path, target.anchor);
            } else if (target.kind === 'external') {
              void import('@tauri-apps/plugin-shell').then(({ open }) => open(target.url));
            }
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <LocalMarkdownImage
          src={src}
          alt={alt}
          documentPath={filePath}
          rootPath={rootPath}
        />
      ),
    }),
    [filePath, onOpenWorkspaceFile, rootPath],
  );

  return (
    <div ref={containerRef} className="h-full overflow-auto p-6">
      <article className="markdown-preview cursor-text select-text">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath, remarkBreaks, remarkPreserveBlankLines]}
          rehypePlugins={[[rehypeKatex], [rehypeHighlight, { ignoreMissing: true }]] as any}
          components={components as any}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
