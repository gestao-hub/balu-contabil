-- 0054 — conserta criar_assinatura_trial(), que quebrava o cadastro de
-- escritorio novo desde que a 0050 subiu para producao.
--
-- O DEFEITO: a 0050 escreveu a guarda como uma condicao so —
--
--   IF TG_TABLE_NAME = 'companies' AND NEW.contabilidade_id IS NOT NULL THEN
--
-- PL/pgSQL nao garante short-circuit: a expressao inteira e resolvida como um
-- SELECT, e `NEW.contabilidade_id` e resolvido mesmo quando o primeiro termo e
-- falso. A mesma funcao serve a duas triggers — trg_assinatura_company (em
-- companies) e trg_assinatura_contabilidade (em contabilidades) — e
-- contabilidades NAO tem a coluna contabilidade_id. Entao todo
-- INSERT INTO contabilidades morria com 42703 (record "new" has no field).
--
-- CONSEQUENCIA EM PRODUCAO: nenhum escritorio novo conseguia se cadastrar
-- (o caminho e contador/actions.ts:37). Passou meses despercebido porque o
-- banco tem uma unica contabilidade, criada ANTES da 0050.
--
-- O CONSERTO: aninhar os dois IF, de modo que NEW.contabilidade_id so seja
-- tocado quando a trigger esta mesmo em companies. Nada mais do corpo muda —
-- o resto e verbatim da 0050:116-139.
--
-- Achado durante o Bloco 4B, ao provar a RLS da 0053; nao tem relacao com o 4B.

CREATE OR REPLACE FUNCTION public.criar_assinatura_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dias int;
BEGIN
  -- Aninhado, e nao `AND`: ver o cabecalho desta migration.
  IF TG_TABLE_NAME = 'companies' THEN
    IF NEW.contabilidade_id IS NOT NULL THEN
      RETURN NEW;  -- coberta pela assinatura do escritorio
    END IF;
  END IF;

  SELECT trial_dias INTO v_dias FROM public.planos
   WHERE publico = CASE TG_TABLE_NAME WHEN 'companies' THEN 'empresa' ELSE 'escritorio' END
     AND ativo ORDER BY valor_centavos LIMIT 1;
  v_dias := COALESCE(v_dias, 7);

  IF TG_TABLE_NAME = 'companies' THEN
    INSERT INTO public.assinaturas (company_id, status, trial_termina_em)
      VALUES (NEW.id, 'trial', (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias)
      ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.assinaturas (contabilidade_id, status, trial_termina_em)
      VALUES (NEW.id, 'trial', (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
