-- Comprovante de pagamento anexado a guia (card "Impostos P3.5").
--
-- O historico de guias ja existia e o registro de comprovante tambem — mas
-- para DECLARACOES ANUAIS (Bloco 3, migration 0048). Guia paga nao tinha onde
-- guardar o recibo, e o cliente que pagava no banco ficava com a prova fora do
-- sistema: no e-mail, no WhatsApp, no print. Quando a Receita cobra uma guia
-- ja paga — que acontece —, a prova precisa estar junto do que ela prova.
--
-- Espelha a 0048 de proposito, coluna por coluna, porque o problema e o mesmo.
-- A diferenca esta no `_nome`: aqui o arquivo vem do banco do cliente e chega
-- com nomes como "comprovante_2026-07-19.pdf", que ajudam a reconhecer o
-- documento na tela. O path e deterministico e nao guarda essa informacao.
ALTER TABLE public.guias_fiscais
  ADD COLUMN IF NOT EXISTS comprovante_path     text,
  ADD COLUMN IF NOT EXISTS comprovante_nome     text,
  ADD COLUMN IF NOT EXISTS comprovante_mime     text,
  ADD COLUMN IF NOT EXISTS comprovante_tamanho  integer,
  ADD COLUMN IF NOT EXISTS comprovante_em       timestamptz;

COMMENT ON COLUMN public.guias_fiscais.comprovante_path IS
  'Path no bucket privado guias-comprovantes. Deterministico por guia: reanexar substitui, nao acumula.';
COMMENT ON COLUMN public.guias_fiscais.comprovante_nome IS
  'Nome do arquivo como o cliente baixou do banco. So para exibir — o path e quem enderecea.';

-- Bucket privado, mesmo desenho da 0048 e da 0052: NENHUMA policy em
-- storage.objects. Quem escreve e a service role (depois de a action provar a
-- posse da guia) e quem le recebe uma signed URL de vida curta. Cliente nunca
-- toca no storage direto, entao nao ha superficie para uma policy errada.
INSERT INTO storage.buckets (id, name, public)
VALUES ('guias-comprovantes', 'guias-comprovantes', false)
ON CONFLICT (id) DO NOTHING;

-- NAO ha grant novo nem policy nova em guias_fiscais: as colunas entram numa
-- tabela que ja tem grant de TABELA para `authenticated` (conferido no banco,
-- como na 0082) e RLS por `user_owns_company` desde a 0010. A ESCRITA do
-- comprovante nao passa por aqui — passa pela action com service role, que
-- valida a posse antes.
