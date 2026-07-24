import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Globe,
  FolderOpen,
  Package,
  FileCode,
  Plus,
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  FolderSearch,
  MoreHorizontal,
  Check,
  Zap,
  FileText,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useSkillsStore, type SkillEntry } from '@/stores/skills-store';
import { useEditorStore } from '@/stores/editor-store';
import { useProjectStore } from '@/stores/project-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { writeClipboard } from '@/lib/utils';
import { getViewerType } from '@/lib/utils';
import { promptConfirm } from '@/components/ui/dialogs';
import type { AgentType, SkillScope } from '@hyscode/agent-harness';

// ─── Constants ──────────────────────────────────────────────────────────────

const SCOPE_ICONS: Record<SkillScope, typeof Globe> = {
  'built-in': Package,
  global: Globe,
  workspace: FolderOpen,
};

const SCOPE_LABELS: Record<SkillScope, string> = {
  'built-in': 'Built-in',
  global: 'Global',
  workspace: 'Workspace',
};

const SCOPE_META: Record<SkillScope, string> = {
  'built-in': 'Core skills shipped with Hyscode',
  global: '~/.agents/skills',
  workspace: '.agents/skills',
};

const AGENT_MODES: { value: AgentType; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'build', label: 'Build' },
  { value: 'review', label: 'Review' },
  { value: 'debug', label: 'Debug' },
  { value: 'plan', label: 'Plan' },
];

const NEW_SKILL_TEMPLATE = `---
name: my-skill
description: Describe what this skill does.
version: 1.0.0
scope: workspace
activation: manual
---

# My Skill

## Instructions

Add your skill instructions here.
`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  skill: SkillEntry;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScopeColor(scope: SkillScope): string {
  switch (scope) {
    case 'built-in':
      return 'text-primary';
    case 'global':
      return 'text-blue-400';
    case 'workspace':
      return 'text-success';
    default:
      return 'text-muted-foreground';
  }
}

function getScopeBg(scope: SkillScope): string {
  switch (scope) {
    case 'built-in':
      return 'bg-primary/10';
    case 'global':
      return 'bg-blue-500/10';
    case 'workspace':
      return 'bg-success/10';
    default:
      return 'bg-muted';
  }
}

