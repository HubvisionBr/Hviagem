import { FilePlus, Receipt, FileCheck, Users, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAdmin, useProfile } from "@/lib/profile";

export type NavItem = {
  to: "/nova" | "/despesas" | "/fechamento" | "/usuarios";
  label: string;
  short: string;
  icon: LucideIcon;
  badge: number;
};

// Itens de navegação compartilhados pela sidebar (desktop) e pela barra inferior (celular).
export function useNavItems(): NavItem[] {
  const profile = useProfile();
  const admin = isAdmin(profile);

  // Admin: pendentes de toda a equipe (para aprovar). Colaborador: as próprias pendentes.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["despesas", "pending-count", profile.id],
    queryFn: async () => {
      let q = supabase.from("despesas").select("id", { count: "exact", head: true }).eq("status", "pendente");
      if (!admin) q = q.eq("user_id", profile.id);
      const { count } = await q;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const items: NavItem[] = [
    { to: "/nova", label: "Nova despesa", short: "Nova despesa", icon: FilePlus, badge: 0 },
    {
      to: "/despesas",
      label: admin ? "Despesas e aprovações" : "Minhas despesas",
      short: admin ? "Despesas" : "Minhas despesas",
      icon: Receipt,
      badge: pendingCount,
    },
  ];
  if (admin) {
    items.push(
      { to: "/fechamento", label: "Fechamento", short: "Fechamento", icon: FileCheck, badge: 0 },
      { to: "/usuarios", label: "Usuários", short: "Usuários", icon: Users, badge: 0 },
    );
  }
  return items;
}
