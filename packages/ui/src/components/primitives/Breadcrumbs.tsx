import { forwardRef, Fragment, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps extends ComponentPropsWithoutRef<"nav"> {
  items: BreadcrumbItem[];
  separator?: ReactNode;
}

export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(
  ({ className, items, separator, ...props }, ref) => (
    <nav ref={ref} aria-label="Breadcrumb" className={cn("text-sm", className)} {...props}>
      <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              <li>
                {item.href && !last ? (
                  <a
                    href={item.href}
                    onClick={item.onClick}
                    className="rounded-sm transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    className={cn(last && "font-medium text-foreground")}
                    aria-current={last ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden className="flex items-center text-neutral-400">
                  {separator ?? <ChevronRight className="size-3.5" />}
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  ),
);
Breadcrumbs.displayName = "Breadcrumbs";
