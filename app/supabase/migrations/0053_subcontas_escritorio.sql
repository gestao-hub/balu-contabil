-- 0053 — Bloco 4B: o escritorio cobrando pela propria subconta Asaas.
--
-- PRINCIPIO (spec §1): a Balu nao intermedia dinheiro de terceiro. A cobranca
-- nasce NA SUBCONTA do escritorio, o credor e ele, o dinheiro liquida na conta
-- dele. Por isso estas cobrancas NAO entram em public.cobrancas, que e o
-- dinheiro da Balu: tabela separada, sem coluna em comum a ser confundida.

-- ------------------------------------------------ vinculo da subconta
ALTER TABLE public.contabilidades
  ADD COLUMN IF NOT EXISTS asaas_subconta_id      text,
  ADD COLUMN IF NOT EXISTS asaas_wallet_id        text,
  -- Cifrada com cifrarCampo (envelope AES-256-GCM do Bloco E). NUNCA em claro.
  -- O Asaas devolve esta chave UMA UNICA VEZ, na criacao; perdida, a subconta
  -- fica inoperavel pela Balu.
  ADD COLUMN IF NOT EXISTS asaas_api_key_cifrada  text,
  -- 'ausente' | 'pendente' (KYC em analise) | 'aprovada' | 'recusada'
  ADD COLUMN IF NOT EXISTS asaas_subconta_status  text NOT NULL DEFAULT 'ausente',
  ADD COLUMN IF NOT EXISTS asaas_subconta_criada_em timestamptz;

ALTER TABLE public.contabilidades
  DROP CONSTRAINT IF EXISTS contabilidades_subconta_status_check;
ALTER TABLE public.contabilidades
  ADD CONSTRAINT contabilidades_subconta_status_check
  CHECK (asaas_subconta_status IN ('ausente','pendente','aprovada','recusada'));

COMMENT ON COLUMN public.contabilidades.asaas_api_key_cifrada IS
  'apiKey da subconta Asaas, cifrada por cifrarCampo. Movimenta dinheiro de TERCEIRO — mais sensivel que a service role. Nunca sai para o cliente, nunca entra em log.';

