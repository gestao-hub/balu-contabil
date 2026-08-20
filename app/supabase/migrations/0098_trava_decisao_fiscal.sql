-- 0098 — as colunas que DECIDEM a emissão saem do alcance do inquilino.
--
-- O QUE A 0097 DEIXOU PASSAR. Ela trancou o SEGREDO (os tokens da Focus) numa
-- tabela fechada, e deixou os QUATRO INSUMOS QUE DECIDEM O USO DO SEGREDO em
-- `empresas_fiscais` — tabela que o dono da empresa escreve pelo navegador.
-- Medido no banco em 20/08/2026:
--
--   has_column_privilege(authenticated, empresas_fiscais.focus_origem,   UPDATE) → true
--   has_column_privilege(authenticated, empresas_fiscais.focus_ambiente, UPDATE) → true
--   has_column_privilege(authenticated, .focus_producao_declarada,       UPDATE) → true
--   has_column_privilege(authenticated, .focus_habilita_nfsen_producao,  UPDATE) → true
--   attacl das quatro → null (o grant vem da tabela: authenticated=arwdm)
--   policy empresas_fiscais_update → USING/CHECK user_owns_company(empresa_id)
--
-- O ATAQUE: assim que existir `token_prod_cifrado` para a empresa — o que
-- `focus-empresa-sync.ts` grava sozinho quando a Focus devolve `token_producao`
-- no POST /v2/empresas — o DONO faz um único
--
--   PATCH /rest/v1/empresas_fiscais?empresa_id=eq.<id>
--   {"focus_ambiente":"prod","focus_origem":"propria","focus_producao_declarada":true}
--
-- com a chave anon e o JWT dele, ambos no navegador. Isso passa nos quatro
-- critérios de `decidirCredencial` e emite NOTA FISCAL REAL — sem contador, sem
-- declaração de custódia, sem a Focus ter habilitado nada. Derruba as decisões
-- D2 (quem cadastra é o contador) e D3 (ambiente é decisão administrada), e
-- transforma a "declaração de quem cadastrou" em autodeclaração do próprio
-- interessado.
--
-- Não era explorável no momento em que foi achado (nenhum caminho do produto
-- grava `focus_ambiente`, e nenhuma empresa tinha `token_prod_cifrado`), mas é
-- bomba armada: bastaria o primeiro cadastro bem-sucedido na Focus.
--
-- POR QUE TRIGGER E NÃO REVOKE: a 0097 já aprendeu que ACL de coluna não
-- subtrai do grant de tabela no Postgres. Mover as quatro colunas para uma
-- tabela fechada quebraria todas as leituras do produto. O projeto já resolveu
-- exatamente este problema na 0036 (trava de `AdminBalu` em `role_types`) — e
-- este arquivo segue aquele molde.
--
-- ⚠️ SECURITY INVOKER É OBRIGATÓRIO (o padrão de plpgsql sem SECURITY DEFINER).
-- No PostgREST toda requisição loga como 'authenticator' e faz SET ROLE para o
-- alvo do JWT; quem distingue o chamador é `current_user`. Num SECURITY
-- DEFINER, `current_user` viraria o dono da função (postgres) e o gate NUNCA
-- bloquearia — é a mesma armadilha documentada na 0036.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

-- ── (1) as quatro colunas de decisão fiscal ────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_empresas_fiscais_trava_decisao()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Só barra quem NÃO é backend. O app legítimo escreve por service_role
  -- (a action do contador usa createAdminClient), e migrations rodam como
  -- postgres.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- `IS DISTINCT FROM` e não `<>`: com NULL dos dois lados, `<>` devolve NULL e
  -- o IF não dispara — o gate passaria em silêncio justamente no estado
  -- inicial, que é onde ele mais importa.
  IF NEW.focus_origem                  IS DISTINCT FROM OLD.focus_origem
     OR NEW.focus_ambiente             IS DISTINCT FROM OLD.focus_ambiente
     OR NEW.focus_producao_declarada   IS DISTINCT FROM OLD.focus_producao_declarada
     OR NEW.focus_habilita_nfsen_producao IS DISTINCT FROM OLD.focus_habilita_nfsen_producao
  THEN
    RAISE EXCEPTION
      'DECISAO_FISCAL_RESTRITA: origem, ambiente, declaracao de producao e habilitacao da Focus so podem ser alterados pelo backend';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_empresas_fiscais_trava_decisao ON public.empresas_fiscais;
