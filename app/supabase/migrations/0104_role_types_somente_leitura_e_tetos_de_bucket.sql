-- 0104 — `role_types` vira somente-leitura para o inquilino, e os buckets
--        privados ganham teto de tamanho.
--
-- ─── PARTE 1: role_types ───────────────────────────────────────────────────
--
-- ACHADO (auditoria 25/08/2026): a tabela que decide o PAPEL da pessoa aceitava
-- INSERT, UPDATE e DELETE do proprio dono da linha:
--
--   [INSERT] role_types_insert {public} CHECK (user_id = auth.uid())
--   [UPDATE] role_types_update {public} USING (user_id = auth.uid())
--   [DELETE] role_types_delete {public} USING (user_id = auth.uid())
--
-- O trigger `tg_role_types_protege_admin` cobre a promocao direta a AdminBalu,
-- mas dispara em `BEFORE INSERT OR UPDATE` — **nao em DELETE**. E o DELETE era
-- o degrau que faltava: apagando a propria linha, o usuario fazia
-- `gate-context.ts` cair no fallback de `user_metadata`, que ele mesmo grava
-- pelo GoTrue (`PUT /auth/v1/user`, com a anon key). O papel passava a ser
-- escolha dele.
--
-- O fallback saiu no mesmo commit desta migration. Esta parte fecha o outro
-- lado: ninguem precisa escrever aqui.
--
-- MEDIDO ANTES (nao suposto):
--   · `grep` por escrita em `role_types` no `src/` inteiro -> ZERO ocorrencias.
--     A linha nasce so do trigger `handle_new_user_role` (0002), que e
--     SECURITY DEFINER e passa por cima de policy.
--   · 8 contas, 8 linhas em `role_types`, 0 orfas — remover o caminho de
--     escrita nao deixa ninguem sem papel.
--
-- O `SELECT` continua: e o que `gate-context`, `admin/guard` e as policias de
-- `audit_log` leem.

begin;

drop policy if exists role_types_insert on public.role_types;
drop policy if exists role_types_update on public.role_types;
drop policy if exists role_types_delete on public.role_types;

-- ─── PARTE 2: tetos de bucket ──────────────────────────────────────────────
--
-- Todos os buckets estavam com `file_size_limit = null` e
-- `allowed_mime_types = null`. Nao e falha explorada — os uploads passam por
-- guarda de aplicacao (magic bytes no logo, path traversal na abertura) — mas
-- o teto no Storage e a defesa que continua de pe quando a guarda de aplicacao
-- for contornada ou um caminho novo esquecer de chama-la.
--
-- `company-certificates` nao aparece aqui: a 0103 ja o fechou e definiu o teto.

update storage.buckets set file_size_limit =  5 * 1024 * 1024 where id = 'branding'                 and file_size_limit is null;
update storage.buckets set file_size_limit =  5 * 1024 * 1024 where id = 'brand'                    and file_size_limit is null;
update storage.buckets set file_size_limit = 20 * 1024 * 1024 where id = 'abertura-documentos'      and file_size_limit is null;
update storage.buckets set file_size_limit = 10 * 1024 * 1024 where id = 'declaracoes-comprovantes' and file_size_limit is null;
update storage.buckets set file_size_limit = 10 * 1024 * 1024 where id = 'guias-comprovantes'       and file_size_limit is null;
update storage.buckets set file_size_limit = 10 * 1024 * 1024 where id = 'liberacoes-comprovantes'  and file_size_limit is null;

-- ── Checks dentro da transacao ─────────────────────────────────────────────
do $$
declare
  v_escrita int;
  v_select  int;
  v_papeis  int;
  v_sem_teto int;
begin
  select count(*) into v_escrita from pg_policies
   where schemaname='public' and tablename='role_types' and cmd in ('INSERT','UPDATE','DELETE','ALL');
  if v_escrita <> 0 then
    raise exception 'CHECK 1 falhou: ainda ha % policy(ies) de escrita em role_types', v_escrita;
  end if;

  select count(*) into v_select from pg_policies
   where schemaname='public' and tablename='role_types' and cmd='SELECT';
  if v_select <> 1 then
    raise exception 'CHECK 2 falhou: role_types deveria manter 1 policy de SELECT, tem %', v_select;
  end if;

  -- Ninguem pode ter perdido o papel: 8 contas, 8 linhas.
  select count(*) into v_papeis from public.role_types;
  if v_papeis <> 8 then
    raise exception 'CHECK 3 falhou: % linhas em role_types, esperadas 8', v_papeis;
  end if;

  -- ⚠️ DEPENDE DA 0103: e ela que define o teto de `company-certificates`.
  -- Aplicar a 0104 sozinha faz este check falhar de proposito, nomeando o
  -- bucket que ficou de fora — falhar alto e melhor que passar por engano.
  select count(*) into v_sem_teto from storage.buckets where file_size_limit is null;
  if v_sem_teto <> 0 then
    raise exception 'CHECK 4 falhou: bucket(s) sem teto de tamanho: %',
      (select string_agg(id, ', ' order by id) from storage.buckets where file_size_limit is null);
  end if;

  raise notice '0104 ok — role_types somente-leitura, % papeis intactos, 0 bucket sem teto', v_papeis;
end $$;

commit;