-- ------------------------------------------------ catalogo de avulsos
CREATE TABLE IF NOT EXISTS public.servicos_avulsos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  nome             text NOT NULL,
  categoria        text,
  -- Percentual desde o comeco (spec §5): recuperacao de credito e cobrada como
  -- % do valor recuperado e taxa de urgencia como % do servico-base. Migrar
  -- depois para incluir isso sairia caro.
  tipo_valor       text NOT NULL DEFAULT 'fixo',
  valor_centavos   integer,
  percentual       numeric(5,2),
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servicos_avulsos_tipo_check CHECK (tipo_valor IN ('fixo','percentual')),
  -- Cada tipo exige o SEU campo e proibe o outro: uma linha 'fixo' com
  -- percentual preenchido nao diz qual dos dois vale.
  CONSTRAINT servicos_avulsos_valor_check CHECK (
    (tipo_valor = 'fixo'       AND valor_centavos IS NOT NULL AND valor_centavos > 0 AND percentual IS NULL)
    OR
    (tipo_valor = 'percentual' AND percentual     IS NOT NULL AND percentual > 0     AND valor_centavos IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS servicos_avulsos_contabilidade_idx
  ON public.servicos_avulsos(contabilidade_id) WHERE ativo;

-- ------------------------------------------------ cobrancas do escritorio
CREATE TABLE IF NOT EXISTS public.cobrancas_escritorio (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id   uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  empresa_cliente_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  honorario_id       uuid REFERENCES public.honorarios(id) ON DELETE SET NULL,
  servico_avulso_id  uuid REFERENCES public.servicos_avulsos(id) ON DELETE SET NULL,
  asaas_charge_id    text NOT NULL,
  descricao          text NOT NULL,
  status             text NOT NULL,
  valor_centavos     integer NOT NULL,
  vencimento         date NOT NULL,
  pago_em            date,
  link_fatura        text,
  pix_copia_cola     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- O webhook acha a cobranca por este id; unico para o evento reentregue nao
-- criar linha duplicada (o Asaas reentrega, e ja mordeu este projeto no 4A).
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_escritorio_charge_unique
  ON public.cobrancas_escritorio(asaas_charge_id);
CREATE INDEX IF NOT EXISTS cobrancas_escritorio_contabilidade_idx
  ON public.cobrancas_escritorio(contabilidade_id);
CREATE INDEX IF NOT EXISTS cobrancas_escritorio_cliente_idx
  ON public.cobrancas_escritorio(empresa_cliente_id);

-- ------------------------------------------------ honorarios
ALTER TABLE public.honorarios
  ADD COLUMN IF NOT EXISTS cobranca_escritorio_id uuid
    REFERENCES public.cobrancas_escritorio(id) ON DELETE SET NULL,
  -- Decisao 7.4: o semaforo do painel e AUTOMATICO onde houver cobranca pela
  -- subconta e MANUAL onde nao houver. Sem esta coluna, um campo `status`
  -- unico sobrescrito pelos dois caminhos esconde qual deles falou por ultimo.
  ADD COLUMN IF NOT EXISTS pagamento_origem text;

ALTER TABLE public.honorarios
  DROP CONSTRAINT IF EXISTS honorarios_pagamento_origem_check;
ALTER TABLE public.honorarios
  ADD CONSTRAINT honorarios_pagamento_origem_check
  CHECK (pagamento_origem IS NULL OR pagamento_origem IN ('asaas','manual'));

-- ------------------------------------------------ RLS
ALTER TABLE public.servicos_avulsos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas_escritorio  ENABLE ROW LEVEL SECURITY;

-- Catalogo: so o escritorio dono le. Escrita so pelo service role (actions),
-- mesma forma de assinaturas na 0050.
DROP POLICY IF EXISTS servicos_avulsos_select_dono ON public.servicos_avulsos;
CREATE POLICY servicos_avulsos_select_dono ON public.servicos_avulsos
  FOR SELECT USING (contabilidade_id = public.minha_contabilidade_membro());

-- Cobrancas: o escritorio le as que emitiu; o CLIENTE le as dele (decisao 7.3
-- — ele ve as cobrancas dentro do app). Duas pernas, uma policy.
DROP POLICY IF EXISTS cobrancas_escritorio_select ON public.cobrancas_escritorio;
CREATE POLICY cobrancas_escritorio_select ON public.cobrancas_escritorio
  FOR SELECT USING (
    contabilidade_id = public.minha_contabilidade_membro()
    OR EXISTS (
      SELECT 1 FROM public.companies c
       WHERE c.id = cobrancas_escritorio.empresa_cliente_id AND c.user_id = auth.uid()
    )
  );

-- ------------------------------------------------ blindagem das colunas da subconta
-- A 0035 (linhas 20-27) da a QUALQUER membro do escritorio SELECT e UPDATE em
-- public.contabilidades sem restricao de coluna. As colunas asaas* acima caem
-- debaixo dessas policies: pela anon key, do navegador, um membro poderia
-- autoaprovar o proprio KYC ('aprovada'), repontar a carteira para outra, ou
-- ZERAR asaas_api_key_cifrada — que o Asaas devolve uma unica vez, tornando a
-- subconta inoperavel sem volta. RLS decide QUAIS LINHAS; so o GRANT decide
-- QUAIS COLUNAS. Por isso o corte e por privilegio de coluna.
--
-- A leitura da chave e revogada porque o COMMENT dela promete "nunca sai para
-- o cliente" — sem isto a promessa era so um comentario. O service role bypassa
-- RLS e nao e alcancado por REVOKE em anon/authenticated, entao as Server
-- Actions seguem lendo e escrevendo normalmente. Mesmo espirito de
-- serpro_contratante (0017:25), a outra tabela de credencial cifrada da casa.
-- ATENCAO ao idioma abaixo. `REVOKE UPDATE (coluna)` NAO funciona aqui, e o
-- silencio engana: o privilegio efetivo e a UNIAO do grant de tabela com o de
-- coluna, entao revogar a coluna enquanto anon/authenticated tem UPDATE de
-- TABELA nao tira nada e nao levanta erro. Provado contra o banco em 28/07:
-- com o REVOKE de coluna aplicado, um membro simulado ainda zerava
-- asaas_api_key_cifrada. So revogar no nivel da tabela e reconceder as colunas
-- permitidas corta de verdade.
--
-- O grant de TABELA nem foi pedido por este projeto: veio do
-- ALTER DEFAULT PRIVILEGES do Supabase, que concede tudo em public para
-- anon/authenticated e assim anulou, calado, o GRANT por coluna da 0030:84.
-- A lista reconcedida abaixo e exatamente a de la — as unicas colunas que o
-- app escreve com cliente autenticado (contador/actions.ts:193-197 e
-- api/contador/logo/route.ts:88-90). Um `GRANT ALL ON ALL TABLES` futuro
-- reabre isto sem avisar.
REVOKE UPDATE ON public.contabilidades FROM anon, authenticated;
GRANT UPDATE (nome, logo_url, whatsapp_suporte, email_remetente_nome)
  ON public.contabilidades TO authenticated;

-- SELECT: mesmo motivo, mesma forma. Subtrai SO a chave cifrada e reconcede o
-- resto para os dois papeis, para nao mudar nada alem do pretendido. Dinamico
-- porque uma lista fixa apodrece a cada coluna nova; ainda assim, coluna nova
-- em contabilidades so passa a ser legivel depois de reaplicar este bloco.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'contabilidades'
     AND column_name <> 'asaas_api_key_cifrada';
  EXECUTE 'REVOKE SELECT ON public.contabilidades FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.contabilidades TO anon, authenticated', cols);
END $$;

-- Duas contabilidades apontando para a mesma subconta e dinheiro liquidando na
-- conta do escritorio errado. Parcial porque 'ausente' e o estado normal de
-- quem ainda nao fez o onboarding. Padrao da 0050:50-53.
CREATE UNIQUE INDEX IF NOT EXISTS contabilidades_asaas_subconta_uidx
  ON public.contabilidades(asaas_subconta_id) WHERE asaas_subconta_id IS NOT NULL;

-- ------------------------------------------------ integridade das cobrancas
-- statusDoAsaas() normaliza todo status do Asaas para um destes quatro e nunca
-- emite outro. Deixar so o TypeScript garantir isso seria incoerente com os
-- outros dois conjuntos fechados deste mesmo arquivo.
ALTER TABLE public.cobrancas_escritorio
  DROP CONSTRAINT IF EXISTS cobrancas_escritorio_status_check;
ALTER TABLE public.cobrancas_escritorio
  ADD CONSTRAINT cobrancas_escritorio_status_check
  CHECK (status IN ('pendente','paga','vencida','estornada'));

-- Cobranca de zero ou negativa nao e cobranca. servicos_avulsos ja exige.
ALTER TABLE public.cobrancas_escritorio
  DROP CONSTRAINT IF EXISTS cobrancas_escritorio_valor_check;
ALTER TABLE public.cobrancas_escritorio
  ADD CONSTRAINT cobrancas_escritorio_valor_check
  CHECK (valor_centavos > 0);

-- Cada ON DELETE SET NULL varre a filha atras das linhas a anular; sem indice
-- na coluna, apagar um honorario ou um item do catalogo vira seq scan.
CREATE INDEX IF NOT EXISTS cobrancas_escritorio_honorario_idx
  ON public.cobrancas_escritorio(honorario_id) WHERE honorario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cobrancas_escritorio_servico_idx
  ON public.cobrancas_escritorio(servico_avulso_id) WHERE servico_avulso_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS honorarios_cobranca_escritorio_idx
  ON public.honorarios(cobranca_escritorio_id) WHERE cobranca_escritorio_id IS NOT NULL;
