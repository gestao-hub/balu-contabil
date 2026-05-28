-- Customização 0004 (aditiva): colunas de emissão + cancelamento em notas_fiscais.
-- Banco é fonte da verdade — só adiciona o que falta. PR 1.3 usa cancelled_at/
-- cancellation_reason/updated_at; as demais são populadas pela emissão (PR 2.1) e
-- pelo webhook da Focus (chave_acesso/pdf_url/xml_url).
alter table public.notas_fiscais
  add column if not exists chave_acesso          text,
  add column if not exists cliente_id            uuid,
  add column if not exists protocolo_autorizacao text,
  add column if not exists xml_url               text,
  add column if not exists pdf_url               text,
  add column if not exists qrcode                text,
  add column if not exists numero_nf             text,
  add column if not exists serie                 text,
  add column if not exists cancelled_at          timestamp with time zone,
  add column if not exists cancellation_reason   text,
  add column if not exists updated_at            timestamp with time zone;
