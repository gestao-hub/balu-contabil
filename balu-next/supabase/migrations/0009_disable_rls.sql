-- 0009_disable_rls.sql
-- Rollback temporário: DESLIGA o RLS em todas as tabelas do schema public para
-- destravar o app. O RLS foi ligado manualmente pelo toggle do painel SEM policies,
-- então toda query autenticada (anon key + sessão) voltava vazia / falhava.
-- As policies corretas + re-enable virão na migration 0010_rls_policies.sql.
-- Spec: docs/superpowers/specs/2026-05-29-rls-supabase-design.md

-- Desliga RLS em TODAS as tabelas public (robusto a tabelas não enumeradas).
do $$
declare r record;
begin
  for r in
    select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I.%I disable row level security;', r.schemaname, r.tablename);
  end loop;
end $$;

-- Remove as policies antigas e erradas de notas_fiscais (auth.uid() = company_id).
-- Com RLS desligado elas já não têm efeito; dropamos para deixar o estado limpo
-- antes de recriar as corretas na 0010.
drop policy if exists "Users can view their own notas_fiscais."   on public.notas_fiscais;
drop policy if exists "Users can insert their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can update their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can delete their own notas_fiscais." on public.notas_fiscais;

-- Conferência (rodar separado se quiser): todas devem voltar relrowsecurity = false
-- select relname, relrowsecurity from pg_class
-- where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
