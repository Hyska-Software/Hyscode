import { useState, useRef, useEffect } from 'react';
import { GitBranch, Check, Trash2, Plus, Search, Cloud, Loader2 } from 'lucide-react';
import { useGitStore } from '../../stores';
import { promptConfirm } from '../ui/dialogs';

interface BranchPickerProps {
  open: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export function BranchPicker({ open, onClose, anchorRef }: BranchPickerProps) {
  const branches = useGitStore((s) => s.branches);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const createBranch = useGitStore((s) => s.createBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const fetchBranches = useGitStore((s) => s.fetchBranches);

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchSource, setNewBranchSource] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      void fetchBranches().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
      setSearch('');
      setCreating(false);
      setNewBranchName('');
      setNewBranchSource(useGitStore.getState().currentBranch);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, fetchBranches]);

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

  const localBranches = branches.filter((b) => !b.is_remote);
  const remoteBranches = branches.filter((b) => b.is_remote);

  const filteredLocal = localBranches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredRemote = remoteBranches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCheckout = async (name: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await checkoutBranch(name);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setIsLoading(true);
    setError(null);
    try {
      await createBranch(name, true, newBranchSource || undefined);
      setCreating(false);
      setNewBranchName('');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    const confirmed = await promptConfirm({
      title: 'Delete Branch',
      description: `Delete local branch "${name}"? Git will reject this if it is not fully merged.`,
    });
    if (!confirmed) return;
    setIsLoading(true);
    setError(null);
    try {
      await deleteBranch(name);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      const forceConfirmed = await promptConfirm({
        title: 'Force Delete Branch',
        description: `Git rejected the normal delete of "${name}". Force deletion can discard commits. Delete it anyway?`,
      });
      if (forceConfirmed) {
        try {
          await deleteBranch(name, true);
          setError(null);
        } catch (forceReason) {
          setError(forceReason instanceof Error ? forceReason.message : String(forceReason));
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-64 max-h-80 rounded-lg border border-border bg-background shadow-xl flex flex-col overflow-hidden"
      style={{
        left: anchorRef?.current ? anchorRef.current.getBoundingClientRect().left : 16,
        bottom: anchorRef?.current
          ? window.innerHeight - anchorRef.current.getBoundingClientRect().top + 4
          : 28,
      }}
    >
      {/* Search / Create header */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          ref={searchRef}
          type="text"
          placeholder={creating ? 'New branch name...' : 'Search branches...'}
          value={creating ? newBranchName : search}
          onChange={(e) =>
            creating ? setNewBranchName(e.target.value) : setSearch(e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && creating) handleCreate();
            if (e.key === 'Escape') {
              if (creating) setCreating(false);
              else onClose();
            }
          }}
          className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
        />
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="border-b border-border bg-destructive/5 px-2 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}

      {/* Create branch button */}
      {!creating && (
        <button
          onClick={() => {
            setCreating(true);
            setNewBranchName(search);
          }}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-primary hover:bg-surface-raised transition-colors"
        >
          <Plus className="h-3 w-3" />
          Create new branch{search ? `: ${search}` : ''}
        </button>
      )}

      {creating && (
        <div className="border-b border-border px-2 py-1.5">
          <label className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            From
            <select
              value={newBranchSource}
              onChange={(event) => setNewBranchSource(event.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground"
            >
              <option value={currentBranch}>{currentBranch || 'Current HEAD'}</option>
              {branches
                .filter((branch) => branch.name !== currentBranch)
                .map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCreate}
              disabled={!newBranchName.trim() || isLoading}
              className="rounded-sm bg-primary px-2 py-0.5 text-[10px] text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              Create & Checkout
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-sm px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Branch list */}
      <div className="flex-1 overflow-auto">
        {filteredLocal.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Local
            </div>
            {filteredLocal.map((b) => (
              <BranchRow
                key={b.name}
                name={b.name}
                isCurrent={b.is_current}
                upstream={b.upstream}
                onCheckout={() => handleCheckout(b.name)}
                onDelete={b.is_current ? undefined : () => handleDelete(b.name)}
              />
            ))}
          </div>
        )}

        {filteredRemote.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Remote
            </div>
            {filteredRemote.map((b) => (
              <button
                key={b.name}
                onClick={() => void handleCheckout(b.name)}
                disabled={isLoading}
                className="flex w-full items-center gap-1.5 px-2 py-[3px] text-left text-[11px] text-muted-foreground hover:bg-surface-raised disabled:opacity-50"
              >
                <Cloud className="h-3 w-3 shrink-0 opacity-50" />
                <span className="truncate">{b.name}</span>
              </button>
            ))}
          </div>
        )}

        {filteredLocal.length === 0 && filteredRemote.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            No branches found
          </div>
        )}
      </div>
    </div>
  );
}

function BranchRow({
  name,
  isCurrent,
  upstream,
  onCheckout,
  onDelete,
}: {
  name: string;
  isCurrent: boolean;
  upstream?: string | null;
  onCheckout: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-[3px] text-[11px] transition-colors cursor-pointer ${
        isCurrent ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-surface-raised'
      }`}
      onClick={isCurrent ? undefined : onCheckout}
    >
      {isCurrent ? (
        <Check className="h-3 w-3 shrink-0 text-primary" />
      ) : (
        <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{name}</span>
      {upstream && (
        <span title={`Tracks ${upstream}`}>
          <Cloud className="h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-50" />
        </span>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-auto opacity-0 group-hover:opacity-100 flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-destructive transition-all"
          title="Delete branch"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
