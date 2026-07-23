/**
 * Settings sidebar tree
 *
 * Renders the hierarchical group → leaf tree for the settings sidebar.
 *
 * Design aligns with the rest of the app:
 *   - Group headers follow the collapsible section pattern used in the agent sidebar
 *     and file-explorer view (text-[10px] uppercase tracking-wider, no icon).
 *   - Leaf rows reuse the visual language of the original flat settings list:
 *     rounded-lg, px-2.5 py-2, text-[12px], bg-surface-raised when active.
 *   - Right-click context menu uses the same custom floating div pattern as the
 *     file explorer and skills views (not shadcn DropdownMenu).
 *   - All rows are <button> elements for correct focus and interaction semantics.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
} from 'react';
import { ChevronRight, RotateCcw, Copy, Braces } from 'lucide-react';
import {
  flattenVisible,
  highlightSegments,
  isTabModified,
  matchesQuery,
  resetTabToDefaults,
  type BuiltinTabId,
  type GroupId,
  type SettingsGroup,
  type SettingsLeaf,
} from './tree-data';

// ── Props ───────────────────────────────────────────────────────────────────

export interface SettingsTreeProps {
  groups: SettingsGroup[];
  /** Synthetic extensions group, when present. */
  extensionsGroup?: SettingsGroup;
  /** Currently active leaf id. */
  activeLeafId: string;
  /** Expanded group ids. */
  expandedIds: ReadonlySet<GroupId>;
  /** Active search query (already trimmed). Unused now that the search bar is removed. */
  query?: string;
  /** Fired when the user selects a leaf. */
  onSelectLeaf: (leafId: string) => void;
  /** Fired when the user toggles a group's expanded state. */
  onToggleGroup: (groupId: GroupId) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  leaf: SettingsLeaf;
}

// ── Component ───────────────────────────────────────────────────────────────

