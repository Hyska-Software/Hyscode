import { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Input, type InputProps } from "./Input";
import { useControllableState } from "../../lib/hooks/useControllableState";

export interface SearchInputProps
  extends Omit<InputProps, "leftIcon" | "rightIcon" | "value" | "defaultValue" | "onChange"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onClear?: () => void;
}

/** Input with a leading search icon and a clear button. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, defaultValue = "", onValueChange, onClear, placeholder = "Search…", ...props }, ref) => {
    const [val, setVal] = useControllableState({ value, defaultValue, onChange: onValueChange });
    return (
      <Input
        ref={ref}
        type="search"
        placeholder={placeholder}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        leftIcon={<Search />}
        rightIcon={
          val ? (
            <button
              type="button"
              onClick={() => {
                setVal("");
                onClear?.();
              }}
              aria-label="Clear search"
              className={cn("rounded-sm text-muted-foreground transition hover:text-foreground")}
            >
              <X className="size-4" />
            </button>
          ) : undefined
        }
        {...props}
      />
    );
  },
);
SearchInput.displayName = "SearchInput";
