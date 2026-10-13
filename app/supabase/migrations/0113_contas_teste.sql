-- 0113 — Contas de teste: nunca expiram, não precisam de assinatura e têm tudo
-- liberado. Pedido do usuário em 13/10/2026.
--
-- POR QUE NO USUÁRIO, e não na assinatura. A assinatura é de uma empresa ou de
-- um escritório, e o mesmo login cria outras (uma empresa nova no onboarding,
-- um escritório). Marcar só a linha de hoje deixaria a próxima empresa da
-- conta de teste nascer com 7 dias de trial. A marca fica em `contas_teste`, e
-- tudo que nasce de um usuário marcado já nasce liberado.
--
-- O QUE "LIBERADO" QUER DIZER, sem mexer no gate (`lib/billing/gate.ts`):
--   * assinatura em `cortesia` — o status que o gate sempre deixa passar, que
--     a reconciliação e o webhook do Asaas não tocam (reconciliar.ts:40,
--     webhooks/asaas:200-208), que o cron de faixa não move (cron.ts só olha
--     trial/ativa/inadimplente) e que não recebe aviso de trial acabando;
--   * escritório `aprovada` — sem isso as telas do contador param em
--     /contador/aguardando.
-- Nenhuma funcionalidade depende do PLANO (só do status), então isso basta.
--
-- O QUE NÃO É LIBERADO: a subconta Asaas do escritório (`asaas_subconta_*`) é
-- uma conta de pagamento REAL no Asaas; forçar 'aprovada' aqui faria a Balu
-- emitir cobrança numa conta que o Asaas recusa. Fica como está.

CREATE TABLE IF NOT EXISTS public.contas_teste (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  marcada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marcada_em  timestamptz NOT NULL DEFAULT now()
);

-- Só o service role lê e escreve (tela do AdminBalu e as triggers abaixo).
ALTER TABLE public.contas_teste ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contas_teste FROM anon, authenticated;

-- ------------------------------------------------ aplicar a um usuário
-- Tudo que é DELE: empresas próprias (fora de carteira — as da carteira são
-- cobertas pelo escritório e não têm assinatura) e os escritórios de que é
-- membro. Idempotente.
CREATE OR REPLACE FUNCTION public.aplicar_conta_teste(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.assinaturas a SET status = 'cortesia', updated_at = now()
   WHERE a.status <> 'cortesia'
     AND (a.company_id IN (SELECT c.id FROM public.companies c WHERE c.user_id = p_user)
       OR a.contabilidade_id IN (SELECT m.contabilidade_id FROM public.contabilidade_membros m WHERE m.user_id = p_user));

  UPDATE public.contabilidades c SET status = 'aprovada', aprovada_em = now(), updated_at = now()
   WHERE c.status <> 'aprovada'
     AND c.id IN (SELECT m.contabilidade_id FROM public.contabilidade_membros m WHERE m.user_id = p_user);
END $$;

-- Desmarcar: o que estava em cortesia POR SER DESTE USUÁRIO volta a trial
-- vencendo hoje — a conta passa a precisar de assinatura, como qualquer outra.
-- Escritório continua aprovado (aprovar é decisão separada, em
-- /admin/contabilidades).
CREATE OR REPLACE FUNCTION public.remover_conta_teste(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.contas_teste WHERE user_id = p_user;
  UPDATE public.assinaturas a
     SET status = 'trial', trial_termina_em = (now() AT TIME ZONE 'America/Sao_Paulo')::date, updated_at = now()
   WHERE a.status = 'cortesia'
     AND (a.company_id IN (SELECT c.id FROM public.companies c WHERE c.user_id = p_user)
       OR a.contabilidade_id IN (SELECT m.contabilidade_id FROM public.contabilidade_membros m WHERE m.user_id = p_user));
END $$;

REVOKE ALL ON FUNCTION public.aplicar_conta_teste(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remover_conta_teste(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_conta_teste(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.remover_conta_teste(uuid) TO service_role;

-- ------------------------------------------------ o que nasce depois
-- Empresa nova de usuário marcado: já nasce em cortesia. Corpo da 0054, mais
-- o ramo da conta de teste. O escritório não tem dono na própria linha (o
-- membro entra depois) — ele é tratado pela trigger de membros abaixo.
CREATE OR REPLACE FUNCTION public.criar_assinatura_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dias int;
BEGIN
  -- Aninhado, e nao `AND`: ver o cabecalho da 0054.
  IF TG_TABLE_NAME = 'companies' THEN
    IF NEW.contabilidade_id IS NOT NULL THEN
      RETURN NEW;  -- coberta pela assinatura do escritorio
    END IF;
    IF NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.contas_teste t WHERE t.user_id = NEW.user_id) THEN
      INSERT INTO public.assinaturas (company_id, status, trial_termina_em)
        VALUES (NEW.id, 'cortesia', NULL)
        ON CONFLICT DO NOTHING;
      RETURN NEW;
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

-- Membro marcado que entra num escritório (inclusive o escritório que ele
-- acabou de criar): o escritório fica em cortesia e aprovado.
CREATE OR REPLACE FUNCTION public.conta_teste_ao_entrar_no_escritorio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.contas_teste t WHERE t.user_id = NEW.user_id) THEN
    PERFORM public.aplicar_conta_teste(NEW.user_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_conta_teste_membro ON public.contabilidade_membros;
CREATE TRIGGER trg_conta_teste_membro AFTER INSERT ON public.contabilidade_membros
  FOR EACH ROW EXECUTE FUNCTION public.conta_teste_ao_entrar_no_escritorio();

-- ------------------------------------------------ as contas do pedido
-- Por e-mail (o id muda entre ambientes). Conta que ainda não existe é
-- marcada depois, pela tela /admin/usuarios.
INSERT INTO public.contas_teste (user_id)
SELECT u.id FROM auth.users u
 WHERE lower(u.email) IN (
   'luanbonadie+demoadmin@gmail.com',
   'luanbonadie+democontador@gmail.com',
   'luanbonadie+demoempresa@gmail.com')
ON CONFLICT DO NOTHING;

SELECT public.aplicar_conta_teste(t.user_id) FROM public.contas_teste t;

DO $$
BEGIN
  IF to_regclass('public.contas_teste') IS NULL THEN
    RAISE EXCEPTION '0113: tabela contas_teste não criada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_conta_teste_membro') THEN
    RAISE EXCEPTION '0113: trigger trg_conta_teste_membro não criada';
  END IF;
END $$;
