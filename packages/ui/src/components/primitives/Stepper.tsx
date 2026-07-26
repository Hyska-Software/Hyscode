import { Fragment, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export interface Step {
  label: ReactNode;
  description?: ReactNode;
}

export interface StepperProps {
  steps: Step[];
  /** Index of the current (active) step. */
  current: number;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function Stepper({ steps, current, orientation = "horizontal", className }: StepperProps) {
  const isH = orientation === "horizontal";
  return (
    <ol className={cn("flex", isH ? "items-start" : "flex-col", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const last = i === steps.length - 1;
        return (
          <Fragment key={i}>
            <li className={cn("flex gap-3", isH ? "flex-col items-center text-center" : "items-start")}>
              <div className={cn("flex", isH ? "flex-col items-center" : "flex-col items-center")}>
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full  text-sm font-medium transition-colors",
                    done && " bg-primary text-primary-foreground",
                    active && " text-primary",
                    !done && !active && " text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
              </div>
              <div className={cn(isH ? "" : "pb-6")}>
                <p className={cn("text-sm font-medium", active || done ? "text-foreground" : "text-muted-foreground")}>
                  {step.label}
                </p>
                {step.description && (
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                )}
              </div>
            </li>
            {!last && (
              <div
                className={cn(
                  "bg-border",
                  isH ? "mt-4 h-px flex-1" : "ml-4 -mt-2 w-px flex-1 self-stretch",
                  done && "bg-primary",
                )}
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
