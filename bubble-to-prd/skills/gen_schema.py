#!/usr/bin/env python3
"""
gen_schema.py — Gera schema Supabase + enums TS + Zod a partir dos slices.

Lê:
    slices/03_user_types.json   → tipos do Bubble (User, aux_produtos)
    slices/04_option_sets.json  → enums (TipoNF, Status_*, CST, CSOSN…)
    slices/07_api_connector.json→ URLs REST → infere tabelas Supabase

Escreve (em <out>/):
    supabase/migrations/0001_init.sql
    src/types/enums.ts
    src/types/zod.ts
    src/types/database.ts        (placeholder — substituível por supabase gen)

Uso:
    python3 gen_schema.py ../slices ../../balu-next
"""
from __future__ import annotations
import json, sys, re, os
from pathlib import Path
from collections import defaultdict

# Mapeamento manual de tipos Bubble → SQL Postgres
BUBBLE_TO_SQL = {
    "text": "text",
    "number": "numeric",
    "integer": "integer",
    "boolean": "boolean",
    "date": "timestamptz",
    "image": "text",
    "file": "text",
    "geographic_address": "jsonb",
}

# Tabelas que o PRD nomeia e suas colunas conhecidas (derivadas do PRD §3).
# O LLM/dev confere depois. Mantemos campos mínimos para FK e RLS funcionarem.
KNOWN_TABLES = {
    # `current_company` é uuid sem FK aqui — a FK é adicionada ao final via ALTER TABLE
    # para evitar forward reference (profiles é criado antes de companies).
    "profiles": [
        ("id", "uuid", "primary key references auth.users(id) on delete cascade"),
        ("current_company", "uuid", ""),
        ("empresa_fiscal_id", "uuid", ""),
        ("logo", "text", ""),
        ("background_color", "text", ""),
        ("user_role", "text", "not null default 'empresa' check (user_role in ('empresa','contador'))"),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "companies": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("user_id", "uuid", "references auth.users(id) on delete cascade not null"),
        ("nome", "text", ""),
        ("razao_social", "text", ""),
        ("cnpj", "text", "not null"),
        ("inscricao_estadual", "text", ""),
        ("inscricao_municipal", "text", ""),
        ("codigo_municipio", "text", ""),
        ("logradouro", "text", ""),
        ("numero", "text", ""),
        ("complemento", "text", ""),
        ("bairro", "text", ""),
        ("municipio", "text", ""),
        ("uf", "text", ""),
        ("cep", "text", ""),
        ("telefone", "text", ""),
        ("email", "text", ""),
        ("status", "text", "default 'active' check (status in ('active','inactive'))"),
        ("deleted_at", "timestamptz", ""),
        ("bubble_id", "text", "unique"),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "clientes": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("owner_user_id", "uuid", "references auth.users(id) on delete cascade not null"),
        ("company_id", "uuid", "references companies(id) on delete cascade not null"),
        ("person_type", "text", "check (person_type in ('PF','PJ'))"),
        ("razao_social", "text", ""),
        ("document", "text", "not null"),
        ("inscricao_estadual", "text", ""),
        # SEFAZ: 1=Contribuinte ICMS, 2=Isento, 9=Não Contribuinte
        ("indicador_inscricao_estadual", "smallint", "check (indicador_inscricao_estadual in (1,2,9))"),
        ("inscricao_municipal", "text", ""),
        ("codigo_municipio", "text", ""),
        ("email", "text", ""),
        ("telefone", "text", ""),
        ("logradouro", "text", ""),
        ("numero", "text", ""),
        ("complemento", "text", ""),
        ("bairro", "text", ""),
        ("municipio", "text", ""),
        ("uf", "text", ""),
        ("cep", "text", ""),
        ("pais", "text", "default 'Brasil'"),
        ("status", "text", "default 'active' check (status in ('active','inactive'))"),
        ("deleted_at", "timestamptz", ""),
        ("bubble_id", "text", ""),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "empresas_fiscais": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("empresa_id", "uuid", "references companies(id) on delete cascade not null"),
        ("unique_id_bubble", "text", "unique"),
        ("municipio_id", "uuid", ""),
        ("cnpj", "text", ""),
        ("regime_tributario", "text", ""),
        ("Code_regime_tributario", "smallint", "check (Code_regime_tributario between 1 and 4)"),
        ("cnae_principal", "text", ""),
        ("anexo_simples", "text", ""),
        ("usa_fator_r", "boolean", "default false"),
        ("inscricao_municipal", "text", ""),
        ("serie_rps", "text", ""),
        ("numero_rps_inicial", "integer", ""),
        ("login_responsavel", "text", ""),
        ("senha_responsavel", "text", ""),
        ("token_portal", "text", ""),
        ("requer_liberacao_rps", "boolean", "default false"),
        ("requer_liberacao_webservice", "boolean", "default false"),
        ("requer_aidf", "boolean", "default false"),
        ("requer_cadastro_homologacao", "boolean", "default false"),
        ("emitir_nota_homol_antes_producao", "boolean", "default false"),
        ("credenciais_por_ambiente", "boolean", "default false"),
        ("requer_token_portal", "boolean", "default false"),
        ("im_zeros_esquerda", "boolean", "default false"),
        ("requer_cadastro_tomador", "boolean", "default false"),
        ("valor_iss_obrigatorio", "boolean", "default false"),
        ("cancelamento_so_portal", "boolean", "default false"),
        ("serie_rps_so_numeros", "boolean", "default false"),
        ("nfse_autenticacao_tipo", "text", ""),
        ("nfse_usuario_login", "text", ""),
        ("nfse_senha_login", "text", ""),
        ("nfse_token_api", "text", ""),
        ("nfse_frase_secreta", "text", ""),
        ("nfse_chave_api", "text", ""),
        ("nfse_url_portal_producao", "text", ""),
        ("nfse_url_portal_homologacao", "text", ""),
        ("empresa_fiscal_ativada", "boolean", "default false"),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "notas_fiscais": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("company_id", "uuid", "references companies(id) on delete cascade not null"),
        ("cliente_id", "uuid", "references clientes(id) on delete set null"),
        ("tipo_nf", "text", "check (tipo_nf in ('nfe','nfce','nfse')) not null"),
        ("ref", "text", "unique"),
        ("numero_nf", "text", ""),
        ("serie", "text", ""),
        ("chave_acesso", "text", ""),
        ("protocolo_autorizacao", "text", ""),
        ("data_emissao", "timestamptz", ""),
        ("valor_total", "numeric(14,2)", ""),
        ("status", "text", "default 'pendente' check (status in ('pendente','ativa','cancelada'))"),
        ("xml_url", "text", ""),
        ("pdf_url", "text", ""),
        ("qrcode", "text", ""),
        ("focus_response", "jsonb", ""),
        ("cancelled_at", "timestamptz", ""),
        ("cancellation_reason", "text", ""),
        ("bubble_id", "text", ""),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "apuracoes_fiscais": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("empresa_id", "uuid", "references companies(id) on delete cascade not null"),
        ("competencia", "char(6)", "not null"),
        ("receita_interno", "numeric(14,2)", "default 0"),
        ("receita_externo", "numeric(14,2)", "default 0"),
        ("irpj", "numeric(14,2)", "default 0"),
        ("csll", "numeric(14,2)", "default 0"),
        ("cofins", "numeric(14,2)", "default 0"),
        ("pis", "numeric(14,2)", "default 0"),
        ("inss_cpp", "numeric(14,2)", "default 0"),
        ("icms", "numeric(14,2)", "default 0"),
        ("iss", "numeric(14,2)", "default 0"),
        ("total_tributos", "numeric(14,2)", "default 0"),
        ("deducoes", "numeric(14,2)", "default 0"),
        ("total", "numeric(14,2)", "default 0"),
        ("rbt12", "numeric(14,2)", ""),
        ("aliquota_efetiva", "numeric(7,4)", ""),
        ("anexo", "text", ""),
        ("created_at", "timestamptz", "default now()"),
    ],
    "aux_produtos": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("company_id", "uuid", "references companies(id) on delete cascade not null"),
        ("codigo", "text", ""),
        ("descricao", "text", "not null"),
        ("ncm", "text", ""),
        ("cfop", "text", ""),
        ("tipo_nf", "text", "check (tipo_nf in ('nfe','nfce','nfse'))"),
        ("unidade_comercial", "text", "default 'UN'"),
        ("quantidade_comercial", "numeric(14,4)", "default 1"),
        ("valor_unitario_comercial", "numeric(14,4)", "default 0"),
        ("finalizado", "boolean", "default false"),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "declaracoes_fiscais": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("empresa_id", "uuid", "references companies(id) on delete cascade not null"),
        ("competencia", "char(6)", "not null"),
        ("tipo_declaracao", "text", ""),
        ("data_envio", "timestamptz", ""),
        ("status", "text", "default 'pronta para enviar' check (status in ('pronta para enviar','enviando','enviada','erro'))"),
        ("protocolo", "text", ""),
        ("xml_url", "text", ""),
        ("pdf_url", "text", ""),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "guias_fiscais": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("empresa_id", "uuid", "references companies(id) on delete cascade not null"),
        ("competencia", "char(6)", "not null"),
        ("tipo_guia", "text", "default 'DAS'"),
        ("data_vencimento", "date", ""),
        ("valor_total", "numeric(14,2)", ""),
        ("status", "text", "default 'gerando' check (status in ('gerando','gerada','paga','vencida','erro'))"),
        ("pdf_url", "text", ""),
        ("linha_digitavel", "text", ""),
        ("data_pagamento", "timestamptz", ""),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "arquivos_auxiliares": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("unique_id_empresa", "uuid", "references companies(id) on delete cascade"),
        ("unique_id_bubble", "text", ""),
        ("supabase_file_path", "text", ""),
        ("cert_password", "text", ""),
        ("created_at", "timestamptz", "default now()"),
    ],
    "municipios_nfse": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("codigo_ibge", "text", "unique not null"),
        ("nome_municipio", "text", ""),
        ("uf", "char(2)", ""),
        ("padrao_nfse", "text", ""),
        ("provedor_nfse", "text", ""),
        ("url_producao", "text", ""),
        ("url_homologacao", "text", ""),
        ("requer_certificado", "boolean", "default false"),
        ("requer_login", "boolean", "default false"),
        ("requer_liberacao_rps", "boolean", "default false"),
        ("requer_liberacao_webservice", "boolean", "default false"),
        ("requer_aidf", "boolean", "default false"),
        ("requer_cadastro_homologacao", "boolean", "default false"),
        ("requer_cadastro_tomador", "boolean", "default false"),
        ("requer_token_portal", "boolean", "default false"),
        ("im_zeros_esquerda", "boolean", "default false"),
        ("cancelamento_so_portal", "boolean", "default false"),
        ("serie_rps_so_numeros", "boolean", "default false"),
        ("valor_iss_obrigatorio", "boolean", "default false"),
        ("campo_serie_rps", "text", ""),
    ],
    "honorarios": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("cliente_id", "uuid", "references clientes(id) on delete cascade not null"),
        ("company_id", "uuid", "references companies(id) on delete cascade not null"),
        ("mes_referencia", "char(6)", "not null"),
        ("valor", "numeric(14,2)", "not null"),
        ("data_vencimento", "date", ""),
        ("data_pagamento", "timestamptz", ""),
        ("status", "text", "default 'pendente' check (status in ('pendente','pago','vencido'))"),
        ("observacao", "text", ""),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
    "abertura_empresas": [
        ("id", "uuid", "primary key default gen_random_uuid()"),
        ("user_id", "uuid", "references auth.users(id) on delete cascade not null"),
        ("company_id", "uuid", "references companies(id) on delete set null"),
        ("titular_rg", "text", ""),
        ("titular_cpf", "text", ""),
        ("titular_nome_mae", "text", ""),
        ("titular_naturalidade", "text", ""),
        ("titular_estado_civil", "text", ""),
        ("titular_endereco", "jsonb", ""),
        ("opcao_razao_social_1", "text", ""),
        ("opcao_razao_social_2", "text", ""),
        ("opcao_razao_social_3", "text", ""),
        ("nome_fantasia", "text", ""),
        ("tipo_societario", "text", ""),
        ("capital_social", "numeric(14,2)", ""),
        ("objeto_social", "text", ""),
        ("cnae", "text", ""),
        ("regime_pretendido", "text", ""),
        ("endereco_sede", "jsonb", ""),
        ("anexos", "jsonb", ""),
        ("processo_etapa", "text", "default 'recebido'"),
        ("created_at", "timestamptz", "default now()"),
        ("updated_at", "timestamptz", "default now()"),
    ],
}

