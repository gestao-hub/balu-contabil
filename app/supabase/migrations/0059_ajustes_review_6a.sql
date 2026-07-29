-- 0059 — três correções que um code-review apontou na 0056.
--
-- ============================================================ 1. o contador
-- A 0056 deu `registrar_explicacao_faltando` (SECURITY DEFINER) para
-- `authenticated`, na suposição de que quem a chamaria era a tela do empresário
-- pela sessão dele. Isso a transformou no ÚNICO caminho de escrita para
-- `explicacoes_faltando` — e num caminho sem validação nenhuma: a PK é `text`
-- livre, então qualquer usuário logado podia chamá-la em laço com strings
-- arbitrárias, inchando a tabela e envenenando a fila de trabalho do admin com
-- situações que ninguém viu. O oposto exato do "cresce por demanda real".
--
-- A CAUSA-RAIZ NÃO É A FALTA DE VALIDAÇÃO — é a função ser alcançável pelo
-- cliente. Este contador conta SITUAÇÕES, não pessoas: não há nada nele que
-- dependa de quem está logado. E quem o chama (`ExplicacaoImposto`, Bloco 6A
-- Task 11) é Server Component, que fala com o banco pelo service role sempre que
-- quer. Então a porta some em vez de ganhar guarda.
REVOKE ALL ON FUNCTION public.registrar_explicacao_faltando(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.registrar_explicacao_faltando(text) TO service_role;

-- Defesa em profundidade, para o dia em que alguém reconceder por engano: a
-- chave tem forma, e forma verificável. `<tributo>:<partes>`, minúsculas, com
-- teto de tamanho. Não fixa a LISTA de tributos de propósito — o 6B trará
-- outros, e uma migration não deve virar o cadastro deles.
--
-- LANÇA em vez de ignorar: chave malformada só pode vir de bug nosso ou de
-- abuso, e o `try/catch` de quem chama (regra do Task 10: contar não derruba a
-- tela) transforma isso em log, não em erro para o cliente. Ignorar em silêncio
-- devolveria o buraco silencioso que o contador existe para acabar.
CREATE OR REPLACE FUNCTION public.registrar_explicacao_faltando(p_chave text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_chave IS NULL OR p_chave !~ '^[a-z][a-z0-9-]{0,19}:[a-z0-9+-]{1,64}$' THEN
    RAISE EXCEPTION 'registrar_explicacao_faltando: chave fora de forma: %', left(coalesce(p_chave,'(nula)'), 40);
  END IF;

  INSERT INTO explicacoes_faltando (chave, vistas)
  VALUES (p_chave, 1)
  ON CONFLICT (chave) DO UPDATE
     SET vistas = explicacoes_faltando.vistas + 1,
         ultima_em = now();
END $$;

-- ============================================================ 2. o catálogo e o anon
-- A 0056 concedeu SELECT do catálogo a `anon` junto com `authenticated`. A tela
-- da explicação é gated — foi essa a razão de a RPC acima ter ficado só com
-- `authenticated` —, então o `anon` ali só servia para quem tem a chave pública
-- (que viaja no bundle do navegador) despejar o catálogo inteiro e enumerar
-- todas as situações fiscais que a Balu atende. Não vaza dado de contribuinte,
-- mas contradiz a premissa da própria migration seguinte.
REVOKE ALL ON public.explicacoes_fiscais FROM anon;
GRANT SELECT ON public.explicacoes_fiscais TO authenticated;

-- ============================================================ 3. updated_at parado
-- `explicacoes_fiscais.updated_at` nasceu sem o trigger que todas as outras
-- tabelas do repo têm (0001, 0013, 0015, 0020, 0022, 0025). Sem ele a coluna
-- congela na inserção — e a regra "editar derruba a aprovação" (§5.6 da spec)
-- passaria a comparar contra um carimbo que nunca anda.
DROP TRIGGER IF EXISTS explicacoes_fiscais_set_updated_at ON public.explicacoes_fiscais;
CREATE TRIGGER explicacoes_fiscais_set_updated_at
  BEFORE UPDATE ON public.explicacoes_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Privilégio e função mudaram: rodar `node app/scratchpad/_reload-postgrest.mjs`.
