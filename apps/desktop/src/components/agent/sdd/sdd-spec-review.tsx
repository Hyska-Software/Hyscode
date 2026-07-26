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
    <div className="mx-4 my-3 border-l-2 border-primary/30 pl-3">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-primary/80" />
        <span className="text-[12px] font-medium text-foreground/90">Specification Review</span>
      </div>

      {/* Spec content */}
      <div className="max-h-60 overflow-y-auto rounded-md bg-muted/20 p-3">
        <MarkdownContent content={sddSpec} className="text-[11.5px]" />
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={onApprove}
          className="h-7 gap-1.5 bg-green-600 px-3 text-[11px] hover:bg-success"
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
