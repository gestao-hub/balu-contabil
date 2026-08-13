-- Data de inicio de atividade da empresa (card "Impostos P1.5").
--
-- O calculo ja sabia anualizar: `lib/fiscal/rbt12.ts` recebe
-- `dataInicioAtividade` e, com menos de 12 meses de vida, projeta a receita
-- para 12 meses em vez de somar meses que nao existiram. O que faltava era o
-- DADO — `impostos/actions.ts` carregava o comentario "nao temos o campo no
-- schema -> sem anualizacao por ora".
--
-- SEM ISTO, EMPRESA NOVA PAGA A MENOS. RBT12 sem anualizar fica artificialmente
-- baixo, cai numa faixa inferior da tabela e produz aliquota menor que a
-- devida (LC 123/2006, art. 18, §2º). Nao e arredondamento: uma empresa com
-- 3 meses de vida pode aparecer na faixa 1 quando esta na 3.
--
-- Fica em `empresas_fiscais` e nao em `companies` porque e dado FISCAL, ao lado
-- do regime e do anexo — e porque e la que a apuracao ja le a ficha, sem uma
-- junta a mais por empresa dentro do laco do cron.
--
-- NULL e um estado legitimo e permanente: significa "nao sabemos", e o calculo
-- trata isso somando os meses que existem, que e o comportamento de hoje. A
-- coluna melhora quem tem o dado sem quebrar quem nao tem.
ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS data_inicio_atividade date;

COMMENT ON COLUMN public.empresas_fiscais.data_inicio_atividade IS
  'Inicio de atividade na Receita (BrasilAPI). Anualiza o RBT12 de empresa com menos de 12 meses. NULL = desconhecido, calculo segue sem anualizar.';

-- SEM GRANT NOVO, e isso foi CONFERIDO e nao presumido. A armadilha das 0074 e
-- 0076 (coluna nova nao herda grant concedido COLUNA A COLUNA) so vale quando o
-- grant e por coluna. Lido do banco em 12/08/2026: `empresas_fiscais` tem grant
-- de TABELA para `authenticated` (SELECT/INSERT/UPDATE/DELETE), e grant de
-- tabela alcanca coluna nova automaticamente. Conceder de novo por coluna aqui
-- nao daria erro, mas registraria no schema uma dependencia que nao existe.
