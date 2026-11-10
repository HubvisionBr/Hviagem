// Gestão de usuários pelo admin. Rodam no servidor com a service role do Supabase
// (necessária para criar contas sem confirmação de e-mail, trocar senha e bloquear acesso).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Role = "admin" | "colaborador";

const MIN_SENHA = 6;

async function assertAdmin(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || !data) throw new Error("Apenas administradores podem gerenciar usuários.");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function traduzir(msg: string): string {
  if (/already (been )?registered|already exists/i.test(msg)) return "Já existe um usuário com este e-mail.";
  if (/password/i.test(msg) && /characters|short|weak/i.test(msg)) return `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`;
  if (/invalid.*email|email.*invalid/i.test(msg)) return "E-mail inválido.";
  return msg;
}

function validarSenha(senha: unknown): string {
  if (typeof senha !== "string" || senha.length < MIN_SENHA) {
    throw new Error(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
  }
  return senha;
}

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { nome: string; email: string; senha: string; role: Role }) => {
    const nome = String(d?.nome ?? "").trim();
    const email = String(d?.email ?? "").trim().toLowerCase();
    if (!nome) throw new Error("Informe o nome.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("E-mail inválido.");
    return { nome, email, senha: validarSenha(d?.senha), role: d?.role === "admin" ? "admin" : "colaborador" } as const;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase);
    const sb = await admin();
    // email_confirm: a conta já nasce confirmada (sem e-mail de verificação).
    // O papel vai em app_metadata, que o trigger handle_new_user usa para criar o perfil.
    const { data: created, error } = await sb.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
      app_metadata: { role: data.role },
    });
    if (error) throw new Error(traduzir(error.message));
    return { id: created.user.id };
  });

export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; nome?: string; role?: Role; ativo?: boolean }) => {
    if (!d?.id) throw new Error("Usuário não informado.");
    if (d.nome !== undefined && !d.nome.trim()) throw new Error("Informe o nome.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase);
    if (data.id === context.userId && (data.ativo === false || data.role === "colaborador")) {
      throw new Error("Você não pode desativar nem remover o próprio acesso de admin.");
    }
    const sb = await admin();

    const patch: Database["public"]["Tables"]["profiles"]["Update"] = {};
    if (data.nome !== undefined) patch.nome = data.nome.trim();
    if (data.role !== undefined) patch.role = data.role;
    if (data.ativo !== undefined) patch.ativo = data.ativo;
    const { error } = await sb.from("profiles").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    // Desativar também bloqueia o login e derruba as sessões abertas.
    if (data.ativo !== undefined) {
      const { error: banErr } = await sb.auth.admin.updateUserById(data.id, {
        ban_duration: data.ativo ? "none" : "876000h",
      });
      if (banErr) throw new Error(banErr.message);
    }
    if (data.role !== undefined) {
      await sb.auth.admin.updateUserById(data.id, { app_metadata: { role: data.role } });
    }
    return { ok: true };
  });

export const redefinirSenha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; senha: string }) => {
    if (!d?.id) throw new Error("Usuário não informado.");
    return { id: d.id, senha: validarSenha(d.senha) };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase);
    const sb = await admin();
    const { error } = await sb.auth.admin.updateUserById(data.id, { password: data.senha });
    if (error) throw new Error(traduzir(error.message));
    return { ok: true };
  });
