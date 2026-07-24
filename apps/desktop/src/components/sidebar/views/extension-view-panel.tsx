import { useState, useEffect, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  AlertCircle,
  Search,
  LayoutList,
  RefreshCw,
  Play,
  Trash2,
  Plus,
  Download,
  Filter,
  Eye,
  FolderOpen,
  Star,
  Tag,
  CheckCircle2,
  Circle,
  Bug,
  Lightbulb,
  AlertTriangle,
  Bookmark,
  Hash,
  Folder,
  File,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useExtensionStore } from '../../../stores/extension-store';
import { useViewRegistryStore } from '../../../stores/view-registry-store';
import { useCommandStore } from '../../../stores/command-store';
import type {
  ViewSection,
  ViewItem,
  ViewAction,
  ViewStat,
  ViewWelcome,
} from '@hyscode/extension-api';

// ── Icon mapping ─────────────────────────────────────────────────────────────

const VIEW_ICON_MAP: Record<string, LucideIcon> = {
  'refresh': RefreshCw,
  'play': Play,
  'trash': Trash2,
  'plus': Plus,
  'download': Download,
  'filter': Filter,
  'eye': Eye,
  'folder-open': FolderOpen,
  'folder': Folder,
  'star': Star,
  'tag': Tag,
  'check': CheckCircle2,
  'circle': Circle,
  'bug': Bug,
  'lightbulb': Lightbulb,
  'warning': AlertTriangle,
  'bookmark': Bookmark,
  'hash': Hash,
  'file': File,
  'file-text': FileText,
  'settings': Settings,
  'search': Search,
  'list': LayoutList,
  '$(refresh)': RefreshCw,
  '$(add)': Plus,
  '$(trash)': Trash2,
  '$(play)': Play,
  '$(filter)': Filter,
  '$(export)': Download,
  '$(eye)': Eye,
  '$(folder-opened)': FolderOpen,
  '$(folder)': Folder,
  '$(star-full)': Star,
  '$(star)': Star,
  '$(tag)': Tag,
  '$(check)': CheckCircle2,
  '$(circle-outline)': Circle,
  '$(bug)': Bug,
  '$(lightbulb)': Lightbulb,
  '$(warning)': AlertTriangle,
  '$(bookmark)': Bookmark,
  '$(symbol-number)': Hash,
  '$(file)': File,
  '$(file-text)': FileText,
  '$(settings-gear)': Settings,
  '$(search)': Search,
  '$(list-tree)': LayoutList,
};

function resolveIcon(icon?: string): LucideIcon | null {
  if (!icon) return null;
  return VIEW_ICON_MAP[icon] ?? null;
}

// ── Command execution helper ─────────────────────────────────────────────────

function executeViewCommand(command?: string, args?: unknown[]) {
  if (!command) return;
  const store = useCommandStore.getState();
  store.executeCommand(command, ...(args ?? []));
}

// ── Props ────────────────────────────────────────────────────────────────────

interface ExtensionViewPanelProps {
  viewId: string;
}

// ── Action Button ────────────────────────────────────────────────────────────

