import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { cn } from "../../lib/cn";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss after ms. Default 4000. Set 0 to disable. */
  duration?: number;
  action?: ReactNode;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const iconColor = {
  info: "text-info-500",
  success: "text-success-500",
  warning: "text-warning-500",
  danger: "text-danger-500",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = Math.random().toString(36).slice(2);
      const item: ToastItem = { id, variant: "info", duration: 4000, ...options };
      setToasts((prev) => [...prev, item]);
      if (item.duration && item.duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), item.duration));
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4">
            {toasts.map((t) => {
              const Icon = icons[t.variant ?? "info"];
              return (
                <div
                  key={t.id}
                  role="status"
                  className="pointer-events-auto flex gap-3 rounded-lg   bg-popover p-4 text-popover-foreground shadow-lg animate-slide-up"
                >
                  <Icon className={cn("size-5 shrink-0", iconColor[t.variant ?? "info"])} />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground">{t.title}</p>
                    {t.description && (
                      <p className="text-sm text-muted-foreground">{t.description}</p>
                    )}
                    {t.action && <div className="pt-1">{t.action}</div>}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
