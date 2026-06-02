-- supabase/migrations/0016_rebuild_municipios_nfse.sql
-- Recria municipios_nfse com schema alinhado à Focus API /v2/municipios.
-- Dados anteriores (Bubble) eram stale e sem fonte de atualização.

drop table if exists public.municipios_nfse cascade;

create table public.municipios_nfse (
  id                                           uuid primary key default gen_random_uuid(),
  codigo_ibge                                  text unique not null,
  nome_municipio                               text not null,
  uf                                           char(2) not null,
  nome_uf                                      text,
  nfse_habilitada                              boolean not null default false,
  status_nfse                                  text,
  provedor_nfse                                text,
  requer_certificado_nfse                      boolean,
  possui_ambiente_homologacao_nfse             boolean,
  possui_cancelamento_nfse                     boolean,
  cpf_cnpj_obrigatorio_nfse                    boolean,
  endereco_obrigatorio_nfse                    boolean,
  item_lista_servico_obrigatorio_nfse          boolean,
  codigo_cnae_obrigatorio_nfse                 boolean,
  codigo_tributario_municipio_obrigatorio_nfse boolean,
  ultima_emissao_nfse                          timestamptz,
  focus_synced_at                              timestamptz,
  created_at                                   timestamptz not null default now(),
  updated_at                                   timestamptz not null default now()
);

alter table public.municipios_nfse enable row level security;

create policy municipios_nfse_select on public.municipios_nfse
  for select to authenticated using (true);
