import {
  ShieldAlert,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  CheckCheck,
  AlertTriangle,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PendingApproval } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { HarnessBridge } from '@/lib/harness-bridge';

// ─── Risk badge config ───────────────────────────────────────────────────────

type RiskLevel = 'safe' | 'moderate' | 'destructive';

const RISK_DISPLAY: Record<RiskLevel, { label: string; color: string; borderColor: string }> = {
  safe: {
    label: 'safe',
    color: 'text-success/90',
    borderColor: 'border-success/25',
  },
  moderate: {
    label: 'moderate',
    color: 'text-warning/90',
    borderColor: 'border-warning/25',
  },
  destructive: {
    label: 'destructive',
    color: 'text-destructive/90',
    borderColor: 'border-destructive/25',
  },
};

function inferRiskLevel(toolName: string): RiskLevel {
  const safeTools = new Set([
    'read_file',
    'read_multiple_files',
    'list_directory',
    'search_code',
    'find_files',
    'get_file_info',
    'list_code_symbols',
    'get_diagnostics',
    'grep_search',
    'gather_context',
    'drop_context',
    'list_context',
    'web_search',
    'web_fetch',
  ]);
  const destructiveTools = new Set([
    'run_terminal_command',
    'respond_terminal_input',
    'run_code',
    'git_commit',
    'git_push',
    'delete_file',
    'git_reset',
    'docker_run',
  ]);
  if (safeTools.has(toolName)) return 'safe';
  if (destructiveTools.has(toolName)) return 'destructive';
  return 'moderate';
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ApprovalDialogProps {
  approval: PendingApproval;
}

export function ApprovalDialog({ approval }: ApprovalDialogProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const approvalMode = useSettingsStore((s) => s.approvalMode);
  const risk = inferRiskLevel(approval.toolName);
  const riskDisplay = RISK_DISPLAY[risk];

  const handleApprove = () => {
    HarnessBridge.get().resolveApproval(approval.id, true);
  };

  const handleApproveAll = () => {
    HarnessBridge.get().resolveApproval(approval.id, true);
    // Temporarily switch to yolo for this session
    useSettingsStore.getState().set('approvalMode', 'yolo');
  };

  const handleTrustTool = () => {
    HarnessBridge.get().resolveApproval(approval.id, true);
    HarnessBridge.get().trustToolForSession(approval.toolName);
    // Switch to session-trust mode if not already
    if (approvalMode === 'manual') {
      useSettingsStore.getState().set('approvalMode', 'session-trust');
    }
  };

  const handleDeny = () => {
    HarnessBridge.get().resolveApproval(approval.id, false);
  };

  return (
    <div className={`agent-fade-in my-3 border-l-2 ${riskDisplay.borderColor} pl-3`}>
      <div className="py-0.5">
        {/* Header */}
        <div className="mb-2.5 flex items-center gap-2.5">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              risk === 'destructive'
                ? 'bg-destructive/10'
                : risk === 'safe'
                  ? 'bg-success/10'
                  : 'bg-warning/10'
            }`}
          >
            {risk === 'destructive' ? (
              <AlertTriangle className="h-3 w-3 text-destructive" />
            ) : (
              <ShieldAlert className={`h-3 w-3 ${riskDisplay.color}`} />
            )}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[11px] font-medium ${
                  risk === 'destructive'
                    ? 'text-destructive/90'
                    : risk === 'safe'
                      ? 'text-success/90'
                      : 'text-warning/90'
                }`}
              >
                Approval Required
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${riskDisplay.color} bg-current/10`}
              >
                {riskDisplay.label}
              </span>
            </div>
            <span
              className={`text-[10px] ${
                risk === 'destructive'
                  ? 'text-destructive/50'
                  : risk === 'safe'
                    ? 'text-success/50'
                    : 'text-warning/50'
              }`}
            >
              {approval.toolName}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="mb-3 text-[12px] leading-relaxed text-foreground/80">
          {approval.description}
        </p>

        {/* Collapsible details */}
        <button
          onClick={() => setDetailOpen(!detailOpen)}
          className="mb-3 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground/50 transition-colors hover:bg-foreground/[0.02] hover:text-muted-foreground/80"
        >
          {detailOpen ? (
            <ChevronDown className="h-2.5 w-2.5" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5" />
          )}
          <span>View parameters</span>
        </button>

        {detailOpen && (
          <div className="agent-fade-in mb-3 overflow-hidden rounded-md bg-muted/30">
            <pre className="overflow-x-auto p-2.5 font-mono text-[10px] leading-relaxed text-foreground/60">
              {JSON.stringify(approval.input, null, 2)}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            className="h-7 gap-1.5 rounded-md bg-green-600 px-3.5 text-[11px] font-medium hover:bg-success transition-colors"
          >
            <Check className="h-3 w-3" />
            Approve
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleTrustTool}
            className="h-7 gap-1.5 rounded-md px-3 text-[11px] text-emerald-400/80 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
          >
            <ShieldCheck className="h-3 w-3" />
            Trust this tool
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleApproveAll}
            className="h-7 gap-1.5 rounded-md px-3 text-[11px] text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
          >
            <CheckCheck className="h-3 w-3" />
            Approve all
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleDeny}
            className="h-7 gap-1.5 rounded-md px-3.5 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}
