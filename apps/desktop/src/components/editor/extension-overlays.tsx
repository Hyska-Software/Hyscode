/**
 * Extension overlays — renders quick-pick and input-box modals
 * triggered by extensions via the ui API.
 */

import { useEffect, useRef, useState } from 'react';
import { Search, X, AlertTriangle, AlertCircle, Terminal } from 'lucide-react';
import { useExtensionUiStore } from '../../stores/extension-ui-store';
import type { ExtensionNotification } from '../../stores/extension-ui-store';

// ── Quick Pick ───────────────────────────────────────────────────────────────

export function ExtensionQuickPick() {
  const { visible, items, title, placeholder } = useExtensionUiStore((s) => s.quickPick);
  const resolveQuickPick = useExtensionUiStore((s) => s.resolveQuickPick);
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (visible) {
      setFilter('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolveQuickPick(undefined);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, resolveQuickPick]);

  if (!visible) return null;

  const filtered = items.filter((i) =>
    i.label.toLowerCase().includes(filter.toLowerCase()) ||
    i.description?.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[100000] flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => resolveQuickPick(undefined)}
      />
      <div className="relative w-[440px] animate-in fade-in slide-in-from-top-2 duration-200 rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/30">
        {title && (
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-[11px] font-semibold text-foreground">{title}</span>
            <button onClick={() => resolveQuickPick(undefined)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={placeholder ?? 'Type to filter...'}
            className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="max-h-[260px] overflow-y-auto p-1">
          {filtered.map((item, i) => (
            <button
              key={i}
              onClick={() => resolveQuickPick(item)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11.5px] hover:bg-surface-raised transition-colors"
            >
              <span className="font-medium text-foreground">{item.label}</span>
              {item.description && (
                <span className="text-muted-foreground text-[10px]">{item.description}</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Input Box ────────────────────────────────────────────────────────────────

export function ExtensionInputBox() {
  const { visible, title, placeholder, value: defaultValue, prompt } = useExtensionUiStore((s) => s.inputBox);
  const resolveInputBox = useExtensionUiStore((s) => s.resolveInputBox);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) {
      setValue(defaultValue ?? '');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible, defaultValue]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolveInputBox(undefined);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, resolveInputBox]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100000] flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => resolveInputBox(undefined)}
      />
      <div className="relative w-[400px] animate-in fade-in slide-in-from-top-2 duration-200 rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/30 p-4">
        {title && <div className="text-[12px] font-semibold text-foreground mb-2">{title}</div>}
        {prompt && <div className="text-[11px] text-muted-foreground mb-3">{prompt}</div>}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') resolveInputBox(value);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] text-foreground outline-none focus:border-primary transition-colors"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={() => resolveInputBox(undefined)}
            className="rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => resolveInputBox(value)}
            className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Combined overlay wrapper ─────────────────────────────────────────────────

// ── Toast Notifications ───────────────────────────────────────────────────────

function Toast({ notification }: { notification: ExtensionNotification }) {
  const dismiss = useExtensionUiStore((s) => s.dismissNotification);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    const t1 = setTimeout(() => setVisible(true), 10);
    // Auto-dismiss after 5s
    const t2 = setTimeout(() => {
      setVisible(false);
      setTimeout(() => dismiss(notification.id), 300);
    }, 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [notification.id, dismiss]);

  const icons = {
    info: <Terminal className="h-3.5 w-3.5 text-blue-400 shrink-0" />,
    warning: <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />,
  };
  const borders = {
    info: 'border-blue-500/30',
    warning: 'border-warning/30',
    error: 'border-destructive/30',
  };

  return (
    <div
      className={`flex items-start gap-2.5 w-[300px] rounded-xl border ${borders[notification.type]} bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/30 px-3 py-2.5 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {icons[notification.type]}
      <div className="flex-1 min-w-0">
        {notification.title && (
          <div className="text-[11px] font-semibold text-foreground leading-tight mb-0.5">{notification.title}</div>
        )}
        <div className="text-[11px] text-muted-foreground leading-snug break-words">{notification.message}</div>
      </div>
      <button
        onClick={() => { setVisible(false); setTimeout(() => dismiss(notification.id), 300); }}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ExtensionToasts() {
  const notifications = useExtensionUiStore((s) => s.notifications);
  if (notifications.length === 0) return null;
  return (
    <div className="fixed bottom-8 right-4 z-[100002] flex flex-col gap-2 items-end pointer-events-none">
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <Toast notification={n} />
        </div>
      ))}
    </div>
  );
}

// ── Combined overlay wrapper ─────────────────────────────────────────────────

export function ExtensionOverlays() {
  return (
    <>
      <ExtensionQuickPick />
      <ExtensionInputBox />
      <ExtensionToasts />
    </>
  );
}
