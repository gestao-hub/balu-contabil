-- 0010_rls_policies.sql
-- RLS para produção. Modelo: companies.user_id = auth.uid(); tabelas de dados
-- acessíveis quando a company referenciada pertence ao usuário.
-- Spec: docs/superpowers/specs/2026-05-29-rls-supabase-design.md
-- DB é fonte de verdade: validado contra db_atual.sql (migrations 0001/0002 defasadas).

-- 1) Helper de ownership (bypassa RLS de companies via SECURITY DEFINER → sem recursão)
create or replace function public.user_owns_company(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.companies
    where id = cid and user_id = auth.uid()
  );
$$;

revoke all on function public.user_owns_company(uuid) from public;
grant execute on function public.user_owns_company(uuid) to authenticated;

-- 2) companies (chave: user_id)
alter table public.companies enable row level security;
drop policy if exists companies_select on public.companies;
drop policy if exists companies_insert on public.companies;
drop policy if exists companies_update on public.companies;
drop policy if exists companies_delete on public.companies;
create policy companies_select on public.companies for select using (user_id = auth.uid());
create policy companies_insert on public.companies for insert with check (user_id = auth.uid());
create policy companies_update on public.companies for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy companies_delete on public.companies for delete using (user_id = auth.uid());

-- 3) profiles (chave: user_id)
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select using (user_id = auth.uid());
create policy profiles_insert on public.profiles for insert with check (user_id = auth.uid());
create policy profiles_update on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_delete on public.profiles for delete using (user_id = auth.uid());

-- 4) role_types (chave: user_id)
alter table public.role_types enable row level security;
drop policy if exists role_types_select on public.role_types;
drop policy if exists role_types_insert on public.role_types;
drop policy if exists role_types_update on public.role_types;
drop policy if exists role_types_delete on public.role_types;
create policy role_types_select on public.role_types for select using (user_id = auth.uid());
create policy role_types_insert on public.role_types for insert with check (user_id = auth.uid());
create policy role_types_update on public.role_types for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy role_types_delete on public.role_types for delete using (user_id = auth.uid());

-- 5) notas_fiscais — dropar as 4 policies ANTIGAS e erradas (auth.uid() = company_id)
drop policy if exists "Users can view their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can insert their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can update their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can delete their own notas_fiscais." on public.notas_fiscais;

-- 6) Tabelas escopadas por company_id
--    clientes, notas_fiscais, guias_fiscais, apuracoes_fiscais,
--    receitas_fiscais, honorarios, arquivos_auxiliares

alter table public.clientes enable row level security;
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy clientes_select on public.clientes for select using (public.user_owns_company(company_id));
create policy clientes_insert on public.clientes for insert with check (public.user_owns_company(company_id));
create policy clientes_update on public.clientes for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy clientes_delete on public.clientes for delete using (public.user_owns_company(company_id));

alter table public.notas_fiscais enable row level security;
create policy notas_fiscais_select on public.notas_fiscais for select using (public.user_owns_company(company_id));
create policy notas_fiscais_insert on public.notas_fiscais for insert with check (public.user_owns_company(company_id));
create policy notas_fiscais_update on public.notas_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy notas_fiscais_delete on public.notas_fiscais for delete using (public.user_owns_company(company_id));

alter table public.guias_fiscais enable row level security;
drop policy if exists guias_fiscais_select on public.guias_fiscais;
drop policy if exists guias_fiscais_insert on public.guias_fiscais;
drop policy if exists guias_fiscais_update on public.guias_fiscais;
drop policy if exists guias_fiscais_delete on public.guias_fiscais;
create policy guias_fiscais_select on public.guias_fiscais for select using (public.user_owns_company(company_id));
create policy guias_fiscais_insert on public.guias_fiscais for insert with check (public.user_owns_company(company_id));
create policy guias_fiscais_update on public.guias_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy guias_fiscais_delete on public.guias_fiscais for delete using (public.user_owns_company(company_id));

