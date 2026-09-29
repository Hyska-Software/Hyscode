// ── Custom Popup Dialogs ─────────────────────────────────────────────────────
// Replaces native prompt() and confirm() with styled React components.

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

// ── Dialog Store ─────────────────────────────────────────────────────────────

interface InputDialogConfig {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  selectRange?: [number, number]; // Selection range in the input
  onConfirm: (value: string) => void;
  onCancel?: () => void;
}

interface ConfirmDialogConfig {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export type DeleteMode = 'trash' | 'permanent';

export interface DeleteDialogResult {
  mode: DeleteMode;
  dontAsk: boolean;
}

interface DeleteDialogConfig {
  fileName: string;
  isDir: boolean;
  defaultMode?: DeleteMode;
  onConfirm: (result: DeleteDialogResult) => void;
  onCancel?: () => void;
}

interface DialogState {
  inputDialog: InputDialogConfig | null;
  confirmDialog: ConfirmDialogConfig | null;
  deleteDialog: DeleteDialogConfig | null;
  showInputDialog: (config: InputDialogConfig) => void;
  showConfirmDialog: (config: ConfirmDialogConfig) => void;
  showDeleteDialog: (config: DeleteDialogConfig) => void;
  closeInputDialog: () => void;
  closeConfirmDialog: () => void;
  closeDeleteDialog: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  inputDialog: null,
  confirmDialog: null,
  deleteDialog: null,
  showInputDialog: (config) => set({ inputDialog: config }),
  showConfirmDialog: (config) => set({ confirmDialog: config }),
  showDeleteDialog: (config) => set({ deleteDialog: config }),
  closeInputDialog: () => set({ inputDialog: null }),
  closeConfirmDialog: () => set({ confirmDialog: null }),
  closeDeleteDialog: () => set({ deleteDialog: null }),
}));

// ── Convenience helpers ──────────────────────────────────────────────────────

export function promptInput(config: Omit<InputDialogConfig, 'onConfirm' | 'onCancel'>): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().showInputDialog({
      ...config,
      onConfirm: (value) => resolve(value),
      onCancel: () => resolve(null),
    });
  });
}

export function promptConfirm(config: Omit<ConfirmDialogConfig, 'onConfirm' | 'onCancel'>): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().showConfirmDialog({
      ...config,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * Ask how to delete a file/folder: Trash (recoverable) or permanently, with a
 * "Don't show again" option that persists the choice. Resolves to null when
 * the user cancels.
 */
export function promptDelete(
  config: Omit<DeleteDialogConfig, 'onConfirm' | 'onCancel'>,
): Promise<DeleteDialogResult | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().showDeleteDialog({
      ...config,
      onConfirm: (result) => resolve(result),
      onCancel: () => resolve(null),
    });
  });
}

// ── Input Dialog Component ──────────────────────────────────────────────────

