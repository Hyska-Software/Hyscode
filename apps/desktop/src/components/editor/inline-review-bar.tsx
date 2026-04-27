import { Check, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HarnessBridge } from '@/lib/harness-bridge';
import type { AgentEditSession } from '@/stores/agent-store';

interface InlineReviewBarProps {
  session: AgentEditSession;
}

export function InlineReviewBar({ session }: InlineReviewBarProps) {
  if (session.phase !== 'pending_review') return null;

  const handleAccept = () => {
    HarnessBridge.get().resolveEditSession(session.id, true);
  };

  const handleReject = () => {
    HarnessBridge.get().resolveEditSession(session.id, false);
  };

  return (
    <div className="flex items-center justify-between border-b border-border bg-purple-500/5 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        Agent edited via{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{session.toolName}</code>
        {session.isNewFile && (
          <span className="ml-1.5 rounded bg-purple-500/10 px-1 py-0.5 text-[10px] text-purple-400">
            new file
          </span>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="xs" onClick={handleReject}>
          <Undo2 className="mr-1 h-3 w-3" />
          Reject
        </Button>
        <Button variant="default" size="xs" onClick={handleAccept}>
          <Check className="mr-1 h-3 w-3" />
          Accept
        </Button>
      </div>
    </div>
  );
}
