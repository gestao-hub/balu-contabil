-- @custom — Cria a tabela aux_produtos no banco hospedado.
--
-- CONTEXTO: aux_produtos está definida na migration 0001_init.sql, mas o banco
-- hospedado está defasado em relação à 0001 (ver DB-DIVERGENCIA.md) — a tabela
-- nunca foi criada. O PostgREST retorna PGRST205 "Could not find the table
-- 'public.aux_produtos'" ao tentar criar/listar produtos na emissão de NF-e/NFC-e.
--
-- Esta migration recria a tabela EXATAMENTE como a 0001 a define (DDL + trigger
-- updated_at + RLS + policy company-scope), tudo idempotente. Se a tabela já
-- existir em algum ambiente, os IF NOT EXISTS / DROP POLICY IF EXISTS tornam a
-- aplicação segura.
--
-- AUTOCONTIDA: o banco hospedado também não tem a função tg_set_updated_at()
-- (erro 42883 ao aplicar dependendo só da 0001). Por isso recriamos aqui, junto
-- com user_company_ids() (usada pela policy), via CREATE OR REPLACE — idempotente
-- e inofensivo se já existirem.

-- ── Funções de suporte (idempotentes) ────────────────
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;

create or replace function public.user_company_ids() returns setof uuid
language sql stable as $$
  select id from public.companies where user_id = auth.uid();
$$;

-- ── Tabela ───────────────────────────────────────────
create table if not exists public.aux_produtos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade not null,
  codigo text,
  descricao text not null,
  ncm text,
  cfop text,
  tipo_nf text check (tipo_nf in ('nfe','nfce','nfse')),
  unidade_comercial text default 'UN',
  quantidade_comercial numeric(14,4) default 1,
  valor_unitario_comercial numeric(14,4) default 0,
  finalizado boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Trigger updated_at (reusa a função existente public.tg_set_updated_at) ──
drop trigger if exists aux_produtos_set_updated_at on public.aux_produtos;
create trigger aux_produtos_set_updated_at
  before update on public.aux_produtos
  for each row execute function public.tg_set_updated_at();

-- ── RLS + policy company-scope (mesmo padrão das demais tabelas) ──
alter table public.aux_produtos enable row level security;

drop policy if exists aux_produtos_company_scope on public.aux_produtos;
create policy aux_produtos_company_scope on public.aux_produtos
  for all to authenticated
  using (company_id in (select public.user_company_ids()))
  with check (company_id in (select public.user_company_ids()));

-- Após aplicar: o PostgREST recarrega o schema cache automaticamente em alguns
-- segundos. Se persistir o PGRST205, rodar: NOTIFY pgrst, 'reload schema';
