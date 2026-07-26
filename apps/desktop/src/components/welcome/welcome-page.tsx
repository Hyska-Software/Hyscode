import { useState, useEffect } from 'react';
import { FolderOpen, Clock, Trash2, ArrowRight, Sparkles, Settings, RotateCcw } from 'lucide-react';
import { useProjectStore, useFileStore, useSettingsStore } from '../../stores';
import { pickFolder } from '../../lib/tauri-dialog';
import { switchProject } from '../../lib/project-persistence';
import type { RecentProject } from '../../stores/project-store';
import { BrandMark } from '../brand-mark';
import { useOnboardingStore } from '../../stores/onboarding-store';

export function WelcomePage() {
  const openProject = useProjectStore((s) => s.openProject);
  const openFolder = useFileStore((s) => s.openFolder);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const removeRecent = useProjectStore((s) => s.removeRecent);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleOpenFolder = async () => {
    const path = await pickFolder();
    if (path) {
      await switchProject(null, path);
      openProject(path);
      await openFolder(path);
    }
  };

  const handleOpenRecent = async (project: RecentProject) => {
    await switchProject(null, project.path);
    openProject(project.path);
    await openFolder(project.path);
  };

  const formatDate = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const shortenPath = (path: string) => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.length <= 3) return normalized;
    return `.../${parts.slice(-3).join('/')}`;
  };

  return (
    <div className="flex h-screen w-screen bg-background relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-72 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-56 w-72 rounded-full bg-primary/3 blur-3xl" />
      </div>

      {/* Top-right actions */}
      <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
        <button
          onClick={() => resetOnboarding()}
          title="Restart setup wizard"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-all"
        >
          <RotateCcw className="h-3 w-3" />
          Setup
        </button>
        <button
          onClick={openSettings}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-all"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>

      <div
        className={`relative z-10 flex w-full flex-col transition-all duration-700 ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        {/* Main content — centered vertically */}
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="flex w-full max-w-2xl flex-col gap-10">
            {/* Logo + heading */}
            <div
              className={`flex flex-col items-center gap-4 text-center transition-all duration-700 delay-100 ${
                mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-primary/10 blur-2xl scale-150" />
                <div
                  className="relative flex h-16 w-16 items-center justify-center rounded-2xl shadow-xl"
                  style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1a3a 100%)' }}
                >
                  <BrandMark className="h-10 w-10" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-light tracking-tight text-foreground">
                  HysCode
                </h1>
                <p className="mt-1 text-sm text-muted-foreground flex items-center gap-1.5 justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  AI-powered code editor
                </p>
              </div>
            </div>

            {/* Two-column layout */}
            <div
              className={`grid grid-cols-1 gap-4 transition-all duration-700 delay-200 ${
                mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              {/* Open folder CTA */}
              <button
                onClick={handleOpenFolder}
                className="group relative flex w-full items-center gap-4 overflow-hidden rounded-xl border border-border bg-surface-raised px-5 py-4 text-left transition-all duration-200 hover:border-primary/40 hover:bg-muted hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-primary/5 to-transparent" />
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                   <FolderOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="relative flex-1">
                  <p className="font-medium text-foreground">Open Folder</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Browse and select a project directory
                  </p>
                </div>
                <ArrowRight className="relative h-4 w-4 text-muted-foreground opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5" />
              </button>
            </div>

            {/* Recent projects */}
            {recentProjects.length > 0 && (
              <div
                className={`flex flex-col gap-3 transition-all duration-700 delay-300 ${
                  mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
                }`}
              >
                <div className="flex items-center gap-2 px-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Recent
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface-raised p-1">
                  {recentProjects.slice(0, 6).map((project, i) => (
                    <div
                      key={project.path}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-150 hover:bg-muted cursor-pointer"
                      style={{ animationDelay: `${(i + 4) * 80}ms` }}
                      onClick={() => handleOpenRecent(project)}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary opacity-60" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {project.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {shortenPath(project.path)}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {formatDate(project.lastOpened)}
                      </span>
                      <button
                         className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        title="Remove from recent"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecent(project.path);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom keyboard shortcuts */}
        <div
          className={`flex justify-center pb-5 transition-all duration-700 delay-500 ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center gap-5 text-[11px] text-muted-foreground/60">
            <div className="flex items-center gap-1.5">
              <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] border border-border/50">
                Ctrl+K Ctrl+O
              </kbd>
              <span>Open Folder</span>
            </div>
            <div className="h-3 w-px bg-border/50" />
            <div className="flex items-center gap-1.5">
              <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] border border-border/50">
                Ctrl+,
              </kbd>
              <span>Settings</span>
            </div>
            <div className="h-3 w-px bg-border/50" />
            <div className="flex items-center gap-1.5">
              <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] border border-border/50">
                Ctrl+L
              </kbd>
              <span>Focus Agent</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
