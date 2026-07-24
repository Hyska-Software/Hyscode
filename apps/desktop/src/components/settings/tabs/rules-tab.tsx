import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, BookText } from 'lucide-react';
import { useRulesStore } from '../../../stores/rules-store';
import { useProjectStore } from '../../../stores/project-store';
import { HarnessBridge } from '../../../lib/harness-bridge';
import { tauriFs } from '../../../lib/tauri-fs';
import { RuleEditorDialog } from './rule-editor-dialog';
import type { RuleEntry } from '../../../stores/rules-store';

export function RulesTab() {
  const rules = useRulesStore((s) => s.rules);
  const loading = useRulesStore((s) => s.loading);
  const setDiscoveredRules = useRulesStore((s) => s.setDiscoveredRules);
  const toggleRule = useRulesStore((s) => s.toggleRule);
  const removeRule = useRulesStore((s) => s.removeRule);
  const ruleEditorOpen = useRulesStore((s) => s.ruleEditorOpen);
  const ruleEditorScope = useRulesStore((s) => s.ruleEditorScope);
  const ruleEditorExistingId = useRulesStore((s) => s.ruleEditorExistingId);
  const openRuleEditor = useRulesStore((s) => s.openRuleEditor);
  const closeRuleEditor = useRulesStore((s) => s.closeRuleEditor);
  const projectPath = useProjectStore((s) => s.rootPath);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingRule = ruleEditorExistingId
    ? rules.find((r) => r.id === ruleEditorExistingId) ?? null
    : null;

  // Load rules on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        useRulesStore.getState().setLoading(true);
        const bridge = HarnessBridge.get();
        const discovered = await bridge.loadRules();
        if (!cancelled) {
          setDiscoveredRules(discovered);
        }
      } catch {
        // Bridge may not be initialized yet
      } finally {
        if (!cancelled) {
          useRulesStore.getState().setLoading(false);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [setDiscoveredRules, projectPath]);

  const handleDelete = useCallback(async (rule: RuleEntry) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    setDeletingId(rule.id);
    try {
      await tauriFs.deletePath(rule.filePath);
      removeRule(rule.id);
      // Re-discover
      try {
        const discovered = await HarnessBridge.get().loadRules();
        setDiscoveredRules(discovered);
      } catch {
        // ignore
      }
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  }, [removeRule, setDiscoveredRules]);

  const globalRules = rules.filter((r) => r.scope === 'global');
  const workspaceRules = rules.filter((r) => r.scope === 'workspace');

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookText className="h-4 w-4 text-muted-foreground" />
          <span className="text-[12px] text-muted-foreground">
            Rules are injected into the agent system prompt before every turn.
          </span>
        </div>
        <button
          onClick={() => openRuleEditor()}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Rule
        </button>
      </div>

      {/* Global Rules */}
      <Section
        title={`Global Rules (${globalRules.length})`}
        description="~/.config/hyscode/rules/"
      >
        {globalRules.length === 0 ? (
          <EmptyState>No global rules yet</EmptyState>
        ) : (
          <div className="flex flex-col gap-1">
            {globalRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => toggleRule(rule.id)}
                onEdit={() => openRuleEditor({ existingId: rule.id })}
                onDelete={() => handleDelete(rule)}
                deleting={deletingId === rule.id}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Workspace Rules */}
      <Section
        title={`Workspace Rules (${workspaceRules.length})`}
        description={projectPath ? `${projectPath}/.hyscode/rules/` : 'No workspace open'}
      >
        {!projectPath ? (
          <EmptyState>Open a project to manage workspace rules</EmptyState>
        ) : workspaceRules.length === 0 ? (
          <EmptyState>No workspace rules yet</EmptyState>
        ) : (
          <div className="flex flex-col gap-1">
            {workspaceRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => toggleRule(rule.id)}
                onEdit={() => openRuleEditor({ existingId: rule.id })}
                onDelete={() => handleDelete(rule)}
                deleting={deletingId === rule.id}
              />
            ))}
          </div>
        )}
      </Section>

      {loading && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading rules...
        </div>
      )}

      <RuleEditorDialog
        open={ruleEditorOpen}
        onClose={closeRuleEditor}
        existingRule={editingRule ?? undefined}
        initialScope={ruleEditorScope}
      />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-medium text-foreground">{title}</h3>
          <span className="text-[9px] text-muted-foreground">{description}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-raised px-3 py-4 text-center text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

function RuleRow({
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
    <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2">
      <div className="flex items-center gap-2.5">
        <Toggle checked={rule.enabled} onChange={onToggle} />
        <div className="flex flex-col">
          <span className="text-[12px] text-foreground">{rule.name}</span>
          <span className="text-[9px] text-muted-foreground truncate max-w-[320px]">
            {rule.filePath}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          title="Delete"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={`relative h-4 w-7 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-foreground transition-transform ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
