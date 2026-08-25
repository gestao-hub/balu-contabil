-- 0103 — o bucket dos certificados deixa de ser publico.
--
-- ACHADO (auditoria 25/08/2026, provado contra producao):
--
--   O bucket `company-certificates` estava com `public = true` e quatro
--   policies em `storage.objects` cuja unica condicao era o proprio
--   `bucket_id`. O efeito, medido:
--
--     GET  /storage/v1/object/public/company-certificates/<uuid>/certificado.enc
--          -> 200, sem header nenhum, para os 6 objetos
--     POST /storage/v1/object/list/company-certificates  (so a anon key)
--          -> 200, listando as 4 pastas de empresa e `system`
--
--   A anon key esta no bundle de toda pagina — ela e publica por natureza.
--   Entao o caminho nao era "adivinhavel": era entregue. E `system/` guarda o
--   certificado CONTRATANTE do SERPRO, que vale pela plataforma inteira.
--
--   As policies de UPDATE e DELETE eram piores que a de leitura: `USING
--   (bucket_id = 'company-certificates')` para o papel `authenticated`, sem
--   uma linha sobre dono. Como o cadastro e aberto, qualquer pessoa que criasse
--   uma conta podia apagar ou substituir o certificado de qualquer empresa.
--
-- POR QUE PASSOU: o bucket e as quatro policies nunca estiveram numa migration
-- — foram criados no painel. `supabase-storage.ts` chama o bucket de "privado"
-- num comentario, e o comentario era a unica declaracao daquilo em qualquer
-- lugar do repositorio. Nao havia o que revisar nem o que testar.
--
-- POR QUE E SEGURO FECHAR: nenhum caminho do produto monta URL publica deste
-- bucket (`getPublicUrl` e `/object/public/` nao aparecem no `src/`). Toda
-- leitura passa por `downloadCertificado` -> admin client `.download()`, e
-- service_role nao e barrado por RLS nem pelo flag `public`. Depois desta
-- migration o bucket fica alcancavel SO pelo backend, que e o que o codigo
-- sempre supos.

begin;

-- 1. O flag. Sem isto, `/object/public/...` continua servindo mesmo sem policy.
update storage.buckets
   set public = false
 where id = 'company-certificates';

-- 2. As quatro policies do painel. Nenhuma delas olhava dono; e nenhuma e
--    necessaria, porque so o service_role toca neste bucket.
drop policy if exists "Public Read company-certificates"        on storage.objects;
drop policy if exists "Authenticated Upload company-certificates" on storage.objects;
drop policy if exists "Authenticated Update company-certificates" on storage.objects;
drop policy if exists "Authenticated Delete company-certificates" on storage.objects;

-- 3. Teto de tamanho e tipo, que tambem faltavam.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['application/octet-stream']
 where id = 'company-certificates';

-- ── Checks dentro da transacao: se algum falhar, nada disto e comitado ──
do $$
declare
  v_public   boolean;
  v_policies int;
  v_objetos  int;
begin
  select public into v_public from storage.buckets where id = 'company-certificates';
  if v_public is distinct from false then
    raise exception 'CHECK 1 falhou: bucket ainda public=% ', v_public;
  end if;

  -- Conta `with_check` TAMBEM: a policy de INSERT nao tem `qual`, so
  -- `with_check`. Filtrar so por `qual` daria 3 onde havia 4, e um check que
  -- conta errado e um check que nao morde.
  select count(*) into v_policies
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual::text,'') || coalesce(with_check::text,'')) like '%company-certificates%';
  if v_policies <> 0 then
    raise exception 'CHECK 2 falhou: ainda ha % policy(ies) citando o bucket', v_policies;
  end if;

  -- Nada pode ter sumido: sao 6 objetos (4 certificados de empresa,
  -- o contratante do SERPRO e o placeholder de pasta).
  select count(*) into v_objetos
    from storage.objects where bucket_id = 'company-certificates';
  if v_objetos <> 6 then
    raise exception 'CHECK 3 falhou: % objetos no bucket, esperados 6', v_objetos;
  end if;

  raise notice '0103 ok — bucket privado, 0 policies, % objetos intactos', v_objetos;
end $$;

commit;
