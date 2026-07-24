import { Monitor, Smartphone, Tablet } from "lucide-react";
import { cn } from "../../lib/cn";
import { useControllableState } from "../../lib/hooks/useControllableState";

export type Viewport = "desktop" | "tablet" | "mobile";

/** Pixel widths for each viewport (mobile/tablet are fixed frames). */
export const VIEWPORT_WIDTHS: Record<Viewport, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
};

export interface ViewportSwitcherProps {
  value?: Viewport;
  defaultValue?: Viewport;
  onValueChange?: (value: Viewport) => void;
  className?: string;
}

const options: { id: Viewport; icon: typeof Monitor; label: string }[] = [
  { id: "desktop", icon: Monitor, label: "Desktop" },
  { id: "tablet", icon: Tablet, label: "Tablet" },
  { id: "mobile", icon: Smartphone, label: "Mobile" },
];

/** Toggle between desktop / tablet / mobile preview widths. */
export function ViewportSwitcher({
  value,
  defaultValue = "desktop",
  onValueChange,
  className,
}: ViewportSwitcherProps) {
  const [current, setCurrent] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5", className)}>
      {options.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={current === id}
          onClick={() => setCurrent(id)}
          className={cn(
            "flex size-7 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4",
            current === id && "bg-card text-foreground shadow-sm",
          )}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
