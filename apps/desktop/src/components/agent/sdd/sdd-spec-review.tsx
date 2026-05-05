import { FileText, Check, X } from 'lucide-react';
import { useAgentStore } from '@/stores/agent-store';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '../markdown-renderer';

interface SddSpecReviewProps {
  onApprove: () => void;
  onReject: () => void;
}

export function SddSpecReview({ onApprove, onReject }: SddSpecReviewProps) {
  const sddSpec = useAgentStore((s) => s.sddSpec);

  if (!sddSpec) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/20 bg-accent/5 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent" />
        <span className="text-[12px] font-semibold text-foreground">
          Specification Review
        </span>
      </div>

      {/* Spec content */}
      <div className="max-h-60 overflow-y-auto rounded-md bg-surface-raised p-3">
        <MarkdownContent content={sddSpec} className="text-[11px]" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onApprove}
          className="h-7 gap-1.5 bg-green-600 px-3 text-[11px] hover:bg-green-700"
        >
          <Check className="h-3 w-3" />
          Approve & Build
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReject}
          className="h-7 gap-1.5 px-3 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Revise
        </Button>
      </div>
    </div>
  );
}
