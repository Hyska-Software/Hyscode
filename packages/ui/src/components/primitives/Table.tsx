import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Table = forwardRef<HTMLTableElement, ComponentPropsWithoutRef<"table">>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"thead">>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("[&_tr]: [&_tr]:", className)} {...props} />
  ),
);
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"tbody">>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

export const TableFooter = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"tfoot">>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("  bg-muted/50 font-medium", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

export const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithoutRef<"tr">>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "  transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export const TableHead = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<"th">>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

export const TableCell = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<"td">>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-3 py-2.5 align-middle text-foreground", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

export const TableCaption = forwardRef<HTMLTableCaptionElement, ComponentPropsWithoutRef<"caption">>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";
