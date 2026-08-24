-- 0102 — o admin token da uazapi sai da variável de ambiente.
--
-- O DEFEITO QUE MOTIVOU, medido em 24/08/2026:
--
--   .env.local            → UAZAPI_BASE_URL, UAZAPI_TOKEN, UAZAPI_WEBHOOK_SECRET, UAZAPI_ADMIN_TOKEN
--   Vercel (produção)     → UAZAPI_BASE_URL, UAZAPI_TOKEN, UAZAPI_WEBHOOK_SECRET
--
-- Falta uma. Consequência: `criarInstancia` responde "UAZAPI_ADMIN_TOKEN não
-- configurado" **em produção e só em produção** — provisionar canal de WhatsApp
-- nunca funcionou publicado, nem para escritório (0091, desde 19/08), e ninguém
-- tinha como saber, porque local funciona.
--
-- É a mesma classe de defeito da 0094, com o sinal trocado: lá o nome tinha
-- acento no `.env.local` e o certo só existia na Vercel; aqui o nome está certo
-- nos dois e a variável só existe de um lado. Variável de ambiente some sem
-- avisar; campo de formulário, não.
--
-- POR QUE ESTA COLUNA, E NÃO UMA VARIÁVEL NOVA NA VERCEL. Este token é
-- **credencial de plataforma**: ele provisiona QUALQUER instância do servidor
-- compartilhado — em 24/08/2026, 37 delas, quase todas de outros produtos. É
-- exatamente a categoria que a sessão 30 tirou do ambiente e trouxe para
-- `/admin/configuracoes` (IA, Focus, SERPRO). Acrescentar a variável na Vercel
-- resolveria hoje e deixaria o mesmo buraco aberto para a próxima pessoa.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

ALTER TABLE public.config_whatsapp
  -- SEMPRE cifrado (prefixo enc:v1:). Nunca volta para a tela, nem mascarado.
  --
  -- Mora na MESMA tabela do token da instância, e não numa `config_uazapi`
  -- separada, porque os dois são a mesma integração e a tabela já é fechada
  -- para anon/authenticated (0101, medido). Separar criaria uma segunda tabela
  -- com as mesmas regras de privilégio para guardar um campo.
  ADD COLUMN IF NOT EXISTS admin_token_cifrado text;

COMMENT ON COLUMN public.config_whatsapp.admin_token_cifrado IS
  'Admin token da uazapi, cifrado. Provisiona QUALQUER instancia do servidor '
  'compartilhado: e a credencial mais forte desta integracao. Precedencia de '
  'leitura: esta coluna, e UAZAPI_ADMIN_TOKEN como retaguarda.';
