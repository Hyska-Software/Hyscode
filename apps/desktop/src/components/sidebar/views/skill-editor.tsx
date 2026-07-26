import { useState, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  FileCode,
  Lock,
  Globe,
  FolderOpen,
  Plus,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tauriInvoke } from '@/lib/tauri-invoke';
import type { SkillScope } from '@hyscode/agent-harness';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkillData {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  activation: string;
  trigger?: string;
  content: string;
  filePath: string | null;
}

interface SkillEditorProps {
  skill?: SkillData | null;
  workspacePath: string;
  onBack: () => void;
  onSaved?: () => void;
}

// ─── Default template ───────────────────────────────────────────────────────

const NEW_SKILL_TEMPLATE = `---
name: my-skill
description: Describe what this skill does.
version: 1.0.0
scope: workspace
activation: manual
---

# My Skill

## Instructions

Add your skill instructions here. This content will be injected into
the agent's system prompt when the skill is active.

## Guidelines

- Be specific about what the agent should do
- Include examples when helpful
- Keep instructions concise
`;

// ─── Scope helpers ──────────────────────────────────────────────────────────

const SCOPE_ICONS: Record<SkillScope, typeof Globe> = {
  'built-in': Lock,
  global: Globe,
  workspace: FolderOpen,
};

const SCOPE_LABELS: Record<SkillScope, string> = {
  'built-in': 'Built-in (read-only)',
  global: 'Global',
  workspace: 'Workspace',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function SkillEditor({ skill, workspacePath, onBack, onSaved }: SkillEditorProps) {
  const isNew = !skill;
  const isReadOnly = skill?.scope === 'built-in';

  const [content, setContent] = useState(skill?.content ?? NEW_SKILL_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse frontmatter from content for display
  const frontmatter = parseFrontmatter(content);

  const handleSave = useCallback(async () => {
    if (isReadOnly) return;
    setSaving(true);
    setError(null);

    try {
      const name = frontmatter.name || 'untitled';
      const scope = frontmatter.scope || 'workspace';

      let targetPath: string;
      if (skill?.filePath) {
        targetPath = skill.filePath;
      } else if (scope === 'workspace') {
        targetPath = `${workspacePath}/.hyscode/skills/${name}.md`;
      } else {
        // Global: ~/.hyscode/skills/<name>.md
        // For now write to workspace — global path requires home dir resolution
        targetPath = `${workspacePath}/.hyscode/skills/${name}.md`;
      }

      // Ensure directory exists
      const dir = targetPath.substring(0, targetPath.lastIndexOf('/'));
      try {
        await tauriInvoke('create_file', { path: dir });
      } catch {
        // Directory may already exist
      }

      await tauriInvoke('write_file', { path: targetPath, content });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [content, frontmatter, skill, workspacePath, isReadOnly, onSaved]);

  const ScopeIcon = SCOPE_ICONS[skill?.scope ?? 'workspace'];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-2 py-1.5">
        <button
          onClick={onBack}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <FileCode className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-medium text-foreground">
          {isNew ? 'New Skill' : frontmatter.name || skill?.name || 'Skill'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <ScopeIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground">
            {SCOPE_LABELS[skill?.scope ?? 'workspace']}
          </span>
        </div>
      </div>

      {/* Metadata bar */}
      {frontmatter.name && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
          {frontmatter.description && (
            <span className="text-[10px] text-muted-foreground">{frontmatter.description}</span>
          )}
          {frontmatter.activation && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {frontmatter.activation}
            </span>
          )}
          {frontmatter.trigger && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
              {frontmatter.trigger}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-auto">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={isReadOnly}
          spellCheck={false}
          className="h-full w-full resize-none bg-background p-3 font-mono text-[11px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/50"
          placeholder="Write your skill content here..."
        />
      </div>

      {/* Footer actions */}
      {!isReadOnly && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="h-7 gap-1.5 px-3 text-[11px]"
          >
            <Save className="h-3 w-3" />
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
          </Button>
          <span className="text-[9px] text-muted-foreground">
            {content.split('\n').length} lines
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Trigger Buttons (used in skills-view) ──────────────────────────────────

export function EditSkillButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-primary"
      title="Edit skill"
    >
      <Pencil className="h-3 w-3" />
    </button>
  );
}

export function NewSkillButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
    >
      <Plus className="h-3 w-3" />
      New Skill
    </button>
  );
}

// ─── Frontmatter parser ─────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fm;

  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      fm[key] = val;
    }
  }
  return fm;
}
