import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { profileQuery } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });

    const profile = await context.queryClient.ensureQueryData(profileQuery(user.id));
    if (!profile?.ativo) {
      await supabase.auth.signOut();
      toast.error(profile ? "Seu acesso está desativado. Fale com o administrador." : "Perfil não encontrado.");
      throw redirect({ to: "/auth" });
    }
    return { user, profile };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="mx-auto max-w-2xl">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
