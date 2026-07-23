-- 0044_abertura_contador.sql
-- Lado do contador/operador da abertura de empresa. Modelo do Michel (4.2/4.4):
-- "o app COLETA os dados e a EQUIPE DO ESCRITÓRIO faz a abertura nos órgãos".
-- Aberturas iniciadas pelo escritório nascem SEM dono (a posse vem depois, via
-- aceitar_convite). O contador da carteira LÊ por RLS; as escritas (avançar
-- etapa, concluir, decidir alteração) vão por server action com admin client
-- escopado por contabilidade_id (mesmo padrão de contador/actions.ts).

-- (a) office-initiated: abertura sem dono. A posse é transferida no convite
--     dirigido (aceitar_convite faz UPDATE companies SET user_id=... WHERE user_id IS NULL).
ALTER TABLE public.abertura_empresas ALTER COLUMN user_id DROP NOT NULL;

-- (b) SELECT do contador da carteira — vínculo por company_id → companies.contabilidade_id
--     (mesma linha das policies filhas do 0033; sem denormalizar contabilidade_id na tabela).
DROP POLICY IF EXISTS abertura_empresas_select_contador ON public.abertura_empresas;
CREATE POLICY abertura_empresas_select_contador ON public.abertura_empresas
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT id FROM public.companies
      WHERE contabilidade_id = public.minha_contabilidade()
    )
  );

DROP POLICY IF EXISTS abertura_alteracoes_select_contador ON public.abertura_alteracoes;
CREATE POLICY abertura_alteracoes_select_contador ON public.abertura_alteracoes
  FOR SELECT TO authenticated
  USING (
    abertura_id IN (
      SELECT ae.id
      FROM public.abertura_empresas ae
      JOIN public.companies c ON c.id = ae.company_id
      WHERE c.contabilidade_id = public.minha_contabilidade()
    )
  );
