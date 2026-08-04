import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AgentType, Skill, SkillScope, SkillStatus } from '@hyscode/agent-harness';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  enabled: boolean;
  filePath: string | null;
  content: string;
  /** Which agent modes this skill is assigned to. Empty = all modes (global). */
  modes: AgentType[];
  /** Whether the skill has valid content or is an empty directory stub. */
  status: SkillStatus;
}

interface PersistedSkillPrefs {
  /** Map of skill id → enabled state */
  enabledMap: Record<string, boolean>;
  /** Map of skill id → assigned agent modes (empty = all) */
  modeOverrides: Record<string, AgentType[]>;
}

interface SkillsState {
  skills: SkillEntry[];
  loading: boolean;

  // Persisted preferences (enabledMap + modeOverrides survive reload)
  enabledMap: Record<string, boolean>;
  modeOverrides: Record<string, AgentType[]>;

  // ─── Actions ────────────────────────────────────────────────────────

  /** Populate skills from harness discovery. Merges with persisted prefs. */
  setDiscoveredSkills: (skills: Skill[]) => void;
  /** Clear discovered workspace skills while a new project is loading. */
  resetProjectState: () => void;

  /** Toggle a skill on/off */
  toggleSkill: (id: string) => void;

  /** Set which modes a skill applies to. Empty array = all modes. */
  setSkillModes: (id: string, modes: AgentType[]) => void;

  /** Add a single skill (e.g. after agent creates one). */
  addSkill: (entry: SkillEntry) => void;

  /** Remove a skill by id */
  removeSkill: (id: string) => void;

  setLoading: (loading: boolean) => void;

  /** Get skills that are active for a given agent mode. */
  getActiveForMode: (mode: AgentType) => SkillEntry[];
}

// ─── Default enabled built-in skills ────────────────────────────────────────

const DEFAULT_ENABLED: Record<string, boolean> = {
  'built-in:code-style': true,
  'built-in:testing': true,
  'built-in:security': true,
  'built-in:git-workflow': true,
  'built-in:performance': false,
  'built-in:documentation': false,
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useSkillsStore = create<SkillsState>()(
  persist(
    immer((set, get) => ({
      skills: [],
      loading: false,
      enabledMap: { ...DEFAULT_ENABLED },
      modeOverrides: {},

      setDiscoveredSkills: (discovered: Skill[]) =>
        set((state) => {
          const prefs = { enabledMap: state.enabledMap, modeOverrides: state.modeOverrides };
          state.skills = discovered.map((s) => {
            const id = s.id;
            const isMissing = s.status === 'missing-content';
            // Missing-content skills are always disabled regardless of prefs
            const enabled = isMissing
              ? false
              : id in prefs.enabledMap
                ? prefs.enabledMap[id]
                : s.frontmatter.activation === 'always' || s.active;
            const modes = prefs.modeOverrides[id] ?? [];
            return {
              id,
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              scope: s.frontmatter.scope,
              enabled,
              filePath: s.filePath,
              content: s.content,
              modes,
              status: s.status ?? 'ok',
            };
          });
          state.loading = false;
        }),

      resetProjectState: () =>
        set((state) => {
          state.skills = [];
          state.loading = false;
        }),

      toggleSkill: (id: string) =>
        set((state) => {
          const skill = state.skills.find((s) => s.id === id);
          if (skill && skill.status !== 'missing-content') {
            skill.enabled = !skill.enabled;
            state.enabledMap[id] = skill.enabled;
          }
        }),

      setSkillModes: (id: string, modes: AgentType[]) =>
        set((state) => {
          const skill = state.skills.find((s) => s.id === id);
          if (skill) {
            skill.modes = modes;
            state.modeOverrides[id] = modes;
          }
        }),

      addSkill: (entry: SkillEntry) =>
        set((state) => {
          // Replace if same id exists
          const idx = state.skills.findIndex((s) => s.id === entry.id);
          if (idx >= 0) {
            state.skills[idx] = entry;
          } else {
            state.skills.push(entry);
          }
          state.enabledMap[entry.id] = entry.enabled;
        }),

      removeSkill: (id: string) =>
        set((state) => {
          state.skills = state.skills.filter((s) => s.id !== id);
          delete state.enabledMap[id];
          delete state.modeOverrides[id];
        }),

      setLoading: (loading: boolean) =>
        set((state) => {
          state.loading = loading;
        }),

      getActiveForMode: (mode: AgentType): SkillEntry[] => {
        const state = get();
        return state.skills.filter((s) => {
          if (!s.enabled) return false;
          // If modes is empty → global (all modes)
          if (s.modes.length === 0) return true;
          return s.modes.includes(mode);
        });
      },
    })),
    {
      name: 'hyscode-skills',
      storage: createJSONStorage(() => localStorage),
      // Only persist preferences, not the full skill list (that comes from discovery)
      partialize: (state): PersistedSkillPrefs => ({
        enabledMap: state.enabledMap,
        modeOverrides: state.modeOverrides,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<PersistedSkillPrefs> | undefined;
        return {
          ...current,
          enabledMap: { ...DEFAULT_ENABLED, ...(p?.enabledMap ?? {}) },
          modeOverrides: p?.modeOverrides ?? {},
        };
      },
    },
  ),
);