async function getUniqueSkillPath(dirPath: string, baseName: string): Promise<string> {
  let targetPath = `${dirPath}/${baseName}.md`;
  let i = 1;
  while (true) {
    try {
      await tauriInvoke('stat_path', { path: targetPath });
      targetPath = `${dirPath}/${baseName}-${i}.md`;
      i++;
    } catch {
      break;
    }
  }
  return targetPath;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SkillsView() {
  const skills = useSkillsStore((s) => s.skills);
  const loading = useSkillsStore((s) => s.loading);
  const toggleSkill = useSkillsStore((s) => s.toggleSkill);
  const setSkillModes = useSkillsStore((s) => s.setSkillModes);
  const addSkill = useSkillsStore((s) => s.addSkill);
  const removeSkill = useSkillsStore((s) => s.removeSkill);

  const [collapsedScopes, setCollapsedScopes] = useState<Set<string>>(new Set());
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const enabledCount = useMemo(() => skills.filter((s) => s.enabled).length, [skills]);

  // Filter skills by search
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.scope.toLowerCase().includes(q),
    );
  }, [skills, searchQuery]);

  // Group skills by scope
  const grouped = useMemo(() => {
    const groups: Record<string, SkillEntry[]> = {};
    for (const s of filteredSkills) {
      (groups[s.scope] ??= []).push(s);
    }
    return groups;
  }, [filteredSkills]);

  // ─── Handlers ─────────────────────────────────────────────────────

  const toggleScope = useCallback((scope: string) => {
    setCollapsedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }, []);

  const openSkillInEditor = useCallback((skill: SkillEntry, focusEdit = false) => {
    if (!skill.filePath) return;
    const fileName = skill.filePath.split('/').pop() ?? skill.name;
    useEditorStore.getState().openTab({
      id: skill.filePath,
      fileName,
      filePath: skill.filePath,
      language: 'markdown',
      viewerType: getViewerType(fileName),
    });
    // If focusEdit, we could set cursor position in future
    void focusEdit;
  }, []);

  const handleModeToggle = useCallback(
    (skillId: string, mode: AgentType, currentModes: AgentType[]) => {
      const next = currentModes.includes(mode)
        ? currentModes.filter((m) => m !== mode)
        : [...currentModes, mode];
      setSkillModes(skillId, next);
    },
    [setSkillModes],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const bridge = HarnessBridge.get();
      const discovered = await bridge.loadSkills();
      useSkillsStore.getState().setDiscoveredSkills(discovered);
    } catch (err) {
      console.warn('[SkillsView] Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleCreateSkill = useCallback(async () => {
    const workspacePath = useProjectStore.getState().rootPath;
    if (!workspacePath) return;

    const skillName = `new-skill-${Date.now()}`;
    const dirPath = `${workspacePath}/.agents/skills`;
    const filePath = `${dirPath}/${skillName}.md`;

    try {
      try {
        await tauriInvoke('create_directory', { path: dirPath });
      } catch { /* may exist */ }

      await tauriInvoke('write_file', { path: filePath, content: NEW_SKILL_TEMPLATE });

      addSkill({
        id: `workspace:${skillName}`,
        name: skillName,
        description: 'New skill',
        scope: 'workspace',
        enabled: true,
        filePath,
        content: NEW_SKILL_TEMPLATE,
        modes: [],
        status: 'ok',
      });

      useEditorStore.getState().openTab({
        id: filePath,
        fileName: `${skillName}.md`,
        filePath,
        language: 'markdown',
        viewerType: 'code',
      });
    } catch (err) {
      console.error('[SkillsView] Failed to create skill:', err);
    }
  }, [addSkill]);

  const handleDeleteSkill = useCallback(
    async (skill: SkillEntry) => {
      if (skill.scope === 'built-in') return;
      const confirmed = await promptConfirm({
        title: `Delete "${skill.name}"?`,
        description: 'This will permanently delete the skill file.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!confirmed) return;

      try {
        if (skill.filePath) {
          await tauriInvoke('delete_path', { path: skill.filePath });
        }
        removeSkill(skill.id);
      } catch (err) {
        console.error('[SkillsView] Failed to delete skill:', err);
      }
    },
    [removeSkill],
  );

  const handleDuplicateSkill = useCallback(
    async (skill: SkillEntry) => {
      if (!skill.filePath) return;
      const dirPath = skill.filePath.substring(0, skill.filePath.lastIndexOf('/'));
      const baseName = skill.name + '-copy';
      const newPath = await getUniqueSkillPath(dirPath, baseName);
      const newName = newPath.split('/').pop()!.replace('.md', '');

      try {
        const content = skill.content || NEW_SKILL_TEMPLATE;
        await tauriInvoke('write_file', { path: newPath, content });

        addSkill({
          id: `${skill.scope}:${newName}`,
          name: newName,
          description: skill.description,
          scope: skill.scope,
          enabled: false,
          filePath: newPath,
          content,
          modes: [],
          status: 'ok',
        });

        openSkillInEditor({
          ...skill,
          filePath: newPath,
          name: newName,
        });
      } catch (err) {
        console.error('[SkillsView] Failed to duplicate skill:', err);
      }
    },
    [addSkill, openSkillInEditor],
  );

  const handleCopyPath = useCallback(async (skill: SkillEntry) => {
    if (!skill.filePath) return;
    try {
      await writeClipboard(skill.filePath);
    } catch (err) {
      console.error('[SkillsView] Failed to copy path:', err);
    }
  }, []);

  const handleRevealInManager = useCallback(async (skill: SkillEntry) => {
    if (!skill.filePath) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reveal_path', { path: skill.filePath });
    } catch (err) {
      console.error('[SkillsView] Failed to reveal:', err);
    }
  }, []);

  // ─── Context Menu interactions ────────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const onMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const onScroll = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, skill: SkillEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, skill });
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 220) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 320) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col gap-1.5 border-b border-border bg-surface-raised px-2 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Skills
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0 text-[9px] font-medium text-muted-foreground">
              {enabledCount}/{skills.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <ActionButton
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh skills"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </ActionButton>
            <ActionButton onClick={handleCreateSkill} title="New skill">
              <Plus className="h-3 w-3" />
            </ActionButton>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter skills..."
            className="w-full rounded-md border border-border bg-background py-1 pl-6 pr-6 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Skills list */}
      <div className="flex-1 overflow-auto py-1">
        {skills.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Package className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">No skills discovered yet.</p>
            <p className="text-[10px] text-muted-foreground/60">
              Open a project or add skills to ~/.agents/skills/
            </p>
          </div>
        )}

        {searchQuery && filteredSkills.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Search className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">No skills match "{searchQuery}"</p>
          </div>
        )}

        {(['built-in', 'global', 'workspace'] as const).map((scope) => {
          const scopeSkills = grouped[scope];
          if (!scopeSkills || scopeSkills.length === 0) return null;

          const ScopeIcon = SCOPE_ICONS[scope];
          const isCollapsed = collapsedScopes.has(scope);
          const scopeEnabled = scopeSkills.filter((s) => s.enabled).length;

          return (
            <div key={scope} className="mb-1">
              {/* Scope header */}
              <button
                onClick={() => toggleScope(scope)}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center">
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  )}
                </span>
                <ScopeIcon className={`h-3.5 w-3.5 ${getScopeColor(scope)}`} />
                <span className="text-[11px] font-medium text-foreground">
                  {SCOPE_LABELS[scope]}
                </span>
                <span className="text-[9px] text-muted-foreground/60">{SCOPE_META[scope]}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {scopeEnabled > 0 && (
                    <span className={`rounded px-1 py-0 text-[9px] font-medium ${getScopeBg(scope)} ${getScopeColor(scope)}`}>
                      {scopeEnabled}
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground/50">{scopeSkills.length}</span>
                </div>
              </button>

              {/* Skill items */}
              {!isCollapsed &&
                scopeSkills.map((skill) => (
                  <SkillItem
                    key={skill.id}
                    skill={skill}
                    isExpanded={expandedSkill === skill.id}
                    onToggle={() => toggleSkill(skill.id)}
                    onExpand={() =>
                      setExpandedSkill(expandedSkill === skill.id ? null : skill.id)
                    }
                    onOpenEditor={() => openSkillInEditor(skill)}
                    onModeToggle={(mode) => handleModeToggle(skill.id, mode, skill.modes)}
                    onContextMenu={(e) => handleContextMenu(e, skill)}
                    scopeColor={getScopeColor(scope)}
                  />
                ))}
            </div>
          );
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-surface p-1 shadow-xl"
          style={{ left: menuX, top: menuY }}
        >
          <ContextMenuItem
            icon={FileCode}
            label="Open"
            onClick={() => {
              openSkillInEditor(contextMenu.skill);
              setContextMenu(null);
            }}
          />
          <ContextMenuItem
            icon={Pencil}
            label="Edit"
            onClick={() => {
              openSkillInEditor(contextMenu.skill, true);
              setContextMenu(null);
            }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={Copy}
            label="Copy Path"
            onClick={() => {
              handleCopyPath(contextMenu.skill);
              setContextMenu(null);
            }}
          />
          {contextMenu.skill.filePath && (
            <ContextMenuItem
              icon={FolderSearch}
              label="Reveal in File Manager"
              onClick={() => {
                handleRevealInManager(contextMenu.skill);
                setContextMenu(null);
              }}
            />
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={FileText}
            label="Duplicate"
            onClick={() => {
              handleDuplicateSkill(contextMenu.skill);
              setContextMenu(null);
            }}
          />
          {contextMenu.skill.scope !== 'built-in' && (
            <ContextMenuItem
              icon={Trash2}
              label="Delete"
              danger
              onClick={() => {
                handleDeleteSkill(contextMenu.skill);
                setContextMenu(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skill Item ─────────────────────────────────────────────────────────────

interface SkillItemProps {
  skill: SkillEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onOpenEditor: () => void;
  onModeToggle: (mode: AgentType) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  scopeColor: string;
}

function SkillItem({
  skill,
  isExpanded,
  onToggle,
  onExpand,
  onOpenEditor,
  onModeToggle,
  onContextMenu,
  scopeColor,
}: SkillItemProps) {
  const isMissing = skill.status === 'missing-content';

  return (
    <div
      className={`group border-b border-border/20 last:border-b-0 ${isMissing ? 'opacity-50' : ''}`}
      onContextMenu={onContextMenu}
    >
      <div
        className="relative flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-surface-raised"
        onDoubleClick={onOpenEditor}
      >
        {/* Toggle */}
        <button
          onClick={onToggle}
          className="mt-0.5 shrink-0 rounded-sm p-0.5 transition-colors hover:bg-muted"
          title={
            isMissing
              ? 'Missing SKILL.md — add content to enable'
              : skill.enabled
                ? 'Disable'
                : 'Enable'
          }
          disabled={isMissing}
        >
          {isMissing ? (
            <AlertTriangle className="h-3.5 w-3.5 text-warning/70" />
          ) : skill.enabled ? (
            <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary/20">
              <Check className="h-2.5 w-2.5 text-primary" />
            </div>
          ) : (
            <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
          )}
        </button>

        {/* Icon */}
        <FileCode className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${scopeColor}`} />

        {/* Info + expand */}
        <button onClick={onExpand} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-medium text-foreground">{skill.name}</span>
            {skill.enabled && !isMissing && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {isMissing ? 'Missing SKILL.md — add content to enable' : skill.description}
          </div>
          {/* Mode badges */}
          {skill.modes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {skill.modes.map((m) => (
                <span
                  key={m}
                  className="rounded bg-primary/10 px-1 py-0 text-[9px] font-medium text-primary"
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </button>

        {/* Hover actions — float over content, no layout reserve */}
        <div className="pointer-events-none absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-surface-raised/95 px-1 py-0.5 shadow-sm group-hover:pointer-events-auto group-hover:flex">
          {skill.filePath && (
            <ActionButton onClick={onOpenEditor} title="Open in editor">
              <ExternalLink className="h-3 w-3" />
            </ActionButton>
          )}
          <ActionButton onClick={onContextMenu} title="More actions">
            <MoreHorizontal className="h-3 w-3" />
          </ActionButton>
        </div>
      </div>

      {/* Expanded: per-mode assignment */}
      {isExpanded && (
        <div className="border-t border-border/20 bg-muted/30 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              Active in modes {skill.modes.length === 0 && '(all)'}
            </span>
            {skill.modes.length > 0 && (
              <button
                onClick={() => useSkillsStore.getState().setSkillModes(skill.id, [])}
                className="text-[9px] text-muted-foreground hover:text-foreground"
              >
                Reset to all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_MODES.map(({ value, label }) => {
              const active = skill.modes.length === 0 || skill.modes.includes(value);
              return (
                <button
                  key={value}
                  onClick={() => onModeToggle(value)}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    active
                      ? 'bg-primary/15 text-primary hover:bg-primary/25'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {skill.filePath && (
            <div className="mt-2 truncate text-[9px] text-muted-foreground/60 font-mono">
              {skill.filePath}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── UI Primitives ───────────────────────────────────────────────────────────

function ActionButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            disabled={disabled}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          />
        }
      >
        {children}
      </TooltipTrigger>
      {title && (
        <TooltipContent side="top" sideOffset={4}>
          <span className="text-[10px]">{title}</span>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function ContextMenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof FileCode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-surface-raised'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
