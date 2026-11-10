-- HViagem — Prestação de Contas Hubvision (versão sem Protheus)
-- Schema inicial para um projeto Supabase novo. Rode inteiro no SQL Editor.
--
-- Papéis:
--   colaborador → lança e acompanha as próprias despesas (edita/exclui só enquanto pendente)
--   admin       → vê as despesas de todos, aprova/rejeita, faz fechamentos e gerencia usuários
-- A primeira conta criada no projeto vira admin automaticamente.

-- ---------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null,
  role text not null default 'colaborador' check (role in ('admin', 'colaborador')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and ativo
  );
$$;

-- Cria o perfil quando a conta é criada (pelo admin, via service role).
-- O papel vem de app_metadata, que só o servidor consegue definir.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  elsif new.raw_app_meta_data ->> 'role' = 'admin' then
    v_role := 'admin';
  else
    v_role := 'colaborador';
  end if;

  insert into public.profiles (id, nome, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)),
    new.email,
    v_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Fechamentos
-- ---------------------------------------------------------------------------
create table public.relatorios_fechamento (
  id uuid primary key default gen_random_uuid(),
  data_inicio date not null,
  data_fim date not null,
  colaborador_id uuid references public.profiles (id) on delete restrict, -- null = todos
  total numeric(12, 2) not null default 0,
  quantidade integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (data_fim >= data_inicio)
);

-- ---------------------------------------------------------------------------
-- Despesas
-- ---------------------------------------------------------------------------
create table public.despesas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  tipo_despesa text not null,
  uf text not null check (char_length(uf) = 2),
  cidade text not null,
  valor numeric(10, 2) not null check (valor > 0),
  data_despesa date not null default current_date,
  descricao text,
  foto_url text, -- caminho no bucket notas-fiscais: <user_id>/<arquivo>
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),
  motivo_rejeicao text,
  avaliado_por uuid references public.profiles (id) on delete set null,
  avaliado_em timestamptz,
  relatorio_id uuid references public.relatorios_fechamento (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index despesas_user_id_idx on public.despesas (user_id, data_despesa desc);
create index despesas_status_idx on public.despesas (status) where relatorio_id is null;
create index despesas_relatorio_idx on public.despesas (relatorio_id);

-- Regras de negócio que o RLS sozinho não cobre (quais colunas cada papel pode mudar).
create or replace function public.despesas_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
begin
  if tg_op = 'INSERT' then
    if not v_admin then
      new.user_id := auth.uid();
    end if;
    new.status := 'pendente';
    new.motivo_rejeicao := null;
    new.avaliado_por := null;
    new.avaliado_em := null;
    new.relatorio_id := null;
    return new;
  end if;

  -- UPDATE
  if old.relatorio_id is not null then
    raise exception 'Despesa incluída em fechamento concluído não pode ser alterada';
  end if;

  if not v_admin then
    if old.status <> 'pendente' then
      raise exception 'Despesa já avaliada não pode ser alterada';
    end if;
    if new.status is distinct from old.status
       or new.user_id is distinct from old.user_id
       or new.relatorio_id is distinct from old.relatorio_id
       or new.motivo_rejeicao is distinct from old.motivo_rejeicao
       or new.avaliado_por is distinct from old.avaliado_por
       or new.avaliado_em is distinct from old.avaliado_em then
      raise exception 'Sem permissão para alterar o status da despesa';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'pendente' then
      new.avaliado_por := null;
      new.avaliado_em := null;
    else
      new.avaliado_por := auth.uid();
      new.avaliado_em := now();
    end if;
    if new.status <> 'rejeitado' then
      new.motivo_rejeicao := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger despesas_guard
  before insert or update on public.despesas
  for each row execute function public.despesas_guard();

-- Fechamento atômico: só despesas APROVADAS e ainda sem fechamento entram.
create or replace function public.concluir_fechamento(
  p_data_inicio date,
  p_data_fim date,
  p_colaborador_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12, 2);
  v_qtd integer;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem concluir fechamentos';
  end if;

  select coalesce(sum(valor), 0), count(*)
    into v_total, v_qtd
    from public.despesas
   where status = 'aprovado'
     and relatorio_id is null
     and data_despesa between p_data_inicio and p_data_fim
     and (p_colaborador_id is null or user_id = p_colaborador_id);

  if v_qtd = 0 then
    raise exception 'Nenhuma despesa aprovada no período';
  end if;

  insert into public.relatorios_fechamento (data_inicio, data_fim, colaborador_id, total, quantidade)
  values (p_data_inicio, p_data_fim, p_colaborador_id, v_total, v_qtd)
  returning id into v_id;

  update public.despesas
     set relatorio_id = v_id
   where status = 'aprovado'
     and relatorio_id is null
     and data_despesa between p_data_inicio and p_data_fim
     and (p_colaborador_id is null or user_id = p_colaborador_id);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.despesas enable row level security;
alter table public.relatorios_fechamento enable row level security;

create policy "profiles: ver o próprio ou admin vê todos"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles: admin edita"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "despesas: dono ou admin vê"
  on public.despesas for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "despesas: usuário ativo lança as suas"
  on public.despesas for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and ativo)
  );

create policy "despesas: dono ou admin altera (regras no trigger)"
  on public.despesas for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "despesas: dono exclui pendente, admin exclui fora de fechamento"
  on public.despesas for delete to authenticated
  using (
    relatorio_id is null
    and ((user_id = auth.uid() and status = 'pendente') or public.is_admin())
  );

create policy "fechamentos: admin vê todos, colaborador vê os seus"
  on public.relatorios_fechamento for select to authenticated
  using (public.is_admin() or colaborador_id = auth.uid());

revoke all on public.profiles, public.despesas, public.relatorios_fechamento from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.despesas to authenticated;
grant select on public.relatorios_fechamento to authenticated;
revoke execute on function public.concluir_fechamento(date, date, uuid) from public, anon;
grant execute on function public.concluir_fechamento(date, date, uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: notas fiscais (privado). Cada usuário grava na pasta <user_id>/.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notas-fiscais', 'notas-fiscais', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "notas: dono ou admin lê"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'notas-fiscais'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy "notas: usuário envia para a própria pasta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'notas-fiscais'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "notas: dono ou admin remove"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'notas-fiscais'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
