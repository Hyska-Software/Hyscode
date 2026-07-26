import { useState, useEffect } from 'react';
import { X, BookText, Settings, Plus, Loader2 } from 'lucide-react';
import { useRulesStore } from '@/stores/rules-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useProjectStore } from '@/stores/project-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { tauriFs } from '@/lib/tauri-fs';
import { RuleEditorDialog } from '@/components/settings/tabs/rule-editor-dialog';
import type { RuleEntry } from '@/stores/rules-store';

interface RulesPanelDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RulesPanelDialog({ open, onClose }: RulesPanelDialogProps) {
  const rules = useRulesStore((s) => s.rules);
  const toggleRule = useRulesStore((s) => s.toggleRule);
  const removeRule = useRulesStore((s) => s.removeRule);
  const setDiscoveredRules = useRulesStore((s) => s.setDiscoveredRules);
  const ruleEditorOpen = useRulesStore((s) => s.ruleEditorOpen);
  const ruleEditorScope = useRulesStore((s) => s.ruleEditorScope);
  const ruleEditorExistingId = useRulesStore((s) => s.ruleEditorExistingId);
  const openRuleEditor = useRulesStore((s) => s.openRuleEditor);
  const closeRuleEditor = useRulesStore((s) => s.closeRuleEditor);
  const projectPath = useProjectStore((s) => s.rootPath);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingRule = ruleEditorExistingId
    ? rules.find((r) => r.id === ruleEditorExistingId) ?? null
    : null;

  // Load rules when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        const bridge = HarnessBridge.get();
        const discovered = await bridge.loadRules();
        if (!cancelled) setDiscoveredRules(discovered);
      } catch {
        // ignore
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [open, setDiscoveredRules, projectPath]);

  const handleOpenSettings = () => {
    onClose();
    openSettings();
  };

  const handleDelete = async (rule: RuleEntry) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    setDeletingId(rule.id);
    try {
      await tauriFs.deletePath(rule.filePath);
      removeRule(rule.id);
      const discovered = await HarnessBridge.get().loadRules();
      setDiscoveredRules(discovered);
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  };

  const globalRules = rules.filter((r) => r.scope === 'global');
  const workspaceRules = rules.filter((r) => r.scope === 'workspace');

  if (!open) return null;

  return (
    <>
      <div className="absolute right-0 top-8 z-50 w-72 rounded-lg border border-border/50 bg-surface-raised shadow-lg shadow-black/20 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <BookText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-foreground">Active Rules</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleOpenSettings}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Open Settings"
            >
              <Settings className="h-3 w-3" />
            </button>
            <button
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex max-h-80 flex-col gap-0 overflow-y-auto px-2 py-2">
          {/* Global */}
          {globalRules.length > 0 && (
            <div className="mb-1">
              <span className="px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Global
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {globalRules.map((rule) => (
                  <RuleItem
                    key={rule.id}
                    rule={rule}
                    onToggle={() => toggleRule(rule.id)}
                    onEdit={() => openRuleEditor({ existingId: rule.id })}
                    onDelete={() => handleDelete(rule)}
                    deleting={deletingId === rule.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Workspace */}
          {workspaceRules.length > 0 && (
            <div className="mb-1">
              <span className="px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Workspace
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {workspaceRules.map((rule) => (
                  <RuleItem
                    key={rule.id}
                    rule={rule}
                    onToggle={() => toggleRule(rule.id)}
                    onEdit={() => openRuleEditor({ existingId: rule.id })}
                    onDelete={() => handleDelete(rule)}
                    deleting={deletingId === rule.id}
                  />
                ))}
              </div>
            </div>
          )}

          {rules.length === 0 && (
            <div className="px-1 py-3 text-center text-[10px] text-muted-foreground">
              No rules configured.
              <br />
              <button
                onClick={() => openRuleEditor()}
                className="mt-1 text-primary hover:underline"
              >
                Create your first rule
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/30 px-3 py-2">
          <span className="text-[9px] text-muted-foreground">
            {rules.filter((r) => r.enabled).length} active
          </span>
          <button
            onClick={() => openRuleEditor()}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3 w-3" />
            New Rule
          </button>
        </div>
      </div>

      <RuleEditorDialog
        open={ruleEditorOpen}
        onClose={closeRuleEditor}
        existingRule={editingRule ?? undefined}
        initialScope={ruleEditorScope}
      />
    </>
  );
}

function RuleItem({
  rule,
  onToggle,
  onEdit,
  onDelete,
  deleting,
}: {
  rule: RuleEntry;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40">
      <div className="flex items-center gap-2">
        <ToggleMini checked={rule.enabled} onChange={onToggle} />
        <span className="text-[11px] text-foreground">{rule.name}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onEdit}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Edit"
        >
          <Settings className="h-3 w-3" />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          title="Delete"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

function ToggleMini({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={`relative h-3.5 w-6 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full bg-foreground transition-transform ${
          checked ? 'translate-x-2.5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
