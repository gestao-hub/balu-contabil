-- Bloco 7, Task 1 — dominio proprio + SLA configuravel do escritorio.
-- Spec: docs/superpowers/specs/2026-08-12-bloco-7-dominio-sla-conciliacao-design.md
--
-- O Bloco A entregou co-branding (logo/nome/whatsapp de suporte) mas nao
-- dominio proprio: o escritorio nao tem como atender a carteira dele em
-- app.escritoriodofulano.com.br. Aqui entram as colunas de dominio e a RPC
-- que resolve host -> marca para um visitante SEM SESSAO (a tela de login
-- sob o dominio proprio precisa ja estar pintada).

ALTER TABLE public.contabilidades
  ADD COLUMN IF NOT EXISTS dominio_customizado   text,
  ADD COLUMN IF NOT EXISTS dominio_status        text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS dominio_token         text,
  ADD COLUMN IF NOT EXISTS dominio_verificado_em timestamptz,
  ADD COLUMN IF NOT EXISTS dominio_erro          text,
  ADD COLUMN IF NOT EXISTS sla_resposta_horas    int;

-- CHECK fora do ADD COLUMN pra este arquivo poder ser reaplicado inteiro.
ALTER TABLE public.contabilidades DROP CONSTRAINT IF EXISTS contabilidades_dominio_status_check;
ALTER TABLE public.contabilidades ADD CONSTRAINT contabilidades_dominio_status_check
  CHECK (dominio_status IN ('pendente','ativo','erro'));

-- SLA em HORAS CORRIDAS (hora util exigiria calendario de feriados
-- municipal/estadual — decisao §2.4 da spec). NULL = escritorio nao promete
-- SLA: nada e exibido ao cliente e nada e alertado.
ALTER TABLE public.contabilidades DROP CONSTRAINT IF EXISTS contabilidades_sla_horas_check;
ALTER TABLE public.contabilidades ADD CONSTRAINT contabilidades_sla_horas_check
  CHECK (sla_resposta_horas IS NULL OR (sla_resposta_horas BETWEEN 1 AND 720));

-- Um host so pode pertencer a um escritorio. Parcial: os NULL (a maioria)
-- nao competem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS contabilidades_dominio_uidx
  ON public.contabilidades (dominio_customizado)
  WHERE dominio_customizado IS NOT NULL;

COMMENT ON COLUMN public.contabilidades.dominio_customizado IS
  'Host normalizado (minusculo, sem esquema, sem porta, sem barra). Ver lib/dominios/host.ts.';
COMMENT ON COLUMN public.contabilidades.dominio_token IS
  'Token servido por GET /api/dominio/verificacao no proprio host. Prova de uma vez que o DNS aponta pra ca, que o TLS esta de pe e que e este app que responde ali.';
COMMENT ON COLUMN public.contabilidades.sla_resposta_horas IS
  'Horas CORRIDAS ate a primeira resposta a uma escalada de atendimento. NULL = sem promessa de SLA.';

-- ── Resolucao host -> marca, para visitante sem sessao ────────────────────
--
-- SECURITY DEFINER com retorno MINIMO, e nao um select na tabela: a
-- `contabilidades` guarda CNPJ, CRC e a chave Asaas cifrada da subconta
-- (0053). Expor a tabela ao `anon` pra pintar um logo seria trocar a marca
-- pela superficie inteira. Esta funcao devolve quatro colunas e nada mais.
--
-- So responde por dominio ATIVO de escritorio APROVADO: um dominio ainda em
-- verificacao, ou de escritorio suspenso, nao pinta marca nenhuma — o app
-- cai na marca Balu, que e o default seguro.
CREATE OR REPLACE FUNCTION public.branding_por_host(p_host text)
RETURNS TABLE (
  contabilidade_id uuid, nome text, logo_url text, sla_resposta_horas int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.nome, c.logo_url, c.sla_resposta_horas
  FROM public.contabilidades c
  WHERE c.dominio_customizado = lower(btrim(p_host))
    AND c.dominio_status = 'ativo'
    AND c.status = 'aprovada'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.branding_por_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branding_por_host(text) TO anon, authenticated;

-- ── Token de verificacao, tambem para visitante sem sessao ────────────────
--
-- O endpoint /api/dominio/verificacao roda SEM sessao (quem chama e o nosso
-- proprio servidor, de fora, pra provar que o host responde). Ele precisa do
-- token daquele host — e so dele. Funcao separada da de branding porque o
-- token nao tem por que aparecer em toda renderizacao de layout.
--
-- Vazamento aceito e consciente: quem adivinhar o host de um escritorio le o
-- token dele. Isso nao da poder nenhum — o token so prova que o host aponta
-- pra ca, e quem controla o host ja poderia ler o proprio endpoint de
-- qualquer forma.
CREATE OR REPLACE FUNCTION public.dominio_token_por_host(p_host text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.dominio_token
  FROM public.contabilidades c
  WHERE c.dominio_customizado = lower(btrim(p_host))
    AND c.dominio_token IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.dominio_token_por_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dominio_token_por_host(text) TO anon, authenticated, service_role;
