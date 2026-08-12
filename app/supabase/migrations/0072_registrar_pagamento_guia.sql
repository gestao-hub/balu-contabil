-- Bloco 7, Task 9 — registrar_pagamento_guia: UM ponto de escrita para "guia paga".
-- Spec: docs/superpowers/specs/2026-08-12-bloco-7-dominio-sla-conciliacao-design.md §2.5
--
-- Ate aqui quem dava baixa era a action manual. Com a conciliacao entram DOIS
-- caminhos — e a sessao 22 ja mostrou o que acontece quando o mesmo fato tem
-- dois donos: o filtro de "guia paga" foi esquecido em tres consumidores
-- seguidos (0065 whatsapp, 0066 email+sino, 0067 pagina), um de cada vez.
--
-- Entao a baixa passa a ser uma funcao so, que faz as tres coisas juntas:
--   1. marca a guia como paga;
--   2. resolve as notificacoes daquela guia (o que a 0067 introduziu);
--   3. grava audit_log com a ORIGEM — pro cliente poder perguntar "por que
--      minha guia apareceu paga sozinha?" e existir resposta.

CREATE OR REPLACE FUNCTION public.registrar_pagamento_guia(
  p_guia_id        uuid,
  p_data_pagamento date,
  p_origem         text DEFAULT 'manual',
  p_transacao_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company     uuid;
  v_ja_paga     date;
  v_notif       int := 0;
  v_service     boolean;
BEGIN
  IF p_origem NOT IN ('manual','conciliacao','conciliacao_confirmada') THEN
    RAISE EXCEPTION 'origem invalida: %', p_origem;
  END IF;

  SELECT company_id, data_pagamento INTO v_company, v_ja_paga
  FROM public.guias_fiscais WHERE id = p_guia_id AND deleted_at IS NULL;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'guia_inexistente');
  END IF;

  -- Autorizacao: ou quem chama e dono da empresa (caminho da tela), ou e o
  -- cron com service_role (caminho da conciliacao).
  --
  -- ⚠️ Detectar o chamador aqui tem uma armadilha: dentro de SECURITY DEFINER,
  -- `current_user` e o DONO da funcao (postgres), nao quem chamou — usar isso
  -- faria a checagem de service_role falhar sempre, inclusive em producao.
  -- Descoberto pelo probe de comportamento antes de aplicar.
  --
  -- O sinal confiavel e `auth.uid()`: toda chamada autenticada carrega `sub`
  -- no JWT, e a do service_role nao carrega nenhum. Como o EXECUTE desta
  -- funcao e so de `authenticated` e `service_role` (o `anon` nao tem), uid
  -- nulo aqui significa service_role — e um usuario comum nao consegue
  -- apagar o proprio `sub` de um JWT assinado.
  v_service := auth.uid() IS NULL;
  IF NOT v_service AND NOT public.user_owns_company(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_autorizado');
  END IF;

  -- Idempotente: guia ja paga nao tem data reescrita nem auditoria duplicada.
  -- Importa de verdade — o cron roda todo dia sobre uma janela que se sobrepoe,
  -- e reprocessar a mesma transacao nao pode mover a data do pagamento.
  IF v_ja_paga IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_estava_paga', true, 'notificacoes_resolvidas', 0);
  END IF;

  UPDATE public.guias_fiscais
  SET status = 'paga', data_pagamento = p_data_pagamento, updated_at = now()
  WHERE id = p_guia_id;

  -- Mesma logica da resolver_notificacoes_guia (0067), inline: aquela funcao
  -- checa user_owns_company por dentro e o cron nao passaria nesse teste.
  UPDATE public.notifications
  SET resolvida_em = now(), lida_em = COALESCE(lida_em, now())
  WHERE resolvida_em IS NULL
    AND tipo IN ('das_a_vencer','das_vencido')
    AND entidade_ref = p_guia_id::text;
  GET DIAGNOSTICS v_notif = ROW_COUNT;

  IF p_transacao_id IS NOT NULL THEN
    UPDATE public.conciliacao_transacoes
    SET guia_id = p_guia_id, conciliada_em = now(), conciliacao_origem = p_origem
    WHERE id = p_transacao_id;
  END IF;

  -- Colunas conferidas contra a 0038: `alvo_id` e uuid (nao text) e o jsonb
  -- chama `meta` (nao `metadata`). Errar aqui so apareceria em runtime.
  INSERT INTO public.audit_log (actor_user_id, acao, alvo_tipo, alvo_id, meta)
  VALUES (
    CASE WHEN v_service THEN NULL ELSE auth.uid() END,
    'guia.pagamento_registrado', 'guia_fiscal', p_guia_id,
    jsonb_build_object('origem', p_origem, 'data_pagamento', p_data_pagamento,
                       'transacao_id', p_transacao_id, 'notificacoes_resolvidas', v_notif)
  );

  RETURN jsonb_build_object('ok', true, 'ja_estava_paga', false, 'notificacoes_resolvidas', v_notif);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_guia(uuid, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_guia(uuid, date, text, uuid) TO authenticated, service_role;
