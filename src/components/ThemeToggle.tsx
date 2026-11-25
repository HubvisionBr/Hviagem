import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className = "", withLabel }: { className?: string; withLabel?: boolean }) {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Usar tema claro" : "Usar tema escuro";
  const Icon = theme === "dark" ? Sun : Moon;
  if (withLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        className={`flex w-full items-center gap-3 rounded-lg px-3 h-10 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${className}`}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="truncate">{theme === "dark" ? "Tema claro" : "Tema escuro"}</span>
      </button>
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label} className={className}>
      <Icon className="size-4" />
    </Button>
  );
}
