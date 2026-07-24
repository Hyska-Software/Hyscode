import { forwardRef } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";

export interface NumberInputProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  "aria-label"?: string;
}

const heights = { sm: "h-8", md: "h-9", lg: "h-11" } as const;

/** Numeric input with stepper buttons and clamping. */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      defaultValue = 0,
      onValueChange,
      min = -Infinity,
      max = Infinity,
      step = 1,
      disabled,
      size = "md",
      className,
      "aria-label": ariaLabel,
    },
    ref,
  ) => {
    const [val, setVal] = useControllableState({ value, defaultValue, onChange: onValueChange });
    const clamp = (n: number) => Math.min(max, Math.max(min, n));
    const set = (n: number) => setVal(clamp(n));

    return (
      <div
        className={cn(
          "inline-flex items-stretch overflow-hidden rounded-md   bg-card focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          heights[size],
          disabled && "opacity-50",
          className,
        )}
      >
        <button
          type="button"
          disabled={disabled || val <= min}
          onClick={() => set(val - step)}
          aria-label="Decrease"
          className="flex w-8 items-center justify-center text-muted-foreground transition hover:bg-muted disabled:opacity-40"
        >
          <Minus className="size-4" />
        </button>
        <input
          ref={ref}
          type="number"
          inputMode="numeric"
          value={Number.isFinite(val) ? val : ""}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => set(Number(e.target.value))}
          className="w-16   bg-transparent text-center text-sm text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled || val >= max}
          onClick={() => set(val + step)}
          aria-label="Increase"
          className="flex w-8 items-center justify-center text-muted-foreground transition hover:bg-muted disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";
