import { useExtensionUiStore } from '../../../stores/extension-ui-store';
import { useExtensionSettingsStore } from '../../../stores/extension-settings-store';
import { useCommandStore } from '../../../stores/command-store';
import type {
  SettingsSection,
  SettingsItem,
  SettingsToggleItem,
  SettingsTextItem,
  SettingsNumberItem,
  SettingsSelectItem,
  SettingsButtonItem,
  SettingsColorItem,
} from '@hyscode/extension-api';

// ── Props ────────────────────────────────────────────────────────────────────

interface ExtensionCustomTabProps {
  tabId: string;
  extensionName: string;
}

// ── Item renderers ───────────────────────────────────────────────────────────

function ToggleItem({ item, extensionName }: { item: SettingsToggleItem; extensionName: string }) {
  const key = `${extensionName}.${item.settingKey}`;
  const value = useExtensionSettingsStore((s) => s.getValue<boolean>(key, item.default ?? false)) ?? false;
  const setValue = useExtensionSettingsStore((s) => s.setValue);

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {item.label && <span className="text-[12px] font-medium text-foreground">{item.label}</span>}
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        onClick={() => setValue(key, !value)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          value ? 'bg-primary' : 'bg-muted'
        }`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function TextItem({ item, extensionName }: { item: SettingsTextItem; extensionName: string }) {
  const key = `${extensionName}.${item.settingKey}`;
  const value = useExtensionSettingsStore((s) => s.getValue<string>(key, item.default ?? '')) ?? '';
  const setValue = useExtensionSettingsStore((s) => s.setValue);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface-raised px-3 py-2.5">
      <div>
        {item.label && <span className="text-[12px] font-medium text-foreground">{item.label}</span>}
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
        )}
      </div>
      {item.multiline ? (
        <textarea
          value={value}
          onChange={(e) => setValue(key, e.target.value)}
          placeholder={item.placeholder}
          rows={3}
          className="w-full resize-none rounded-md bg-muted px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/50"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(key, e.target.value)}
          placeholder={item.placeholder}
          className="w-full rounded-md bg-muted px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/50"
        />
      )}
    </div>
  );
}

function NumberItem({ item, extensionName }: { item: SettingsNumberItem; extensionName: string }) {
  const key = `${extensionName}.${item.settingKey}`;
  const value = useExtensionSettingsStore((s) => s.getValue<number>(key, item.default ?? 0)) ?? 0;
  const setValue = useExtensionSettingsStore((s) => s.setValue);
  const min = item.min ?? 0;
  const max = item.max ?? 100;
  const step = item.step ?? 1;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {item.label && <span className="text-[12px] font-medium text-foreground">{item.label}</span>}
          {item.description && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
          )}
        </div>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setValue(key, Number(e.target.value))}
          className="w-16 rounded-md bg-muted px-2 py-1 text-center text-[12px] text-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setValue(key, Number(e.target.value))}
        className="w-full cursor-pointer primary-primary"
      />
    </div>
  );
}

function SelectItem({ item, extensionName }: { item: SettingsSelectItem; extensionName: string }) {
  const key = `${extensionName}.${item.settingKey}`;
  const value = useExtensionSettingsStore((s) => s.getValue<string>(key, item.default ?? '')) ?? '';
  const setValue = useExtensionSettingsStore((s) => s.setValue);

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {item.label && <span className="text-[12px] font-medium text-foreground">{item.label}</span>}
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => setValue(key, e.target.value)}
        className="h-7 min-w-[120px] rounded-md bg-muted px-2 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-primary/50"
      >
        {item.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ButtonItem({ item }: { item: SettingsButtonItem }) {
  const executeCommand = useCommandStore((s) => s.executeCommand);
  const isDanger = item.variant === 'danger';

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {item.label && <span className="text-[12px] font-medium text-foreground">{item.label}</span>}
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        onClick={() => void executeCommand(item.command, ...(item.commandArgs ?? []))}
        className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
          isDanger
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
            : 'bg-primary/10 text-primary hover:bg-primary/20'
        }`}
      >
        {item.buttonLabel ?? item.label ?? 'Run'}
      </button>
    </div>
  );
}

function ColorItem({ item, extensionName }: { item: SettingsColorItem; extensionName: string }) {
  const key = `${extensionName}.${item.settingKey}`;
  const value = useExtensionSettingsStore((s) => s.getValue<string>(key, item.default ?? '#000000')) ?? '#000000';
  const setValue = useExtensionSettingsStore((s) => s.setValue);

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {item.label && <span className="text-[12px] font-medium text-foreground">{item.label}</span>}
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[11px] text-muted-foreground">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => setValue(key, e.target.value)}
          className="h-7 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}

// ── Item dispatcher ──────────────────────────────────────────────────────────

function RenderItem({ item, extensionName }: { item: SettingsItem; extensionName: string }) {
  switch (item.type) {
    case 'heading':
      return (
        <h3 className="px-1 pt-1 text-[12px] font-semibold text-foreground">
          {item.label}
          {item.description && (
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">{item.description}</span>
          )}
        </h3>
      );

    case 'separator':
      return <hr className="border-border/50" />;

    case 'toggle':
      return <ToggleItem item={item} extensionName={extensionName} />;

    case 'text':
      return <TextItem item={item} extensionName={extensionName} />;

    case 'number':
      return <NumberItem item={item} extensionName={extensionName} />;

    case 'select':
      return <SelectItem item={item} extensionName={extensionName} />;

    case 'button':
      return <ButtonItem item={item} />;

    case 'color':
      return <ColorItem item={item} extensionName={extensionName} />;

    default:
      return null;
  }
}

// ── Section ──────────────────────────────────────────────────────────────────

function RenderSection({ section, extensionName }: { section: SettingsSection; extensionName: string }) {
  return (
    <div className="space-y-2">
      {(section.title || section.description) && (
        <div className="px-1">
          {section.title && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </p>
          )}
          {section.description && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">{section.description}</p>
          )}
        </div>
      )}
      <div className="space-y-2">
        {section.items.map((item) => (
          <RenderItem key={item.id} item={item} extensionName={extensionName} />
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ExtensionCustomTab({ tabId, extensionName }: ExtensionCustomTabProps) {
  const content = useExtensionUiStore((s) => s.settingsTabContents[tabId]);

  if (!content || content.sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <div className="text-center">
          <p className="text-[12px] text-muted-foreground/60">No settings yet</p>
          <p className="text-[10px] text-muted-foreground/40 mt-1">
            This extension hasn't pushed any settings content.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {content.sections.map((section) => (
        <RenderSection key={section.id} section={section} extensionName={extensionName} />
      ))}
    </div>
  );
}
