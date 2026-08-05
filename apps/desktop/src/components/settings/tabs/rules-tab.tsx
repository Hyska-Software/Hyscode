import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, BookText, Lock } from 'lucide-react';
import { useRulesStore } from '../../../stores/rules-store';
import { useProjectStore } from '../../../stores/project-store';
import { useSettingsStore } from '../../../stores/settings-store';
import { getActiveAgentBridge } from '../../../lib/active-agent-bridge';
import { tauriFs } from '../../../lib/tauri-fs';
import { RuleEditorDialog } from './rule-editor-dialog';
import type { RuleEntry } from '../../../stores/rules-store';
import { SettingSection, SettingToggle } from '../controls';

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
  const globalRulesPath = useSettingsStore((s) => s.globalRulesPath);

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
        const bridge = getActiveAgentBridge();
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
        const discovered = await getActiveAgentBridge().loadRules();
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

  const nativeRules = rules.filter((r) => r.origin === 'native');
  const globalRules = rules.filter((r) => r.origin !== 'native' && r.scope === 'global');
  const workspaceRules = rules.filter((r) => r.origin !== 'native' && r.scope === 'workspace');

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookText className="h-4 w-4 text-muted-foreground" />
          <span className="text-[12px] text-muted-foreground">
            Managed rules and native project instructions are injected before every turn.
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
      <SettingSection
        title={`Global Rules (${globalRules.length})`}
        description={globalRulesPath || '~/.config/hyscode/rules/'}
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
      </SettingSection>

      {/* Native project instructions */}
      <SettingSection
        title={`Project Instructions (${nativeRules.length})`}
        description="AGENTS.md and CLAUDE.md — required and read-only"
      >
        {!projectPath ? (
          <EmptyState>Open a project to discover native instructions</EmptyState>
        ) : nativeRules.length === 0 ? (
          <EmptyState>No AGENTS.md or CLAUDE.md found</EmptyState>
        ) : (
          <div className="flex flex-col gap-1">
            {nativeRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} readOnly />
            ))}
          </div>
        )}
      </SettingSection>

      {/* Workspace Rules */}
      <SettingSection
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
      </SettingSection>

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
  readOnly = false,
}: {
  rule: RuleEntry;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2">
      <div className="flex items-center gap-2.5">
        <SettingToggle checked={rule.enabled} onChange={onToggle ?? (() => {})} disabled={readOnly} />
        <div className="flex flex-col">
          <span className="text-[12px] text-foreground">{rule.name}</span>
          <span className="text-[9px] text-muted-foreground truncate max-w-[320px]">
            {rule.filePath}
          </span>
        </div>
      </div>
      {readOnly ? (
        <Lock className="h-3 w-3 text-muted-foreground/70" aria-label="Required project instruction" />
      ) : (
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
      )}
    </div>
  );
}
