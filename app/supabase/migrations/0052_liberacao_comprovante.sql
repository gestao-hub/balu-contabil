-- 0052 — Comprovante OBRIGATORIO na liberacao manual de acesso.
--
-- POR QUE OBRIGATORIO (decisao do usuario, 27/07): a liberacao manual e a unica
-- porta que destrava o gate sem passar pelo Asaas. Sem arquivo anexado, o unico
-- rastro e um texto livre digitado pelo proprio admin que liberou — que prova
-- nada em auditoria e nao distingue "cliente mandou o comprovante do boleto"
-- de "alguem liberou um conhecido". Com o arquivo, a liberacao tem lastro.
--
-- POR QUE COLUNAS E NAO TABELA DE HISTORICO: a liberacao vigente e UMA so por
-- assinatura (0051 ja e assim). O historico de todas as liberacoes vive no
-- audit_log, e a meta de cada evento guarda o path do arquivo daquela vez —
-- por isso o path e unico por upload (carimbo de tempo no nome), nunca
-- sobrescrito. Renovar nao apaga o comprovante da liberacao anterior do bucket.

ALTER TABLE public.assinaturas
  -- Path no bucket `liberacoes-comprovantes`. NULL nas linhas anteriores a esta
  -- migration e nas que nunca tiveram liberacao.
  ADD COLUMN IF NOT EXISTS liberacao_comprovante_path     text,
  -- Nome original do arquivo, como o admin recebeu. O path e higienizado
  -- (sem acento, sem espaco); sem guardar o nome cru, ninguem reconhece o
  -- arquivo depois — "boleto agosto.pdf" vira "boleto-agosto.pdf" e tudo bem,
  -- mas "Comprovante PIX 12h.pdf" vira algo irreconhecivel.
  ADD COLUMN IF NOT EXISTS liberacao_comprovante_nome     text,
  ADD COLUMN IF NOT EXISTS liberacao_comprovante_mime     text,
  ADD COLUMN IF NOT EXISTS liberacao_comprovante_tamanho  integer;

COMMENT ON COLUMN public.assinaturas.liberacao_comprovante_path IS
  'Arquivo que lastreia a liberacao manual (bucket privado liberacoes-comprovantes). Obrigatorio na aplicacao desde a 0052. Nunca sobrescrito: cada liberacao gera um path novo, e o path de cada uma fica no audit_log.';

-- Bucket privado. Acesso SO pela service role (upload na action, leitura por
-- signed URL gerada para o AdminBalu), como declaracoes-comprovantes e
-- abertura-documentos: nenhum cliente toca direto, entao nao ha policy em
-- storage.objects.
--
-- O titular NAO ve este arquivo. A policy de leitura da 0051 e por LINHA, entao
-- ele enxerga as colunas novas — mas um path sem signed URL nao abre nada, e a
-- signed URL so e gerada atras do requireAdminBaluAction.
INSERT INTO storage.buckets (id, name, public)
VALUES ('liberacoes-comprovantes', 'liberacoes-comprovantes', false)
ON CONFLICT (id) DO NOTHING;
