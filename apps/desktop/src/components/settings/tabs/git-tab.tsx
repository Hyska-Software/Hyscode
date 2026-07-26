import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../../../stores';
import { useFileStore } from '../../../stores/file-store';
import { tauriInvoke } from '../../../lib/tauri-invoke';
import {
  listCommitMessageTargets,
  type CommitMessageTarget,
} from '../../../lib/commit-message-provider';
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
  const [aiTargets, setAiTargets] = useState<CommitMessageTarget[]>([]);
  const [aiTargetsError, setAiTargetsError] = useState<string | null>(null);
  const [isLoadingAiTargets, setIsLoadingAiTargets] = useState(true);

  const currentAiValue =
    store.commitAiProviderId && store.commitAiModelId
      ? `${store.commitAiProviderId}::${store.commitAiModelId}`
      : '';
  const selectedAiTarget = aiTargets.find(
    (target) =>
      target.providerId === store.commitAiProviderId && target.modelId === store.commitAiModelId,
  );
  const aiTargetGroups = useMemo(() => {
    const groups = new Map<string, { label: string; targets: CommitMessageTarget[] }>();
    for (const target of aiTargets) {
      const group = groups.get(target.providerId) ?? {
        label: target.providerName,
        targets: [],
      };
      group.targets.push(target);
      groups.set(target.providerId, group);
    }
    return [...groups.values()];
  }, [aiTargets]);

  const loadAiTargets = useCallback(async (): Promise<void> => {
    setIsLoadingAiTargets(true);
    setAiTargetsError(null);
    try {
      setAiTargets(await listCommitMessageTargets(store.enabledModels, store.customModels));
    } catch (error) {
      setAiTargetsError(
        error instanceof Error ? error.message : 'Could not load configured AI models.',
      );
    } finally {
      setIsLoadingAiTargets(false);
    }
  }, [store.customModels, store.enabledModels]);

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

  useEffect(() => {
    void loadAiTargets();
  }, [loadAiTargets]);

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
        <p className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-[10px] leading-relaxed text-warning">
          Remote AI providers receive repository-relative staged file paths and staged patch
          content. Local providers such as Ollama keep this data on your machine.
        </p>
        <SettingRow label="Model">
          {isLoadingAiTargets ? (
            <span className="text-[11px] text-muted-foreground">Loading configured models…</span>
          ) : aiTargetsError ? (
            <button
              type="button"
              onClick={() => void loadAiTargets()}
              className="text-[11px] text-destructive underline-offset-2 hover:underline"
            >
              {aiTargetsError} Retry
            </button>
          ) : aiTargets.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              No configured and enabled models — check the AI tab or local provider.
            </span>
          ) : (
            <SettingSelect
              value={currentAiValue}
              onChange={(v) => handleAiModelChange(v)}
              options={[
                { value: '' as string, label: 'Use active agent model' },
                ...(!selectedAiTarget && currentAiValue
                  ? [{ value: currentAiValue, label: `${currentAiValue} (unavailable)` }]
                  : []),
              ]}
              groups={aiTargetGroups.map((group) => ({
                label: group.label,
                options: group.targets.map((target) => ({
                  value: `${target.providerId}::${target.modelId}` as string,
                  label: target.modelName,
                })),
              }))}
            />
          )}
        </SettingRow>
        {store.commitAiProviderId && (
          <SettingRow label="Selected">
            <span className="text-[11px] text-muted-foreground">
              {selectedAiTarget?.providerName ?? store.commitAiProviderId}
              {' / '}
              <span className={selectedAiTarget ? 'text-foreground' : 'text-destructive'}>
                {selectedAiTarget?.modelName ?? `${store.commitAiModelId} (unavailable)`}
              </span>
            </span>
          </SettingRow>
        )}
      </SettingSection>
    </div>
  );
}
