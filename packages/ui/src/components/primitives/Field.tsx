import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/* ---------------------------------- Label ---------------------------------- */
export interface LabelProps extends ComponentPropsWithoutRef<"label"> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  ),
);
Label.displayName = "Label";

/* ---------------------------------- Field ---------------------------------- */
export interface FieldProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Render prop receives ids to wire aria attributes onto the control. */
  children: (ids: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
}

/** Labelled form field with description and error, wiring aria attributes. */
export const Field = forwardRef<HTMLDivElement, FieldProps>(
  ({ label, description, error, required, children, className, ...props }, ref) => {
    const id = useId();
    const descId = description ? `${id}-desc` : undefined;
    const errId = error ? `${id}-err` : undefined;
    const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;

    return (
      <div ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props}>
        {label && (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        )}
        {description && (
          <p id={descId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {children({ id, "aria-describedby": describedBy, "aria-invalid": !!error })}
        {error && (
          <p id={errId} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Field.displayName = "Field";
