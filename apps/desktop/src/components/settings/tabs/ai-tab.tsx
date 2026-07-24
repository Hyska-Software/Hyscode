import { useState, useEffect } from 'react';
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  X,
  HelpCircle,
  Shield,
  Brain,
  Zap,
  SlidersHorizontal,
  Check,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import type { McpServerConfig } from '@/stores/settings-store';
import { Button } from '@/components/ui/button';
import { tauriInvoke } from '@/lib/tauri-invoke';
import { reinitProvider } from '@/lib/init-providers';
import { McpServerForm } from './mcp-server-form';
import { CopilotAuthRow } from './copilot-auth-row';
import { CopilotBillingInfo } from './copilot-billing-info';
import { ProviderSetupGuide } from './provider-setup-guide';
import {
  PROVIDERS,
  getProviderModels,
  isModelEnabled,
  getEnabledModelsForProvider,
  getAllEnabledModelsGrouped,
} from '@/lib/provider-catalog';
import type { ProviderInfo, ModelInfo } from '@/lib/provider-catalog';
import type { ToolCategory } from '@hyscode/agent-harness';

function getActiveModelInfo(providerId: string | null, modelId: string | null): ModelInfo | null {
  if (!providerId || !modelId) return null;
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function AiTab() {
  const store = useSettingsStore();
  const [showingMcpForm, setShowingMcpForm] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [customModelInput, setCustomModelInput] = useState('');
  const [setupGuide, setSetupGuide] = useState<'claude-agent' | 'github-copilot' | null>(null);

  const enabledForProvider = (providerId: string): ModelInfo[] =>
    getEnabledModelsForProvider(providerId, store.enabledModels, store.customModels);

  const handleToggleModel = (provider: ProviderInfo, modelId: string) => {
    const all = getProviderModels(provider, store.customModels);
    const explicit = store.enabledModels[provider.id];
    if (!explicit) {
      // First toggle: materialize the full list minus this model
      const allIds = all.map((m) => m.id).filter((id) => id !== modelId);
      store.setEnabledModels(provider.id, allIds);
    } else {
      store.toggleModel(provider.id, modelId);
    }
  };

  const handleAddCustomModel = (providerId: string) => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return;
    const name = trimmed.split('/').pop()?.replace(/:.*$/, '') ?? trimmed;
    store.addCustomModel({ providerId, modelId: trimmed, name });
    setCustomModelInput('');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Active Provider & Model ────────────────────────────────── */}
      <Section title="Active Provider & Model">
        {/* Use all providers toggle */}
        <Row
          label="Use all providers"
          description="Show models from every provider in the selector"
        >
          <button
            onClick={() => store.set('useAllProviders', !store.useAllProviders)}
            className="shrink-0"
            aria-pressed={store.useAllProviders}
          >
            {store.useAllProviders ? (
              <ToggleRight className="h-5 w-5 text-primary" />
            ) : (
              <ToggleLeft className="h-5 w-5 text-muted-foreground opacity-50" />
            )}
          </button>
        </Row>

        {/* Single-provider mode */}
        {!store.useAllProviders && (
          <>
            <Row label="Provider">
              <SelectInput
                value={store.activeProviderId ?? ''}
                onChange={(v) => {
                  const enabled = enabledForProvider(v);
                  store.setActiveProvider(v, enabled[0]?.id ?? '');
                }}
                options={PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Row>
            <Row label="Model">
              {store.activeProviderId === 'openrouter' ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={store.activeModelId ?? ''}
                    onChange={(e) => store.set('activeModelId', e.target.value)}
                    placeholder="provider/model-name"
                    className="h-7 w-52 rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
              ) : (
                <SelectInput
                  value={store.activeModelId ?? ''}
                  onChange={(v) => store.set('activeModelId', v)}
                  options={enabledForProvider(store.activeProviderId ?? '').map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                />
              )}
            </Row>
          </>
        )}

        {/* All-providers mode: grouped model selector */}
        {store.useAllProviders && (
          <Row label="Model">
            <select
              value={`${store.activeProviderId ?? ''}::${store.activeModelId ?? ''}`}
              onChange={(e) => {
                const [providerId, modelId] = e.target.value.split('::');
                store.setActiveProvider(providerId, modelId);
              }}
              className="h-7 rounded-md bg-muted px-2 text-[11px] text-foreground outline-none"
            >
              {getAllEnabledModelsGrouped(store.enabledModels, store.customModels).map(
                ({ provider, models }) => (
                  <optgroup key={provider.id} label={provider.name}>
                    {models.map((m) => (
                      <option key={m.id} value={`${provider.id}::${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </Row>
        )}
      </Section>

      {/* ─── Models per Provider ────────────────────────────────────── */}
      <Section title="Models">
        <p className="text-[10px] text-muted-foreground -mt-1 mb-1">
          Enable or disable models for each provider. Enabled models appear in the model selector.
        </p>
        {PROVIDERS.map((provider) => {
          const all = getProviderModels(provider, store.customModels);
          const enabledCount = all.filter((m) =>
            isModelEnabled(store.enabledModels, provider.id, m.id),
          ).length;
          const isExpanded = expandedProvider === provider.id;

          return (
            <div key={provider.id} className="rounded-lg bg-surface-raised overflow-hidden">
              <button
                onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="text-[12px] font-medium text-foreground">{provider.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {enabledCount}/{all.length} models
                </span>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-3 py-2 flex flex-col gap-1">
                  {all.map((model) => {
                    const isCustom = store.customModels.some(
                      (c) => c.providerId === provider.id && c.modelId === model.id,
                    );
                    const enabled = isModelEnabled(store.enabledModels, provider.id, model.id);

                    return (
                      <div key={model.id} className="flex items-center justify-between gap-2 py-1">
                        <div className="min-w-0 flex-1">
                          <span className="text-[11px] text-foreground">{model.name}</span>
                          <span className="ml-1.5 text-[9px] text-muted-foreground">
                            {model.id}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {isCustom && (
                            <button
                              onClick={() => store.removeCustomModel(provider.id, model.id)}
                              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                              title="Remove custom model"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleModel(provider, model.id)}
                            className="shrink-0"
                          >
                            {enabled ? (
                              <ToggleRight className="h-4 w-4 text-primary" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-muted-foreground opacity-50" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Custom model input */}
                  {provider.supportsCustomModels && (
                    <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-2">
                      <input
                        type="text"
                        value={expandedProvider === provider.id ? customModelInput : ''}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddCustomModel(provider.id);
                        }}
                        placeholder={
                          provider.id === 'openrouter'
                            ? 'e.g. z-ai/glm-4.5-air:free'
                            : 'e.g. my-model:latest'
                        }
                        className="h-7 flex-1 rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAddCustomModel(provider.id)}
                        disabled={!customModelInput.trim()}
                        className="h-7 px-2 text-[10px]"
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* ─── API Keys ──────────────────────────────────────────────── */}
      <Section title="API Keys">
        {PROVIDERS.filter((p) => p.needsKey).map((provider) => (
          <ApiKeyRow key={provider.id} providerId={provider.id} providerName={provider.name} />
        ))}

        {/* Claude Agent note — reuses Anthropic key */}
        <div className="rounded-lg bg-surface-raised px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Key className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[12px] text-foreground">Claude Agent</span>
            <span className="text-[10px] text-muted-foreground italic">uses Anthropic key</span>
            <button
              onClick={() => setSetupGuide('claude-agent')}
              className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Setup guide"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* GitHub Copilot OAuth */}
        <div className="rounded-lg bg-surface-raised px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[12px] text-foreground">GitHub Copilot</span>
            <button
              onClick={() => setSetupGuide('github-copilot')}
              className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Setup guide"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
          <CopilotAuthRow />
          <CopilotBillingInfo />
        </div>
      </Section>

      {/* ─── Generation Settings ───────────────────────────────────── */}
      <Section title="Generation">
        <Row
          label="Temperature"
          description="Controls creativity: 0.0 = deterministic, 1.0 = balanced, 2.0 = highly creative. Lower values produce consistent code; higher values produce varied responses."
        >
          <NumberInput
            value={store.temperature}
            onChange={(v) => store.set('temperature', v)}
            min={0}
            max={2}
            step={0.1}
          />
        </Row>
        <Row label="Max Output Tokens">
          <NumberInput
            value={store.maxTokens}
            onChange={(v) => store.set('maxTokens', v)}
            min={256}
            max={32768}
            step={256}
          />
        </Row>
        <Row label="Top P" description="Nucleus sampling (leave empty for default)">
          <NumberInput
            value={store.topP ?? 1}
            onChange={(v) => store.set('topP', v)}
            min={0}
            max={1}
            step={0.05}
          />
        </Row>
        <Row
          label="Limit Interactions"
          description="Off by default. GitHub Copilot retains provider cost caps."
        >
          <Toggle
            checked={store.interactionLimitEnabled}
            onChange={(v) => store.set('interactionLimitEnabled', v)}
          />
        </Row>
        {store.interactionLimitEnabled && (
          <Row label="Max Interactions">
            <NumberInput
              value={store.maxIterations}
              onChange={(v) => store.set('maxIterations', v)}
              min={1}
              max={500}
            />
          </Row>
        )}
        <Row label="Approval Mode" description="Controls when the agent asks before running tools">
          <SelectInput
            value={store.approvalMode}
            onChange={(v) => store.set('approvalMode', v)}
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'smart', label: 'Smart' },
              { value: 'session-trust', label: 'Session Trust' },
              { value: 'notify', label: 'Notify Only' },
              { value: 'yolo', label: 'Auto-approve' },
              { value: 'custom', label: 'Custom Rules' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Advanced resilience">
        <Row
          label="Automatic retries"
          description="Only applies before the provider returns useful content."
        >
          <NumberInput
            value={store.agentMaxRetries}
            onChange={(v) => store.set('agentMaxRetries', v)}
            min={0}
            max={10}
          />
        </Row>
        <Row label="Initial retry delay (ms)">
          <NumberInput
            value={store.agentRetryBaseDelayMs}
            onChange={(v) => store.set('agentRetryBaseDelayMs', v)}
            min={100}
            max={30000}
            step={100}
          />
        </Row>
        <Row label="Maximum retry delay (ms)">
          <NumberInput
            value={store.agentRetryMaxDelayMs}
            onChange={(v) => store.set('agentRetryMaxDelayMs', v)}
            min={1000}
            max={120000}
            step={1000}
          />
        </Row>
        <Row label="Request timeout (ms)">
          <NumberInput
            value={store.agentRequestTimeoutMs}
            onChange={(v) => store.set('agentRequestTimeoutMs', v)}
            min={10000}
            max={600000}
            step={5000}
          />
        </Row>
        <Row label="Stream inactivity timeout (ms)">
          <NumberInput
            value={store.agentStreamIdleTimeoutMs}
            onChange={(v) => store.set('agentStreamIdleTimeoutMs', v)}
            min={10000}
            max={600000}
            step={5000}
          />
        </Row>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              store.set('agentMaxRetries', 3);
              store.set('agentRetryBaseDelayMs', 1000);
              store.set('agentRetryMaxDelayMs', 30000);
              store.set('agentRequestTimeoutMs', 120000);
              store.set('agentStreamIdleTimeoutMs', 90000);
            }}
          >
            Restore defaults
          </Button>
        </div>
      </Section>

      {/* ─── Thinking / Reasoning ─────────────────────────────────── */}
      {(() => {
        const activeModel = getActiveModelInfo(store.activeProviderId, store.activeModelId);
        if (!activeModel?.supportsThinking) return null;
        const thinkingKey = `${store.activeProviderId}::${store.activeModelId}`;
        const thinkingConfig = store.thinkingSettings[thinkingKey] ?? { enabled: false };
        const levels = activeModel.thinkingLevels ?? ['low', 'medium', 'high'];
        return (
          <Section title="Thinking & Reasoning">
            <Row
              label="Enable thinking"
              description="Allow the model to use extended reasoning before responding"
            >
              <Toggle
                checked={thinkingConfig.enabled}
                onChange={(v) =>
                  store.setThinkingConfig(store.activeProviderId!, store.activeModelId!, {
                    enabled: v,
                  })
                }
              />
            </Row>
            {thinkingConfig.enabled && (
              <>
                <Row label="Thinking level" description="Control how deeply the model reasons">
                  <SelectInput
                    value={thinkingConfig.level ?? levels[0]}
                    onChange={(v) =>
                      store.setThinkingConfig(store.activeProviderId!, store.activeModelId!, {
                        level: v as import('@/stores/settings-store').ModelThinkingConfig['level'],
                      })
                    }
                    options={levels.map((lvl) => ({
                      value: lvl,
                      label: lvl.charAt(0).toUpperCase() + lvl.slice(1),
                    }))}
                  />
                </Row>
                {activeModel.thinkingType === 'anthropic' && (
                  <Row
                    label="Budget tokens"
                    description="Max tokens for reasoning (leave empty for default)"
                  >
                    <NumberInput
                      value={thinkingConfig.budgetTokens ?? 0}
                      onChange={(v) =>
                        store.setThinkingConfig(store.activeProviderId!, store.activeModelId!, {
                          budgetTokens: v > 0 ? v : undefined,
                        })
                      }
                      min={0}
                      max={32000}
                      step={1024}
                    />
                  </Row>
                )}
                {activeModel.thinkingType === 'anthropic' && (
                  <Row label="Display mode" description="How thinking content is shown">
                    <SelectInput
                      value={thinkingConfig.display ?? 'summarized'}
                      onChange={(v) =>
                        store.setThinkingConfig(store.activeProviderId!, store.activeModelId!, {
                          display: v as 'summarized' | 'omitted',
                        })
                      }
                      options={[
                        { value: 'summarized', label: 'Summarized' },
                        { value: 'omitted', label: 'Omitted' },
                      ]}
                    />
                  </Row>
                )}
              </>
            )}
          </Section>
        );
      })()}

      {/* ─── Inline Completion ─────────────────────────────────────── */}
      <Section title="Inline Completion">
        <Row
          label="Enable AI autocomplete"
          description="Show ghost-text suggestions powered by AI while typing"
        >
          <Toggle
            checked={store.inlineCompletionEnabled}
            onChange={(v) => store.set('inlineCompletionEnabled', v)}
          />
        </Row>

        {store.inlineCompletionEnabled && (
          <>
            <Row label="Provider" description="Leave on Active to use the provider selected above">
              <SelectInput
                value={store.inlineCompletionProviderId ?? '__active__'}
                onChange={(v) =>
                  store.set('inlineCompletionProviderId', v === '__active__' ? null : v)
                }
                options={[
                  { value: '__active__', label: 'Active provider' },
                  ...PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Row>

            <Row label="Model" description="Leave on Active to use the model selected above">
              {store.inlineCompletionProviderId === 'openrouter' ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={store.inlineCompletionModelId ?? ''}
                    onChange={(e) => store.set('inlineCompletionModelId', e.target.value || null)}
                    placeholder="provider/model-name"
                    className="h-7 w-52 rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
              ) : (
                <SelectInput
                  value={store.inlineCompletionModelId ?? '__active__'}
                  onChange={(v) =>
                    store.set('inlineCompletionModelId', v === '__active__' ? null : v)
                  }
                  options={[
                    { value: '__active__', label: 'Active model' },
                    ...(store.inlineCompletionProviderId
                      ? enabledForProvider(store.inlineCompletionProviderId).map((m) => ({
                          value: m.id,
                          label: m.name,
                        }))
                      : enabledForProvider(store.activeProviderId ?? '').map((m) => ({
                          value: m.id,
                          label: m.name,
                        }))),
                  ]}
                />
              )}
            </Row>

            <Row
              label="Debounce delay"
              description="Milliseconds to wait after typing before requesting a completion"
            >
              <NumberInput
                value={store.inlineCompletionDelay}
                onChange={(v) => store.set('inlineCompletionDelay', v)}
                min={0}
                max={2000}
                step={50}
              />
            </Row>

            <Row
              label="Max completion tokens"
              description="Maximum length of a single completion suggestion"
            >
              <NumberInput
                value={store.inlineCompletionMaxTokens}
                onChange={(v) => store.set('inlineCompletionMaxTokens', v)}
                min={16}
                max={512}
                step={16}
              />
            </Row>

            <Row
              label="Temperature"
              description="Lower = more deterministic completions, higher = more creative"
            >
              <NumberInput
                value={store.inlineCompletionTemperature}
                onChange={(v) => store.set('inlineCompletionTemperature', v)}
                min={0}
                max={1}
                step={0.05}
              />
            </Row>
          </>
        )}
      </Section>

      {/* ─── Custom Approval Rules ─────────────────────────────────── */}
      {store.approvalMode === 'custom' && <CustomApprovalRulesSection />}

      {/* ─── MCP Servers ───────────────────────────────────────────────── */}
      <Section title="MCP Servers">
        {store.mcpServers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2.5"
          >
            <div className="flex flex-col">
              <span className="text-[12px] text-foreground">{server.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {server.transport} · {server.enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Toggle
                checked={server.enabled}
                onChange={(v) => store.updateMcpServer(server.id, { enabled: v })}
              />
              <button
                onClick={() => store.removeMcpServer(server.id)}
                className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
        {showingMcpForm ? (
          <McpServerForm
            onSave={(server: McpServerConfig) => {
              store.addMcpServer(server);
              setShowingMcpForm(false);
            }}
            onCancel={() => setShowingMcpForm(false)}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowingMcpForm(true)}
            className="h-8 gap-1.5 self-start text-[11px]"
          >
            <Plus className="h-3 w-3" />
            Add MCP Server
          </Button>
        )}
      </Section>

      {/* ─── Setup Guide Modal ──────────────────────────────────────── */}
      <ProviderSetupGuide
        guide={setupGuide ?? 'claude-agent'}
        open={setupGuide !== null}
        onClose={() => setSetupGuide(null)}
      />
    </div>
  );
}

// ─── API Key Row ────────────────────────────────────────────────────────────

// ─── Custom Approval Rules ──────────────────────────────────────────────────

const TOOL_CATEGORIES: {
  id: ToolCategory;
  label: string;
  description: string;
  icon: typeof Shield;
}[] = [
  {
    id: 'filesystem',
    label: 'File System',
    description: 'Read & write files, directories',
    icon: Shield,
  },
  { id: 'terminal', label: 'Terminal', description: 'Run shell commands and scripts', icon: Zap },
  { id: 'git', label: 'Git', description: 'Commits, pushes, branch operations', icon: Shield },
  { id: 'code', label: 'Code', description: 'Edit, refactor, create code files', icon: Brain },
  { id: 'browser', label: 'Browser', description: 'Open URLs, web scraping', icon: Shield },
  { id: 'mcp', label: 'MCP', description: 'External MCP server tools', icon: SlidersHorizontal },
  { id: 'meta', label: 'Meta', description: 'Agent orchestration & delegation', icon: Brain },
];

type ToolRuleState = 'auto' | 'ask';

function CustomApprovalRulesSection() {
  const store = useSettingsStore();
  const rules = store.customApprovalRules;
  const [newToolName, setNewToolName] = useState('');
  const [newToolAuto, setNewToolAuto] = useState(false);

  const getCategoryState = (cat: ToolCategory): ToolRuleState => {
    const override = rules.categoryRules[cat];
    if (override === true) return 'auto';
    if (override === false) return 'ask';
    // Default: ask (same as manual for unset categories)
    return 'ask';
  };

  const setCategoryState = (cat: ToolCategory, state: ToolRuleState) => {
    store.setCustomCategoryRule(cat, state === 'auto' ? true : false);
  };

  const handleAddToolRule = () => {
    const trimmed = newToolName.trim();
    if (!trimmed) return;
    store.setCustomToolRule(trimmed, newToolAuto);
    setNewToolName('');
    setNewToolAuto(false);
  };

  const toolOverrides = Object.entries(rules.toolRules);

  return (
    <Section title="Custom Approval Rules">
      <p className="text-[10px] text-muted-foreground -mt-1 mb-1">
        Define approval behavior per tool category. Tool-level overrides take highest priority.
      </p>

      {/* Category toggles */}
      <div className="rounded-lg bg-surface-raised overflow-hidden divide-y divide-border/30">
        {TOOL_CATEGORIES.map(({ id, label, description }) => {
          const state = getCategoryState(id);
          return (
            <div key={id} className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] text-foreground">{label}</span>
                <span className="text-[10px] text-muted-foreground">{description}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted p-0.5">
                <button
                  onClick={() => setCategoryState(id, 'ask')}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    state === 'ask'
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Ask
                </button>
                <button
                  onClick={() => setCategoryState(id, 'auto')}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    state === 'auto'
                      ? 'bg-primary/20 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Auto
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-tool overrides */}
      <div className="mt-3">
        <h4 className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Tool Overrides
        </h4>

        {toolOverrides.length > 0 && (
          <div className="mb-2 rounded-lg bg-surface-raised overflow-hidden divide-y divide-border/30">
            {toolOverrides.map(([toolName, autoApprove]) => (
              <div key={toolName} className="flex items-center justify-between gap-4 px-3 py-2">
                <span className="font-mono text-[11px] text-foreground">{toolName}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`text-[10px] font-medium ${autoApprove ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {autoApprove ? 'Auto' : 'Ask'}
                  </span>
                  <button
                    onClick={() => store.setCustomToolRule(toolName, !autoApprove)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title="Toggle"
                  >
                    {autoApprove ? (
                      <ToggleRight className="h-4 w-4 text-primary" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-muted-foreground opacity-50" />
                    )}
                  </button>
                  <button
                    onClick={() => store.setCustomToolRule(toolName, undefined)}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    title="Remove override"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add new tool override */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newToolName}
            onChange={(e) => setNewToolName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddToolRule();
            }}
            placeholder="e.g. run_terminal_command"
            className="h-7 flex-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => setNewToolAuto((v) => !v)}
            className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-[10px] font-medium transition-colors ${
              newToolAuto ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            }`}
            title="Toggle auto/ask for new rule"
          >
            {newToolAuto ? (
              <>
                <Check className="h-3 w-3" /> Auto
              </>
            ) : (
              'Ask'
            )}
          </button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleAddToolRule}
            disabled={!newToolName.trim()}
            className="h-7 px-2 text-[10px]"
          >
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
      </div>
    </Section>
  );
}

function ApiKeyRow({ providerId, providerName }: { providerId: string; providerName: string }) {
  const [value, setValue] = useState('');
  const [hasExisting, setHasExisting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState(false);

  // Load existing key on mount
  useEffect(() => {
    tauriInvoke('keychain_get', {
      service: 'hyscode',
      account: `${providerId}_api_key`,
    }).then((existing) => {
      if (existing) {
        setValue(existing ?? '');
        setHasExisting(true);
      }
    });
  }, [providerId]);

  const handleSave = async () => {
    if (!value.trim()) return;
    await tauriInvoke('keychain_set', {
      service: 'hyscode',
      account: `${providerId}_api_key`,
      password: value.trim(),
    });
    // Re-initialize this provider so it picks up the new key immediately
    await reinitProvider(providerId).catch(console.error);
    setHasExisting(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[12px] text-foreground">{providerName}</span>
        {hasExisting && !saved && <span className="text-[9px] text-primary">● configured</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHasExisting(false);
            }}
            placeholder="sk-..."
            className="h-7 w-44 rounded-md bg-muted px-2 pr-7 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => setVisible(!visible)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!value.trim()}
          className="h-7 px-2.5 text-[10px]"
        >
          {saved ? 'Saved ✓' : hasExisting ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ── Shared atoms ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        {description && <span className="text-[10px] text-muted-foreground">{description}</span>}
      </div>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-muted primary-primary"
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {step < 1 ? value.toFixed(1) : value}
      </span>
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none"
    >
      {options.length === 0 && <option value="">Select...</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-foreground transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
