-- 0100 — a dívida de coluna que a sessão 31 registrou e não fechou.
--
-- O QUE FICOU ESCRITO NA SESSÃO 31, palavra por palavra: "`profiles_update` e
-- `notas_fiscais_update` sem restrição de coluna. As guardas de aplicação
-- fecham os vetores conhecidos; a camada de banco é defesa em profundidade.
-- NÃO fiz porque travar `current_company` errado quebra o seletor de empresa
-- (4 pontos legítimos o escrevem)."
--
-- Esta migration fecha as duas. O que destravou foi medir, em 24/08/2026, QUEM
-- de fato escreve cada coluna — em vez de supor:
--
--   profiles: 4 linhas, todas com `current_company` que o dono POSSUI ou que
--             está na carteira do escritório dele (0 inválidas)
--   os 4 pontos que escrevem `current_company`: MenuLateral (troca de empresa),
--             onboarding/abertura (stub recém-criado, do próprio usuário),
--             notificacoes/abrir (só se a RLS de `companies` deixar ver), e a
--             RPC `add_company_to_profile` (empresa recém-criada pelo usuário)
--   notas_fiscais: NENHUMA função do banco escreve nela; do lado da aplicação,
--             só `notas_fiscais/actions.ts` e o webhook da Focus (já service role)
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

-- ── (1) `notas_fiscais`: o inquilino não atualiza nota nenhuma ──────────────
--
-- POR QUE TIRAR A POLICY INTEIRA, e não travar coluna por coluna. Tudo que se
-- grava numa nota depois do INSERT é FATO QUE VEIO DA FOCUS: `status`,
-- `numero_nf`, `serie`, `chave_acesso`, `protocolo_autorizacao`, `pdf_url`,
-- `xml_url`, `payload_focusnfe`, `cancelled_at`. Não existe uma única coluna
-- que o titular precise escrever com a própria mão. Uma trava seletiva
-- deixaria a policy de pé prometendo um direito que ninguém usa.
--
-- O QUE ISSO ARMAVA (nenhum era explorável hoje; os dois são bomba armada):
--
--   a) `xml_url` gravável pelo titular RECARREGA o SSRF que a sessão 31 fechou
--      do lado do fetch. Lá o buraco era uma URL relativa forjada levando o
--      token da Focus para o servidor do atacante; a correção foi na leitura, e
--      a ESCRITA continuou aberta por PATCH direto no PostgREST.
--   b) `status` e `valor_total` graváveis mexem na base de cálculo que a
--      apuração lê para gerar a guia — o imposto do próprio CNPJ, decidido
--      pelo navegador de quem paga.
--
-- O QUE MUDA NA APLICAÇÃO, e por que isto não quebra a emissão: as oito
-- escritas de `notas_fiscais/actions.ts` passaram a sair por `escritaDeNota()`
-- (service role) na mesma sessão desta migration, cada uma filtrando por um
-- `company_id` já PROVADO por `empresaDoDono`. O webhook da Focus já usava
-- service role. Aplicar esta migration sem aquele commit deixa emissão,
-- polling e cancelamento gravando no vazio — vão juntas.
--
-- O INSERT CONTINUA DE PÉ, de propósito: `notas_fiscais_insert` exige
-- `user_owns_company(company_id)`, e é ela a guarda de quem pode criar nota.
-- Emissão e lançamento manual inserem pela sessão do usuário.
DROP POLICY IF EXISTS notas_fiscais_update ON public.notas_fiscais;

-- O trigger da 0098 (`tg_notas_fiscais_ambiente_imutavel`) FICA. Sem policy de
-- UPDATE ele é inalcançável para o inquilino hoje, mas é o que segura o
-- carimbo de ambiente se alguém recriar a policy sem ler este cabeçalho.

COMMENT ON TABLE public.notas_fiscais IS
  'Nota fiscal. INSERT pelo titular (policy notas_fiscais_insert); UPDATE SÓ por service_role — ver 0100.';

