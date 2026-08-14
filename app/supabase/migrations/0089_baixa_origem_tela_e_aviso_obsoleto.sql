-- Rodada de revisão de 14/08/2026 — dois defeitos em `registrar_pagamento_guia`,
-- ambos nascidos com a 0087.
--
-- ⚠️ ORDEM OBRIGATÓRIA: **aplicar esta migration ANTES de subir o deploy** que
-- passa `p_origem => 'serpro_tela'`. A função valida a origem e LEVANTA EXCEÇÃO
-- para valor fora da lista — código novo contra banco velho quebra a
-- sincronização de /impostos inteira. O caminho inverso é inofensivo: esta
-- migration aplicada sem o deploy não muda comportamento nenhum, porque nada
-- ainda usa a origem nova.
--
--
-- ── 1. A SINCRONIZAÇÃO PELA TELA VIRA UMA ORIGEM PRÓPRIA ────────────────────
--
-- A 0087 estabeleceu a regra certa e classificou um caso errado. A regra: só
-- descoberta AUTOMÁTICA avisa, porque "em 'manual' quem deu a baixa foi o
-- próprio dono olhando para a tela" — e o cabeçalho dela conclui que
-- "notificacao que repete ato do usuario e como o cliente aprende a ignorar as
-- outras".
--
-- Só que `impostos/actions.ts` passa 'serpro' quando o usuário CLICA em
-- "Atualizar". É o mesmo dono, olhando para a mesma tela, vendo as guias
-- ficarem verdes na frente dele — e recebendo um aviso por competência mesmo
-- assim.
--
-- O estrago concreto é na PRIMEIRA sincronização de um cliente novo, que é
-- justamente o pior momento para errar: o ano inteiro é descoberto de uma vez,
-- e um cliente em dia gera até 12 avisos `pagamento_confirmado` de pagamentos
-- feitos meses atrás. Como `notificacoes_pendentes_email` não filtra por tipo,
-- isso vira até 12 e-mails; e `suprimir_whatsapp_superadas` (0068) só coalesce
-- das_a_vencer/das_vencido, então no dia em que o UAZAPI_TOKEN existir vira
-- também uma rajada de 12 mensagens.
--
-- 'serpro'      = varredura diária do cron (automática)  → AVISA
-- 'serpro_tela' = botão "Atualizar" do /impostos (humana) → NÃO avisa
--
-- A auditoria continua distinguindo os dois, que é o outro motivo para ser uma
-- origem nova em vez de reusar 'manual': 'manual' quer dizer "o dono digitou a
-- data", e isso não foi o que aconteceu.
--
--
-- ── 2. O AVISO OBSOLETO QUE SOBREVIVIA À BAIXA ──────────────────────────────
--
-- A função resolvia só `das_a_vencer` e `das_vencido`. Mas a conciliação
-- (lib/conciliacao/cron.ts) cria `pagamento_nao_detectado` para a MESMA guia,
-- com o mesmo `entidade_ref`, dizendo "não identificamos o pagamento desta
-- guia".
--
-- Quando o pagamento aparecia depois, a baixa criava "Pagamento confirmado" e
-- deixava o "não identificamos" de pé, com `resolvida_em` nulo. Os dois ficavam
-- lado a lado no sino, contradizendo um ao outro — e, como
-- `notificacoes_pendentes_email`/`_whatsapp` filtram só por `resolvida_em`, o
-- aviso obsoleto continuava na fila para ser ENVIADO depois de já ser falso.

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
  v_ins         int := 0;
BEGIN
  IF p_origem NOT IN ('manual','conciliacao','conciliacao_confirmada','serpro','serpro_tela') THEN
    RAISE EXCEPTION 'origem invalida: %', p_origem;
  END IF;

  -- Guarda nova: sem data, a baixa é veneno. `data_pagamento IS NOT NULL` é o
  -- SINAL DE IDEMPOTÊNCIA desta função (ver o retorno cedo mais abaixo) —
  -- gravar 'paga' com data nula faria toda rodada seguinte reprocessar a mesma
  -- guia e empilhar auditoria para sempre. Os chamadores já filtram isso
  -- (`planejarBaixas` conta em `semDataDePagamento`), mas a regra pertence ao
  -- ponto de escrita, que é o que esta função existe para ser.
  IF p_data_pagamento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'data_pagamento_ausente');
  END IF;

  SELECT company_id, data_pagamento, competencia_referencia
    INTO v_company, v_ja_paga, v_competencia
  FROM public.guias_fiscais WHERE id = p_guia_id AND deleted_at IS NULL;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'guia_inexistente');
  END IF;

  v_service := auth.uid() IS NULL;
  IF NOT v_service AND NOT public.user_owns_company(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nao_autorizado');
  END IF;

  IF v_ja_paga IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_estava_paga', true,
                              'notificacoes_resolvidas', 0, 'notificacao_criada', false);
  END IF;

  UPDATE public.guias_fiscais
  SET status = 'paga', data_pagamento = p_data_pagamento, updated_at = now()
  WHERE id = p_guia_id;

  -- `pagamento_nao_detectado` entra na lista (item 2 do cabeçalho): ele fala da
  -- MESMA guia, pelo mesmo `entidade_ref`, e "não identificamos o pagamento"
  -- deixa de ser verdade no instante em que a baixa acontece.
  UPDATE public.notifications
  SET resolvida_em = now(), lida_em = COALESCE(lida_em, now())
  WHERE resolvida_em IS NULL
    AND tipo IN ('das_a_vencer','das_vencido','pagamento_nao_detectado')
    AND entidade_ref = p_guia_id::text;
  GET DIAGNOSTICS v_notif = ROW_COUNT;

  IF p_transacao_id IS NOT NULL THEN
    UPDATE public.conciliacao_transacoes
    SET guia_id = p_guia_id, conciliada_em = now(), conciliacao_origem = p_origem
    WHERE id = p_transacao_id;
  END IF;

  -- 'serpro_tela' NÃO entra aqui: é o dono clicando em "Atualizar" e vendo a
  -- guia ficar verde na própria tela. Mesma razão de 'manual'.
  IF p_origem IN ('serpro','conciliacao') THEN
    SELECT user_id INTO v_owner FROM public.companies WHERE id = v_company;

    IF v_owner IS NOT NULL THEN
      v_fonte := CASE p_origem
                   WHEN 'serpro' THEN 'confirmado pela Receita'
                   ELSE 'confirmado pelo extrato da conta conectada'
                 END;

      -- Envelopado: um aviso que não pôde ser criado NÃO pode desfazer a baixa.
      -- Sem o BEGIN/EXCEPTION, qualquer falha aqui dentro (violação do CHECK de
      -- tipo com a 0086 fora de sincronia, gatilho novo, cache de schema velho)
      -- estoura e o plpgsql desfaz a transação inteira — inclusive o
      -- `UPDATE guias_fiscais` acima. O pagamento deixaria de ser registrado
      -- por causa de um aviso, silenciosamente, em TODOS os caminhos de baixa.
      -- É a mesma decisão que `aplicar-cobranca-escritorio.ts` já toma do lado
      -- do Asaas: "o dinheiro já foi escrito, e um aviso que não saiu não pode
      -- desfazer isso".
      BEGIN
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
      EXCEPTION WHEN OTHERS THEN
        v_avisou := false;
        RAISE WARNING 'registrar_pagamento_guia: aviso nao criado para guia % (%)', p_guia_id, SQLERRM;
      END;
    END IF;
  END IF;

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
