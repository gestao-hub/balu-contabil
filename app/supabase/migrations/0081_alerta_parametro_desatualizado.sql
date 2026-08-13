-- O app passa a AVISAR sozinho quando um parametro fiscal ficou para tras.
--
-- A 0079/0080 tiraram a tabela do Simples e o salario minimo do codigo: trocar
-- o valor virou INSERT com vigencia, e a troca passa a valer sozinha na data.
-- Sobrou o elo humano: alguem precisa LEMBRAR de cadastrar o valor novo. Foi
-- exatamente esse elo que falhou em 2026 — o minimo mudou em janeiro e o
-- sistema seguiu sete meses estimando DAS-MEI com o de 2025, sem que nada no
-- app reclamasse.
--
-- Este e o alarme. Ele nao inventa o valor novo (chutar imposto e pior do que
-- ficar desatualizado): ele detecta que a vigencia mais recente do salario
-- minimo e de um ano anterior ao de hoje e avisa quem pode cadastrar.
--
-- Salario minimo muda por ano civil, entao a regra e por ANO e nao por
-- "N dias sem atualizar": em 3 de janeiro o parametro ja esta velho, e em 20
-- de dezembro o de janeiro ainda esta perfeito.
--
-- ⚠️ A lista de tipos abaixo e a VIVA, lida do banco em 12/08/2026 (15 tipos),
-- mais o novo. Mesmo cuidado que a 0070 documenta: recriar esta constraint com
-- uma lista "do plano" ja quase apagou dois tipos uma vez (acidente na 0061).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado',
  'sla_estourado','pagamento_nao_detectado',
  'parametro_fiscal_desatualizado'
));

CREATE OR REPLACE FUNCTION public.alertar_parametros_desatualizados(
  p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_ano_hoje    integer := EXTRACT(YEAR FROM p_hoje);
  v_ano_vigente integer;
  v_n           integer := 0;
BEGIN
  SELECT EXTRACT(YEAR FROM MAX(vigencia_inicio)) INTO v_ano_vigente
    FROM public.parametros_fiscais
   WHERE chave = 'salario_minimo'
     AND vigencia_inicio <= p_hoje;

  -- Sem nenhuma linha o app cai no fallback do codigo, que TAMBEM avisa: e o
  -- caso de banco recem-restaurado ou seed incompleto, e continua sendo algo
  -- que o AdminBalu precisa ver.
  IF v_ano_vigente IS NOT NULL AND v_ano_vigente >= v_ano_hoje THEN
    RETURN 0;
  END IF;

  -- Um aviso por AdminBalu. Ninguem mais pode cadastrar parametro, entao
  -- avisar o resto da base seria barulho sobre algo que o usuario nao resolve.
  INSERT INTO public.notifications
    (owner_user_id, tipo, severidade, titulo, corpo, norma, action_href, chave)
  SELECT r.user_id,
         'parametro_fiscal_desatualizado',
         'warning',
         'Salário mínimo desatualizado',
         CASE WHEN v_ano_vigente IS NULL
              THEN 'Não há salário mínimo cadastrado. O DAS-MEI está sendo estimado pelo valor de reserva do sistema. Cadastre o valor vigente.'
              ELSE 'O salário mínimo mais recente cadastrado é de ' || v_ano_vigente ||
                   ', e estamos em ' || v_ano_hoje ||
                   '. Enquanto não for cadastrado o valor deste ano, o DAS-MEI é estimado pelo valor antigo.'
         END,
         'LC 123/2006, art. 18-A, §3º, V',
         '/admin/configuracoes/parametros',
         -- Uma vez por ano, nao por dia: o indice unico (owner_user_id, chave)
         -- transforma o cron diario num aviso so, que reaparece na virada do
         -- ano seguinte.
         'parametro_desatualizado:salario_minimo:' || v_ano_hoje
    FROM public.role_types r
   WHERE r.type = 'AdminBalu'
  ON CONFLICT (owner_user_id, chave) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.alertar_parametros_desatualizados(date) IS
  'Avisa o AdminBalu quando o salario minimo vigente e de um ano anterior ao corrente. Nao inventa valor: so alerta. Chamada pelo /api/cron/obrigacoes.';

REVOKE ALL ON FUNCTION public.alertar_parametros_desatualizados(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alertar_parametros_desatualizados(date) TO service_role;
