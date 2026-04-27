import { ShieldAlert, Check, X, ChevronDown, ChevronRight, ShieldCheck, CheckCheck, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PendingApproval } from '@/stores/agent-store';
import { useSettingsStore } from '@/stores/settings-store';
import { HarnessBridge } from '@/lib/harness-bridge';

// ─── Risk badge config ───────────────────────────────────────────────────────

type RiskLevel = 'safe' | 'moderate' | 'destructive';

const RISK_DISPLAY: Record<RiskLevel, { label: string; color: string; borderColor: string; bgColor: string }> = {
  safe: {
    label: 'safe',
    color: 'text-green-400',
    borderColor: 'border-green-500/25',
    bgColor: 'bg-green-500/[0.04]',
  },
  moderate: {
    label: 'moderate',
    color: 'text-yellow-400',
    borderColor: 'border-yellow-500/25',
    bgColor: 'bg-yellow-500/[0.04]',
  },
  destructive: {
    label: 'destructive',
    color: 'text-red-400',
    borderColor: 'border-red-500/25',
    bgColor: 'bg-red-500/[0.04]',
  },
};

function inferRiskLevel(toolName: string): RiskLevel {
  const safeTools = new Set([
    'read_file', 'read_multiple_files', 'list_directory', 'search_code', 'find_files',
    'get_file_info', 'list_code_symbols', 'get_diagnostics', 'grep_search',
    'gather_context', 'drop_context', 'list_context', 'web_search', 'web_fetch',
  ]);
  const destructiveTools = new Set([
    'run_terminal_command', 'run_code', 'git_commit', 'git_push',
    'delete_file', 'git_reset', 'docker_run',
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
    <div className={`agent-fade-in my-2.5 overflow-hidden rounded-lg border ${riskDisplay.borderColor} ${riskDisplay.bgColor}`}>
      {/* Accent bar — color matches risk */}
      <div className={`h-[2px] w-full ${
        risk === 'destructive'
          ? 'bg-gradient-to-r from-red-500/40 via-red-400/60 to-red-500/40'
          : risk === 'safe'
            ? 'bg-gradient-to-r from-green-500/40 via-green-400/60 to-green-500/40'
            : 'bg-gradient-to-r from-yellow-500/40 via-yellow-400/60 to-yellow-500/40'
      }`} />

      <div className="p-3.5">
        {/* Header */}
        <div className="mb-2.5 flex items-center gap-2.5">
          <div className={`flex h-6 w-6 items-center justify-center rounded-md ${
            risk === 'destructive' ? 'bg-red-500/10' : risk === 'safe' ? 'bg-green-500/10' : 'bg-yellow-500/10'
          }`}>
            {risk === 'destructive' ? (
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
            ) : (
              <ShieldAlert className={`h-3.5 w-3.5 ${riskDisplay.color}`} />
            )}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-semibold ${
                risk === 'destructive' ? 'text-red-300' : risk === 'safe' ? 'text-green-300' : 'text-yellow-300'
              }`}>
                Approval Required
              </span>
              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${riskDisplay.color} bg-current/10`}>
                {riskDisplay.label}
              </span>
            </div>
            <span className={`text-[10px] ${
              risk === 'destructive' ? 'text-red-400/50' : risk === 'safe' ? 'text-green-400/50' : 'text-yellow-400/50'
            }`}>{approval.toolName}</span>
          </div>
        </div>

        {/* Description */}
        <p className="mb-3 text-[11.5px] leading-relaxed text-foreground/75">{approval.description}</p>

        {/* Collapsible details */}
        <button
          onClick={() => setDetailOpen(!detailOpen)}
          className="mb-3 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground/50 transition-colors hover:bg-white/[0.02] hover:text-muted-foreground/80"
        >
          {detailOpen ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
          <span>View parameters</span>
        </button>

        {detailOpen && (
          <div className="agent-fade-in mb-3 overflow-hidden rounded-md border border-border/15 bg-surface-raised/40">
            <pre className="overflow-x-auto p-2.5 text-[10px] font-mono leading-relaxed text-foreground/60">
              {JSON.stringify(approval.input, null, 2)}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={handleApprove}
            className="h-7 gap-1.5 rounded-md bg-green-600 px-3.5 text-[11px] font-medium shadow-sm shadow-green-900/20 hover:bg-green-500 transition-colors"
          >
            <Check className="h-3 w-3" />
            Approve
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleTrustTool}
            className="h-7 gap-1.5 rounded-md px-3 text-[11px] text-emerald-400/80 hover:bg-emerald-950/20 hover:text-emerald-300 transition-colors"
          >
            <ShieldCheck className="h-3 w-3" />
            Trust this tool
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleApproveAll}
            className="h-7 gap-1.5 rounded-md px-3 text-[11px] text-amber-400/80 hover:bg-amber-950/20 hover:text-amber-300 transition-colors"
          >
            <CheckCheck className="h-3 w-3" />
            Approve all
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleDeny}
            className="h-7 gap-1.5 rounded-md px-3.5 text-[11px] text-red-400/80 hover:bg-red-950/20 hover:text-red-300 transition-colors"
          >
            <X className="h-3 w-3" />
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}
