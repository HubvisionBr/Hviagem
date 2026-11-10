import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/lib/profile";
import logo from "@/assets/hviagem-logo.png";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const navigate = useNavigate();
  const profile = useProfile();

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <header className="flex items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3 min-w-0">
        <img src={logo} alt="Logo HViagem" width={1024} height={1024} className="size-10 object-contain shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{title}</h1>
          <p className="text-sm text-muted-foreground truncate">
            {subtitle ?? profile.nome}
            {profile.role === "admin" && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--color-gold-soft)] px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink)]">
                admin
              </span>
            )}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair" className="shrink-0">
        <LogOut className="size-4" />
      </Button>
    </header>
  );
}
