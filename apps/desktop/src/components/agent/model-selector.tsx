// ─── Chat model selector ─────────────────────────────────────────────────────
// Toolbar dropdown in the agent composer: picks the active AI model and offers
// a real-time search field (matches model name or id, token-wise) with ↑/↓ +
// Enter keyboard navigation over the filtered list.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { getEnabledModelsForProvider, getAllEnabledModelsGrouped } from '@/lib/provider-catalog';
import type { ModelInfo } from '@/lib/provider-catalog';

type FlatEntry = {
  providerId: string;
  model: ModelInfo;
  index: number;
};

const TRIGGER_CLASS =
  'flex h-8 max-w-[180px] cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[11px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';
const SEARCH_PLACEHOLDER = 'Search models…';
const EMPTY_LIST_LABEL = 'No models found';
const CUSTOM_ID_PLACEHOLDER = 'Type model id…';
const CUSTOM_ID_INPUT_CLASS =
  'h-6 w-full rounded bg-muted px-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/50';
const SEARCH_INPUT_CLASS =
  'h-5 min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50';

function matchesQuery(model: ModelInfo, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${model.name} ${model.id}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function ModelSelector() {
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const enabledModels = useSettingsStore((s) => s.enabledModels);
  const customModels = useSettingsStore((s) => s.customModels);
  const useAllProviders = useSettingsStore((s) => s.useAllProviders);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  // Unfiltered catalogs — drive the trigger label and the filtering below.
  const availableModels = useMemo(
    () => getEnabledModelsForProvider(activeProviderId ?? '', enabledModels, customModels),
    [activeProviderId, enabledModels, customModels],
  );
  const groupedModels = useMemo(
    () => getAllEnabledModelsGrouped(enabledModels, customModels),
    [enabledModels, customModels],
  );

  const activeModelLabel = useMemo(() => {
    if (!activeModelId) return 'Select model';
    const inActive = availableModels.find((m) => m.id === activeModelId);
    if (inActive) return inActive.name;
    for (const g of groupedModels) {
      const found = g.models.find((m) => m.id === activeModelId);
      if (found) return found.name;
    }
    return activeModelId.length > 30 ? activeModelId.slice(0, 28) + '…' : activeModelId;
  }, [activeModelId, availableModels, groupedModels]);

  // Filtered views. In grouped mode empty groups are hidden and every kept
  // entry receives a contiguous index into the flat `entries` list; in flat
  // mode entries cover the active provider's models only.
  const { groups, entries } = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (useAllProviders) {
      const flat: FlatEntry[] = [];
      const visible: Array<{
        provider: (typeof groupedModels)[number]['provider'];
        entries: FlatEntry[];
      }> = [];
      for (const { provider, models } of groupedModels) {
        const kept = models.filter((m) => matchesQuery(m, tokens));
        if (kept.length === 0) continue;
        const base = flat.length;
        const groupEntries = kept.map((model, offset) => ({
          providerId: provider.id,
          model,
          index: base + offset,
        }));
        flat.push(...groupEntries);
        visible.push({ provider, entries: groupEntries });
      }
      return { groups: visible, entries: flat };
    }
    const flat = availableModels
      .filter((m) => matchesQuery(m, tokens))
      .map((model, index) => ({ providerId: activeProviderId ?? '', model, index }));
    return { groups: null, entries: flat };
  }, [query, useAllProviders, groupedModels, availableModels, activeProviderId]);

  const safeIdx = entries.length === 0 ? -1 : Math.min(highlightIdx, entries.length - 1);

  const closeMenu = () => {
    setOpen(false);
    setQuery('');
    setHighlightIdx(0);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    closeMenu();
  };

  const select = (providerId: string, modelId: string) => {
    useSettingsStore.getState().setActiveProvider(providerId, modelId);
    closeMenu();
  };

  // Keep focus in the search input: Base UI may move focus to the first menu
  // item when the menu is opened from the keyboard (arrow/enter on the
  // trigger), a few frames after mount. The rAF passes re-claim focus after
  // any such steal.
  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      innerFrame = requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
    };
  }, [open]);

  // Scroll the keyboard-highlighted row into view inside the popup.
  useEffect(() => {
    if (!open || safeIdx < 0) return;
    itemRefs.current[safeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [open, safeIdx]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Never intercept keys that belong to an in-progress IME composition.
    if (e.nativeEvent.isComposing) return;
    // Escape/Tab stay native so Base UI can dismiss the menu / manage focus.
    if (e.key === 'Escape' || e.key === 'Tab') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (entries.length === 0) return;
      const base = safeIdx < 0 ? 0 : safeIdx;
      const next = e.key === 'ArrowDown' ? base + 1 : base - 1;
      setHighlightIdx((next + entries.length) % entries.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const entry = entries[safeIdx];
      if (entry) select(entry.providerId, entry.model.id);
      return;
    }
    // Block Base UI's typeahead and list navigation from hijacking typing.
    e.stopPropagation();
  };

  const renderItem = (entry: FlatEntry) => {
    const { providerId, model, index } = entry;
    const isActive = activeModelId === model.id && activeProviderId === providerId;
    const isHighlighted = index === safeIdx;
    return (
      <DropdownMenuItem
        key={`${providerId}::${model.id}`}
        ref={(el) => {
          itemRefs.current[index] = el;
        }}
        onClick={() => select(providerId, model.id)}
        onMouseMove={() => setHighlightIdx(index)}
        className={cn(
          isActive && 'bg-primary/10 text-primary',
          isHighlighted && 'bg-primary/15 text-primary hover:bg-primary/20',
        )}
      >
        <div className="flex flex-col">
          <span className="text-[11px]">{model.name}</span>
          <span className="text-[9px] text-muted-foreground">{model.id}</span>
        </div>
      </DropdownMenuItem>
    );
  };

  const renderCustomIdInput = (providerId: string) => (
    <div className="px-2 py-1.5">
      <input
        type="text"
        placeholder={CUSTOM_ID_PLACEHOLDER}
        className={CUSTOM_ID_INPUT_CLASS}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const val = (e.target as HTMLInputElement).value.trim();
            if (val) useSettingsStore.getState().setActiveProvider(providerId, val);
          }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} highlightItemOnHover={false}>
      <DropdownMenuTrigger className={TRIGGER_CLASS}>
        <span className="truncate">{activeModelLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="max-h-72 min-w-[200px] overflow-auto p-0">
        {/* Sticky search header */}
        <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border/40 bg-popover px-2 py-1.5">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            placeholder={SEARCH_PLACEHOLDER}
            aria-label={SEARCH_PLACEHOLDER}
            className={SEARCH_INPUT_CLASS}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIdx(0);
            }}
            onKeyDown={handleSearchKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="p-1">
          {entries.length === 0 && (
            <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              {EMPTY_LIST_LABEL}
            </div>
          )}
          {groups ? (
            groups.map(({ provider, entries: groupEntries }, groupIdx) => (
              <div key={provider.id}>
                {groupIdx > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {provider.name}
                  </DropdownMenuLabel>
                  {groupEntries.map(renderItem)}
                  {/* OpenRouter free-text input in its group */}
                  {provider.id === 'openrouter' && renderCustomIdInput('openrouter')}
                </DropdownMenuGroup>
              </div>
            ))
          ) : (
            <>
              {entries.map(renderItem)}
              {activeProviderId === 'openrouter' && (
                <>
                  <div className="my-1 border-t border-border" />
                  {renderCustomIdInput(activeProviderId)}
                </>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
