-- Tabela do Simples e salario minimo passam a ser DADO com vigencia, nao
-- constante de codigo (card "Impostos P1.4").
--
-- O problema: `TABELA_SIMPLES_2026` e o INSS do MEI moravam em .ts. Toda
-- virada de ano — e toda alteracao da LC 123 — exigia deploy para corrigir
-- imposto, e ate o deploy sair o valor exibido estava errado. O salario minimo
-- ja demonstrou isso na pratica: o codigo carregava o de 2025 dentro de 2026.
--
-- O lugar certo ja existia. `parametros_fiscais` (0033) foi criada exatamente
-- para isto — "tetos NUNCA hard-coded" — com PK (chave, vigencia_inicio). O
-- que faltava era caber uma tabela inteira, nao so um numero.
--
-- ── valor_json ──────────────────────────────────────────────────────────────
-- `valor numeric` nao guarda 5 anexos x 6 faixas. Em vez de uma tabela nova
-- (`tabelas_simples`) com o mesmo criterio de vigencia repetido do lado,
-- entra uma coluna: a chave e a vigencia continuam sendo as mesmas de sempre,
-- e o SELECT que ja existe continua servindo. A tabela do Simples e lida como
-- unidade — nunca "a faixa 3 do Anexo II" isolada —, entao normalizar em
-- linhas so acrescentaria junta sem acrescentar consulta.
ALTER TABLE public.parametros_fiscais ADD COLUMN IF NOT EXISTS valor_json jsonb;
ALTER TABLE public.parametros_fiscais ALTER COLUMN valor DROP NOT NULL;

-- Exatamente um dos dois preenchido. Sem isto a tabela aceitaria linha vazia
-- (que o leitor trataria como "parametro ausente" e cairia no fallback em
-- silencio) e linha com os dois (em que ninguem sabe qual vale).
ALTER TABLE public.parametros_fiscais DROP CONSTRAINT IF EXISTS parametros_fiscais_valor_xor;
ALTER TABLE public.parametros_fiscais ADD CONSTRAINT parametros_fiscais_valor_xor
  CHECK ((valor IS NULL) <> (valor_json IS NULL));

COMMENT ON COLUMN public.parametros_fiscais.valor_json IS
  'Parametro que nao e um numero unico (ex.: tabela_simples). Exclusivo com valor.';

-- ── salario minimo ──────────────────────────────────────────────────────────
-- So o de 2025, que e o valor que o codigo ja usava e o unico conferido. O de
-- 2026 NAO entra aqui de chute: DAS-MEI errado e uma guia paga a menor, com
-- multa para o contribuinte. Quando o valor oficial estiver em maos, e um
-- INSERT de uma linha ('2026-01-01', <valor>) — sem deploy.
INSERT INTO public.parametros_fiscais (chave, valor, vigencia_inicio, norma) VALUES
  ('salario_minimo', 1518, '2025-01-01', 'Lei 15.077/2024')
ON CONFLICT DO NOTHING;

-- ── tabela do Simples ───────────────────────────────────────────────────────
-- Vigencia 2018-01-01: e quando a redacao da LC 155/2016 passou a valer, e e
-- de quando sao estes anexos. Datar em 2026 faria a reapuracao de qualquer
-- competencia anterior nao achar tabela nenhuma e cair no fallback — daria o
-- mesmo numero hoje, e mentiria sobre desde quando ele vale.
--
-- Conteudo IDENTICO ao TABELA_SIMPLES_FALLBACK de lib/fiscal/simples.ts. Nao e
-- duplicacao por descuido: o fallback existe para o SELECT que falha, e um
-- fallback que discorda do banco seria um segundo imposto possivel. Ha teste
-- travando os dois lados iguais.
INSERT INTO public.parametros_fiscais (chave, valor_json, vigencia_inicio, norma) VALUES
  ('tabela_simples', '{
    "Anexo I": [
      {"faixa":1,"ate":180000,"nominal":0.04,"deduzir":0},
      {"faixa":2,"ate":360000,"nominal":0.073,"deduzir":5940},
      {"faixa":3,"ate":720000,"nominal":0.095,"deduzir":13860},
      {"faixa":4,"ate":1800000,"nominal":0.107,"deduzir":22500},
      {"faixa":5,"ate":3600000,"nominal":0.143,"deduzir":87300},
      {"faixa":6,"ate":4800000,"nominal":0.19,"deduzir":378000}
    ],
    "Anexo II": [
      {"faixa":1,"ate":180000,"nominal":0.045,"deduzir":0},
      {"faixa":2,"ate":360000,"nominal":0.078,"deduzir":5940},
      {"faixa":3,"ate":720000,"nominal":0.10,"deduzir":13860},
      {"faixa":4,"ate":1800000,"nominal":0.112,"deduzir":22500},
      {"faixa":5,"ate":3600000,"nominal":0.147,"deduzir":85500},
      {"faixa":6,"ate":4800000,"nominal":0.30,"deduzir":720000}
    ],
    "Anexo III": [
      {"faixa":1,"ate":180000,"nominal":0.06,"deduzir":0},
      {"faixa":2,"ate":360000,"nominal":0.112,"deduzir":9360},
      {"faixa":3,"ate":720000,"nominal":0.135,"deduzir":17640},
      {"faixa":4,"ate":1800000,"nominal":0.16,"deduzir":35640},
      {"faixa":5,"ate":3600000,"nominal":0.21,"deduzir":125640},
      {"faixa":6,"ate":4800000,"nominal":0.33,"deduzir":648000}
    ],
    "Anexo IV": [
      {"faixa":1,"ate":180000,"nominal":0.045,"deduzir":0},
      {"faixa":2,"ate":360000,"nominal":0.09,"deduzir":8100},
      {"faixa":3,"ate":720000,"nominal":0.102,"deduzir":12420},
      {"faixa":4,"ate":1800000,"nominal":0.14,"deduzir":39780},
      {"faixa":5,"ate":3600000,"nominal":0.22,"deduzir":183780},
      {"faixa":6,"ate":4800000,"nominal":0.33,"deduzir":828000}
    ],
    "Anexo V": [
      {"faixa":1,"ate":180000,"nominal":0.155,"deduzir":0},
      {"faixa":2,"ate":360000,"nominal":0.18,"deduzir":4500},
      {"faixa":3,"ate":720000,"nominal":0.195,"deduzir":9900},
      {"faixa":4,"ate":1800000,"nominal":0.205,"deduzir":17100},
      {"faixa":5,"ate":3600000,"nominal":0.23,"deduzir":62100},
      {"faixa":6,"ate":4800000,"nominal":0.305,"deduzir":540000}
    ]
  }'::jsonb, '2018-01-01', 'LC 123/2006, art. 18 (redacao da LC 155/2016)')
ON CONFLICT DO NOTHING;
