import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../../stores';
import { useFileStore } from '../../../stores/file-store';
import { tauriInvoke } from '../../../lib/tauri-invoke';
import { getAllEnabledModelsGrouped, PROVIDERS } from '../../../lib/provider-catalog';
import {
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSlider,
  SettingTextInput,
  SettingToggle,
} from '../controls';

export function GitTab() {
  const store = useSettingsStore();
  const rootPath = useFileStore((state) => state.rootPath);
  const [identityScope, setIdentityScope] = useState<'local' | 'global'>(
    rootPath ? 'local' : 'global',
  );
  const [gitUserName, setGitUserName] = useState('');
  const [gitUserEmail, setGitUserEmail] = useState('');
  const [identityStatus, setIdentityStatus] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<string | null>(null);
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

  useEffect(() => {
    if (identityScope === 'local' && !rootPath) {
      setIdentityScope('global');
      return;
    }
    let cancelled = false;
    setIdentityStatus(null);
    void tauriInvoke('git_config_identity', {
      ...(rootPath ? { repoPath: rootPath } : {}),
      scope: identityScope,
    })
      .then((identity) => {
        if (cancelled) return;
        setGitUserName(identity.user_name ?? '');
        setGitUserEmail(identity.user_email ?? '');
      })
      .catch((error: unknown) => {
        if (!cancelled) setIdentityStatus(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [identityScope, rootPath]);

  useEffect(() => {
    void tauriInvoke('github_has_token', {})
      .then(setHasGithubToken)
      .catch((error: unknown) => {
        setCredentialStatus(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const saveIdentity = async (): Promise<void> => {
    setIdentityStatus(null);
    try {
      await tauriInvoke('git_config_set_identity', {
        ...(rootPath ? { repoPath: rootPath } : {}),
        scope: identityScope,
        userName: gitUserName,
        userEmail: gitUserEmail,
      });
      setIdentityStatus(`Saved to ${identityScope} Git configuration`);
    } catch (error) {
      setIdentityStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const saveGithubToken = async (): Promise<void> => {
    if (!githubToken.trim()) return;
    setCredentialStatus(null);
    try {
      await tauriInvoke('github_set_token', { token: githubToken.trim() });
      setGithubToken('');
      setHasGithubToken(true);
      setCredentialStatus('Repository token stored securely');
    } catch (error) {
      setCredentialStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const removeGithubToken = async (): Promise<void> => {
    setCredentialStatus(null);
    try {
      await tauriInvoke('github_remove_token', {});
      setHasGithubToken(false);
      setCredentialStatus('Repository token removed');
    } catch (error) {
      setCredentialStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingSection title="User">
        <SettingRow label="Configuration Scope">
          <SettingSelect
            value={identityScope}
            onChange={setIdentityScope}
            options={[
              ...(rootPath ? [{ value: 'local' as const, label: 'Repository' }] : []),
              { value: 'global' as const, label: 'Global' },
            ]}
          />
        </SettingRow>
        <SettingRow label="User Name">
          <SettingTextInput value={gitUserName} onChange={setGitUserName} placeholder="Your Name" />
        </SettingRow>
        <SettingRow label="User Email">
          <SettingTextInput
            value={gitUserEmail}
            onChange={setGitUserEmail}
            placeholder="you@example.com"
          />
        </SettingRow>
        <div className="flex items-center justify-end gap-2">
          {identityStatus && (
            <span className="mr-auto text-[10px] text-muted-foreground">{identityStatus}</span>
          )}
          <button
            type="button"
            onClick={() => void saveIdentity()}
            disabled={!gitUserName.trim() || !gitUserEmail.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] text-primary-foreground disabled:opacity-40"
          >
            Save Git Identity
          </button>
        </div>
      </SettingSection>

      <SettingSection
        title="GitHub Pull Requests"
        description="A repository-scoped token is stored in the system keychain and is separate from Copilot authentication."
      >
        <SettingRow
          label="Repository Token"
          description={hasGithubToken ? 'Configured' : 'Not configured'}
        >
          <SettingTextInput
            type="password"
            value={githubToken}
            onChange={setGithubToken}
            placeholder={hasGithubToken ? 'Replace token…' : 'github_pat_…'}
          />
        </SettingRow>
        <div className="flex items-center justify-end gap-2">
          {credentialStatus && (
            <span className="mr-auto text-[10px] text-muted-foreground">{credentialStatus}</span>
          )}
          {hasGithubToken && (
            <button
              type="button"
              onClick={() => void removeGithubToken()}
              className="rounded-md px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveGithubToken()}
            disabled={!githubToken.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-[11px] text-primary-foreground disabled:opacity-40"
          >
            {hasGithubToken ? 'Replace Token' : 'Save Token'}
          </button>
        </div>
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
          Model used by the <span className="text-foreground">✦ Generate</span> button in the Git
          panel. Leave empty to use the active agent model.
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
              {PROVIDERS.find((p) => p.id === store.commitAiProviderId)?.name ??
                store.commitAiProviderId}
              {' / '}
              <span className="text-foreground">{store.commitAiModelId}</span>
            </span>
          </SettingRow>
        )}
      </SettingSection>
    </div>
  );
}