export function InputDialog() {
  const dialog = useDialogStore((s) => s.inputDialog);
  const close = useDialogStore((s) => s.closeInputDialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog) {
      setValue(dialog.defaultValue ?? '');
      // Focus + select after render
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        if (dialog.selectRange) {
          el.setSelectionRange(dialog.selectRange[0], dialog.selectRange[1]);
        } else if (dialog.defaultValue) {
          // Select filename part (before last dot)
          const dot = dialog.defaultValue.lastIndexOf('.');
          el.setSelectionRange(0, dot > 0 ? dot : dialog.defaultValue.length);
        } else {
          el.select();
        }
      });
    }
  }, [dialog]);

  const handleConfirm = useCallback(() => {
    if (!dialog || !value.trim()) return;
    dialog.onConfirm(value.trim());
    close();
  }, [dialog, value, close]);

  const handleCancel = useCallback(() => {
    dialog?.onCancel?.();
    close();
  }, [dialog, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleConfirm, handleCancel],
  );

  if (!dialog) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        role="button"
        tabIndex={0}
        aria-label="Close dialog"
        onClick={handleCancel}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') handleCancel();
        }}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg">
        <h3 className="mb-3 text-[12px] font-semibold text-foreground">{dialog.title}</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={dialog.placeholder}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-[12px] text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
          style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="rounded-md px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value.trim()}
            className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {dialog.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Confirm Dialog Component ────────────────────────────────────────────────

export function ConfirmDialog() {
  const dialog = useDialogStore((s) => s.confirmDialog);
  const close = useDialogStore((s) => s.closeConfirmDialog);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog) {
      requestAnimationFrame(() => confirmRef.current?.focus());
    }
  }, [dialog]);

  const handleConfirm = useCallback(() => {
    dialog?.onConfirm();
    close();
  }, [dialog, close]);

  const handleCancel = useCallback(() => {
    dialog?.onCancel?.();
    close();
  }, [dialog, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleCancel],
  );

  if (!dialog) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        role="button"
        tabIndex={0}
        aria-label="Close confirm dialog"
        onClick={handleCancel}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') handleCancel();
        }}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg">
        <h3 className="mb-1 text-[12px] font-semibold text-foreground">{dialog.title}</h3>
        {dialog.description && (
          <p className="mb-3 text-[11px] text-muted-foreground">{dialog.description}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="rounded-md px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={handleConfirm}
            className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
              dialog.danger
                ? 'bg-destructive text-white hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {dialog.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Delete Dialog Component ────────────────────────────────────────────────

export function DeleteDialog() {
  const dialog = useDialogStore((s) => s.deleteDialog);
  const close = useDialogStore((s) => s.closeDeleteDialog);
  const [mode, setMode] = useState<DeleteMode>('trash');
  const [dontAsk, setDontAsk] = useState(false);
  const trashRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog) {
      setMode(dialog.defaultMode ?? 'trash');
      setDontAsk(false);
      requestAnimationFrame(() => trashRef.current?.focus());
    }
  }, [dialog]);

  const handleConfirm = useCallback(() => {
    if (!dialog) return;
    dialog.onConfirm({ mode, dontAsk });
    close();
  }, [dialog, mode, dontAsk, close]);

  const handleCancel = useCallback(() => {
    dialog?.onCancel?.();
    close();
  }, [dialog, close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleConfirm, handleCancel],
  );

  if (!dialog) return null;

  const item = dialog.isDir ? 'folder' : 'file';

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        role="button"
        tabIndex={0}
        aria-label="Close delete dialog"
        onClick={handleCancel}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') handleCancel();
        }}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg">
        <h3 className="mb-1 text-[12px] font-semibold text-foreground">
          Delete &ldquo;{dialog.fileName}&rdquo;?
        </h3>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {dialog.isDir
            ? 'This folder and all its contents will be removed.'
            : 'This file will be removed.'}
        </p>

        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Delete method">
          <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted">
            <input
              ref={trashRef}
              type="radio"
              name="delete-mode"
              checked={mode === 'trash'}
              onChange={() => setMode('trash')}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-[11px] font-medium text-foreground">
                Move to Trash
              </span>
              <span className="block text-[10px] text-muted-foreground">
                Recoverable from the system trash
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted">
            <input
              type="radio"
              name="delete-mode"
              checked={mode === 'permanent'}
              onChange={() => setMode('permanent')}
              className="mt-0.5 accent-destructive"
            />
            <span>
              <span className="block text-[11px] font-medium text-foreground">
                Delete permanently
              </span>
              <span className="block text-[10px] text-muted-foreground">
                Cannot be undone
              </span>
            </span>
          </label>
        </div>

        <label className="mt-2 flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
            className="accent-primary"
          />
          Don&apos;t show again
        </label>

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="rounded-md px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
              mode === 'permanent'
                ? 'bg-destructive text-white hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {mode === 'permanent' ? `Delete ${item} permanently` : `Move ${item} to Trash`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Dialog Provider (renders both dialogs) ──────────────────────────────────

export function DialogProvider() {
  return (
    <>
      <InputDialog />
      <ConfirmDialog />
      <DeleteDialog />
    </>
  );
}
