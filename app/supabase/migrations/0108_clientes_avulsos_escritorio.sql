-- 0108 — cobrança avulsa para quem NÃO está na carteira do escritório.
--
-- POR QUE EXISTE. Até aqui toda cobrança do escritório apontava para uma
-- empresa da carteira (`cobrancas_escritorio.empresa_cliente_id NOT NULL`). O
-- escritório também presta serviço pontual a quem não é cliente fixo — a
-- certidão de um conhecido, o IRPF de um sócio de outra empresa — e cadastrar
-- essa pessoa em `companies` a colocaria na CARTEIRA: ela passaria a contar na
-- faixa da assinatura, apareceria nas telas de obrigações e ganharia um
-- convite de app que ninguém pediu.
--
-- `clientes_avulsos` é só o destinatário de cobrança: nome, documento e os dois
-- canais por onde o escritório manda a fatura (WhatsApp e e-mail). Esse cliente
-- não tem login na Balu — por isso a tela de cobranças ganha o "compartilhar".
--
-- A cobrança aponta para UM dos dois, nunca para nenhum nem para ambos (CHECK).

-- ------------------------------------------------ clientes avulsos
CREATE TABLE IF NOT EXISTS public.clientes_avulsos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  nome             text NOT NULL,
  -- Só dígitos: 11 (CPF) ou 14 (CNPJ). É o que o Asaas recebe e o que deduplica.
  cpf_cnpj         text NOT NULL,
  email            text,
  -- Só dígitos, com DDD (sem o 55). O link do WhatsApp acrescenta o país.
  telefone         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clientes_avulsos_doc_check CHECK (cpf_cnpj ~ '^([0-9]{11}|[0-9]{14})$'),
  CONSTRAINT clientes_avulsos_nome_check CHECK (length(btrim(nome)) > 0),
  CONSTRAINT clientes_avulsos_tel_check CHECK (telefone IS NULL OR telefone ~ '^[0-9]{10,11}$')
);

-- Mesmo documento cadastrado duas vezes no mesmo escritório viraria duas
-- linhas com contato divergente; a action reaproveita a existente.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_avulsos_doc_unique
  ON public.clientes_avulsos(contabilidade_id, cpf_cnpj);

ALTER TABLE public.clientes_avulsos ENABLE ROW LEVEL SECURITY;

-- Leitura só do escritório dono; escrita só pelo service role (actions) —
-- mesma forma de `servicos_avulsos` (0053).
DROP POLICY IF EXISTS clientes_avulsos_select_dono ON public.clientes_avulsos;
CREATE POLICY clientes_avulsos_select_dono ON public.clientes_avulsos
  FOR SELECT USING (contabilidade_id = public.minha_contabilidade_membro());

-- Sem grant de escrita para os papéis do navegador: a policy acima só cobre
-- SELECT, e o grant de tabela nova não precisa ficar mais largo que isso.
REVOKE ALL ON public.clientes_avulsos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.clientes_avulsos FROM authenticated;
GRANT SELECT ON public.clientes_avulsos TO authenticated;

-- ------------------------------------------------ a cobrança aponta para um dos dois
ALTER TABLE public.cobrancas_escritorio
  ADD COLUMN IF NOT EXISTS cliente_avulso_id uuid
    REFERENCES public.clientes_avulsos(id) ON DELETE RESTRICT;

ALTER TABLE public.cobrancas_escritorio
  ALTER COLUMN empresa_cliente_id DROP NOT NULL;

ALTER TABLE public.cobrancas_escritorio
  DROP CONSTRAINT IF EXISTS cobrancas_escritorio_destino_check;
ALTER TABLE public.cobrancas_escritorio
  ADD CONSTRAINT cobrancas_escritorio_destino_check
  CHECK ((empresa_cliente_id IS NULL) <> (cliente_avulso_id IS NULL));

CREATE INDEX IF NOT EXISTS cobrancas_escritorio_cliente_avulso_idx
  ON public.cobrancas_escritorio(cliente_avulso_id) WHERE cliente_avulso_id IS NOT NULL;

-- ------------------------------------------------ guarda
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cobrancas_escritorio_destino_check'
  ) THEN
    RAISE EXCEPTION '0108: CHECK de destino não foi criado';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cobrancas_escritorio'
       AND column_name = 'empresa_cliente_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '0108: empresa_cliente_id continua NOT NULL';
  END IF;
END $$;
