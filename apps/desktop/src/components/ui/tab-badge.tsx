import { cn } from '@/lib/utils';

interface TabBadgeProps {
  count: number;
  /** Render even when count is 0. Defaults to false. */
  showZero?: boolean;
  className?: string;
}

export function TabBadge({ count, showZero = false, className }: TabBadgeProps) {
  if (!showZero && count <= 0) return null;

  return (
    <span
      className={cn(
        'min-w-4 rounded-full bg-primary/15 px-1 text-[9px] font-medium tabular-nums text-primary',
        className,
      )}
    >
      {count}
    </span>
  );
}

// Keep type export for any existing consumers that imported it
export type TabBadgeVariant = string;
