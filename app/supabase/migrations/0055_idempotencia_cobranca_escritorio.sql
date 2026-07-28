-- 0055 — idempotencia da emissao de cobranca do escritorio (Bloco 4B).
--
-- O PROBLEMA: dois cliques SIMULTANEOS em "cobrar" emitem DUAS cobrancas no
-- Asaas — dois boletos reais na mao do cliente do escritorio. Botao desabilitado
-- nao alcanca duas abas nem POST direto. O banco e o unico lugar onde as duas
-- requisicoes se encontram.
--
-- ┌─ ESTE ARQUIVO TEM DUAS CAMADAS, E A SEGUNDA E A QUE IMPORTA ────────────┐
-- │                                                                         │
-- │ 1. INDICES UNICOS (o estado duravel). Garantem que NUNCA existam duas   │
-- │    linhas para a mesma divida. Mas eles arbitram DEPOIS da chamada ao   │
-- │    Asaas: nos dois cliques simultaneos, os dois boletos ja nasceram e   │
-- │    so a segunda LINHA e recusada. O segundo boleto fica ORFAO — o       │
-- │    webhook o trataria como 'cobranca_desconhecida' e ele sumiria do     │
-- │    painel. Isso e PIOR que duplicado e rastreado.                       │
-- │                                                                         │
-- │ 2. RESERVA (`reservas_cobranca_escritorio` + as duas RPCs). Arbitra     │
-- │    ANTES da chamada ao Asaas: quem perde a corrida nao chega a falar    │
-- │    com o Asaas, e o segundo boleto NAO NASCE. E a camada que resolve o  │
-- │    problema; os indices ficam como rede de baixo.                       │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- A metade de codigo mora em `app/src/lib/billing/emitir-cobranca.ts`, o unico
-- lugar que faz o INSERT em `cobrancas_escritorio`. As duas entram JUNTAS: sem
-- o codigo, `idempotency_key` fica sempre NULL, a reserva nunca e tomada, e o
-- indice do honorario passa a produzir exatamente o boleto orfao descrito acima.

-- ══════════════════════════════════════════════════════════════════════════
-- CAMADA 1 — O ESTADO DURAVEL
-- ══════════════════════════════════════════════════════════════════════════

-- ------------------------------------------------ honorario: chave natural
-- UMA COBRANCA VIVA POR HONORARIO.
--
-- O predicado repete, no banco, a particao `STATUS_VIVOS` / `STATUS_MORTOS` de
-- lib/billing/cobranca-escritorio.ts. As duas TEM de concordar: se a guarda da
-- action considerar morto um status que o indice considera vivo, a tela deixa
-- passar o que o banco recusa — e o contador ve um erro de Postgres.
--
-- `estornada` FICA DE FORA de proposito (decisao do usuario, 28/07): estorno
-- acontece por valor errado, dados errados ou acordo, e a divida continua
-- existindo. Se `estornada` contasse como viva, o honorario estornado nunca
-- mais poderia ser recobrado pela tela. Um futuro 'cancelada' tambem fica de
-- fora — e entra, no mesmo dia, em STATUS_MORTOS.
--
-- `vencida` fica DENTRO: no Asaas o boleto vencido continua pagavel, entao
-- emitir outra e mandar um segundo boleto da mesma divida.
DROP INDEX IF EXISTS public.cobrancas_escritorio_honorario_viva_uidx;
CREATE UNIQUE INDEX cobrancas_escritorio_honorario_viva_uidx
  ON public.cobrancas_escritorio(honorario_id)
  WHERE honorario_id IS NOT NULL AND status IN ('pendente','paga','vencida');

COMMENT ON INDEX public.cobrancas_escritorio_honorario_viva_uidx IS
  'Uma cobranca VIVA por honorario. O predicado espelha STATUS_VIVOS de lib/billing/cobranca-escritorio.ts — mudar um exige mudar o outro.';

