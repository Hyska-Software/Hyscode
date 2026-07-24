import { forwardRef, useState, type ReactNode } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";
import {
  ViewportSwitcher,
  VIEWPORT_WIDTHS,
  type Viewport,
} from "./ViewportSwitcher";

export interface WebPreviewProps {
  url: string;
  onUrlChange?: (url: string) => void;
  onRefresh?: () => void;
  /** Show the responsive viewport switcher. Default true. */
  showViewport?: boolean;
  viewport?: Viewport;
  onViewportChange?: (v: Viewport) => void;
  /** Toolbar actions rendered on the right. */
  actions?: ReactNode;
  /** Height of the preview area. */
  height?: string;
  /** Render custom content instead of an <iframe> (e.g. a live sandbox). */
  children?: ReactNode;
  className?: string;
}

/** Live app preview with URL bar, refresh and device viewport switcher
 *  (Replit / Lovable / v0 / bolt.new style). */
export const WebPreview = forwardRef<HTMLIFrameElement, WebPreviewProps>(
  (
    {
      url,
      onUrlChange,
      onRefresh,
      showViewport = true,
      viewport,
      onViewportChange,
      actions,
      height = "24rem",
      children,
      className,
    },
    ref,
  ) => {
    const [vp, setVp] = useControllableState<Viewport>({
      value: viewport,
      defaultValue: "desktop",
      onChange: onViewportChange,
    });
    const [draft, setDraft] = useState(url);
    const [key, setKey] = useState(0);
    const width = VIEWPORT_WIDTHS[vp];

    const refresh = () => {
      setKey((k) => k + 1);
      onRefresh?.();
    };

    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl   bg-card",
          className,
        )}
      >
        <div className="flex items-center gap-2   px-2 py-1.5">
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RotateCw className="size-4" />
          </button>
          <form
            className="flex h-7 min-w-0 flex-1 items-center rounded-md bg-muted px-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              onUrlChange?.(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
            />
          </form>
          {showViewport && <ViewportSwitcher value={vp} onValueChange={setVp} />}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in new tab"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-4" />
          </a>
          {actions}
        </div>
        <div
          className="flex justify-center overflow-auto bg-neutral-100 p-4 dark:bg-neutral-950"
          style={{ height }}
        >
          <div
            className="h-full overflow-hidden rounded-lg   bg-white shadow-sm transition-[width] duration-300"
            style={{ width: width ? `${width}px` : "100%" }}
          >
            {children ?? (
              <iframe
                ref={ref}
                key={key}
                src={url}
                title="Preview"
                className="size-full "
              />
            )}
          </div>
        </div>
      </div>
    );
  },
);
WebPreview.displayName = "WebPreview";
