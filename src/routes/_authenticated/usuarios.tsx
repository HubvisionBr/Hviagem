import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { requireAdmin, useProfile, type Profile } from "@/lib/profile";
import { atualizarUsuario, criarUsuario, redefinirSenha } from "@/lib/usuarios.functions";

export const Route = createFileRoute("/_authenticated/usuarios")({
  beforeLoad: requireAdmin,
  head: () => ({ meta: [{ title: "Usuários — Hubvision" }] }),
  component: UsuariosPage,
});

type Role = "admin" | "colaborador";

function UsuariosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useProfile();
  const [dialog, setDialog] = useState<{ mode: "novo" } | { mode: "editar"; user: Profile } | { mode: "senha"; user: Profile } | null>(null);

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["profiles", "gestao"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("ativo", { ascending: false }).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["profiles"] });
    // O perfil logado vem do contexto da rota: descarta o cache e recarrega (caso o admin tenha editado o próprio nome).
    qc.removeQueries({ queryKey: ["profile"] });
    router.invalidate();
  };

  const toggleAtivo = useMutation({
    mutationFn: (u: Profile) => atualizarUsuario({ data: { id: u.id, ativo: !u.ativo } }),
    onSuccess: (_, u) => {
      refresh();
      toast.success(u.ativo ? `${u.nome} desativado` : `${u.nome} reativado`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="px-4 pt-6 pb-4">
      <PageHeader title="Usuários" subtitle="Colaboradores e administradores" />

      <Button className="w-full h-11 mb-4" onClick={() => setDialog({ mode: "novo" })}>
        <UserPlus className="size-4 mr-2" /> Novo usuário
      </Button>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="space-y-3">
          {usuarios.map((u) => (
            <li key={u.id} className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${u.ativo ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{u.nome}</span>
                    {u.role === "admin" && (
                      <span className="inline-flex items-center rounded-full bg-[var(--color-gold-soft)] px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink)]">
                        admin
                      </span>
                    )}
                    {!u.ativo && (
                      <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-foreground/70">
                        inativo
                      </span>
                    )}
                    {u.id === me.id && <span className="text-[11px] text-muted-foreground">(você)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</div>
                </div>
                {u.id !== me.id && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    Ativo
                    <Switch checked={u.ativo} disabled={toggleAtivo.isPending}
                      onCheckedChange={() => {
                        if (!u.ativo || confirm(`Desativar ${u.nome}? Essa pessoa não conseguirá mais entrar.`)) toggleAtivo.mutate(u);
                      }} />
                  </label>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "editar", user: u })}>
                  <Pencil className="size-3.5 mr-1" /> Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: "senha", user: u })}>
                  <KeyRound className="size-3.5 mr-1" /> Redefinir senha
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NovoUsuarioDialog open={dialog?.mode === "novo"} onClose={() => setDialog(null)} onDone={refresh} />
      <EditarUsuarioDialog user={dialog?.mode === "editar" ? dialog.user : null} isMe={dialog?.mode === "editar" && dialog.user.id === me.id}
        onClose={() => setDialog(null)} onDone={refresh} />
      <SenhaDialog user={dialog?.mode === "senha" ? dialog.user : null} onClose={() => setDialog(null)} />
    </div>
  );
}

function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="colaborador">Colaborador — lança as próprias despesas</SelectItem>
        <SelectItem value="admin">Admin — aprova, fecha e gerencia usuários</SelectItem>
      </SelectContent>
    </Select>
  );
}

function NovoUsuarioDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ nome: "", email: "", senha: "", role: "colaborador" as Role });
  useEffect(() => { if (open) setForm({ nome: "", email: "", senha: "", role: "colaborador" }); }, [open]);

  const create = useMutation({
    mutationFn: () => criarUsuario({ data: form }),
    onSuccess: () => {
      onDone();
      onClose();
      toast.success("Usuário criado", { description: `Envie o e-mail e a senha para ${form.nome}.` });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
        <form id="novo-usuario" className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input required type="email" inputMode="email" autoCapitalize="none" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Senha inicial</Label>
            <Input required minLength={6} value={form.senha} autoComplete="new-password"
              onChange={(e) => setForm({ ...form, senha: e.target.value })} placeholder="Mínimo 6 caracteres" />
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="novo-usuario" disabled={create.isPending}>
            {create.isPending ? "Criando…" : "Criar usuário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarUsuarioDialog({ user, isMe, onClose, onDone }: { user: Profile | null; isMe: boolean; onClose: () => void; onDone: () => void }) {
  const [nome, setNome] = useState("");
  const [role, setRole] = useState<Role>("colaborador");
  useEffect(() => {
    if (user) { setNome(user.nome); setRole(user.role as Role); }
  }, [user]);

  const save = useMutation({
    mutationFn: () => atualizarUsuario({ data: { id: user!.id, nome, ...(isMe ? {} : { role }) } }),
    onSuccess: () => {
      onDone();
      onClose();
      toast.success("Usuário atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <RoleSelect value={role} onChange={setRole} disabled={isMe} />
            {isMe && <p className="text-xs text-muted-foreground">Você não pode alterar o próprio papel.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !nome.trim()}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SenhaDialog({ user, onClose }: { user: Profile | null; onClose: () => void }) {
  const [senha, setSenha] = useState("");
  useEffect(() => { if (user) setSenha(""); }, [user]);

  const save = useMutation({
    mutationFn: () => redefinirSenha({ data: { id: user!.id, senha } }),
    onSuccess: () => {
      onClose();
      toast.success("Senha redefinida", { description: `Envie a nova senha para ${user?.nome}.` });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Redefinir senha</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{user?.nome} · {user?.email}</p>
        <div className="space-y-1.5">
          <Label>Nova senha</Label>
          <Input value={senha} minLength={6} autoComplete="new-password" onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || senha.length < 6}>
            {save.isPending ? "Salvando…" : "Redefinir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
