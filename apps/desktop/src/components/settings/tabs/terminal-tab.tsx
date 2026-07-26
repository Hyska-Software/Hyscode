import { useSettingsStore } from '../../../stores';
import type { TerminalCursorStyle } from '../../../stores/settings-store';
import { SettingRow, SettingSection, SettingSelect, SettingSlider, SettingTextInput } from '../controls';

export function TerminalTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="Font">
        <SettingRow label="Font Family">
          <SettingTextInput
            value={store.terminalFontFamily}
            onChange={(v) => store.set('terminalFontFamily', v)}
            placeholder="Geist Mono"
          />
        </SettingRow>
        <SettingRow label="Font Size">
          <SettingSlider
            value={store.terminalFontSize}
            onChange={(v) => store.set('terminalFontSize', v)}
            min={8}
            max={24}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Behavior">
        <SettingRow label="Scrollback Lines">
          <SettingSlider
            value={store.terminalScrollback}
            onChange={(v) => store.set('terminalScrollback', v)}
            min={100}
            max={10000}
            step={100}
          />
        </SettingRow>
        <SettingRow label="Cursor Style">
          <SettingSelect<TerminalCursorStyle>
            value={store.terminalCursorStyle}
            onChange={(v) => store.set('terminalCursorStyle', v)}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
              { value: 'bar', label: 'Bar' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Default Shell">
          <SettingTextInput
            value={store.terminalShell}
            onChange={(v) => store.set('terminalShell', v)}
            placeholder="System default"
          />
        </SettingRow>
      </SettingSection>

      {/* Preview */}
      <SettingSection title="Preview">
        <div
          className="overflow-hidden rounded-lg bg-background p-3"
          style={{
            fontFamily: store.terminalFontFamily || 'Geist Mono',
            fontSize: `${store.terminalFontSize}px`,
          }}
        >
          <div className="text-muted-foreground">
            <span className="text-success">user@machine</span>
            <span className="text-muted-foreground">:</span>
            <span className="text-primary">~/project</span>
            <span className="text-muted-foreground">$ </span>
            <span className="text-foreground">echo "Hello World"</span>
          </div>
          <div className="text-foreground">Hello World</div>
          <div className="text-muted-foreground">
            <span className="text-success">user@machine</span>
            <span className="text-muted-foreground">:</span>
            <span className="text-primary">~/project</span>
            <span className="text-muted-foreground">$ </span>
            <span
              className={`inline-block ${
                store.terminalCursorStyle === 'block'
                  ? 'bg-foreground text-background px-[1px]'
                  : store.terminalCursorStyle === 'underline'
                    ? 'border-b-2 border-foreground'
                    : 'border-l-2 border-foreground'
              }`}
            >
              &nbsp;
            </span>
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
