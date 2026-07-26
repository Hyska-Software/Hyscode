import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

interface TerminalDropZoneProps {
  /** What happens when the terminal is dropped here */
  onDrop: () => void;
  /** Label shown in the drop indicator */
  label: string;
  /** Direction of the drop zone visual */
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps a panel area and shows a drop indicator when a terminal
 * drag is hovering over it.
 */
export function TerminalDropZone({ onDrop, label, className, children }: TerminalDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('hyscode/terminal-move')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.types.includes('hyscode/terminal-move')) {
        onDrop();
      }
    },
    [onDrop],
  );

  return (
    <div
      className={cn('relative', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm pointer-events-none">
          <span className="rounded-md bg-primary/20 px-3 py-1.5 text-[11px] font-medium text-primary">
            {label}
          </span>
        </div>
      )}
    </div>
  );
}