alter table public.apuracoes_fiscais enable row level security;
drop policy if exists apuracoes_fiscais_select on public.apuracoes_fiscais;
drop policy if exists apuracoes_fiscais_insert on public.apuracoes_fiscais;
drop policy if exists apuracoes_fiscais_update on public.apuracoes_fiscais;
drop policy if exists apuracoes_fiscais_delete on public.apuracoes_fiscais;
create policy apuracoes_fiscais_select on public.apuracoes_fiscais for select using (public.user_owns_company(company_id));
create policy apuracoes_fiscais_insert on public.apuracoes_fiscais for insert with check (public.user_owns_company(company_id));
create policy apuracoes_fiscais_update on public.apuracoes_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy apuracoes_fiscais_delete on public.apuracoes_fiscais for delete using (public.user_owns_company(company_id));

alter table public.receitas_fiscais enable row level security;
drop policy if exists receitas_fiscais_select on public.receitas_fiscais;
drop policy if exists receitas_fiscais_insert on public.receitas_fiscais;
drop policy if exists receitas_fiscais_update on public.receitas_fiscais;
drop policy if exists receitas_fiscais_delete on public.receitas_fiscais;
create policy receitas_fiscais_select on public.receitas_fiscais for select using (public.user_owns_company(company_id));
create policy receitas_fiscais_insert on public.receitas_fiscais for insert with check (public.user_owns_company(company_id));
create policy receitas_fiscais_update on public.receitas_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy receitas_fiscais_delete on public.receitas_fiscais for delete using (public.user_owns_company(company_id));

alter table public.honorarios enable row level security;
drop policy if exists honorarios_select on public.honorarios;
drop policy if exists honorarios_insert on public.honorarios;
drop policy if exists honorarios_update on public.honorarios;
drop policy if exists honorarios_delete on public.honorarios;
create policy honorarios_select on public.honorarios for select using (public.user_owns_company(company_id));
create policy honorarios_insert on public.honorarios for insert with check (public.user_owns_company(company_id));
create policy honorarios_update on public.honorarios for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy honorarios_delete on public.honorarios for delete using (public.user_owns_company(company_id));

alter table public.arquivos_auxiliares enable row level security;
drop policy if exists arquivos_auxiliares_select on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_insert on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_update on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_delete on public.arquivos_auxiliares;
create policy arquivos_auxiliares_select on public.arquivos_auxiliares for select using (public.user_owns_company(company_id));
create policy arquivos_auxiliares_insert on public.arquivos_auxiliares for insert with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_update on public.arquivos_auxiliares for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_delete on public.arquivos_auxiliares for delete using (public.user_owns_company(company_id));

-- 7) empresas_fiscais (chave: empresa_id → companies.id)
alter table public.empresas_fiscais enable row level security;
drop policy if exists empresas_fiscais_select on public.empresas_fiscais;
drop policy if exists empresas_fiscais_insert on public.empresas_fiscais;
drop policy if exists empresas_fiscais_update on public.empresas_fiscais;
drop policy if exists empresas_fiscais_delete on public.empresas_fiscais;
create policy empresas_fiscais_select on public.empresas_fiscais for select using (public.user_owns_company(empresa_id));
create policy empresas_fiscais_insert on public.empresas_fiscais for insert with check (public.user_owns_company(empresa_id));
create policy empresas_fiscais_update on public.empresas_fiscais for update using (public.user_owns_company(empresa_id)) with check (public.user_owns_company(empresa_id));
create policy empresas_fiscais_delete on public.empresas_fiscais for delete using (public.user_owns_company(empresa_id));

-- 8) municipios_nfse (referência: leitura p/ authenticated; escrita só service_role)
alter table public.municipios_nfse enable row level security;
drop policy if exists municipios_nfse_select on public.municipios_nfse;
create policy municipios_nfse_select on public.municipios_nfse for select to authenticated using (true);

-- 9) abertura_empresas (sem chave de tenant → nega anon/auth; service_role bypassa)
alter table public.abertura_empresas enable row level security;
