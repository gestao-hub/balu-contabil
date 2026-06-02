-- Customização 0003: metadados do certificado A1 extraídos no upload (Next/node-forge).
-- A senha (cert_password) deixa de ser usada — o material de chave passa a ser cifrado
-- e guardado como blob .enc no Storage (ver supabase_file_path). Mantemos a coluna
-- cert_password por ora (limpeza futura) mas o app passa a gravar NULL.

alter table public.arquivos_auxiliares
  add column if not exists cert_not_after   timestamp with time zone,
  add column if not exists cert_subject_cn  text,
  add column if not exists cert_cnpj        text,
  add column if not exists cert_fingerprint text;
