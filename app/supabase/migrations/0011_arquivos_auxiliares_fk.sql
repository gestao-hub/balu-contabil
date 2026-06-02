-- 0011_arquivos_auxiliares_fk.sql
-- Pós-RLS: formaliza a FK de arquivos_auxiliares (a coluna unique_id_empresa já é
-- uuid = companies.id), dropa o legado unique_id_bubble, e fecha os gaps de
-- role_types (grant) e abertura_empresas (policy por user_id).
-- PRÉ-REQUISITO: rodar scripts/saneamento-arquivos-auxiliares.mjs --apply ANTES
-- (remove as órfãs; a FK falha se existirem company_id sem company correspondente).
-- Spec: docs/superpowers/specs/2026-05-29-saneamento-arquivos-auxiliares-design.md

-- 1) arquivos_auxiliares: rename + FK + drop coluna legada
alter table public.arquivos_auxiliares rename column unique_id_empresa to company_id;
alter table public.arquivos_auxiliares
  add constraint arquivos_auxiliares_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete cascade;
alter table public.arquivos_auxiliares drop column unique_id_bubble;

-- 2) recria as policies referenciando company_id (o rename atualizaria sozinho; explicitamos)
drop policy if exists arquivos_auxiliares_select on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_insert on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_update on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_delete on public.arquivos_auxiliares;
create policy arquivos_auxiliares_select on public.arquivos_auxiliares for select using (public.user_owns_company(company_id));
create policy arquivos_auxiliares_insert on public.arquivos_auxiliares for insert with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_update on public.arquivos_auxiliares for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_delete on public.arquivos_auxiliares for delete using (public.user_owns_company(company_id));

-- 3) role_types: fecha o gap de GRANT (RLS own-row já criado na 0010)
grant select, insert, update, delete on public.role_types to authenticated;
grant all on public.role_types to service_role;

-- 4) abertura_empresas: policies por user_id (relação por user, não company)
drop policy if exists abertura_empresas_select on public.abertura_empresas;
drop policy if exists abertura_empresas_insert on public.abertura_empresas;
drop policy if exists abertura_empresas_update on public.abertura_empresas;
drop policy if exists abertura_empresas_delete on public.abertura_empresas;
create policy abertura_empresas_select on public.abertura_empresas for select using (user_id = auth.uid());
create policy abertura_empresas_insert on public.abertura_empresas for insert with check (user_id = auth.uid());
create policy abertura_empresas_update on public.abertura_empresas for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy abertura_empresas_delete on public.abertura_empresas for delete using (user_id = auth.uid());
