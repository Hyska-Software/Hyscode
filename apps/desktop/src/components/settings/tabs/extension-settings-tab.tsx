import { useState } from 'react';
import { ChevronDown, ChevronRight, Blocks, Eye, EyeOff } from 'lucide-react';
import { useExtensionStore } from '../../../stores/extension-store';
import { useSettingsStore } from '../../../stores';
import type { ConfigurationContribution } from '@hyscode/extension-api';
import { SettingInput, SettingSelect, SettingSlider, SettingToggle } from '../controls';
import {
  createSidebarViewDescriptors,
  getVisibleSidebarViewIds,
} from '../../../lib/activity-bar-model';

interface ExtConfigEntry {
  extensionName: string;
  config: ConfigurationContribution;
}

function ConfigSection({ entry }: { entry: ExtConfigEntry }) {
  const [expanded, setExpanded] = useState(true);
  const properties = entry.config.properties;
  const title = entry.config.title || entry.extensionName;
  const keys = Object.keys(properties);

  if (keys.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <Blocks className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[12px] font-medium text-foreground">{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{keys.length} settings</span>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {keys.map((key) => {
            const prop = properties[key];
            return (
              <ConfigProperty key={key} propKey={key} prop={prop} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfigProperty({
  propKey,
  prop,
}: {
  propKey: string;
  prop: {
    type?: string;
    default?: unknown;
    description?: string;
    enum?: string[];
    items?: { type?: string };
    minimum?: number;
    maximum?: number;
  };
}) {
  const settingsStore = useSettingsStore();
  // Extension settings are stored using a generic `set` method
  // Read from store or use default
  const storedValue = (settingsStore as any)[propKey];
  const currentValue = storedValue !== undefined ? storedValue : prop.default;

  const handleChange = (value: unknown) => {
    // Store extension settings using the settings store's generic setter
    try {
      (settingsStore as any).set(propKey, value);
    } catch {
      // Extension settings may not be in the typed store; use extensionSettings
      const extSettings = (globalThis as any).__hyscode_extension_settings ?? {};
      extSettings[propKey] = value;
      (globalThis as any).__hyscode_extension_settings = extSettings;

      // Notify extension API
      const api = (globalThis as any).hyscode;
      if (api?.settings?.onDidChange) {
        api.settings.onDidChange(propKey, value);
      }
    }
  };

  const shortKey = propKey.split('.').pop() || propKey;

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-raised px-3 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-foreground">{shortKey}</span>
          {prop.description && (
            <p className="text-[10px] text-muted-foreground/70 leading-snug mt-0.5">
              {prop.description}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {prop.enum ? (
            <SettingSelect
              value={String(currentValue ?? prop.default ?? '')}
              onChange={(v) => handleChange(v)}
              options={prop.enum.map((v) => ({ value: v, label: v }))}
            />
          ) : prop.type === 'boolean' ? (
            <SettingToggle
              checked={!!(currentValue ?? prop.default)}
              onChange={(v) => handleChange(v)}
            />
          ) : prop.type === 'number' || prop.type === 'integer' ? (
            <div className="flex items-center gap-2">
              <SettingSlider
                value={Number(currentValue ?? prop.default ?? 0)}
                onChange={(v) => handleChange(v)}
                min={prop.minimum ?? 0}
                max={prop.maximum ?? 100}
                step={1}
              />
              <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                {Number(currentValue ?? prop.default ?? 0)}
              </span>
            </div>
          ) : prop.type === 'array' ? (
            <SettingInput
              type="text"
              value={Array.isArray(currentValue) ? currentValue.join(', ') : String(currentValue ?? prop.default ?? '')}
              onChange={(e) => handleChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              placeholder="comma-separated values"
              className="h-7 w-44"
            />
          ) : prop.type === 'object' ? (
            <span className="text-[10px] text-muted-foreground/60 italic">JSON object</span>
          ) : (
            <SettingInput
              type="text"
              value={String(currentValue ?? prop.default ?? '')}
              onChange={(e) => handleChange(e.target.value)}
              className="h-7 w-44"
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground/40">{propKey}</span>
        {prop.default !== undefined && (
          <span className="text-[9px] text-muted-foreground/40">
            default: {JSON.stringify(prop.default)}
          </span>
        )}
      </div>
    </div>
  );
}

function ViewsSection() {
  const extensionViews = useExtensionStore((s) => s.contributions.views);
  const visibleSidebarTabs = useSettingsStore((s) => s.visibleSidebarTabs);
  const visibleExtensionViews = useSettingsStore((s) => s.visibleExtensionViews);
  const sidebarViewOrder = useSettingsStore((s) => s.sidebarViewOrder);
  const setSidebarViewVisible = useSettingsStore((s) => s.setSidebarViewVisible);
  const availableIds = createSidebarViewDescriptors(extensionViews).map((view) => view.id);
  const visibleIds = getVisibleSidebarViewIds(sidebarViewOrder, availableIds, {
    builtin: visibleSidebarTabs,
    extension: visibleExtensionViews,
  });

  if (extensionViews.length === 0) return null;

  // Group views by extension
  const byExtension: Record<string, typeof extensionViews> = {};
  for (const view of extensionViews) {
    if (!byExtension[view.extensionName]) byExtension[view.extensionName] = [];
    byExtension[view.extensionName].push(view);
  }

  const toggleView = (viewId: string, visible: boolean) => {
    setSidebarViewVisible(viewId, visible, availableIds);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-[12px] font-semibold text-foreground">Sidebar Views</h3>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          {extensionViews.length} view{extensionViews.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground/70 -mt-2">
        Toggle visibility of extension-contributed sidebar tabs.
      </p>

      <div className="space-y-2">
        {Object.entries(byExtension).map(([extName, views]) => (
          <div key={extName} className="rounded-lg border border-border bg-background overflow-hidden">
            <div className="px-3 py-1.5 bg-muted/30 border-b border-border">
              <span className="text-[11px] font-medium text-foreground">{extName}</span>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              {views.map((view) => {
                const isVisible = visibleExtensionViews[view.id] !== false;
                const isLastVisible = isVisible && visibleIds.length <= 1;
                return (
                  <div key={view.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isVisible ? (
                        <Eye className="h-3 w-3 text-muted-foreground/60" />
                      ) : (
                        <EyeOff className="h-3 w-3 text-muted-foreground/40" />
                      )}
                      <span className="text-[11px] text-foreground">{view.name}</span>
                      <span className="text-[9px] font-mono text-muted-foreground/40">{view.id}</span>
                    </div>
                    <button
                      onClick={() => toggleView(view.id, !isVisible)}
                      disabled={isLastVisible}
                      className={`relative h-4 w-7 rounded-full transition-colors ${
                        isLastVisible
                          ? 'cursor-not-allowed bg-primary opacity-50'
                          : isVisible
                            ? 'bg-primary'
                            : 'bg-muted'
                      }`}
                      title={
                        isLastVisible
                          ? 'At least one sidebar view must remain visible'
                          : isVisible
                            ? 'Hide from sidebar'
                            : 'Show in sidebar'
                      }
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-foreground transition-transform ${
                          isVisible ? 'translate-x-3' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExtensionSettingsTab() {
  const configurations = useExtensionStore((s) => s.contributions.configurations);
  const extensionViews = useExtensionStore((s) => s.contributions.views);

  const hasContent = configurations.length > 0 || extensionViews.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <Blocks className="h-8 w-8 text-muted-foreground/20" />
        <div className="text-center">
          <p className="text-[12px] text-muted-foreground/60">No extension settings</p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            Installed extensions with configurable settings or sidebar views will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ViewsSection />

      {configurations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Blocks className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[12px] font-semibold text-foreground">Extension Settings</h3>
          </div>
          <p className="text-[10px] text-muted-foreground/70 -mt-3">
            Settings contributed by installed extensions. Changes apply immediately.
          </p>

          <div className="space-y-2">
            {configurations.map((entry) => (
              <ConfigSection key={entry.extensionName} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
