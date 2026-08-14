-- Frente 3 (avisos de pagamento) — Task 2: a RPC de baixa passa a AVISAR.
-- Spec: docs/superpowers/specs/2026-08-13-frente-3-avisos-de-pagamento-design.md §2.2 e §3.2
--
-- Duas mudancas sobre a 0072, e as duas existem pelo mesmo motivo: o sync da
-- SERPRO era o QUARTO caminho de baixa e o unico fora desta funcao — gravava
-- `status='paga'` por upsert direto em `impostos/actions.ts`. Quando a Receita
-- revelava que o DAS estava pago, ninguem era notificado e nada ia para a
-- auditoria.
--
--   1. `p_origem` aceita 'serpro'. A lista da 0072 era fechada e a chamada nova
--      levantaria excecao — o defeito nao teria como ser consertado sem isto.
--
--   2. A funcao passa a CRIAR o aviso `pagamento_confirmado` (0086). Ate aqui
--      ela so RESOLVIA notificacoes de DAS a vencer/vencido; nenhum ponto do
--      sistema avisava "seu pagamento foi reconhecido". Criar aqui dentro — e
--      nao em quem chama — e a mesma decisao que fez a 0072 existir: os quatro
--      caminhos de baixa ganham o aviso de uma vez, na MESMA transacao que ja
--      grava a auditoria. Notificar no chamador daria o aviso a um caminho so,
--      e o quinto caminho nasceria mudo de novo.
--
-- ⚠️ QUEM RECEBE, E QUEM NAO RECEBE
-- So avisamos quando a descoberta foi AUTOMATICA ('serpro' e 'conciliacao').
-- Em 'manual' e 'conciliacao_confirmada' quem deu a baixa foi o proprio dono,
-- olhando para a tela — mandar de volta "seu pagamento foi confirmado" seria
-- contar a alguem o que essa pessoa acabou de fazer. Notificacao que repete
-- ato do usuario e como o cliente aprende a ignorar as outras.

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
  v_owner       uuid;
  v_competencia text;
  v_avisou      boolean := false;
  v_fonte       text;
  -- Contador PROPRIO do INSERT do aviso. Reusar `v_notif` aqui trocaria o
  -- significado de `notificacoes_resolvidas` no retorno e na auditoria — o
  -- numero passaria a ser "criei um aviso?" em vez de "quantos avisos de DAS
  -- calei?", e quem for auditar uma baixa no futuro leria o valor errado.
  v_ins         int := 0;
BEGIN
  IF p_origem NOT IN ('manual','conciliacao','conciliacao_confirmada','serpro') THEN
    RAISE EXCEPTION 'origem invalida: %', p_origem;
  END IF;

  SELECT company_id, data_pagamento, competencia_referencia
    INTO v_company, v_ja_paga, v_competencia
  FROM public.guias_fiscais WHERE id = p_guia_id AND deleted_at IS NULL;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'guia_inexistente');
  END IF;

  -- Autorizacao: ou quem chama e dono da empresa (caminho da tela), ou e o
  -- cron com service_role (caminho da conciliacao e o da SERPRO).
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
  -- e reprocessar a mesma transacao nao pode mover a data do pagamento. E o
  -- retorno cedo tambem e o que impede o aviso de sair duas vezes.
  IF v_ja_paga IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_estava_paga', true,
                              'notificacoes_resolvidas', 0, 'notificacao_criada', false);
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

  -- ── O aviso de pagamento confirmado (Frente 3) ────────────────────────────
  IF p_origem IN ('serpro','conciliacao') THEN
    -- Sem dono nao ha a quem avisar: empresa cadastrada pelo contador antes de
    -- o cliente aceitar o convite tem `user_id` nulo (companies.user_id e
    -- nullable). A baixa acontece do mesmo jeito; so o aviso e que nao tem
    -- destinatario.
    SELECT user_id INTO v_owner FROM public.companies WHERE id = v_company;

    IF v_owner IS NOT NULL THEN
      v_fonte := CASE p_origem
                   WHEN 'serpro' THEN 'confirmado pela Receita'
                   ELSE 'confirmado pelo extrato da conta conectada'
                 END;

      -- `chave` unica por guia + o indice notifications_owner_chave_uidx (0045)
      -- fazem a idempotencia ser do BANCO, nao da esperanca: o cron roda todo
      -- dia sobre a mesma janela, e duas rodadas nao podem virar dois avisos.
      INSERT INTO public.notifications
        (owner_user_id, company_id, tipo, severidade, titulo, corpo, entidade_ref, action_href, chave)
      VALUES (
        v_owner, v_company, 'pagamento_confirmado', 'info',
        'Pagamento confirmado',
        CASE
          WHEN v_competencia ~ '^\d{6}$'
            THEN 'DAS de ' || substr(v_competencia, 5, 2) || '/' || substr(v_competencia, 1, 4)
                 || ' · ' || v_fonte || '. Nada a fazer.'
          ELSE 'Seu DAS foi ' || v_fonte || '. Nada a fazer.'
        END,
        p_guia_id::text, '/impostos',
        'pagamento_confirmado:' || p_guia_id::text
      )
      ON CONFLICT (owner_user_id, chave) DO NOTHING;
      GET DIAGNOSTICS v_ins = ROW_COUNT;
      v_avisou := v_ins > 0;
    END IF;
  END IF;

  -- Colunas conferidas contra a 0038: `alvo_id` e uuid (nao text) e o jsonb
  -- chama `meta` (nao `metadata`). Errar aqui so apareceria em runtime.
  INSERT INTO public.audit_log (actor_user_id, acao, alvo_tipo, alvo_id, meta)
  VALUES (
    CASE WHEN v_service THEN NULL ELSE auth.uid() END,
    'guia.pagamento_registrado', 'guia_fiscal', p_guia_id,
    jsonb_build_object('origem', p_origem, 'data_pagamento', p_data_pagamento,
                       'transacao_id', p_transacao_id, 'notificacoes_resolvidas', v_notif,
                       'notificacao_criada', v_avisou)
  );

  RETURN jsonb_build_object('ok', true, 'ja_estava_paga', false,
                            'notificacoes_resolvidas', v_notif,
                            'notificacao_criada', v_avisou);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_guia(uuid, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_guia(uuid, date, text, uuid) TO authenticated, service_role;
