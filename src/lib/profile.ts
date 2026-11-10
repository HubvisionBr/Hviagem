import { queryOptions } from "@tanstack/react-query";
import { redirect, useRouteContext } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;

export const profileQuery = (userId: string) =>
  queryOptions({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

/** Perfil do usuário logado (disponível em qualquer rota dentro de /_authenticated). */
export function useProfile(): Profile {
  return useRouteContext({ from: "/_authenticated" }).profile;
}

/** beforeLoad para rotas exclusivas do admin. */
export function requireAdmin({ context }: { context: { profile: Profile } }) {
  if (context.profile.role !== "admin") throw redirect({ to: "/despesas" });
}

export const isAdmin = (p: Pick<Profile, "role">) => p.role === "admin";
