import { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '../../../stores';
import { useRulesStore } from '../../../stores/rules-store';
import { useProjectStore } from '../../../stores/project-store';
import { defineAllMonacoThemes, getMonacoThemeName } from '../../../lib/monaco-themes';
import { tauriFs } from '../../../lib/tauri-fs';
import { HarnessBridge } from '../../../lib/harness-bridge';
import { getActiveAgentBridge } from '../../../lib/active-agent-bridge';
import type { RuleScope } from '@hyscode/agent-harness';
import { SettingInput, SettingSelect } from '../controls';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface RuleEditorDialogProps {
  open: boolean;
  onClose: () => void;
  /** If provided, edit mode. Otherwise create mode. */
  existingRule?: {
    id: string;
    name: string;
    scope: RuleScope;
    content: string;
    filePath: string;
    mandatory?: boolean;
  };
  /** Default scope for new rules (when existingRule is not provided). */
  initialScope?: RuleScope;
}

export function RuleEditorDialog({ open, onClose, existingRule, initialScope = 'global' }: RuleEditorDialogProps) {
  const themeId = useSettingsStore((s) => s.themeId);
  const monacoTheme = getMonacoThemeName(themeId);
  const projectPath = useProjectStore((s) => s.rootPath);

  const [name, setName] = useState(existingRule?.name ?? '');
  const [scope, setScope] = useState<RuleScope>(existingRule?.scope ?? initialScope);
  const [content, setContent] = useState(existingRule?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(existingRule?.name ?? '');
      setScope(existingRule?.scope ?? initialScope);
      setContent(existingRule?.content ?? '');
      setError(null);
    }
  }, [open, existingRule, initialScope]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) setContent(value);
  }, []);

  const handleSave = async () => {
    if (existingRule?.mandatory) {
      setError('Native project instructions are read-only');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Rule name is required');
      return;
    }
    if (!content.trim()) {
      setError('Rule content cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let dirPath: string;
      if (scope === 'global') {
        const homePath = HarnessBridge.getHomePath();
        dirPath = useSettingsStore.getState().globalRulesPath.trim() || `${homePath}/.config/hyscode/rules`;
      } else {
        if (!projectPath) {
          setError('No workspace open. Cannot create workspace rule.');
          setSaving(false);
          return;
        }
        dirPath = `${projectPath}/.hyscode/rules`;
      }

      // Ensure directory exists (best-effort via create_file parent)
      try {
        await tauriFs.createFile(`${dirPath}/.gitkeep`, '');
      } catch {
        // ignore — directory may already exist or command may fail
      }

      const filePath = `${dirPath}/${trimmedName}.md`;

      if (existingRule && existingRule.filePath !== filePath) {
        // Name changed — delete old file
        await tauriFs.deletePath(existingRule.filePath);
      }

      await tauriFs.writeFile(filePath, content);

      // Update store
      const id = `${scope}:${trimmedName}`;
      useRulesStore.getState().upsertRule({
        id,
        name: trimmedName,
        scope,
        origin: 'managed',
        mandatory: false,
        enabled: true,
        filePath,
        content,
      });

      // Re-discover rules in harness
      try {
        const discovered = await getActiveAgentBridge().loadRules();
        useRulesStore.getState().setDiscoveredRules(discovered);
      } catch {
        // ignore
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[520px] w-[680px] flex-col overflow-hidden rounded-xl bg-card shadow-2xl">
        {/* Header */}
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface-raised px-4">
          <span className="text-[13px] font-semibold text-foreground">
            {existingRule ? 'Edit Rule' : 'New Rule'}
          </span>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Form */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Name</label>
            <SettingInput
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!existingRule}
              placeholder="my-rule"
              className="h-7 w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">Scope</label>
            <SettingSelect
              value={scope}
              onChange={(v) => setScope(v as RuleScope)}
              disabled={!!existingRule}
              options={[
                { value: 'global' as RuleScope, label: 'Global' },
                { value: 'workspace' as RuleScope, label: 'Workspace' },
              ]}
            />
          </div>
          {scope === 'workspace' && !projectPath && (
            <span className="text-[10px] text-destructive">No workspace open</span>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <MonacoEditor
              language="markdown"
              value={content}
              onChange={handleEditorChange}
              theme={monacoTheme}
              beforeMount={defineAllMonacoThemes}
              options={{
                fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
                fontSize: 14,
                lineHeight: 1.6,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                wordWrap: 'on',
                tabSize: 2,
                padding: { top: 8 },
                automaticLayout: true,
              }}
            />
          </Suspense>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-surface-raised px-4 py-3">
          {error ? (
            <span className="text-[11px] text-destructive">{error}</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Rules are injected into the agent system prompt before each turn.
            </span>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
