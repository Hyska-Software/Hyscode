import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../providers/ThemeProvider";
import { IconButton } from "./IconButton";

/** Toggles between light and dark themes. Requires a <ThemeProvider>. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <IconButton
      aria-label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggleTheme}
      variant="ghost"
      className={className}
      icon={resolvedTheme === "dark" ? <Sun /> : <Moon />}
    />
  );
}