function ActionButton({ action, size = 'sm' }: { action: ViewAction; size?: 'sm' | 'md' }) {
  const Icon = resolveIcon(action.icon);
  const isSmall = size === 'sm';

  return (
    <button
      onClick={() => executeViewCommand(action.command, action.commandArgs)}
      className={`rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted ${
        isSmall ? 'p-0.5' : 'flex items-center gap-1.5 px-2 py-1 text-[11px]'
      }`}
      title={action.tooltip || action.label}
    >
      {Icon && <Icon className={isSmall ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
      {!isSmall && <span>{action.label}</span>}
    </button>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function ViewToolbar({ actions }: { actions: ViewAction[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} size="sm" />
      ))}
    </div>
  );
}

// ── Search bar ───────────────────────────────────────────────────────────────

function ViewSearchBar({
  viewId,
  placeholder,
}: {
  viewId: string;
  placeholder?: string;
}) {
  const query = useViewRegistryStore((s) => s.searchQueries[viewId] ?? '');
  const setQuery = useViewRegistryStore((s) => s.setSearchQuery);

  return (
    <div className="relative px-0.5 pb-1.5">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 -mt-[3px]" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(viewId, e.target.value)}
        placeholder={placeholder || 'Filter...'}
        className="w-full rounded bg-muted/50 border border-border/50 py-1 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
      />
    </div>
  );
}

// ── Tree Node (recursive) ────────────────────────────────────────────────────

function ViewTreeNode({ item, depth = 0 }: { item: ViewItem; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const hasChildren = item.children && item.children.length > 0;
  const Icon = resolveIcon(item.icon);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenuOpen]);

  const handleClick = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    } else if (item.command) {
      executeViewCommand(item.command, item.commandArgs);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (item.contextMenu && item.contextMenu.length > 0) {
      e.preventDefault();
      setContextMenuOpen(true);
    }
  };

  // Label styles based on decorations
  const labelClass = [
    'truncate text-[11px]',
    item.decorations?.strikethrough ? 'line-through' : '',
    item.decorations?.faded ? 'opacity-50' : '',
    item.decorations?.italic ? 'italic' : '',
    item.decorations?.bold ? 'font-semibold' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const labelStyle: React.CSSProperties = {};
  if (item.decorations?.color) labelStyle.color = item.decorations.color;
  if (item.iconColor && Icon) {
    // iconColor handled inline below
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left hover:bg-muted/50 transition-colors group"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        title={item.tooltip || item.label}
      >
        {/* Expand/collapse chevron or leaf icon */}
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : Icon ? (
          <Icon className="h-3 w-3 shrink-0" style={item.iconColor ? { color: item.iconColor } : undefined} />
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Label */}
        <span className={labelClass} style={labelStyle}>
          {item.label}
        </span>

        {/* Description */}
        {item.description && (
          <span className="ml-1 truncate text-[10px] text-muted-foreground/60">
            {item.description}
          </span>
        )}

        {/* Badge */}
        {item.badge && (
          <span
            className="ml-auto shrink-0 rounded-full px-1.5 py-0 text-[9px] font-medium leading-[16px]"
            style={{
              backgroundColor: item.badgeColor ? `${item.badgeColor}20` : 'var(--color-muted)',
              color: item.badgeColor || 'var(--color-muted-foreground)',
            }}
          >
            {item.badge}
          </span>
        )}
      </button>

      {/* Context menu */}
      {contextMenuOpen && item.contextMenu && (
        <div
          ref={contextMenuRef}
          className="absolute left-8 top-full z-50 min-w-32 rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {item.contextMenu.map((action) => {
            const MenuIcon = resolveIcon(action.icon);
            return (
              <button
                key={action.id}
                onClick={() => {
                  setContextMenuOpen(false);
                  executeViewCommand(action.command, action.commandArgs);
                }}
                className="flex w-full items-center gap-2 px-3 py-1 text-[11px] text-foreground hover:bg-muted/50 transition-colors"
              >
                {MenuIcon && <MenuIcon className="h-3 w-3 text-muted-foreground" />}
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {item.children!.map((child) => (
            <ViewTreeNode key={child.id} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stats Grid ───────────────────────────────────────────────────────────────

function StatsGrid({ stats }: { stats: ViewStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 p-1">
      {stats.map((stat, i) => {
        const Icon = resolveIcon(stat.icon);
        return (
          <button
            key={i}
            onClick={() => executeViewCommand(stat.command)}
            disabled={!stat.command}
            className={`flex flex-col items-center gap-0.5 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 transition-colors ${
              stat.command ? 'hover:bg-muted/60 cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="flex items-center gap-1">
              {Icon && (
                <Icon
                  className="h-3 w-3"
                  style={stat.color ? { color: stat.color } : undefined}
                />
              )}
              <span
                className="text-sm font-semibold tabular-nums"
                style={stat.color ? { color: stat.color } : undefined}
              >
                {stat.value}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground/70">{stat.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: { value?: number; label?: string } }) {
  const isIndeterminate = progress.value === undefined;
  return (
    <div className="px-2 py-1.5">
      {progress.label && (
        <p className="text-[10px] text-muted-foreground mb-1">{progress.label}</p>
      )}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        {isIndeterminate ? (
          <div className="h-full w-1/3 rounded-full bg-primary animate-[indeterminate_1.5s_ease-in-out_infinite]" />
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress.value ?? 0))}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

function ViewSectionRenderer({ section }: { section: ViewSection }) {
  const [collapsed, setCollapsed] = useState(section.collapsed ?? false);
  const isCollapsible = section.collapsible !== false;

  return (
    <div className="border-b border-border/30 last:border-b-0">
      {/* Section header */}
      <button
        onClick={() => isCollapsible && setCollapsed(!collapsed)}
        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left ${
          isCollapsible ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'
        } transition-colors`}
      >
        {isCollapsible &&
          (collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ))}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {section.title}
        </span>
        {section.badge && (
          <span
            className="ml-auto shrink-0 rounded-full px-1.5 text-[9px] font-medium leading-[16px]"
            style={{
              backgroundColor: section.badgeColor ? `${section.badgeColor}20` : 'var(--color-muted)',
              color: section.badgeColor || 'var(--color-muted-foreground)',
            }}
          >
            {section.badge}
          </span>
        )}
      </button>

      {/* Section content */}
      {!collapsed && (
        <div className="pb-1">
          {section.type === 'stats' && section.stats && (
            <StatsGrid stats={section.stats} />
          )}
          {section.type === 'actions' && section.actions && (
            <div className="flex flex-wrap gap-1 px-2 py-1">
              {section.actions.map((a) => (
                <ActionButton key={a.id} action={a} size="md" />
              ))}
            </div>
          )}
          {section.type === 'progress' && section.progress && (
            <ProgressBar progress={section.progress} />
          )}
          {(section.type === 'tree' || section.type === 'list') &&
            section.items &&
            section.items.map((item) => (
              <ViewTreeNode key={item.id} item={item} depth={0} />
            ))}
        </div>
      )}
    </div>
  );
}

// ── Welcome / Empty State ────────────────────────────────────────────────────

function WelcomeView({ welcome }: { welcome: ViewWelcome }) {
  const Icon = resolveIcon(welcome.icon);
  return (
    <div className="flex flex-col items-center justify-center px-6 py-8 gap-2 text-center">
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/25" />}
      <p className="text-[12px] font-medium text-muted-foreground/80">{welcome.title}</p>
      {welcome.description && (
        <p className="text-[10px] text-muted-foreground/50 max-w-48">{welcome.description}</p>
      )}
      {welcome.actions && welcome.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {welcome.actions.map((a) => (
            <ActionButton key={a.id} action={a} size="md" />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function ViewFooter({ text, command }: { text: string; command?: string }) {
  return (
    <button
      onClick={() => executeViewCommand(command)}
      disabled={!command}
      className={`flex items-center justify-center border-t border-border/30 px-2 py-1.5 text-[10px] text-muted-foreground/60 ${
        command ? 'hover:text-foreground hover:bg-muted/30 cursor-pointer' : 'cursor-default'
      } transition-colors`}
    >
      {text}
    </button>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function ExtensionViewPanel({ viewId }: ExtensionViewPanelProps) {
  const viewDef = useExtensionStore((s) => s.contributions.views.find((v) => v.id === viewId));
  const content = useViewRegistryStore((s) => s.contents[viewId]);
  // Subscribe to version to guarantee re-renders on updates
  const version = useViewRegistryStore((s) => s.version);

  console.log(`[ExtensionViewPanel] render viewId="${viewId}" version=${version} hasContent=${!!content} contentType="${content?.type}"`);

  // Notify extension about visibility
  const notifyVisibility = useViewRegistryStore((s) => s.notifyVisibility);
  useEffect(() => {
    notifyVisibility(viewId, true);
    return () => notifyVisibility(viewId, false);
  }, [viewId, notifyVisibility]);

  if (!viewDef) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <AlertCircle className="h-5 w-5 text-muted-foreground/40" />
        <p className="text-[10px] text-muted-foreground/60">View not found: {viewId}</p>
      </div>
    );
  }

  // No content yet — show loading/placeholder
  if (!content) {
    return (
      <div className="flex h-full flex-col">
        <ViewHeader name={viewDef.name} />
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6">
          <LayoutList className="h-6 w-6 text-muted-foreground/20" />
          <p className="text-[10px] text-muted-foreground/50 text-center">
            Loading {viewDef.name}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with toolbar */}
      <ViewHeader name={viewDef.name} toolbar={content.toolbar} />

      {/* Search bar */}
      {content.searchable && (
        <ViewSearchBar viewId={viewId} placeholder={content.searchPlaceholder} />
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {content.type === 'welcome' && content.welcome && (
          <WelcomeView welcome={content.welcome} />
        )}

        {content.type === 'sections' &&
          content.sections &&
          content.sections.map((section) => (
            <ViewSectionRenderer key={section.id} section={section} />
          ))}

        {(content.type === 'tree' || content.type === 'list') &&
          content.items &&
          content.items.map((item) => (
            <ViewTreeNode key={item.id} item={item} depth={0} />
          ))}
      </div>

      {/* Footer */}
      {content.footer && (
        <ViewFooter text={content.footer.text} command={content.footer.command} />
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function ViewHeader({ name, toolbar }: { name: string; toolbar?: ViewAction[] }) {
  return (
    <div className="flex items-center justify-between pb-1.5 px-0.5">
      <div className="flex items-center gap-1.5">
        <LayoutList className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground">{name}</span>
      </div>
      {toolbar && toolbar.length > 0 && <ViewToolbar actions={toolbar} />}
    </div>
  );
}