# Mapeia tabela → coluna FK pra company (para gerar RLS company-scoped uniformemente)
COMPANY_FK_COL = {
    "clientes": "company_id",
    "empresas_fiscais": "empresa_id",
    "notas_fiscais": "company_id",
    "apuracoes_fiscais": "empresa_id",
    "declaracoes_fiscais": "empresa_id",
    "guias_fiscais": "empresa_id",
    "honorarios": "company_id",
    "arquivos_auxiliares": "unique_id_empresa",
    "aux_produtos": "company_id",
}


def emit_sql(out: Path):
    parts = [
        "-- @generated by bubble-to-prd/skills/gen_schema.py — edits são sobrescritos no próximo run.",
        "-- Para customizar, adicione migrations 0002+ ao lado.",
        "-- Schema inicial Balu (Bubble → Supabase Postgres)",
        "",
        "create extension if not exists \"pgcrypto\";",
        "",
    ]

    for table, cols in KNOWN_TABLES.items():
        parts.append(f"-- ─────────────────────────────────────────────────────")
        parts.append(f"create table if not exists public.{table} (")
        col_lines = []
        for name, typ, extra in cols:
            line = f"  {name} {typ}"
            if extra:
                line += f" {extra}"
            col_lines.append(line)
        parts.append(",\n".join(col_lines))
        parts.append(");")
        parts.append("")

    # ── Constraints adicionais via ALTER (evita forward references) ──
    parts.append("-- ─── Constraints adicionais ─────────────────────────")
    parts.append("alter table public.profiles add constraint profiles_current_company_fk "
                 "foreign key (current_company) references public.companies(id) on delete set null;")
    parts.append("alter table public.profiles add constraint profiles_empresa_fiscal_fk "
                 "foreign key (empresa_fiscal_id) references public.empresas_fiscais(id) on delete set null;")
    parts.append("-- dedup: 1 cliente por documento por dono (PRD §15.2)")
    parts.append("create unique index if not exists clientes_owner_doc_uniq "
                 "on public.clientes (owner_user_id, document) where deleted_at is null;")
    parts.append("-- 1 empresa por CNPJ por dono")
    parts.append("create unique index if not exists companies_owner_cnpj_uniq "
                 "on public.companies (user_id, cnpj) where deleted_at is null;")
    parts.append("")

    # ── Updated_at automático ──
    parts.append("-- ─── updated_at triggers ────────────────────────────")
    parts.append("""create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;""")
    for table, cols in KNOWN_TABLES.items():
        if any(c[0] == "updated_at" for c in cols):
            parts.append(f"create trigger {table}_set_updated_at before update on public.{table} "
                         f"for each row execute function public.tg_set_updated_at();")
    parts.append("")

    # ── RLS ──
    parts.append("-- ─── RLS ─────────────────────────────────────────────")
    for table in KNOWN_TABLES:
        parts.append(f"alter table public.{table} enable row level security;")
    parts.append("")

    parts.append("-- profiles: user só lê/edita o próprio")
    parts.append("create policy profiles_self on public.profiles for all to authenticated "
                 "using (id = auth.uid()) with check (id = auth.uid());")
    parts.append("")
    parts.append("-- companies: owner")
    parts.append("create policy companies_owner on public.companies for all to authenticated "
                 "using (user_id = auth.uid()) with check (user_id = auth.uid());")
    parts.append("")

    parts.append("-- helper: empresas do usuário")
    parts.append("""create or replace function public.user_company_ids() returns setof uuid
language sql stable as $$
  select id from public.companies where user_id = auth.uid();
$$;""")
    parts.append("")

    # Company-scoped tables (uniforme via mapping)
    for table, fk in COMPANY_FK_COL.items():
        parts.append(
            f"create policy {table}_company_scope on public.{table} for all to authenticated "
            f"using ({fk} in (select public.user_company_ids())) "
            f"with check ({fk} in (select public.user_company_ids()));"
        )
    parts.append("")

    # Cert_password nunca volta pro front: revoke select dessa coluna pra `authenticated`
    parts.append("-- PRD §3.3: cert_password NUNCA é exposto ao front.")
    parts.append("-- Revoga SELECT da coluna; backend usa service_role pra ler.")
    parts.append("revoke select (cert_password) on public.arquivos_auxiliares from authenticated;")
    parts.append("revoke select (cert_password) on public.arquivos_auxiliares from anon;")
    parts.append("")

    parts.append("-- municipios_nfse: leitura pública para autenticados")
    parts.append("create policy municipios_read on public.municipios_nfse for select to authenticated using (true);")
    parts.append("")

    parts.append("-- abertura_empresas: dono")
    parts.append("create policy abertura_owner on public.abertura_empresas for all to authenticated "
                 "using (user_id = auth.uid()) with check (user_id = auth.uid());")
    parts.append("")

    # RPC + trigger de auto-perfil
    parts.append("-- RPC: vincula empresa ao perfil + define como current")
    parts.append("""create or replace function public.add_company_to_profile(p_user_id uuid, p_company_id uuid) returns void
language plpgsql security definer as $$
begin
  update public.profiles set current_company = p_company_id where id = p_user_id;
end; $$;""")
    parts.append("")

    parts.append("-- Auto-cria profile quando user é criado no auth")
    parts.append("""create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();""")
    parts.append("")

    sql_path = out / "supabase" / "migrations" / "0001_init.sql"
    sql_path.parent.mkdir(parents=True, exist_ok=True)
    sql_path.write_text("\n".join(parts))
    print(f"✓ {sql_path}  ({len(KNOWN_TABLES)} tabelas, RLS habilitado, triggers + RPCs)")


