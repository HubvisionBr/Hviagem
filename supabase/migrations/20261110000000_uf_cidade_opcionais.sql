-- UF e cidade saíram do formulário de despesa: passam a ser opcionais.
-- As colunas ficam no banco (dados já lançados são preservados).
alter table public.despesas
  alter column uf drop not null,
  alter column cidade drop not null;
