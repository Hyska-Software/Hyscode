import {
  Send,
  Square,
  ChevronDown,
  Settings,
  MessageSquare,
  Hammer,
  Search,
  Bug,
  ClipboardList,
  Shield,
  Zap,
  SlidersHorizontal,
  Check,
  ArrowRight,
  Plus,
  Brain,
  Bell,
  ShieldCheck,
  Paperclip,
  X,
  ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import { useState, useRef, useMemo, useCallback } from 'react';
import { ContextMentionPicker } from './context-mention-picker';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import type { AgentMode, AttachedImage } from '@/stores/agent-store';
import type { ApprovalMode } from '@/stores/settings-store';
import {
  PROVIDERS,
  getEnabledModelsForProvider,
  getAllEnabledModelsGrouped,
} from '@/lib/provider-catalog';
import type { ModelInfo } from '@/lib/provider-catalog';
import { getProviderRegistry } from '@hyscode/ai-providers';
import type { AIModel } from '@hyscode/ai-providers';

// ─── Vision helpers ─────────────────────────────────────────────────────────

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

function useActiveModel(): AIModel | null {
  const providerId = useSettingsStore((s) => s.activeProviderId);
  const modelId = useSettingsStore((s) => s.activeModelId);
  if (!providerId || !modelId) return null;
  const provider = getProviderRegistry().get(providerId);
  return provider?.models.find((m) => m.id === modelId) ?? null;
}

function useActiveModelInfo(): ModelInfo | null {
  const providerId = useSettingsStore((s) => s.activeProviderId);
  const modelId = useSettingsStore((s) => s.activeModelId);
  if (!providerId || !modelId) return null;
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

function processImageFile(file: File): Promise<AttachedImage | null> {
  return new Promise((resolve) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      resolve(null);
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx < 0) {
        resolve(null);
        return;
      }
      const base64 = dataUrl.slice(commaIdx + 1);
      const previewUrl = URL.createObjectURL(file);
      resolve({
        id: crypto.randomUUID(),
        name: file.name || 'image',
        base64,
        mediaType: file.type,
        previewUrl,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ─── Agent capability map ───────────────────────────────────────────────────

interface AgentCapability {
  icon: typeof MessageSquare;
  label: string;
  description: string;
  badge: string;
  color: string;
  placeholder: string;
}

const AGENT_CAPABILITIES: Record<AgentMode, AgentCapability> = {
  chat: {
    icon: MessageSquare,
    label: 'Chat',
    description: 'General-purpose assistant for questions and explanations.',
    badge: 'read-only',
    color: 'text-blue-400',
    placeholder: 'Ask anything...',
  },
  build: {
    icon: Hammer,
    label: 'Build',
    description: 'Implements features, writes code, creates files, runs commands.',
    badge: 'full access',
    color: 'text-accent',
    placeholder: 'Describe what to build...',
  },
  review: {
    icon: Search,
    label: 'Review',
    description: 'Reviews code for bugs, security, performance, best practices.',
    badge: 'read-only',
    color: 'text-purple-400',
    placeholder: 'What should I review?',
  },
  debug: {
    icon: Bug,
    label: 'Debug',
    description: 'Diagnoses and fixes bugs, errors, and unexpected behavior.',
    badge: 'full access',
    color: 'text-red-400',
    placeholder: 'Describe the bug or error...',
  },
  plan: {
    icon: ClipboardList,
    label: 'Plan',
    description: 'Plans architecture, writes specs, designs systems.',
    badge: 'writes docs',
    color: 'text-amber-400',
    placeholder: 'Describe what to plan or design...',
  },
};

const AGENT_MODES: AgentMode[] = ['chat', 'build', 'review', 'debug', 'plan'];

// ─── Approval mode config ────────────────────────────────────────────────────

interface ApprovalConfig {
  icon: typeof Shield;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  badge?: string;
}

const APPROVAL_CONFIG: Record<ApprovalMode, ApprovalConfig> = {
  manual: {
    icon: Shield,
    label: 'Manual',
    shortLabel: 'Manual',
    description: 'Review and approve every tool call before execution.',
    color: 'text-blue-400',
    badge: 'safest',
  },
  smart: {
    icon: Brain,
    label: 'Smart',
    shortLabel: 'Smart',
    description: 'Auto-approve read-only tools, ask for destructive actions.',
    color: 'text-cyan-400',
    badge: 'recommended',
  },
  'session-trust': {
    icon: ShieldCheck,
    label: 'Session Trust',
    shortLabel: 'Trust',
    description: 'Approve once per tool type, then auto-approve for the session.',
    color: 'text-emerald-400',
  },
  notify: {
    icon: Bell,
    label: 'Notify Only',
    shortLabel: 'Notify',
    description: 'Auto-approve all but show a notification for each action.',
    color: 'text-violet-400',
  },
  yolo: {
    icon: Zap,
    label: 'Auto-approve',
    shortLabel: 'Auto',
    description: 'Automatically approve all tool calls without review.',
    color: 'text-amber-400',
    badge: 'fastest',
  },
  custom: {
    icon: SlidersHorizontal,
    label: 'Custom rules',
    shortLabel: 'Custom',
    description: 'Use custom approval rules defined in settings.',
    color: 'text-purple-400',
  },
};

const APPROVAL_MODES: ApprovalMode[] = [
  'manual',
  'smart',
  'session-trust',
  'notify',
  'yolo',
  'custom',
];

// ─── Provider & model catalog (mirrors ai-tab.tsx) ──────────────────────────
// (Moved to @/lib/provider-catalog — imported above)

export function AgentInput() {
  const [input, setInput] = useState('');
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mode = useAgentStore((s) => s.mode);
  const setMode = useAgentStore((s) => s.setMode);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const delegationChain = useAgentStore((s) => s.delegationChain);
  const attachedImages = useAgentStore((s) => s.attachedImages);
  const activeModelId = useSettingsStore((s) => s.activeModelId);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const enabledModels = useSettingsStore((s) => s.enabledModels);
  const customModels = useSettingsStore((s) => s.customModels);
  const useAllProviders = useSettingsStore((s) => s.useAllProviders);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const approvalMode = useSettingsStore((s) => s.approvalMode);

  const activeModel = useActiveModel();
  const activeModelInfo = useActiveModelInfo();
  const showVisionWarning =
    attachedImages.length > 0 && activeModel != null && !activeModel.supportsVision;

  const thinkingKey = `${activeProviderId ?? ''}::${activeModelId ?? ''}`;
  const thinkingSettings = useSettingsStore((s) => s.thinkingSettings);
  const setThinkingConfig = useSettingsStore((s) => s.setThinkingConfig);
  const currentThinking = thinkingSettings[thinkingKey] ?? { enabled: false };

  const currentCap = AGENT_CAPABILITIES[mode];

  // Single-provider mode: enabled models for the active provider
  const availableModels = useMemo(
    () => getEnabledModelsForProvider(activeProviderId ?? '', enabledModels, customModels),
    [activeProviderId, enabledModels, customModels],
  );

  // All-providers mode: all enabled models grouped by provider
  const groupedModels = useMemo(
    () => getAllEnabledModelsGrouped(enabledModels, customModels),
    [enabledModels, customModels],
  );

  const activeModelLabel = useMemo(() => {
    if (!activeModelId) return 'Select model';
    const inActive = availableModels.find((m) => m.id === activeModelId);
    if (inActive) return inActive.name;
    for (const g of groupedModels) {
      const found = g.models.find((m) => m.id === activeModelId);
      if (found) return found.name;
    }
    return activeModelId.length > 30 ? activeModelId.slice(0, 28) + '…' : activeModelId;
  }, [activeModelId, availableModels, groupedModels]);

  const handleModelChange = (modelId: string) => {
    useSettingsStore
      .getState()
      .setActiveProvider(useSettingsStore.getState().activeProviderId ?? '', modelId);
  };

  const handleModelChangeWithProvider = (providerId: string, modelId: string) => {
    useSettingsStore.getState().setActiveProvider(providerId, modelId);
  };

  const handleSend = () => {
    const hasImages = useAgentStore.getState().attachedImages.length > 0;
    if ((!input.trim() && !hasImages) || isStreaming) return;
    try {
      HarnessBridge.get().sendMessage(input.trim() || '(image attached)');
    } catch {
      // Bridge not initialized yet
    }
    setInput('');
  };

  const handleStop = () => {
    try {
      HarnessBridge.get().cancel();
    } catch {
      // ignore
    }
  };

  const handleModeChange = (newMode: AgentMode) => {
    try {
      HarnessBridge.get().setAgentType(newMode);
    } catch {
      setMode(newMode);
    }
  };

  const handleApprovalChange = (mode: ApprovalMode) => {
    useSettingsStore.getState().set('approvalMode', mode);
  };

  const handleMentionSelect = useCallback((path: string) => {
    // Special tokens are not file paths
    if (path.startsWith('__') && path.endsWith('__')) return;
    useAgentStore.getState().addContextFile(path);
    // Remove the trailing '@' from input if present
    setInput((prev) => {
      const trimmed = prev.replace(/@\s*$/, '');
      return trimmed;
    });
    setMentionPickerOpen(false);
    textareaRef.current?.focus();
  }, []);

  // ─── Image attachment handlers ─────────────────────────────────────

  const addImagesFromFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const img = await processImageFile(file);
      if (img) useAgentStore.getState().addAttachedImage(img);
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addImagesFromFiles(e.target.files);
        e.target.value = ''; // reset so same file can be re-selected
      }
    },
    [addImagesFromFiles],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImagesFromFiles(imageFiles);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.types).includes('Files');
    if (hasImages) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if actually leaving the wrapper (not entering a child)
    if (inputWrapperRef.current && !inputWrapperRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files?.length) {
        addImagesFromFiles(e.dataTransfer.files);
      }
    },
    [addImagesFromFiles],
  );

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      {/* Hidden file input for image picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Vision warning */}
      {showVisionWarning && (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>{activeModel.name} does not support vision. Images will be ignored.</span>
        </div>
      )}

      {/* ── Minimal input frame ── */}
      <div
        ref={inputWrapperRef}
        className={cn(
          'group/input relative flex flex-col overflow-hidden rounded-xl transition-all',
          'bg-foreground/[0.025]',
          'border border-foreground/[0.06]',
          'focus-within:border-foreground/[0.1]',
          isDragOver && 'border-accent/40',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag-to-drop overlay */}
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent/5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
              <ImageIcon className="h-4 w-4" />
              Drop images here
            </div>
          </div>
        )}

        {/* Image preview strip */}
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachedImages.map((img) => (
              <div
                key={img.id}
                className="group/img relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted/50"
                title={img.name}
              >
                <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                <button
                  onClick={() => useAgentStore.getState().removeAttachedImage(img.id)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/img:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className="relative px-3 pt-2">
          <ContextMentionPicker
            open={mentionPickerOpen}
            onClose={() => setMentionPickerOpen(false)}
            onSelect={handleMentionSelect}
          />
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              // Detect '@' typed at the end or after a space
              if (
                val.endsWith('@') &&
                (val.length === 1 || val[val.length - 2] === ' ' || val[val.length - 2] === '\n')
              ) {
                setMentionPickerOpen(true);
              }
            }}
            onPaste={handlePaste}
            placeholder={`${currentCap.placeholder} (Enter para enviar, Shift+Enter para nova linha)`}
            className="max-h-40 min-h-[52px] w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[13px] leading-[1.6] text-foreground/90 placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
            onKeyDown={(e) => {
              if (
                mentionPickerOpen &&
                (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp')
              ) {
                // Let the picker handle these keys
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                if (mentionPickerOpen) {
                  // Don't send when picker is open
                  return;
                }
                e.preventDefault();
                handleSend();
              }
            }}
          />
        </div>

        {/* Bottom toolbar: selectors left, actions right */}
        <div className="flex items-center justify-between gap-1.5 px-2 pb-1.5 pt-1">
          {/* Agent mode + model + approval selectors */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {/* Agent mode dropdown (icon-only) */}
            {(() => {
              const cap = AGENT_CAPABILITIES[mode];
              const ModeIcon = cap.icon;
              return (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DropdownMenuTrigger
                          className={cn(
                            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-foreground/[0.07] bg-transparent transition-all focus:outline-none',
                            'hover:border-foreground/[0.14] hover:bg-foreground/[0.03]',
                            cap.color,
                          )}
                        />
                      }
                    >
                      <ModeIcon className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Agent mode: {cap.label}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent side="top" className="min-w-[200px]">
                    <div className="px-2 pb-1 pt-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      Agent Mode
                    </div>
                    <DropdownMenuSeparator />
                    {AGENT_MODES.map((m) => {
                      const c = AGENT_CAPABILITIES[m];
                      const Icon = c.icon;
                      const isActive = mode === m;
                      return (
                        <DropdownMenuItem
                          key={m}
                          onClick={() => handleModeChange(m)}
                          className={cn(isActive && 'bg-accent/10')}
                        >
                          <div className="flex w-full items-center gap-2">
                            <Icon className={cn('h-3.5 w-3.5 shrink-0', c.color)} />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="text-[11px] font-medium">{c.label}</span>
                              <span className="text-[9px] leading-tight text-muted-foreground">
                                {c.description}
                              </span>
                            </div>
                            <span className={cn('shrink-0 text-[9px] font-medium', c.color)}>
                              {c.badge}
                            </span>
                            {isActive && <Check className="h-3 w-3 shrink-0 text-accent" />}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}

            {/* Delegation chain badge */}
            {delegationChain.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-cyan-400">
                <ArrowRight className="h-2.5 w-2.5" />
                delegated
              </span>
            )}

            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex h-8 max-w-[180px] cursor-pointer items-center gap-1 rounded-lg border border-foreground/[0.07] bg-transparent px-2.5 text-[11px] text-foreground/75 transition-colors hover:border-foreground/[0.14] hover:bg-foreground/[0.03] hover:text-foreground focus:outline-none">
                <span className="truncate">{activeModelLabel}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="max-h-72 min-w-[200px] overflow-auto">
                {useAllProviders ? (
                  /* Grouped: all providers */
                  groupedModels.map(({ provider, models }, idx) => (
                    <div key={provider.id}>
                      {idx > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                          {provider.name}
                        </DropdownMenuLabel>
                        {models.map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            onClick={() => handleModelChangeWithProvider(provider.id, m.id)}
                            className={cn(
                              activeModelId === m.id &&
                                activeProviderId === provider.id &&
                                'bg-accent/10 text-accent',
                            )}
                          >
                            <div className="flex flex-col">
                              <span className="text-[11px]">{m.name}</span>
                              <span className="text-[9px] text-muted-foreground">{m.id}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        {/* OpenRouter free-text input in its group */}
                        {provider.id === 'openrouter' && (
                          <div className="px-2 py-1.5">
                            <input
                              type="text"
                              placeholder="Type model id…"
                              className="h-6 w-full rounded bg-muted px-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/50"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const val = (e.target as HTMLInputElement).value.trim();
                                  if (val) handleModelChangeWithProvider('openrouter', val);
                                }
                                e.stopPropagation();
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        )}
                      </DropdownMenuGroup>
                    </div>
                  ))
                ) : (
                  /* Flat: active provider only */
                  <>
                    {availableModels.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => handleModelChange(m.id)}
                        className={cn(activeModelId === m.id && 'bg-accent/10 text-accent')}
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px]">{m.name}</span>
                          <span className="text-[9px] text-muted-foreground">{m.id}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    {activeProviderId === 'openrouter' && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <div className="px-2 py-1.5">
                          <input
                            type="text"
                            placeholder="Type model id…"
                            className="h-6 w-full rounded bg-muted px-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/50"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value.trim();
                                if (val) handleModelChange(val);
                              }
                              e.stopPropagation();
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Thinking control (icon-only) */}
            {activeModelInfo?.supportsThinking && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        className={cn(
                          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-all focus:outline-none',
                          currentThinking.enabled
                            ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/[0.1]'
                            : 'border-foreground/[0.07] text-foreground/60 hover:border-foreground/[0.14] hover:bg-foreground/[0.03] hover:text-foreground',
                        )}
                      />
                    }
                  >
                    <Brain className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Thinking: {currentThinking.enabled ? currentThinking.level ?? 'default' : 'off'}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="top" className="min-w-[180px]">
                  <div className="px-2 pb-1 pt-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    Thinking Mode
                  </div>
                  <DropdownMenuSeparator />
                  {/* Toggle on/off */}
                  <DropdownMenuItem
                    onClick={() => {
                      if (!activeProviderId || !activeModelId) return;
                      setThinkingConfig(activeProviderId, activeModelId, {
                        enabled: !currentThinking.enabled,
                      });
                    }}
                    className={cn(!currentThinking.enabled && 'bg-accent/10')}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-[11px]">
                        {currentThinking.enabled ? 'Disable thinking' : 'Enable thinking'}
                      </span>
                      {!currentThinking.enabled && (
                        <Check className="h-3 w-3 shrink-0 text-accent" />
                      )}
                    </div>
                  </DropdownMenuItem>
                  {/* Level selector (only when enabled) */}
                  {currentThinking.enabled && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="px-2 pb-1 pt-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Level
                      </div>
                      {(activeModelInfo.thinkingLevels ?? ['low', 'medium', 'high']).map((lvl) => (
                        <DropdownMenuItem
                          key={lvl}
                          onClick={() => {
                            if (!activeProviderId || !activeModelId) return;
                            setThinkingConfig(activeProviderId, activeModelId, {
                              enabled: true,
                              level:
                                lvl as import('@/stores/settings-store').ModelThinkingConfig['level'],
                            });
                          }}
                          className={cn(currentThinking.level === lvl && 'bg-accent/10')}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-[11px] capitalize">{lvl}</span>
                            {currentThinking.level === lvl && (
                              <Check className="h-3 w-3 shrink-0 text-accent" />
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Approval mode selector (icon-only) */}
            {(() => {
              const cfg = APPROVAL_CONFIG[approvalMode];
              const ApprovalIcon = cfg.icon;
              return (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DropdownMenuTrigger
                          className={cn(
                            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-foreground/[0.07] bg-transparent transition-all focus:outline-none',
                            'hover:border-foreground/[0.14] hover:bg-foreground/[0.03]',
                            cfg.color,
                          )}
                        />
                      }
                    >
                      <ApprovalIcon className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Approval: {cfg.label}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent side="top" className="min-w-[220px]">
                    <div className="px-2 pb-1 pt-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      Approval Mode
                    </div>
                    <DropdownMenuSeparator />
                    {APPROVAL_MODES.map((m) => {
                      const c = APPROVAL_CONFIG[m];
                      const Icon = c.icon;
                      const isActive = approvalMode === m;
                      return (
                        <DropdownMenuItem
                          key={m}
                          onClick={() => handleApprovalChange(m)}
                          className={cn(isActive && 'bg-accent/10')}
                        >
                          <div className="flex w-full items-center gap-2">
                            <Icon className={cn('h-3.5 w-3.5 shrink-0', c.color)} />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="text-[11px] font-medium">{c.label}</span>
                              <span className="text-[9px] leading-tight text-muted-foreground">
                                {c.description}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {c.badge && (
                                <span
                                  className={cn(
                                    'rounded-full px-1.5 py-0.5 text-[8px] font-medium',
                                    c.color,
                                    'bg-current/10',
                                  )}
                                >
                                  {c.badge}
                                </span>
                              )}
                              {isActive && <Check className="h-3 w-3 shrink-0 text-accent" />}
                            </div>
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={openSettings}
                    className="text-muted-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground"
                  />
                }
              >
                <Settings className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="top">Settings</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground"
                    onClick={() => setMentionPickerOpen((v) => !v)}
                  />
                }
              >
                <Plus className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="top">Add context (@)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      'text-muted-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground',
                      attachedImages.length > 0 && 'text-accent',
                    )}
                    onClick={() => fileInputRef.current?.click()}
                  />
                }
              >
                <Paperclip className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="top">Attach image</TooltipContent>
            </Tooltip>

            {isStreaming ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      onClick={handleStop}
                      variant="destructive"
                    />
                  }
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </TooltipTrigger>
                <TooltipContent side="top">Stop (Esc)</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="default"
                      size="icon-sm"
                      disabled={!input.trim() && attachedImages.length === 0}
                      onClick={handleSend}
                      className="disabled:opacity-30"
                    />
                  }
                >
                  <Send className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent side="top">Send (Enter)</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
