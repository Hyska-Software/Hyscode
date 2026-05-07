import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Package, CheckCircle2, XCircle, Power, Trash2 } from 'lucide-react';
import { MARKDOWN_COMPONENTS } from '../agent/markdown-renderer';
import { useExtensionStore } from '../../stores/extension-store';
import { useEditorStore } from '../../stores/editor-store';

interface ExtensionReadmeViewerProps {
  extensionName: string;
  displayName: string;
  readmeContent: string;
  iconUrl?: string | null;
  version?: string;
  publisher?: string;
  description?: string;
  enabled?: boolean;
  categories?: string[];
  activationEvents?: string[];
  installedAt?: string;
  hasMain?: boolean;
  contributions?: { label: string; count: number }[];
}

export function ExtensionReadmeViewer({
  extensionName,
  displayName,
  readmeContent,
  iconUrl,
  version,
  publisher,
  description,
  enabled,
  categories,
  activationEvents,
  installedAt,
  hasMain,
  contributions,
}: ExtensionReadmeViewerProps) {
  const toggleExtension = useExtensionStore((s) => s.toggleExtension);
  const uninstallExtension = useExtensionStore((s) => s.uninstallExtension);
  const closeTab = useEditorStore((s) => s.closeTab);
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const hasReadme = readmeContent.trim().length > 0;
  const hasMetadata = isEnabled !== undefined || (categories && categories.length > 0) || (contributions && contributions.length > 0) || (activationEvents && activationEvents.length > 0) || installedAt !== undefined;

  const handleToggle = async () => {
    if (isEnabled === undefined) return;
    await toggleExtension(extensionName);
    setIsEnabled((v) => !v);
  };

  const handleUninstall = async () => {
    await uninstallExtension(extensionName);
    closeTab(`extension-readme:${extensionName}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Extension header */}
      <div className="flex items-start gap-4 border-b border-border px-8 py-6 shrink-0">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={displayName}
            className="h-16 w-16 shrink-0 rounded-xl object-cover shadow-md"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted shadow-md">
            <Package className="h-8 w-8 text-muted-foreground/50" />
          </div>
        )}
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-[20px] font-bold leading-tight text-foreground">{displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {publisher && <span className="font-medium text-foreground/80">{publisher}</span>}
            {publisher && version && <span className="text-muted-foreground/40">·</span>}
            {version && <span>v{version}</span>}
          </div>
          {description && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
      </div>

      {/* Body: README + optional metadata sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* README */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {hasReadme ? (
            <div className="prose prose-sm dark:prose-invert max-w-none
              [&_h1]:text-[18px] [&_h1]:font-bold [&_h1]:text-foreground [&_h1]:mt-6 [&_h1]:mb-3
              [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1
              [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1.5
              [&_p]:text-[12px] [&_p]:leading-relaxed [&_p]:text-foreground/80 [&_p]:my-2
              [&_ul]:text-[12px] [&_ul]:text-foreground/80 [&_ul]:my-2 [&_ul]:pl-5
              [&_ol]:text-[12px] [&_ol]:text-foreground/80 [&_ol]:my-2 [&_ol]:pl-5
              [&_li]:my-0.5
              [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline
              [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic
              [&_table]:w-full [&_table]:text-[11px] [&_table]:border-collapse
              [&_th]:border [&_th]:border-border [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:bg-muted/50 [&_th]:font-medium
              [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5
              [&_hr]:border-border [&_hr]:my-4
              [&_img]:rounded-lg [&_img]:max-w-full
            ">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={MARKDOWN_COMPONENTS}
              >
                {readmeContent}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Package className="mb-3 h-10 w-10 text-muted-foreground/20" />
              <p className="text-[13px] font-medium text-muted-foreground/60">No README available</p>
              <p className="mt-1 text-[11px] text-muted-foreground/40">
                This extension does not include a README file.
              </p>
            </div>
          )}
        </div>

        {/* Metadata sidebar */}
        {hasMetadata && (
          <div className="w-56 shrink-0 overflow-y-auto border-l border-border px-4 py-5 flex flex-col gap-5">
            {/* Status + actions */}
            {isEnabled !== undefined && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {isEnabled ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent">
                      <CheckCircle2 className="h-3 w-3" />
                      Enabled
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      <XCircle className="h-3 w-3" />
                      Disabled
                    </span>
                  )}
                  <button
                    onClick={handleToggle}
                    title={isEnabled ? 'Disable extension' : 'Enable extension'}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  {confirmUninstall ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleUninstall}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmUninstall(false)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmUninstall(true)}
                      title="Uninstall extension"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Categories */}
            {categories && categories.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Categories</p>
                <div className="flex flex-wrap gap-1">
                  {categories.map((cat) => (
                    <span key={cat} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground/70">{cat}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Contributions */}
            {contributions && contributions.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Contributions</p>
                <div className="flex flex-col gap-0.5">
                  {contributions.map(({ label, count }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[11px] text-foreground/70">{label}</span>
                      <span className="text-[11px] font-medium text-foreground/90">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activation Events */}
            {activationEvents && activationEvents.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Activation Events</p>
                <div className="flex flex-col gap-1">
                  {activationEvents.map((ev) => (
                    <span key={ev} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/70">{ev}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Details */}
            {(installedAt !== undefined || hasMain !== undefined) && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Details</p>
                <div className="flex flex-col gap-1">
                  {installedAt && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/50">Installed</p>
                      <p className="text-[11px] text-foreground/70">{new Date(installedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {hasMain !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-foreground/70">Has Code</span>
                      <span className="text-[11px] font-medium text-foreground/90">{hasMain ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
