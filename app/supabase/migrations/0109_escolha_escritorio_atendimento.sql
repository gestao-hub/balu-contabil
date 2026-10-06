-- 0109 — o atendimento lembra QUAIS escritórios ofereceu.
--
-- No número oficial da Balu, quem não tem cadastro (ou não tem escritório
-- vinculado) e pede atendimento humano recebe uma lista numerada de escritórios
-- e responde "2" ou "demo". A resposta só pode ser lida contra a MESMA lista que
-- foi enviada — reler a lista do banco na mensagem seguinte deixaria um
-- escritório aprovado no meio do caminho trocar o "2" de dono.
--
-- A lista fica na linha do atendimento que a enviou. Nada além do id: o nome
-- vem do banco na hora de confirmar.
ALTER TABLE public.whatsapp_atendimentos
  ADD COLUMN IF NOT EXISTS opcoes_escritorio uuid[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'whatsapp_atendimentos'
       AND column_name = 'opcoes_escritorio'
  ) THEN
    RAISE EXCEPTION '0109: coluna opcoes_escritorio não foi criada';
  END IF;
END $$;
