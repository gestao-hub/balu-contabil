-- 0101 — o canal de WhatsApp DA PLATAFORMA sai da variável de ambiente.
--
-- O QUE FICOU PARA TRÁS. A 0091 tirou do ambiente o canal de cada ESCRITÓRIO
-- (instância, token e webhook token viraram colunas de `contabilidades`), e o
-- canal da PLATAFORMA — o número oficial do Balu, que atende as empresas sem
-- escritório, decisão D8 do Bloco 6B — continuou vivendo em `UAZAPI_TOKEN` no
-- `.env`/Vercel. Consequência prática: **não existe tela nenhuma para
-- conectá-lo**. Provisionar o número oficial exigia criar a instância na mão no
-- painel da uazapi, copiar o token e colar numa variável de ambiente.
--
-- É exatamente o defeito que a 0094 descreve para a Focus: "variável de
-- ambiente erra de nome sem avisar; formulário com campo nomeado, não". Aqui é
-- pior, porque não é só o nome — é o provisionamento inteiro fora do produto.
--
-- MOLDE: `config_ia` (0056) e `config_focus`/`config_serpro` (0094). Singleton
-- `id = 1`, segredo SEMPRE cifrado (prefixo `enc:v1:`, envelope AES-256-GCM de
-- `lib/crypto/envelope.ts`), tabela fechada para as roles do cliente, escrita
-- só pelas actions do AdminBalu.
--
-- ⚠️ O SEGREDO DO WEBHOOK NÃO ENTRA AQUI. A rota `/api/webhooks/uazapi` valida
-- o canal da plataforma comparando `?s=` com `process.env.UAZAPI_WEBHOOK_SECRET`.
-- Mover esse segredo para cá exigiria mudar a validação na entrada, e trocar a
-- porta de entrada do WhatsApp no mesmo passo em que se estreia a tela de
-- conexão é acumular dois riscos num só deploy. O que esta migration guarda é
-- a INSTÂNCIA; o `?s=` continua saindo do ambiente, e a tela usa esse mesmo
-- valor ao configurar o webhook.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

CREATE TABLE IF NOT EXISTS public.config_whatsapp (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Id da instância no servidor uazapi. Não é segredo — é o que se cita no
  -- suporte quando a criação grava pela metade.
  instancia_id   text,
  -- SEMPRE cifrado (prefixo enc:v1:). Envia mensagem em nome da plataforma
  -- inteira: nunca volta para a tela, nem mascarado.
  token_cifrado  text,
  -- Espelho do estado da uazapi, para a tela abrir sabendo o que mostrar sem
  -- depender de uma chamada externa. Mesmos três valores de `contabilidades`
  -- (0091), pelo mesmo motivo: o vocabulário da uazapi é traduzido na borda.
  status         text NOT NULL DEFAULT 'desconectado'
                 CHECK (status IN ('desconectado', 'conectando', 'conectado')),
  -- Só dígitos, preenchido pelo `owner` da instância DEPOIS de conectar —
  -- nunca digitado por ninguém. É o número oficial do Balu.
  numero         text,
  conectado_em   timestamptz,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.config_whatsapp ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL (e não a lista de verbos): o default privileges do Supabase
-- concede ALL, e ALL inclui TRUNCATE — que IGNORA RLS. Lição registrada na
-- 0056, reconfirmada na 0090 e na 0094.
REVOKE ALL ON public.config_whatsapp FROM anon, authenticated;
GRANT  ALL ON public.config_whatsapp TO service_role;

COMMENT ON TABLE public.config_whatsapp IS
  'Instancia uazapi do canal da PLATAFORMA (numero oficial do Balu), token '
  'cifrado. Singleton id=1. Lido so pelo service_role; a tela e '
  '/admin/configuracoes/whatsapp. O canal de cada escritorio nao mora aqui: '
  'ele esta em contabilidades.uazapi_* desde a 0091.';

COMMENT ON COLUMN public.config_whatsapp.numero IS
  'Preenchido pelo owner da instancia apos a conexao, nunca digitado.';
