import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

export interface LogEntry {
  id?: string;
  level?: LogLevel;
  time?: ReactNode;
  message: ReactNode;
  /** Optional source tag, e.g. "vite", "server". */
  source?: ReactNode;
}

export interface LogStreamProps {
  logs: LogEntry[];
  title?: ReactNode;
  showTime?: boolean;
  maxHeight?: string;
  className?: string;
  footer?: ReactNode;
}

const levelClass: Record<LogLevel, string> = {
  debug: "text-neutral-500",
  info: "text-[var(--terminal-fg)]",
  warn: "text-warning-500",
  error: "text-danger-500",
  success: "text-primary",
};

const levelTag: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
  success: "OK ",
};

/** Timestamped, leveled log/console stream (dev server output). */
export const LogStream = forwardRef<HTMLDivElement, LogStreamProps>(
  ({ logs, title, showTime = true, maxHeight = "18rem", className, footer }, ref) => (
    <div
      className={cn(
        "overflow-hidden rounded-lg   bg-[var(--terminal-bg)]",
        className,
      )}
    >
      {title && (
        <div className="  px-3 py-2 font-mono text-xs text-neutral-400">
          {title}
        </div>
      )}
      <div ref={ref} className="overflow-auto p-3 font-mono text-xs leading-relaxed" style={{ maxHeight }}>
        {logs.map((log, i) => {
          const level = log.level ?? "info";
          return (
            <div key={log.id ?? i} className="flex gap-2 whitespace-pre-wrap break-words">
              {showTime && log.time != null && (
                <span className="shrink-0 text-neutral-600">{log.time}</span>
              )}
              <span className={cn("shrink-0 font-semibold", levelClass[level])}>{levelTag[level]}</span>
              {log.source != null && <span className="shrink-0 text-info-500">[{log.source}]</span>}
              <span className={levelClass[level]}>{log.message}</span>
            </div>
          );
        })}
        {footer}
      </div>
    </div>
  ),
);
LogStream.displayName = "LogStream";
