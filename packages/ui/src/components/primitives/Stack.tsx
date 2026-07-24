import { forwardRef, type ElementType, type ComponentPropsWithoutRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const stackVariants = cva("flex", {
  variants: {
    direction: {
      row: "flex-row",
      column: "flex-col",
      "row-reverse": "flex-row-reverse",
      "column-reverse": "flex-col-reverse",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
      around: "justify-around",
      evenly: "justify-evenly",
    },
    gap: {
      0: "gap-0",
      1: "gap-1",
      2: "gap-2",
      3: "gap-3",
      4: "gap-4",
      5: "gap-5",
      6: "gap-6",
      8: "gap-8",
      10: "gap-10",
      12: "gap-12",
    },
    wrap: {
      true: "flex-wrap",
      false: "flex-nowrap",
    },
  },
  defaultVariants: {
    direction: "column",
    gap: 4,
  },
});

export interface StackProps
  extends ComponentPropsWithoutRef<"div">,
    VariantProps<typeof stackVariants> {
  as?: ElementType;
}

/** Flexbox stack with direction/gap/alignment controls. */
export const Stack = forwardRef<HTMLDivElement, StackProps>(
  ({ as: Comp = "div", className, direction, align, justify, gap, wrap, ...props }, ref) => {
    return (
      <Comp
        ref={ref}
        className={cn(stackVariants({ direction, align, justify, gap, wrap }), className)}
        {...props}
      />
    );
  },
);
Stack.displayName = "Stack";

/** Horizontal stack shortcut. */
export const HStack = forwardRef<HTMLDivElement, Omit<StackProps, "direction">>(
  (props, ref) => <Stack ref={ref} direction="row" align="center" {...props} />,
);
HStack.displayName = "HStack";

/** Vertical stack shortcut. */
export const VStack = forwardRef<HTMLDivElement, Omit<StackProps, "direction">>(
  (props, ref) => <Stack ref={ref} direction="column" {...props} />,
);
VStack.displayName = "VStack";
