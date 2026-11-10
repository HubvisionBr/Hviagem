import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logo from "@/assets/hviagem-logo.png";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — HViagem" },
      { name: "description", content: "Acesse o HViagem para lançar despesas corporativas da Hubvision." },
      { property: "og:title", content: "HViagem — Prestação de Contas" },
      { property: "og:description", content: "Ferramenta da Hubvision para lançar despesas de viagem." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/nova" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        throw new Error(
          error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message,
        );
      }
      navigate({ to: "/nova" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <img src={logo} alt="Logo HViagem" width={1024} height={1024} className="size-12 object-contain" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">HViagem</h1>
            <p className="text-xs text-muted-foreground">Prestação de contas · Hubvision</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">Entrar</h2>
          <p className="text-sm text-muted-foreground mb-5">Use o e-mail e a senha que o administrador cadastrou</p>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" inputMode="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-11">
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Não tem acesso ou esqueceu a senha? Fale com o administrador.
          </p>
        </div>
      </div>
    </div>
  );
}
