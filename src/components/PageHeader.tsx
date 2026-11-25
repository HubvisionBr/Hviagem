import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useProfile } from "@/lib/profile";

// Topo de cada tela. No celular traz a marca, o tema e o sair; no desktop isso fica na sidebar.
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const navigate = useNavigate();
  const profile = useProfile();

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <header className="flex items-center justify-between gap-3 mb-5 md:mb-6">
      <div className="flex items-center gap-3 min-w-0">
        <span className="md:hidden shrink-0">
          <Logo variant="icon" className="h-10 w-auto" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl md:text-[26px] font-bold tracking-tight truncate">{title}</h1>
          <p className="text-sm text-muted-foreground truncate">
            {subtitle ?? profile.nome}
            {profile.role === "admin" && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--color-soft-accent)] px-1.5 py-px font-sans text-[10px] font-bold uppercase tracking-wider text-primary dark:text-[var(--color-brand-secondary)]">
                admin
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 md:hidden">
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
