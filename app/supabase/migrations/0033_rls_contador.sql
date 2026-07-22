-- 0033: fronteira de segurança do contador. SÓ SELECT em dados do cliente; zero escrita.

-- Helper: contabilidade APROVADA do usuário logado (null = sem acesso).
-- security definer p/ não recursar RLS; stable p/ cache por statement.
CREATE OR REPLACE FUNCTION public.minha_contabilidade()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT cm.contabilidade_id
  FROM contabilidade_membros cm
  JOIN contabilidades c ON c.id = cm.contabilidade_id AND c.status = 'aprovada'
  WHERE cm.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.minha_contabilidade() FROM public;
GRANT EXECUTE ON FUNCTION public.minha_contabilidade() TO authenticated;

-- companies: condição direta
CREATE POLICY companies_select_contador ON public.companies FOR SELECT
  USING (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade());

-- filhas por company_id
CREATE POLICY notas_fiscais_select_contador ON public.notas_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY apuracoes_select_contador ON public.apuracoes_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY declaracoes_select_contador ON public.declaracoes_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY guias_select_contador ON public.guias_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY clientes_select_contador ON public.clientes FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY company_cnaes_select_contador ON public.company_cnaes FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
-- colunas de FK divergentes:
CREATE POLICY empresas_fiscais_select_contador ON public.empresas_fiscais FOR SELECT
  USING (empresa_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY arquivos_aux_select_contador ON public.arquivos_auxiliares FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));

-- honorarios v2: membro CRUD no que é do escritório; empresário lê os da própria empresa
CREATE POLICY honorarios_all_membro ON public.honorarios FOR ALL
  USING (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade())
  WITH CHECK (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade());
CREATE POLICY honorarios_select_empresario ON public.honorarios FOR SELECT
  USING (empresa_cliente_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid()));

-- parâmetros fiscais versionados (tetos NUNCA hard-coded — LC 123/2006; PLP 108/2024 pode reajustar)
CREATE TABLE IF NOT EXISTS public.parametros_fiscais (
  chave text NOT NULL,
  valor numeric NOT NULL,
  vigencia_inicio date NOT NULL,
  norma text,
  PRIMARY KEY (chave, vigencia_inicio)
);
ALTER TABLE public.parametros_fiscais ENABLE ROW LEVEL SECURITY;
CREATE POLICY parametros_select_all ON public.parametros_fiscais FOR SELECT USING (true);
GRANT SELECT ON public.parametros_fiscais TO authenticated, anon;
GRANT ALL ON public.parametros_fiscais TO service_role;

INSERT INTO public.parametros_fiscais (chave, valor, vigencia_inicio, norma) VALUES
  ('limite_mei',     81000,   '2018-01-01', 'LC 123/2006, art. 18-A, §1º'),
  ('limite_simples', 4800000, '2018-01-01', 'LC 123/2006, art. 3º, II')
ON CONFLICT DO NOTHING;