export function SettingsTree({
  groups,
  extensionsGroup,
  activeLeafId,
  expandedIds,
  query = '',
  onSelectLeaf,
  onToggleGroup,
}: SettingsTreeProps) {
  const allGroups = useMemo(() => {
    if (!extensionsGroup) return groups;
    return [...groups, extensionsGroup];
  }, [groups, extensionsGroup]);

  // Compute the flat list of currently visible nodes for keyboard navigation.
  const flat = useMemo(() => flattenVisible(allGroups, expandedIds, query), [allGroups, expandedIds, query]);

  // Focused id for roving tabindex. Default: active leaf (or first node if no match).
  const [focusedId, setFocusedId] = useState<string>(() => {
    const active = flat.find((n) => n.kind === 'leaf' && n.id === activeLeafId);
    return active?.id ?? flat[0]?.id ?? '';
  });
  useEffect(() => {
    // If the focused id is no longer visible (e.g., search filtered it out), reset to first.
    if (!flat.some((n) => n.id === focusedId)) {
      setFocusedId(flat[0]?.id ?? '');
    }
  }, [flat, focusedId]);

  // Refs for each row, used to programmatically focus on keyboard navigation.
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const setRowRef = useCallback((id: string) => (el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);

  const focusByIndex = useCallback(
    (index: number) => {
      if (flat.length === 0) return;
      const wrapped = (index + flat.length) % flat.length;
      focusRow(flat[wrapped].id as string);
    },
    [flat, focusRow],
  );

  const focusRelative = useCallback(
    (delta: number) => {
      const idx = flat.findIndex((n) => n.id === focusedId);
      if (idx === -1) {
        focusByIndex(0);
        return;
      }
      focusByIndex(idx + delta);
    },
    [flat, focusedId, focusByIndex],
  );

  const focusFirst = useCallback(() => focusByIndex(0), [focusByIndex]);
  const focusLast = useCallback(() => focusByIndex(flat.length - 1), [flat.length, focusByIndex]);

  const focusPage = useCallback(
    (direction: 1 | -1) => {
      // Approximate one viewport ≈ 8 rows.
      focusRelative(direction * 8);
    },
    [focusRelative],
  );

  // Keyboard handling.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const node = flat.find((n) => n.id === focusedId);
      if (!node) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusRelative(1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          focusRelative(-1);
          return;
        case 'Home':
          e.preventDefault();
          focusFirst();
          return;
        case 'End':
          e.preventDefault();
          focusLast();
          return;
        case 'PageDown':
          e.preventDefault();
          focusPage(1);
          return;
        case 'PageUp':
          e.preventDefault();
          focusPage(-1);
          return;
        case 'ArrowRight': {
          e.preventDefault();
          if (node.kind === 'group') {
            if (!expandedIds.has(node.groupId)) onToggleGroup(node.groupId);
            else {
              // Already open → move to first child
              const firstChild = flat[flat.indexOf(node) + 1];
              if (firstChild) focusRow(firstChild.id as string);
            }
          }
          return;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (node.kind === 'group' && expandedIds.has(node.groupId)) {
            onToggleGroup(node.groupId);
          } else {
            // Move to parent group
            const parentGroup = allGroups.find((g) => g.id === node.groupId);
            if (parentGroup) focusRow(parentGroup.id);
          }
          return;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (node.kind === 'group') {
            onToggleGroup(node.groupId);
          } else {
            onSelectLeaf(node.id as string);
          }
          return;
        }
        default:
          return;
      }
    },
    [flat, focusedId, expandedIds, onToggleGroup, onSelectLeaf, allGroups, focusRelative, focusFirst, focusLast, focusPage, focusRow],
  );

  // Right-click context menu.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const handleContextMenu = useCallback((e: MouseEvent, leaf: SettingsLeaf) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, leaf });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    const handleScroll = () => closeContextMenu();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu, closeContextMenu]);

  if (flat.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center" id="settings-tree">
        <div className="text-[12px] text-muted-foreground">No settings match &ldquo;{query}&rdquo;</div>
        <div className="text-[10px] text-muted-foreground/60">Try a shorter query or clear the search.</div>
      </div>
    );
  }

  return (
    <>
      <div
        id="settings-tree"
        role="tree"
        aria-label="Settings categories"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto px-1 py-1 outline-none"
      >
        {allGroups
          .filter((g) => flat.some((n) => n.kind === 'group' && n.id === g.id))
          .map((group) => {
            const trimmed = query.trim();
            const isOpen = trimmed.length > 0 || expandedIds.has(group.id);
            const visibleLeaves = trimmed
              ? group.leaves.filter((l) => matchesQuery([l.label, ...(l.keywords ?? [])].join(' '), trimmed))
              : group.leaves;
            return (
              <TreeGroupRow
                key={group.id}
                group={group}
                visibleLeaves={visibleLeaves}
                isOpen={isOpen}
                isFocused={focusedId === group.id}
                hasActiveDescendant={flat.some(
                  (n) => n.kind === 'leaf' && n.groupId === group.id && n.id === activeLeafId,
                )}
                activeLeafId={activeLeafId}
                query={query}
                rowRefs={rowRefs}
                setRowRef={setRowRef}
                onToggleGroup={onToggleGroup}
                onSelectLeaf={onSelectLeaf}
                onContextMenu={handleContextMenu}
                focusedId={focusedId}
                setFocusedId={setFocusedId}
              />
            );
          })}
      </div>

      {contextMenu && (
        <SettingsContextMenu
          ref={menuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          leaf={contextMenu.leaf}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
}

// ── Group row ───────────────────────────────────────────────────────────────

interface TreeGroupRowProps {
  group: SettingsGroup;
  visibleLeaves: SettingsLeaf[];
  isOpen: boolean;
  isFocused: boolean;
  hasActiveDescendant: boolean;
  activeLeafId: string;
  query: string;
  rowRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  setRowRef: (id: string) => (el: HTMLButtonElement | null) => void;
  onToggleGroup: (groupId: GroupId) => void;
  onSelectLeaf: (leafId: string) => void;
  onContextMenu: (e: MouseEvent, leaf: SettingsLeaf) => void;
  focusedId: string;
  setFocusedId: (id: string) => void;
}

function TreeGroupRow({
  group,
  visibleLeaves,
  isOpen,
  isFocused,
  hasActiveDescendant,
  activeLeafId,
  query,
  setRowRef,
  onToggleGroup,
  onSelectLeaf,
  onContextMenu,
  focusedId,
  setFocusedId,
}: TreeGroupRowProps) {
  return (
    <>
      <button
        ref={setRowRef(group.id)}
        role="treeitem"
        aria-level={1}
        aria-expanded={isOpen}
        aria-selected={false}
        tabIndex={isFocused ? 0 : -1}
        data-node-id={group.id}
        type="button"
        onClick={() => onToggleGroup(group.id)}
        onFocus={() => setFocusedId(group.id)}
        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 ${
          hasActiveDescendant
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        } hover:bg-muted/50`}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
            isOpen ? 'rotate-90' : ''
          }`}
          aria-hidden
        />
        <span className="text-[10px] font-medium uppercase tracking-wider">
          <HighlightedText text={group.label} query={query} />
        </span>
      </button>
      {isOpen &&
        visibleLeaves.map((leaf) => (
          <TreeLeafRow
            key={leaf.id}
            leaf={leaf}
            isActive={leaf.id === activeLeafId}
            isFocused={focusedId === leaf.id}
            query={query}
            setRowRef={setRowRef}
            onSelectLeaf={onSelectLeaf}
            onContextMenu={onContextMenu}
            setFocusedId={setFocusedId}
          />
        ))}
    </>
  );
}

// ── Leaf row ────────────────────────────────────────────────────────────────

interface TreeLeafRowProps {
  leaf: SettingsLeaf;
  isActive: boolean;
  isFocused: boolean;
  query: string;
  setRowRef: (id: string) => (el: HTMLButtonElement | null) => void;
  onSelectLeaf: (leafId: string) => void;
  onContextMenu: (e: MouseEvent, leaf: SettingsLeaf) => void;
  setFocusedId: (id: string) => void;
}

function TreeLeafRow({
  leaf,
  isActive,
  isFocused,
  query,
  setRowRef,
  onSelectLeaf,
  onContextMenu,
  setFocusedId,
}: TreeLeafRowProps) {
  return (
    <button
      ref={setRowRef(leaf.id)}
      role="treeitem"
      aria-level={2}
      aria-selected={isActive}
      tabIndex={isFocused ? 0 : -1}
      data-node-id={leaf.id}
      type="button"
      onClick={() => onSelectLeaf(leaf.id)}
      onContextMenu={(e) => onContextMenu(e, leaf)}
      onFocus={() => setFocusedId(leaf.id)}
      className={`ml-3 flex w-[calc(100%-0.75rem)] cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 ${
        isActive
          ? 'bg-surface-raised text-foreground'
          : 'text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground'
      }`}
    >
      <leaf.icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">
        <HighlightedText text={leaf.label} query={query} />
      </span>
    </button>
  );
}

// ── Custom context menu ─────────────────────────────────────────────────────

const SettingsContextMenu = forwardRef<HTMLDivElement, {
  x: number;
  y: number;
  leaf: SettingsLeaf;
  onClose: () => void;
}>(({ x, y, leaf, onClose }, ref) => {
  const canReset = isBuiltinLeaf(leaf.id) && isTabModified(leaf.id as BuiltinTabId);
  const settingId = leaf.id;

  const handleReset = () => {
    if (isBuiltinLeaf(leaf.id)) resetTabToDefaults(leaf.id as BuiltinTabId);
    onClose();
  };

  const handleCopyId = () => {
    void copyToClipboard(settingId);
    onClose();
  };

  const handleCopyJson = () => {
    void copyToClipboard(JSON.stringify({ id: settingId, label: leaf.label }, null, 2));
    onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-surface p-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      <ContextMenuItem
        icon={RotateCcw}
        label="Reset to Default"
        disabled={!canReset}
        onClick={handleReset}
      />
      <ContextMenuSeparator />
      <ContextMenuItem icon={Copy} label="Copy Setting ID" onClick={handleCopyId} />
      <ContextMenuItem icon={Braces} label="Copy as JSON" onClick={handleCopyJson} />
    </div>
  );
});

function ContextMenuItem({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof RotateCcw;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
        disabled
          ? 'pointer-events-none text-muted-foreground/50'
          : 'text-foreground hover:bg-surface-raised'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

// ── Highlighted text ────────────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => highlightSegments(text, query), [text, query]);
  if (segments.length === 1 && !segments[0].match) return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="rounded-sm bg-warning/30 px-0.5 text-foreground"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isBuiltinLeaf(id: string): id is BuiltinTabId {
  return (
    id === 'editor' ||
    id === 'theme' ||
    id === 'terminal' ||
    id === 'git' ||
    id === 'general' ||
    id === 'ai' ||
    id === 'languages' ||
    id === 'mobile' ||
    id === 'docker' ||
    id === 'extensions' ||
    id === 'rules' ||
    id === 'sub-agents' ||
    id === 'about'
  );
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to legacy path
  }
  // Fallback for non-secure contexts.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

