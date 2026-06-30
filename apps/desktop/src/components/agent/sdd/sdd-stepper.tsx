import { Check, Circle, Loader2, ChevronRight } from 'lucide-react';
import { useAgentStore } from '@/stores/agent-store';
import { cn } from '@/lib/utils';
import type { SddStatus } from '@hyscode/agent-harness';

const SDD_PHASES: { key: SddStatus; label: string }[] = [
  { key: 'describing', label: 'Describe' },
  { key: 'specifying', label: 'Spec' },
  { key: 'planning', label: 'Plan' },
  { key: 'executing', label: 'Execute' },
  { key: 'reviewing', label: 'Review' },
];

function getPhaseState(
  phase: SddStatus,
  currentPhase: SddStatus,
): 'completed' | 'active' | 'upcoming' {
  const order = SDD_PHASES.map((p) => p.key);
  const currentIdx = order.indexOf(currentPhase);
  const phaseIdx = order.indexOf(phase);
  if (phaseIdx < currentIdx) return 'completed';
  if (phaseIdx === currentIdx) return 'active';
  return 'upcoming';
}

export function SddStepper() {
  const sddPhase = useAgentStore((s) => s.sddPhase);
  const sddProgress = useAgentStore((s) => s.sddProgress);

  if (!sddPhase || sddPhase === 'completed' || sddPhase === 'cancelled') return null;

  return (
    <div className="shrink-0 border-b border-foreground/[0.06] px-4 py-2">
      {/* Phase steps */}
      <div className="flex items-center gap-1">
        {SDD_PHASES.map((phase, i) => {
          const st = getPhaseState(phase.key, sddPhase);
          return (
            <div key={phase.key} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/30" />}
              <div className="flex items-center gap-1">
                {st === 'completed' ? (
                  <Check className="h-3 w-3 text-green-400/80" />
                ) : st === 'active' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-accent" />
                ) : (
                  <Circle className="h-3 w-3 text-muted-foreground/30" />
                )}
                <span
                  className={cn(
                    'text-[10px] font-medium',
                    st === 'completed' && 'text-green-400/80',
                    st === 'active' && 'text-accent',
                    st === 'upcoming' && 'text-muted-foreground/40',
                  )}
                >
                  {phase.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {sddPhase === 'executing' && (
        <div className="mt-1.5 h-1 w-full rounded-full bg-foreground/[0.06]">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${sddProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}