CREATE TRIGGER tg_empresas_fiscais_trava_decisao
  BEFORE UPDATE ON public.empresas_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.tg_empresas_fiscais_trava_decisao();

-- INSERT também: sem isto, o dono cria a linha fiscal já nascida em 'prod'.
-- Aqui não há OLD, então a regra é "só o default é aceito de quem não é
-- backend" — quem precisa de outro valor passa pelo backend.
CREATE OR REPLACE FUNCTION public.tg_empresas_fiscais_trava_decisao_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.focus_origem <> 'balu'
     OR NEW.focus_ambiente <> 'hom'
     OR COALESCE(NEW.focus_producao_declarada, false) IS TRUE
     OR COALESCE(NEW.focus_habilita_nfsen_producao, false) IS TRUE
  THEN
    RAISE EXCEPTION
      'DECISAO_FISCAL_RESTRITA: empresa nasce em homologacao e origem balu; mudar isso e do backend';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_empresas_fiscais_trava_decisao_insert ON public.empresas_fiscais;
CREATE TRIGGER tg_empresas_fiscais_trava_decisao_insert
  BEFORE INSERT ON public.empresas_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.tg_empresas_fiscais_trava_decisao_insert();

-- ── (2) o carimbo de ambiente da nota é imutável ───────────────────────────
-- A decisão D4 diz que a nota carrega o ambiente em que NASCEU, e que status,
-- download e cancelamento seguem esse carimbo. Se o titular puder reescrevê-lo,
-- ele redireciona as três leituras para a base errada.
--
-- INSERT fica liberado de propósito: a action insere pela sessão do usuário, e
-- inserir uma linha com ambiente 'prod' não emite nada — a emissão decide o
-- ambiente por conta própria e o token vem da tabela fechada.
CREATE OR REPLACE FUNCTION public.tg_notas_fiscais_ambiente_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.ambiente IS DISTINCT FROM OLD.ambiente THEN
    RAISE EXCEPTION
      'AMBIENTE_IMUTAVEL: o ambiente de uma nota emitida nao pode ser alterado';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_notas_fiscais_ambiente_imutavel ON public.notas_fiscais;
CREATE TRIGGER tg_notas_fiscais_ambiente_imutavel
  BEFORE UPDATE ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.tg_notas_fiscais_ambiente_imutavel();

-- ── (3) uma linha fiscal viva por empresa ──────────────────────────────────
-- `resolverCredencialEmissao` usa `.maybeSingle()` em `empresas_fiscais`. Com
-- duas linhas vivas para a mesma empresa, o PostgREST devolve erro PGRST116,
-- `data` vem null, e a leitura cai no default 'hom' — emitindo em homologação
-- uma empresa configurada para produção. Índice parcial porque a tabela usa
-- soft delete: linhas apagadas podem repetir o `empresa_id`.
--
-- Conferido antes de criar (20/08/2026): 5 linhas, 0 soft-deleted, 0 duplicatas.
CREATE UNIQUE INDEX IF NOT EXISTS empresas_fiscais_empresa_id_viva_uniq
  ON public.empresas_fiscais (empresa_id)
  WHERE deleted_at IS NULL;

COMMENT ON FUNCTION public.tg_empresas_fiscais_trava_decisao() IS
  'Impede que o dono da empresa ligue producao fiscal por PATCH direto no PostgREST. Ver cabecalho da 0098.';
