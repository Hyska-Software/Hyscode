// ─── GitHub Account Switcher (status bar popover) ───────────────────────────
// Lists connected accounts, lets the user pick the active one, add more
// accounts (OAuth device flow or personal access token) and jump to Settings.

import { useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import { useGithubStore } from '../../stores/github-store';
import { useSettingsStore } from '../../stores/settings-store';
import { GithubAccountSection } from '../settings/tabs/github-account-section';

interface GithubAccountSwitcherProps {
  open: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export function GithubAccountSwitcher({ open, onClose, anchorRef }: GithubAccountSwitcherProps) {
  const accounts = useGithubStore((s) => s.accounts);
  const openSettingsOnTab = useSettingsStore((s) => s.openSettingsOnTab);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-background p-2.5 shadow-xl"
      style={{
        left: anchorRef?.current ? anchorRef.current.getBoundingClientRect().left : 16,
        bottom: anchorRef?.current
          ? window.innerHeight - anchorRef.current.getBoundingClientRect().top + 4
          : 28,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">GitHub Accounts</span>
        <button
          type="button"
          onClick={() => {
            openSettingsOnTab('git');
            onClose();
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-3 w-3" />
          Manage
        </button>
      </div>
      <GithubAccountSection onAccountSelected={onClose} />
      {accounts.length > 1 && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          The active account is used by default. Each remote can be bound to a specific account in
          the Source Control view.
        </p>
      )}
    </div>
  );
}
