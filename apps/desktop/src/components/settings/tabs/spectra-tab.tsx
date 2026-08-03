import { useSettingsStore } from '../../../stores';
import { SettingRow, SettingSection, SettingTextInput, SettingToggle } from '../controls';

export function SpectraTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="Toolchain">
        <SettingRow label="spectralang Path">
          <SettingTextInput
            value={store.spectraCliPath}
            onChange={(v) => store.set('spectraCliPath', v)}
            placeholder="spectralang"
          />
        </SettingRow>
        <SettingRow label="Lint on Save">
          <SettingToggle
            checked={store.spectraLintOnSave}
            onChange={(v) => store.set('spectraLintOnSave', v)}
          />
        </SettingRow>
        <SettingRow label="Format on Save">
          <SettingToggle
            checked={store.spectraFormatOnSave}
            onChange={(v) => store.set('spectraFormatOnSave', v)}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
