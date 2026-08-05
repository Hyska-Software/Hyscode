import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentStore } from '@/stores/agent-store';
import { getActiveAgentBridge } from '@/lib/active-agent-bridge';

export function PendingChangesBar() {
  const pendingSessionCount = useAgentStore(
    (s) =>
      s.agentEditSessions.filter(
        (es) => es.phase === 'streaming' || es.phase === 'pending_review',
      ).length,
  );

  if (pendingSessionCount === 0) return null;

  const handleAcceptAll = () => {
    getActiveAgentBridge().resolveAllEditSessions(true);
  };

  const handleRejectAll = () => {
    getActiveAgentBridge().resolveAllEditSessions(false);
  };

  return (
    <div className="flex items-center justify-between border-t border-border bg-muted/60 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        <strong className="text-foreground">{pendingSessionCount}</strong> pending agent{' '}
        {pendingSessionCount === 1 ? 'change' : 'changes'}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="destructive" size="xs" onClick={handleRejectAll}>
          <X className="mr-1 h-3 w-3" />
          Reject All
        </Button>
        <Button variant="default" size="xs" onClick={handleAcceptAll}>
          <Check className="mr-1 h-3 w-3" />
          Accept All
        </Button>
      </div>
    </div>
  );
}