-- ------------------------------------------------ avulso: chave de idempotencia
-- O avulso NAO TEM chave natural: cobrar duas vezes o mesmo servico do mesmo
-- cliente e legitimo (dois meses de consultoria, duas certidoes para dois
-- socios). Entao a chave nao pode descrever O QUE se cobra — ela descreve QUAL
-- SUBMISSAO esta se repetindo.
--
-- Gerada no cliente com crypto.randomUUID() UMA VEZ POR ABERTURA DO FORMULARIO
-- e renovada so apos uma emissao bem-sucedida. Assim:
--   * dois cliques no mesmo formulario  -> mesma chave -> o 2o INSERT bate 23505;
--   * F5 / resubmit da mesma tela       -> mesma chave -> idem;
--   * "cobrar de novo" (formulario novo)-> chave nova  -> emite, como deve.
--
-- Escopada por contabilidade e nao global: a chave vem do navegador de um
-- terceiro, e uma colisao forjada nao pode alcancar a carteira de outro
-- escritorio. NULL fica de fora do indice — linhas anteriores a esta migration,
-- e o caminho do honorario (que ja tem chave natural), nao carregam chave.
--
-- SEM predicado de status, ao contrario do indice de cima: a chave descreve uma
-- submissao HTTP, nao uma divida. Estornar e recobrar usa formulario novo, logo
-- chave nova, logo nao colide.
ALTER TABLE public.cobrancas_escritorio
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.cobrancas_escritorio
  DROP CONSTRAINT IF EXISTS cobrancas_escritorio_idem_formato_check;
ALTER TABLE public.cobrancas_escritorio
  ADD CONSTRAINT cobrancas_escritorio_idem_formato_check
  CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

