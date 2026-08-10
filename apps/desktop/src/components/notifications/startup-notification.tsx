import { useEffect, useState } from 'react';
import { Coffee, X } from 'lucide-react';
import { useStartupNotificationStore } from '../../stores/startup-notification-store';

const KO_FI_URL = 'https://ko-fi.com/hyscode';

export function StartupNotification() {
  const dismissedForever = useStartupNotificationStore((s) => s.dismissedForever);
  const sessionDismissed = useStartupNotificationStore((s) => s.sessionDismissed);
  const dismissForSession = useStartupNotificationStore((s) => s.dismissForSession);
  const dismissForever = useStartupNotificationStore((s) => s.dismissForever);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 400);
    return () => clearTimeout(t);
  }, []);

  if (dismissedForever || sessionDismissed) return null;

  return (
    <div
      className={`fixed top-10 left-1/2 z-[9500] -translate-x-1/2 transition-all duration-300 ${
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div className="flex w-[560px] max-w-[calc(100vw-24px)] items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 backdrop-blur-xl shadow-2xl shadow-black/30">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Coffee className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-foreground leading-tight">
            Enjoying HysCode?
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            It's free and open source — support the project with a coffee on Ko-fi.
          </p>
        </div>
        <a
          href={KO_FI_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Support us
        </a>
        <button
          onClick={dismissForever}
          className="shrink-0 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Don't show again
        </button>
        <button
          onClick={dismissForSession}
          aria-label="Close notification"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