-- ── (2) `profiles`: as colunas que não são do inquilino ─────────────────────
--
-- A policy `profiles_update` (0010) é `USING/CHECK user_id = auth.uid()`: ela
-- garante que a pessoa só mexe na PRÓPRIA linha, e nada além disso. Coluna
-- alguma tem restrição — medido em 24/08/2026, `authenticated` tem UPDATE nas
-- nove colunas da tabela.
--
-- MESMO MOLDE DA 0036 E DA 0098, pelo mesmo motivo: ACL de coluna não subtrai
-- do grant de tabela no Postgres, e mover coluna para tabela fechada quebraria
-- as leituras do produto.
--
-- ⚠️ SECURITY INVOKER É OBRIGATÓRIO (o padrão do plpgsql). No PostgREST toda
-- requisição loga como 'authenticator' e faz SET ROLE para o alvo do JWT; quem
-- distingue o chamador é `current_user`. Num SECURITY DEFINER `current_user`
-- viraria o dono da função (postgres) e o gate NUNCA bloquearia — armadilha
-- documentada na 0036 e repetida na 0098.
CREATE OR REPLACE FUNCTION public.tg_profiles_trava_colunas()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Backend passa. `anonimizar_usuario` (LGPD art. 18) é SECURITY DEFINER com
  -- dono `postgres` e escreve `deleted_at` — sem este desvio, o direito ao
  -- esquecimento morria com exceção.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- `IS DISTINCT FROM` e não `<>`: com NULL dos dois lados `<>` devolve NULL, o
  -- IF não dispara, e o gate passaria em silêncio justamente no estado inicial.
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.user_id    IS DISTINCT FROM OLD.user_id
     -- `company_id` é coluna MORTA: nenhuma linha do app a lê (dito por escrito
     -- em `(auth)/onboarding/actions.ts`, quando a 0083 tirou a RPC de escrevê-la).
     -- Coluna morta e gravável é a que ninguém audita e alguém um dia confia.
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- `deleted_at` é o carimbo de anonimização (LGPD): quem o escreve é a RPC,
     -- por cima deste gate. Pelo navegador, ninguém.
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION
      'PERFIL_COLUNA_RESTRITA: id, user_id, company_id, created_at e deleted_at nao sao alteraveis por aqui';
  END IF;

  -- `current_company` NÃO é travada — é escolha legítima do usuário, e travá-la
  -- quebraria o seletor de empresa. É VALIDADA: tem de ser empresa que o
  -- usuário possui, ou empresa da carteira do escritório dele.
  --
  -- O vetor que isto fecha está escrito em `lib/auth/empresa-dono.ts`: um
  -- `PATCH /rest/v1/profiles` apontando `current_company` para empresa alheia,
  -- porque daí em diante `resolverCredencialEmissao` e `tokenParaAmbiente`
  -- rodam com SERVICE ROLE e devolvem o token DECIFRADO daquela empresa.
  --
  -- O ramo da carteira NÃO é frouxidão: é o estado real de hoje (um dos quatro
  -- perfis é membro de escritório com a empresa do cliente ativa) e o que
  -- `notificacoes/abrir` já produz. Quem separa "vê a empresa" de "opera
  -- documento fiscal dela" é `empresaDoDono`, na aplicação, e continua sendo.
  --
  -- Só valida na MUDANÇA: um perfil cujo vínculo caiu depois (empresa
  -- transferida, escritório desvinculado) não pode ficar impedido de salvar o
  -- WhatsApp por causa de um valor antigo que ele não está tocando.
  IF NEW.current_company IS NOT NULL
     AND NEW.current_company IS DISTINCT FROM OLD.current_company
     AND NOT public.user_owns_company(NEW.current_company)
     AND NOT EXISTS (
       SELECT 1 FROM public.companies c
        WHERE c.id = NEW.current_company
          AND c.contabilidade_id = public.minha_contabilidade()
     )
  THEN
    RAISE EXCEPTION
      'EMPRESA_ATIVA_RESTRITA: a empresa ativa tem de ser sua ou da carteira do seu escritorio';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_profiles_trava_colunas ON public.profiles;
CREATE TRIGGER tg_profiles_trava_colunas
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_trava_colunas();

-- INSERT também: sem isto o perfil nasce já apontando para empresa alheia, e o
-- gate de UPDATE nunca chega a ver essa linha. Quem insere de verdade é
-- `onboarding/abertura` (stub recém-criado pelo próprio usuário) e a RPC
-- `add_company_to_profile` (SECURITY INVOKER, empresa recém-criada) — os dois
-- passam pela mesma regra de posse.
CREATE OR REPLACE FUNCTION public.tg_profiles_trava_colunas_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'PERFIL_COLUNA_RESTRITA: perfil nasce sem company_id e sem deleted_at';
  END IF;

  IF NEW.current_company IS NOT NULL
     AND NOT public.user_owns_company(NEW.current_company)
     AND NOT EXISTS (
       SELECT 1 FROM public.companies c
        WHERE c.id = NEW.current_company
          AND c.contabilidade_id = public.minha_contabilidade()
     )
  THEN
    RAISE EXCEPTION
      'EMPRESA_ATIVA_RESTRITA: a empresa ativa tem de ser sua ou da carteira do seu escritorio';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_profiles_trava_colunas_insert ON public.profiles;
CREATE TRIGGER tg_profiles_trava_colunas_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_trava_colunas_insert();

-- ── (3) o número de WhatsApp guardado em UMA forma só ───────────────────────
--
-- A canonicalização (tira máscara, exige +55 e 12+ dígitos) mora em
-- `conta/actions.ts` e SÓ lá. Um PATCH direto no PostgREST grava
-- "+55 32 98700-6789" e "5532987006789" como valores diferentes do mesmo
-- celular: o índice único `profiles_whatsapp_numero_uidx` não dedupe mais
-- nada, e a RPC que identifica quem escreveu no WhatsApp não casa com linha
-- nenhuma — a pessoa manda mensagem e o bot não sabe quem é.
--
-- CHECK e não trigger: aqui o certo é valer para TODO MUNDO, backend incluído.
-- Se uma action nossa gravar fora do formato, é bug nosso e tem de estourar.
-- Conferido antes de criar (24/08/2026): 1 número gravado, dentro do padrão.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_whatsapp_numero_e164_check,
  ADD CONSTRAINT profiles_whatsapp_numero_e164_check
    CHECK (whatsapp_numero IS NULL OR whatsapp_numero ~ '^\+[1-9][0-9]{6,14}$');

COMMENT ON FUNCTION public.tg_profiles_trava_colunas() IS
  'Impede PATCH direto em colunas de perfil que nao sao do inquilino, e valida current_company. Ver cabecalho da 0100.';
