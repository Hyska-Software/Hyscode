import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Rule, RuleScope } from '@hyscode/agent-harness';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RuleEntry {
  id: string;
  name: string;
  scope: RuleScope;
  enabled: boolean;
  filePath: string;
  content: string;
}

interface PersistedRulePrefs {
  /** Map of rule id → enabled state */
  enabledMap: Record<string, boolean>;
}

interface RulesState {
  rules: RuleEntry[];
  loading: boolean;

  // Persisted preferences
  enabledMap: Record<string, boolean>;

  // Rule editor dialog (transient)
  ruleEditorOpen: boolean;
  ruleEditorScope: RuleScope;
  ruleEditorExistingId: string | null;

  // ─── Actions ────────────────────────────────────────────────────────

  /** Populate rules from harness discovery. Merges with persisted prefs. */
  setDiscoveredRules: (rules: Rule[]) => void;
  /** Clear discovered workspace rules while a new project is loading. */
  resetProjectState: () => void;

  /** Toggle a rule on/off */
  toggleRule: (id: string) => void;

  /** Set enabled state for a rule */
  setRuleEnabled: (id: string, enabled: boolean) => void;

  /** Add or replace a single rule (e.g. after user creates one). */
  upsertRule: (entry: RuleEntry) => void;

  /** Remove a rule by id */
  removeRule: (id: string) => void;

  setLoading: (loading: boolean) => void;

  /** Get rules that are active (enabled). */
  getActiveRules: () => RuleEntry[];

  /** Open the rule editor dialog. existingId=null for new rule. */
  openRuleEditor: (opts?: { scope?: RuleScope; existingId?: string | null }) => void;
  /** Close the rule editor dialog. */
  closeRuleEditor: () => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useRulesStore = create<RulesState>()(
  persist(
    immer((set, get) => ({
      rules: [],
      loading: false,
      enabledMap: {},
      ruleEditorOpen: false,
      ruleEditorScope: 'global' as RuleScope,
      ruleEditorExistingId: null,

      setDiscoveredRules: (discovered: Rule[]) =>
        set((state) => {
          state.rules = discovered.map((r) => {
            const id = r.id;
            const enabled = id in state.enabledMap ? state.enabledMap[id] : r.enabled;
            return {
              id,
              name: r.name,
              scope: r.scope,
              enabled,
              filePath: r.filePath,
              content: r.content,
            };
          });
          state.loading = false;
        }),

      resetProjectState: () =>
        set((state) => {
          state.rules = [];
          state.loading = false;
          state.ruleEditorOpen = false;
          state.ruleEditorExistingId = null;
        }),

      toggleRule: (id: string) =>
        set((state) => {
          const rule = state.rules.find((r) => r.id === id);
          if (rule) {
            rule.enabled = !rule.enabled;
            state.enabledMap[id] = rule.enabled;
          }
        }),

      setRuleEnabled: (id: string, enabled: boolean) =>
        set((state) => {
          const rule = state.rules.find((r) => r.id === id);
          if (rule) {
            rule.enabled = enabled;
            state.enabledMap[id] = enabled;
          }
        }),

      upsertRule: (entry: RuleEntry) =>
        set((state) => {
          const idx = state.rules.findIndex((r) => r.id === entry.id);
          if (idx >= 0) {
            state.rules[idx] = entry;
          } else {
            state.rules.push(entry);
          }
          state.enabledMap[entry.id] = entry.enabled;
        }),

      removeRule: (id: string) =>
        set((state) => {
          state.rules = state.rules.filter((r) => r.id !== id);
          delete state.enabledMap[id];
        }),

      setLoading: (loading: boolean) =>
        set((state) => {
          state.loading = loading;
        }),

      getActiveRules: (): RuleEntry[] => {
        const state = get();
        return state.rules.filter((r) => r.enabled);
      },

      openRuleEditor: (opts) =>
        set((state) => {
          state.ruleEditorOpen = true;
          state.ruleEditorScope = opts?.scope ?? 'global';
          state.ruleEditorExistingId = opts?.existingId ?? null;
        }),

      closeRuleEditor: () =>
        set((state) => {
          state.ruleEditorOpen = false;
          state.ruleEditorExistingId = null;
        }),
    })),
    {
      name: 'hyscode-rules',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedRulePrefs => ({
        enabledMap: state.enabledMap,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<PersistedRulePrefs> | undefined;
        return {
          ...current,
          enabledMap: { ...(p?.enabledMap ?? {}) },
        };
      },
    },
  ),
);
