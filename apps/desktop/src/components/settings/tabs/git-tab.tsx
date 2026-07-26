import { useSettingsStore } from '../../../stores';
import { getAllEnabledModelsGrouped, PROVIDERS } from '../../../lib/provider-catalog';
import { SettingRow, SettingSection, SettingSelect, SettingSlider, SettingTextInput, SettingToggle } from '../controls';

export function GitTab() {
  const store = useSettingsStore();
  const grouped = getAllEnabledModelsGrouped(store.enabledModels, store.customModels);

  const currentAiValue =
    store.commitAiProviderId && store.commitAiModelId
      ? `${store.commitAiProviderId}::${store.commitAiModelId}`
      : '';

  const handleAiModelChange = (value: string) => {
    if (!value) {
      store.set('commitAiProviderId', null);
      store.set('commitAiModelId', null);
      return;
    }
    const sep = value.indexOf('::');
    if (sep === -1) return;
    store.set('commitAiProviderId', value.slice(0, sep));
    store.set('commitAiModelId', value.slice(sep + 2));
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="User">
        <SettingRow label="User Name">
          <SettingTextInput
            value={store.gitUserName}
            onChange={(v) => store.set('gitUserName', v)}
            placeholder="Your Name"
          />
        </SettingRow>
        <SettingRow label="User Email">
          <SettingTextInput
            value={store.gitUserEmail}
            onChange={(v) => store.set('gitUserEmail', v)}
            placeholder="you@example.com"
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Defaults">
        <SettingRow label="Default Branch">
          <SettingTextInput
            value={store.gitDefaultBranch}
            onChange={(v) => store.set('gitDefaultBranch', v)}
            placeholder="main"
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Behavior">
        <SettingRow label="Auto Fetch">
          <SettingToggle
            checked={store.gitAutoFetch}
            onChange={(v) => store.set('gitAutoFetch', v)}
          />
        </SettingRow>
        {store.gitAutoFetch && (
          <SettingRow label="Auto Fetch Interval (min)">
            <SettingSlider
              value={store.gitAutoFetchInterval}
              onChange={(v) => store.set('gitAutoFetchInterval', v)}
              min={1}
              max={60}
            />
          </SettingRow>
        )}
        <SettingRow label="Confirm Before Discard">
          <SettingToggle
            checked={store.gitConfirmDiscard}
            onChange={(v) => store.set('gitConfirmDiscard', v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="AI Commit Message">
        <p className="text-[10px] text-muted-foreground -mt-1 mb-1 leading-relaxed">
          Model used by the <span className="text-foreground">✦ Generate</span> button in the Git panel.
          Leave empty to use the active agent model.
        </p>
        <SettingRow label="Model">
          {grouped.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              No providers configured — add an API key in the AI tab.
            </span>
          ) : (
              <SettingSelect
                value={currentAiValue}
                onChange={(v) => handleAiModelChange(v)}
                options={[{ value: '' as string, label: 'Use active agent model' }]}
                groups={grouped.map(({ provider, models }) => ({
                  label: provider.name,
                  options: models.map((m) => ({
                    value: `${provider.id}::${m.id}` as string,
                    label: m.name,
                  })),
                }))}
              />
          )}
        </SettingRow>
        {store.commitAiProviderId && (
          <SettingRow label="Selected">
            <span className="text-[11px] text-muted-foreground">
              {PROVIDERS.find((p) => p.id === store.commitAiProviderId)?.name ?? store.commitAiProviderId}
              {' / '}
              <span className="text-foreground">{store.commitAiModelId}</span>
            </span>
          </SettingRow>
        )}
      </SettingSection>
    </div>
  );
}