def emit_enums(slices: Path, out: Path):
    osets = json.loads((slices / "04_option_sets.json").read_text())
    lines = ["// @generated by bubble-to-prd/skills/gen_schema.py — enums espelhando option_sets do Bubble.",
             "// Cada enum lista [db_value, display]. Códigos SEFAZ/Receita são transcrição literal.",
             ""]
    for key, oset in osets.items():
        if not isinstance(oset, dict): continue
        display = oset.get("display") or key
        values = oset.get("values") or {}
        ts_name = re.sub(r"[^A-Za-z0-9]+", "_", display).strip("_")
        # ordena por sort_factor quando presente
        ordered = sorted(values.values(), key=lambda v: v.get("sort_factor", 999) if isinstance(v, dict) else 999)
        lines.append(f"export const {ts_name} = [")
        # Dedup por db_value E por display — Bubble renomeia colisões com sufixo "0".
        seen_db, seen_disp = set(), set()
        for v in ordered:
            if not isinstance(v, dict): continue
            db = (v.get("db_value") or "").replace("'", "\\'")
            disp = (v.get("display") or "").replace("'", "\\'")
            if db in seen_db or disp in seen_disp: continue
            seen_db.add(db); seen_disp.add(disp)
            lines.append(f"  {{ value: '{db}', label: '{disp}' }},")
        lines.append(f"] as const;")
        lines.append(f"export type {ts_name}Value = typeof {ts_name}[number]['value'];")
        lines.append("")
    ts_path = out / "src" / "types" / "enums.ts"
    ts_path.parent.mkdir(parents=True, exist_ok=True)
    ts_path.write_text("\n".join(lines))
    print(f"✓ {ts_path}  ({len(osets)} enums)")


