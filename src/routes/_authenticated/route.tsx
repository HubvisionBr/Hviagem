import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { AppSidebar } from "@/components/AppSidebar";
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
    <div className="min-h-screen bg-background md:flex">
      <AppSidebar />
      <main className="flex-1 min-w-0 pb-24 md:pb-10">
        <div className="mx-auto max-w-2xl md:max-w-3xl md:px-4 md:pt-2">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
