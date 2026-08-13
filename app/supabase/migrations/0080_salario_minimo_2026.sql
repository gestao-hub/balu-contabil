-- Salario minimo de 2026: R$ 1.621,00 → INSS do MEI R$ 81,05.
--
-- Fecha a divida que a 0079 deixou aberta de proposito. Ate agora o codigo
-- calculava DAS-MEI com o minimo de 2025 (R$ 1.518) dentro de 2026 — o valor
-- exibido estava R$ 5,15 abaixo do devido desde janeiro.
--
-- E A PRIMEIRA VEZ QUE ATUALIZAR IMPOSTO NAO PRECISA DE DEPLOY. Antes da 0079
-- isto seria editar `INSS_MENSAL` em das-mei.ts, buildar e subir. Agora e uma
-- linha, e a vigencia faz o resto: competencia de 2025 continua achando 1518,
-- competencia de 2026 em diante acha 1621. Reapuracao antiga nao muda.
--
-- Valor informado pelo Walace em 12/08/2026. Sem numero de lei aqui de
-- proposito: `norma` e citado em tela e em explicacao ao contribuinte, e citar
-- um decreto que eu nao li seria pior do que nao citar nenhum. Quando a
-- referencia estiver conferida, e um UPDATE de uma coluna de texto.
INSERT INTO public.parametros_fiscais (chave, valor, vigencia_inicio, norma) VALUES
  ('salario_minimo', 1621, '2026-01-01', 'Salario minimo vigente em 2026')
ON CONFLICT (chave, vigencia_inicio) DO UPDATE
  SET valor = EXCLUDED.valor, norma = EXCLUDED.norma;