def emit_zod(out: Path):
    """Zod schemas mínimos para os data types mais usados em forms."""
    lines = [
        "// Auto-gerado — esquemas Zod para os payloads mais usados.",
        "// Estender conforme as pages forem implementadas.",
        "import { z } from 'zod';",
        "",
        "export const ClienteSchema = z.object({",
        "  person_type: z.enum(['PF','PJ']),",
        "  razao_social: z.string().min(2),",
        "  document: z.string().min(11),",
        "  inscricao_estadual: z.string().optional(),",
        "  indicador_inscricao_estadual: z.number().int().min(0).max(9).optional(),",
        "  inscricao_municipal: z.string().optional(),",
        "  email: z.string().email().optional(),",
        "  telefone: z.string().optional(),",
        "  logradouro: z.string().optional(),",
        "  numero: z.string().optional(),",
        "  complemento: z.string().optional(),",
        "  bairro: z.string().optional(),",
        "  municipio: z.string().optional(),",
        "  uf: z.string().length(2).optional(),",
        "  cep: z.string().optional(),",
        "  pais: z.string().default('Brasil'),",
        "});",
        "export type ClienteInput = z.infer<typeof ClienteSchema>;",
        "",
        "export const CompanySchema = z.object({",
        "  cnpj: z.string().length(14),",
        "  razao_social: z.string().min(2),",
        "  nome: z.string().optional(),",
        "  inscricao_estadual: z.string().optional(),",
        "  inscricao_municipal: z.string().optional(),",
        "  codigo_municipio: z.string().optional(),",
        "  logradouro: z.string().optional(),",
        "  numero: z.string().optional(),",
        "  bairro: z.string().optional(),",
        "  municipio: z.string().optional(),",
        "  uf: z.string().length(2).optional(),",
        "  cep: z.string().optional(),",
        "  telefone: z.string().optional(),",
        "  email: z.string().email().optional(),",
        "});",
        "export type CompanyInput = z.infer<typeof CompanySchema>;",
        "",
        "export const HonorarioSchema = z.object({",
        "  cliente_id: z.string().uuid(),",
        "  company_id: z.string().uuid(),",
        "  mes_referencia: z.string().regex(/^\\d{6}$/),",
        "  valor: z.number().nonnegative(),",
        "  data_vencimento: z.string().optional(),",
        "  observacao: z.string().optional(),",
        "});",
        "export type HonorarioInput = z.infer<typeof HonorarioSchema>;",
    ]
    p = out / "src" / "types" / "zod.ts"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines))
    print(f"✓ {p}")