DROP INDEX IF EXISTS public.cobrancas_escritorio_idem_uidx;
CREATE UNIQUE INDEX cobrancas_escritorio_idem_uidx
  ON public.cobrancas_escritorio(contabilidade_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.cobrancas_escritorio.idempotency_key IS
  'UUID gerado pelo navegador por abertura do formulario de cobranca avulsa. Identifica a SUBMISSAO, nao a divida: cobrar o mesmo servico de novo usa chave nova.';

-- ══════════════════════════════════════════════════════════════════════════
-- CAMADA 2 — A RESERVA, QUE ARBITRA ANTES DO ASAAS
-- ══════════════════════════════════════════════════════════════════════════
--
-- ┌─ POR QUE UMA TABELA SEPARADA, E NAO UMA LINHA "reservada" NA PROPRIA ───┐
-- │ `cobrancas_escritorio`?                                                 │
-- │  * `asaas_charge_id` e NOT NULL e UNIQUE (0053) — antes do Asaas nao ha │
-- │    id, e um placeholder ficaria visivel para o CLIENTE (a policy de     │
-- │    SELECT da 0053 da acesso a ele) e seria varrido pela reconciliacao;  │
-- │  * `status` tem CHECK fechado nos quatro valores que descrevem DINHEIRO;│
-- │    um quinto valor ('reservada') teria de ser ensinado ao webhook, ao   │
-- │    cron, a `cobrancaViva` e as telas — para descrever algo que nao e    │
-- │    dinheiro, e sim um TRINCO que vive 2 minutos.                        │
-- │ A reserva e um trinco. Trinco mora em tabela de trinco.                 │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ A RESERVA NAO PODE VIRAR LAPIDE ───────────────────────────────────────┐
-- │ Se o processo morrer entre reservar e emitir (deploy no meio, funcao    │
-- │ da Vercel morta por timeout, queda de rede), uma reserva sem TTL        │
-- │ trancaria aquele honorario PARA SEMPRE, e nem o suporte saberia por que.│
-- │ Por isso toda reserva nasce com `expira_em`, e `reservar_emissao_       │
-- │ cobranca` ROUBA a reserva vencida no mesmo statement em que a cria      │
-- │ (ON CONFLICT DO UPDATE ... WHERE expira_em < now()). O pior caso deixa  │
-- │ de ser "trancado para sempre" e passa a ser "trancado por 2 minutos".   │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE TABLE IF NOT EXISTS public.reservas_cobranca_escritorio (
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  -- UMA chave por linha, e nao duas colunas nullable com dois indices unicos:
  -- `ON CONFLICT` so sabe inferir UM alvo, e uma linha capaz de colidir por
  -- dois caminhos diferentes faria o segundo estourar 23505 cru em vez de
  -- devolver "perdi a corrida". Formato: 'hon:<uuid>' | 'idem:<uuid>'.
  chave            text NOT NULL,
  -- Quem tomou a reserva. Existe para que LIBERAR seja exato: sem ele, um
  -- pedido cuja reserva ja tinha vencido e sido roubada por outro apagaria, ao
  -- terminar, a reserva VIVA do outro — e abriria a porta para o segundo boleto
  -- justamente no caso em que o primeiro demorou.
  dono             uuid NOT NULL,
  expira_em        timestamptz NOT NULL,
  criada_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contabilidade_id, chave),
  CONSTRAINT reservas_cobranca_chave_formato_check
    CHECK (chave ~ '^(hon|idem):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

COMMENT ON TABLE public.reservas_cobranca_escritorio IS
  'Trinco de curta duracao que arbitra dois cliques simultaneos ANTES da chamada ao Asaas. Nao e dado de negocio: nada aqui sobrevive a emissao, e toda linha expira sozinha.';

-- ------------------------------------------------ RPCs
-- Duas RPCs e nao dois `.from()` do supabase-js por um motivo so: o "roubar se
-- vencida" precisa de `ON CONFLICT DO UPDATE ... WHERE`, que o PostgREST nao
-- expressa. Fora de um unico statement atomico, a corrida volta.

-- Devolve o `dono` da reserva quando ELA E NOSSA, e NULL quando outro pedido
-- ja a tem e ela ainda esta viva. `NULL` = perdi a corrida = nao chame o Asaas.
CREATE OR REPLACE FUNCTION public.reservar_emissao_cobranca(
  p_contabilidade uuid, p_chave text, p_ttl_segs int DEFAULT 120
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dono uuid;
BEGIN
  INSERT INTO reservas_cobranca_escritorio (contabilidade_id, chave, dono, expira_em)
  VALUES (p_contabilidade, p_chave, gen_random_uuid(), now() + make_interval(secs => p_ttl_segs))
  ON CONFLICT (contabilidade_id, chave) DO UPDATE
     SET dono = gen_random_uuid(), expira_em = EXCLUDED.expira_em, criada_em = now()
   -- A CLAUSULA QUE FAZ TUDO. Reserva viva -> zero linhas afetadas -> RETURNING
   -- nao devolve nada -> v_dono fica NULL -> o chamador perdeu a corrida.
   -- Reserva VENCIDA -> roubada aqui, atomicamente.
   WHERE reservas_cobranca_escritorio.expira_em < now()
  RETURNING dono INTO v_dono;

  -- Poda oportunista (best-effort, mesmo espirito de check_rate_limit/0037). So
  -- alcanca reserva vencida ha muito tempo: uma vencida ha pouco ainda pode ser
  -- ROUBADA por outro pedido, e apaga-la nao mudaria nada de util.
  DELETE FROM reservas_cobranca_escritorio WHERE expira_em < now() - interval '1 hour';

  RETURN v_dono;
END $$;

COMMENT ON FUNCTION public.reservar_emissao_cobranca(uuid, text, int) IS
  'Trinco da emissao. Devolve o dono da reserva, ou NULL quando outro pedido a tem viva. Chamada ANTES do Asaas — e o que impede o segundo boleto de nascer.';

-- Libera SO se a reserva ainda for nossa (`dono`). Devolve quantas apagou:
-- 0 significa que ela ja tinha vencido e sido roubada — e nao ha nada a fazer,
-- porque quem a roubou e quem manda agora.
CREATE OR REPLACE FUNCTION public.liberar_reserva_cobranca(
  p_contabilidade uuid, p_chave text, p_dono uuid
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM reservas_cobranca_escritorio
   WHERE contabilidade_id = p_contabilidade AND chave = p_chave AND dono = p_dono;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

COMMENT ON FUNCTION public.liberar_reserva_cobranca(uuid, text, uuid) IS
  'Devolve o trinco. So e chamada quando se SABE que nenhuma cobranca nasceu no Asaas — depois de uma recusa 4xx, por exemplo. Depois de erro ambiguo (5xx, timeout) a reserva fica de proposito e expira sozinha.';

-- ------------------------------------------------ privilegios
-- Trinco nao e dado de ninguem: nem o escritorio nem o cliente tem o que ler
-- aqui. RLS ligada SEM policy nenhuma ja fecha, mas o REVOKE explicito e a
-- licao registrada na 0053: o ALTER DEFAULT PRIVILEGES do Supabase concede
-- tudo em `public` para anon/authenticated, calado, em toda tabela nova.
ALTER TABLE public.reservas_cobranca_escritorio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservas_cobranca_escritorio FROM anon, authenticated;
GRANT ALL ON public.reservas_cobranca_escritorio TO service_role;

REVOKE ALL ON FUNCTION public.reservar_emissao_cobranca(uuid, text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_emissao_cobranca(uuid, text, int) TO service_role;
REVOKE ALL ON FUNCTION public.liberar_reserva_cobranca(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.liberar_reserva_cobranca(uuid, text, uuid) TO service_role;

-- Coluna, tabela e RPCs novas: rodar `node app/scratchpad/_reload-postgrest.mjs`.
