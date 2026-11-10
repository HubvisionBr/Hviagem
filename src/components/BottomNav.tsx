import { Link, useLocation } from "@tanstack/react-router";
import { FilePlus, Receipt, FileCheck, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAdmin, useProfile } from "@/lib/profile";

export function BottomNav() {
  const loc = useLocation();
  const profile = useProfile();
  const admin = isAdmin(profile);

  // Admin: pendentes de toda a equipe (para aprovar). Colaborador: as próprias pendentes.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["despesas", "pending-count", profile.id],
    queryFn: async () => {
      let q = supabase
        .from("despesas")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      if (!admin) q = q.eq("user_id", profile.id);
      const { count } = await q;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const tabs = [
    { to: "/nova", label: "Nova despesa", icon: FilePlus, badge: 0 },
    { to: "/despesas", label: admin ? "Despesas" : "Minhas despesas", icon: Receipt, badge: pendingCount },
    ...(admin
      ? [
          { to: "/fechamento", label: "Fechamento", icon: FileCheck, badge: 0 },
          { to: "/usuarios", label: "Usuários", icon: Users, badge: 0 },
        ]
      : []),
  ] as const;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]">
      <div className={`mx-auto max-w-2xl grid ${admin ? "grid-cols-4" : "grid-cols-2"}`}>
        {tabs.map((t) => {
          const active = loc.pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`relative flex flex-col items-center justify-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
              <span>{t.label}</span>
              {t.badge > 0 && (
                <span className="absolute top-1.5 right-[calc(50%-28px)] min-w-4 h-4 px-1 rounded-full bg-[var(--color-status-pending)] text-white text-[10px] font-bold flex items-center justify-center font-mono-ledger">
                  {t.badge}
                </span>
              )}
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-b-full bg-[var(--color-gold)]" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