def emit_database_types(out: Path):
    """Tipos TS mínimos derivados de KNOWN_TABLES. Não substitui `supabase gen types`,
    mas dá type-safety básica em selects/inserts até o CLI rodar contra DB real."""
    # mapeamento bruto pg → ts
    PG_TS = {"uuid":"string","text":"string","integer":"number","smallint":"number",
             "boolean":"boolean","timestamptz":"string","date":"string","jsonb":"unknown",
             "numeric":"number","char":"string"}
    def ts_of(pg: str) -> str:
        base = pg.split("(")[0].split()[0]
        return PG_TS.get(base, "string")

    lines = [
        "// @generated by bubble-to-prd/skills/gen_schema.py — edits são sobrescritos.",
        "// Substitua por `npx supabase gen types typescript --local > src/types/database.ts` quando o CLI estiver disponível.",
        "//",
        "// Database é `any` propositalmente: a inferência de `.select('col1, col2')` do supabase-js",
        "// exige machinery gerada pelo CLI (com prefixos `__InternalSupabase`). Sem ela, todos os",
        "// retornos viram `never`. Como compensação, exportamos `Tables.<nome>` nominalmente.",
        "",
        "export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];",
        "export type Database = any;",
        "",
        "export type Tables = {",
    ]
    for table, cols in KNOWN_TABLES.items():
        lines.append(f"  {table}: {{")
        for name, pg, extra in cols:
            optional = "" if "not null" in extra or "primary key" in extra else " | null"
            lines.append(f"    {name}: {ts_of(pg)}{optional};")
        lines.append(f"  }};")
    lines.append("};")
    lines.append("")
    lines.append("// Helper: linha de tabela X")
    lines.append("export type Row<T extends keyof Tables> = Tables[T];")

    p = out / "src" / "types" / "database.ts"
    p.write_text("\n".join(lines))
    print(f"✓ {p}  ({len(KNOWN_TABLES)} tabelas tipadas)")


def main():
    if len(sys.argv) < 3:
        print("Uso: gen_schema.py <slices_dir> <out_dir>"); sys.exit(1)
    slices = Path(sys.argv[1])
    out = Path(sys.argv[2])
    emit_sql(out)
    emit_enums(slices, out)
    emit_zod(out)
    emit_database_types(out)


if __name__ == "__main__":
    main()
