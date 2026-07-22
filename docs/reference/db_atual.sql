--
-- PostgreSQL database dump
--
-- ATENÇÃO (2026-07-22): este snapshot é ANTERIOR ao Bloco A. Os deltas do
-- Bloco A estão nas migrations 0030–0035 (app/supabase/migrations/), que foram
-- aplicadas VERBATIM no banco real em 2026-07-22 com verificação pós-aplicação.
-- Fonte da verdade do schema = este arquivo + migrations 0030–0035.
-- (Regenerar via pg_dump quando houver Docker/psql disponível.)
--

\restrict eHcNHxLmTHueGGvLiqLPcTttVq2bfApkAgAL0xtLEFJt1gbBdLAj2bnfssuXQt4

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: user_types; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_types AS ENUM (
    'Empresa',
    'Contador'
);


--
-- Name: TYPE user_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.user_types IS 'Tipos de usuário';


--
-- Name: add_company_to_profile(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_company_to_profile(p_user_id uuid, p_company_id uuid) RETURNS json
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE profiles
  SET company_id = p_company_id
  WHERE user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'user_id', p_user_id,
    'company_id', p_company_id
  );
END;
$$;


--
-- Name: handle_new_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$begin
  insert into public.role_types (
    user_id,
    type
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'type',
      'Empresa'
    )::user_types
  );

  return new;
end;$$;


--
-- Name: set_atualizado_em(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_atualizado_em() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: tg_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN new.updated_at := now(); RETURN new; END; $$;


--
-- Name: update_status_atrasado_honorarios(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_status_atrasado_honorarios() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.data_vencimento < CURRENT_DATE AND NEW.data_pagamento IS NULL THEN
    NEW.status = 'atrasado';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_honorarios(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_honorarios() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: user_company_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_company_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE
    AS $$
  select id from public.companies where user_id = auth.uid();
$$;


--
-- Name: user_owns_company(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_owns_company(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.companies
    where id = cid and user_id = auth.uid()
  );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: abertura_alteracoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abertura_alteracoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    abertura_id uuid NOT NULL,
    user_id uuid NOT NULL,
    dados jsonb NOT NULL,
    dados_hash text NOT NULL,
    status character varying(20) DEFAULT 'pendente'::character varying NOT NULL,
    observacoes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT abertura_alteracoes_status_check CHECK (((status)::text = ANY ((ARRAY['pendente'::character varying, 'aprovada'::character varying, 'rejeitada'::character varying])::text[])))
);


--
-- Name: abertura_empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abertura_empresas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    titular_nome_completo text NOT NULL,
    titular_cpf character varying(14) NOT NULL,
    titular_rg_numero character varying(20),
    titular_rg_orgao_emissor character varying(20),
    titular_rg_uf character(2),
    titular_data_nascimento date,
    titular_estado_civil character varying(20),
    titular_nome_mae text,
    titular_telefone character varying(20),
    titular_email text,
    titular_nacionalidade character varying(50) DEFAULT 'brasileiro(a)'::character varying,
    titular_naturalidade_cidade text,
    titular_naturalidade_uf character(2),
    titular_cep character varying(9),
    titular_logradouro text,
    titular_numero character varying(20),
    titular_complemento text,
    titular_bairro text,
    titular_cidade text,
    titular_uf character(2),
    empresa_razao_social_1 text,
    empresa_razao_social_2 text,
    empresa_razao_social_3 text,
    empresa_nome_fantasia text,
    empresa_tipo character varying(10),
    empresa_capital_social numeric(15,2),
    empresa_objeto_social text,
    empresa_cnae_principal character varying(10),
    empresa_cnaes_secundarios text[],
    empresa_regime_tributario character varying(20),
    sede_mesmo_que_titular boolean DEFAULT false,
    sede_tipo_endereco character varying(20),
    sede_cep character varying(9),
    sede_logradouro text,
    sede_numero character varying(20),
    sede_complemento text,
    sede_bairro text,
    sede_cidade text,
    sede_uf character(2),
    doc_rg_frente text,
    doc_rg_verso text,
    doc_cnh_frente text,
    doc_cnh_verso text,
    doc_cpf text,
    doc_comprovante_titular text,
    doc_comprovante_sede text,
    doc_declaracao_uso text,
    processo_etapa character varying(30) DEFAULT 'recebido'::character varying,
    processo_protocolo text,
    processo_cnpj_emitido character varying(18),
    processo_observacoes text,
    processo_atualizado_por text,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now(),
    user_id uuid,
    company_id uuid,
    dados_hash text,
    CONSTRAINT abertura_empresas_empresa_regime_tributario_check CHECK (((empresa_regime_tributario)::text = ANY ((ARRAY['MEI'::character varying, 'Simples Nacional'::character varying, 'Lucro Presumido'::character varying, 'Lucro Real'::character varying])::text[]))),
    CONSTRAINT abertura_empresas_empresa_tipo_check CHECK (((empresa_tipo)::text = ANY ((ARRAY['MEI'::character varying, 'EI'::character varying, 'LTDA'::character varying])::text[]))),
    CONSTRAINT abertura_empresas_processo_etapa_check CHECK (((processo_etapa)::text = ANY ((ARRAY['recebido'::character varying, 'em_analise'::character varying, 'pendente_documentos'::character varying, 'enviado_receita'::character varying, 'enviado_junta'::character varying, 'enviado_prefeitura'::character varying, 'concluido'::character varying, 'cancelado'::character varying])::text[]))),
    CONSTRAINT abertura_empresas_sede_tipo_endereco_check CHECK (((sede_tipo_endereco)::text = ANY ((ARRAY['Residencial'::character varying, 'Comercial'::character varying, 'Virtual'::character varying])::text[])))
);


--
-- Name: apuracoes_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apuracoes_fiscais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    owner_user_id uuid,
    competencia_referencia character varying(7),
    anexo_simples character varying(10),
    fator_r numeric(7,4),
    aliquota_efetiva numeric(7,4),
    guia_fiscal_id uuid,
    status character varying(20) DEFAULT 'pendente'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    tipo_apuracao character varying(30),
    receita_mes numeric(15,2) DEFAULT 0,
    rbt12 numeric(15,2),
    valor_imposto numeric(15,2) DEFAULT 0,
    payload_calculo jsonb
);


--
-- Name: arquivos_auxiliares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arquivos_auxiliares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    supabase_file_path text,
    cert_password character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    storage_key text,
    cert_not_after timestamp with time zone,
    cert_subject_cn text,
    cert_cnpj text,
    cert_fingerprint text
);


--
-- Name: aux_produtos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aux_produtos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    codigo text,
    descricao text NOT NULL,
    ncm text,
    cfop text,
    tipo_nf text,
    unidade_comercial text DEFAULT 'UN'::text,
    quantidade_comercial numeric(14,4) DEFAULT 1,
    valor_unitario_comercial numeric(14,4) DEFAULT 0,
    finalizado boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT aux_produtos_tipo_nf_check CHECK ((tipo_nf = ANY (ARRAY['nfe'::text, 'nfce'::text, 'nfse'::text])))
);


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid,
    company_id uuid,
    person_type character varying(10),
    razao_social character varying(255),
    document character varying(20),
    inscricao_estadual character varying(30),
    indicador_inscricao_estadual character varying(5),
    inscricao_municipal character varying(30),
    codigo_municipio character varying(10),
    email character varying(255),
    telefone character varying(20),
    logradouro character varying(255),
    numero character varying(10),
    complemento character varying(100),
    bairro character varying(100),
    municipio character varying(100),
    uf character(2),
    cep character varying(10),
    pais character varying(50),
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: cnae_anexo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cnae_anexo (
    codigo text NOT NULL,
    anexo_base text,
    fator_r boolean DEFAULT false NOT NULL,
    anexo_iv boolean DEFAULT false NOT NULL,
    descricao text,
    observacao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE cnae_anexo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cnae_anexo IS 'Referência CNAE→anexo do Simples (curada). anexo_base NULL quando depende de Fator R.';


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    nome character varying(255),
    razao_social character varying(255),
    cnpj character varying(20),
    inscricao_estadual character varying(30),
    inscricao_municipal character varying(30),
    codigo_municipio character varying(10),
    logradouro character varying(255),
    numero character varying(10),
    complemento character varying(100),
    bairro character varying(100),
    municipio character varying(100),
    uf character(2),
    cep character varying(10),
    telefone character varying(20),
    email character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    sem_numero boolean DEFAULT false NOT NULL,
    focus_token text,
    focus_status text,
    focus_last_check timestamp with time zone,
    focus_last_error text,
    status text DEFAULT 'active'::text,
    CONSTRAINT companies_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'em_abertura'::text])))
);


--
-- Name: COLUMN companies.focus_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.focus_token IS 'Token devolvido pelo POST /v2/empresas da Focus (auth por-empresa).';


--
-- Name: COLUMN companies.focus_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.focus_status IS 'Estado do último sync com Focus: ok | erro | NULL (nunca tentou).';


--
-- Name: COLUMN companies.focus_last_check; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.focus_last_check IS 'Timestamp da última tentativa de cadastro/sync na Focus.';


--
-- Name: COLUMN companies.focus_last_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.focus_last_error IS 'Mensagem da última falha (NULL quando status=ok).';


--
-- Name: company_cnaes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_cnaes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    codigo text NOT NULL,
    descricao text,
    tipo text NOT NULL,
    fonte text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT company_cnaes_tipo_check CHECK ((tipo = ANY (ARRAY['principal'::text, 'secundario'::text])))
);


--
-- Name: TABLE company_cnaes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.company_cnaes IS 'CNAEs (principal + secundários) por empresa. Anexo é resolvido via cnae_anexo em leitura.';


--
-- Name: declaracoes_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.declaracoes_fiscais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    competencia_referencia text NOT NULL,
    tipo text DEFAULT 'PGDAS-D'::text NOT NULL,
    numero_declaracao text,
    data_transmissao timestamp with time zone,
    status text,
    guia_fiscal_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE declaracoes_fiscais; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.declaracoes_fiscais IS 'Declarações fiscais (PGDAS-D etc.) por competência. Convenção real (company_id/competencia_referencia); corrige a 0001.';


--
-- Name: empresas_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresas_fiscais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid,
    cnpj character varying(20),
    regime_tributario character varying(50),
    "Code_regime_tributario" character varying(10),
    cnae_principal character varying(20),
    anexo_simples character varying(10),
    usa_fator_r boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    login_responsavel text,
    senha_responsavel text,
    inscricao_municipal character varying(30),
    serie_rps character varying(20),
    numero_rps_inicial integer DEFAULT 1,
    token_portal text,
    regime_especial_tributacao character varying(10),
    email_provedor character varying(255),
    whatsapp_provedor character varying(20),
    caminho_liberacao_rps text,
    municipio_id uuid,
    requer_liberacao_rps boolean DEFAULT false,
    requer_liberacao_webservice boolean DEFAULT false,
    requer_aidf boolean DEFAULT false,
    requer_cadastro_homologacao boolean DEFAULT false,
    emitir_nota_homol_antes_producao boolean DEFAULT false,
    credenciais_por_ambiente boolean DEFAULT false,
    requer_token_portal boolean DEFAULT false,
    im_zeros_esquerda boolean DEFAULT false,
    requer_cadastro_tomador boolean DEFAULT false,
    valor_iss_obrigatorio boolean DEFAULT false,
    cancelamento_so_portal boolean DEFAULT false,
    serie_rps_so_numeros boolean DEFAULT false,
    instrucoes_configuracao text,
    owner_user_id uuid,
    nfse_autenticacao_tipo character varying(50),
    nfse_usuario_login text,
    nfse_senha_login text,
    nfse_token_api text,
    nfse_frase_secreta text,
    nfse_chave_api text,
    nfse_url_portal_producao text,
    nfse_url_portal_homologacao text,
    unique_id_bubble character varying(255),
    rps_liberado boolean DEFAULT false,
    webservice_liberado boolean DEFAULT false,
    homologacao_liberada boolean DEFAULT false,
    producao_liberada boolean DEFAULT false,
    tomador_credenciado boolean DEFAULT false,
    aidf_solicitada boolean DEFAULT false,
    cadastro_homologacao_feito boolean DEFAULT false,
    nota_homol_emitida boolean DEFAULT false,
    nfse_habilitada boolean,
    empresa_fiscal_ativada boolean,
    focus_empresa_id integer,
    focus_codigo_municipio text,
    focus_habilita_nfse boolean,
    focus_habilita_nfsen_producao boolean,
    focus_habilita_nfsen_homologacao boolean,
    focus_sync_em timestamp with time zone,
    focus_habilita_nfe boolean DEFAULT false NOT NULL,
    focus_habilita_nfce boolean DEFAULT false NOT NULL,
    serpro_token_procurador text,
    serpro_token_procurador_expiration timestamp with time zone,
    focus_fields_dirty_at timestamp with time zone,
    atividade_mei text,
    sincronizacao_inicial_serpro_at timestamp with time zone
);


--
-- Name: COLUMN empresas_fiscais.focus_habilita_nfe; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfe IS 'Empresa habilitada a emitir NF-e (modelo 55) no painel.';


--
-- Name: COLUMN empresas_fiscais.focus_habilita_nfce; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfce IS 'Empresa habilitada a emitir NFC-e (modelo 65) no painel.';


--
-- Name: COLUMN empresas_fiscais.focus_fields_dirty_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresas_fiscais.focus_fields_dirty_at IS 'Última edição de um campo que vai no payload da Focus (dados da empresa / regime). Comparado contra focus_sync_em para detectar drift. NULL = nada pendente.';


--
-- Name: COLUMN empresas_fiscais.atividade_mei; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresas_fiscais.atividade_mei IS 'Atividade do MEI p/ estimativa de DAS-MEI. NULL → Serviços (default).';


--
-- Name: folha_mensal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folha_mensal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    competencia text NOT NULL,
    pro_labore numeric(14,2) DEFAULT 0 NOT NULL,
    salarios numeric(14,2) DEFAULT 0 NOT NULL,
    encargos numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE folha_mensal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.folha_mensal IS 'Folha mensal por empresa (pró-labore+salários+encargos). Alimenta o Fator R (Anexo III↔V).';


--
-- Name: guias_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guias_fiscais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    owner_user_id uuid,
    competencia_mes integer NOT NULL,
    competencia_ano integer NOT NULL,
    competencia_referencia character varying(7),
    valor_pago numeric(15,2) DEFAULT 0,
    codigo_barras text,
    linha_digitavel text,
    data_vencimento date,
    data_pagamento date,
    numero_guia character varying(50),
    url_guia text,
    status character varying(30) DEFAULT 'pendente'::character varying,
    origem character varying(30) DEFAULT 'n8n'::character varying,
    observacoes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    numero_das character varying(50),
    valor_principal numeric(15,2) DEFAULT 0,
    valor_multa numeric(15,2) DEFAULT 0,
    valor_juros numeric(15,2) DEFAULT 0,
    valor_total numeric(15,2) DEFAULT 0,
    url_pdf text,
    CONSTRAINT guias_fiscais_ano_check CHECK (((competencia_ano >= 2000) AND (competencia_ano <= 2100))),
    CONSTRAINT guias_fiscais_mes_check CHECK (((competencia_mes >= 1) AND (competencia_mes <= 12)))
);


--
-- Name: honorarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.honorarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    company_id uuid NOT NULL,
    mes_referencia date NOT NULL,
    valor numeric(10,2) NOT NULL,
    data_vencimento date NOT NULL,
    data_pagamento date,
    status character varying(20) DEFAULT 'pendente'::character varying,
    observacao text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT honorarios_status_check CHECK (((status)::text = ANY ((ARRAY['pendente'::character varying, 'pago'::character varying, 'atrasado'::character varying])::text[])))
);


--
-- Name: municipios_nfse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.municipios_nfse (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo_ibge text NOT NULL,
    nome_municipio text NOT NULL,
    uf character(2) NOT NULL,
    nome_uf text,
    nfse_habilitada boolean DEFAULT false NOT NULL,
    status_nfse text,
    provedor_nfse text,
    requer_certificado_nfse boolean,
    possui_ambiente_homologacao_nfse boolean,
    possui_cancelamento_nfse boolean,
    cpf_cnpj_obrigatorio_nfse boolean,
    endereco_obrigatorio_nfse boolean,
    item_lista_servico_obrigatorio_nfse boolean,
    codigo_cnae_obrigatorio_nfse boolean,
    codigo_tributario_municipio_obrigatorio_nfse boolean,
    ultima_emissao_nfse timestamp with time zone,
    focus_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notas_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_fiscais (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    tipo_documento text NOT NULL,
    referencia text NOT NULL,
    data_emissao timestamp with time zone NOT NULL,
    status text NOT NULL,
    valor_total numeric(15,2) NOT NULL,
    payload_focusnfe jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    chave_acesso text,
    cliente_id uuid,
    protocolo_autorizacao text,
    xml_url text,
    pdf_url text,
    qrcode text,
    numero_nf text,
    serie text,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    updated_at timestamp with time zone,
    cnae text,
    origem text DEFAULT 'emissao'::text NOT NULL,
    CONSTRAINT notas_fiscais_origem_check CHECK ((origem = ANY (ARRAY['emissao'::text, 'manual'::text]))),
    CONSTRAINT notas_fiscais_tipo_documento_check CHECK ((tipo_documento = ANY (ARRAY['NFe'::text, 'NFCe'::text, 'NFSe'::text])))
);


--
-- Name: COLUMN notas_fiscais.cnae; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notas_fiscais.cnae IS 'CNAE (7 dígitos) da atividade da nota; resolve o anexo na apuração. NULL → fallback no principal.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    company_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    current_company uuid
);


--
-- Name: role_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.user_types DEFAULT 'Empresa'::public.user_types NOT NULL
);


--
-- Name: TABLE role_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_types IS 'Empresa / Contador';


--
-- Name: COLUMN role_types.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.role_types.type IS 'Empresa / Contador';


--
-- Name: serpro_contratante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.serpro_contratante (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cnpj character varying(20) NOT NULL,
    nome text,
    cert_pfx_enc text NOT NULL,
    cert_password_enc text NOT NULL,
    cert_not_after timestamp with time zone,
    cert_subject_cn text,
    auth_access_token text,
    auth_jwt_token text,
    auth_token_expiration timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: abertura_alteracoes abertura_alteracoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_alteracoes
    ADD CONSTRAINT abertura_alteracoes_pkey PRIMARY KEY (id);


--
-- Name: abertura_empresas abertura_empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_empresas
    ADD CONSTRAINT abertura_empresas_pkey PRIMARY KEY (id);


--
-- Name: abertura_empresas abertura_empresas_titular_cpf_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_empresas
    ADD CONSTRAINT abertura_empresas_titular_cpf_key UNIQUE (titular_cpf);


--
-- Name: apuracoes_fiscais apuracoes_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apuracoes_fiscais
    ADD CONSTRAINT apuracoes_fiscais_pkey PRIMARY KEY (id);


--
-- Name: arquivos_auxiliares arquivos_auxiliares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arquivos_auxiliares
    ADD CONSTRAINT arquivos_auxiliares_pkey PRIMARY KEY (id);


--
-- Name: aux_produtos aux_produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aux_produtos
    ADD CONSTRAINT aux_produtos_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: cnae_anexo cnae_anexo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cnae_anexo
    ADD CONSTRAINT cnae_anexo_pkey PRIMARY KEY (codigo);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_cnaes company_cnaes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_cnaes
    ADD CONSTRAINT company_cnaes_pkey PRIMARY KEY (id);


--
-- Name: declaracoes_fiscais declaracoes_fiscais_company_comp_tipo_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_company_comp_tipo_uniq UNIQUE (company_id, competencia_referencia, tipo);


--
-- Name: declaracoes_fiscais declaracoes_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_pkey PRIMARY KEY (id);


--
-- Name: empresas_fiscais empresas_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_fiscais
    ADD CONSTRAINT empresas_fiscais_pkey PRIMARY KEY (id);


--
-- Name: folha_mensal folha_mensal_company_competencia_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folha_mensal
    ADD CONSTRAINT folha_mensal_company_competencia_uniq UNIQUE (company_id, competencia);


--
-- Name: folha_mensal folha_mensal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folha_mensal
    ADD CONSTRAINT folha_mensal_pkey PRIMARY KEY (id);


--
-- Name: guias_fiscais guias_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guias_fiscais
    ADD CONSTRAINT guias_fiscais_pkey PRIMARY KEY (id);


--
-- Name: honorarios honorarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honorarios
    ADD CONSTRAINT honorarios_pkey PRIMARY KEY (id);


--
-- Name: municipios_nfse municipios_nfse_codigo_ibge_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipios_nfse
    ADD CONSTRAINT municipios_nfse_codigo_ibge_key UNIQUE (codigo_ibge);


--
-- Name: municipios_nfse municipios_nfse_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipios_nfse
    ADD CONSTRAINT municipios_nfse_pkey PRIMARY KEY (id);


--
-- Name: notas_fiscais notas_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais
    ADD CONSTRAINT notas_fiscais_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: role_types role_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_types
    ADD CONSTRAINT role_types_pkey PRIMARY KEY (id);


--
-- Name: serpro_contratante serpro_contratante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.serpro_contratante
    ADD CONSTRAINT serpro_contratante_pkey PRIMARY KEY (id);


--
-- Name: abertura_alteracoes_abertura_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abertura_alteracoes_abertura_id_idx ON public.abertura_alteracoes USING btree (abertura_id);


--
-- Name: company_cnaes_company_codigo_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_cnaes_company_codigo_uniq ON public.company_cnaes USING btree (company_id, codigo) WHERE (deleted_at IS NULL);


--
-- Name: company_cnaes_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_cnaes_company_idx ON public.company_cnaes USING btree (company_id);


--
-- Name: declaracoes_fiscais_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX declaracoes_fiscais_company_idx ON public.declaracoes_fiscais USING btree (company_id);


--
-- Name: folha_mensal_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folha_mensal_company_idx ON public.folha_mensal USING btree (company_id);


--
-- Name: idx_abertura_cnpj; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abertura_cnpj ON public.abertura_empresas USING btree (processo_cnpj_emitido);


--
-- Name: idx_abertura_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abertura_company_id ON public.abertura_empresas USING btree (company_id);


--
-- Name: idx_abertura_cpf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abertura_cpf ON public.abertura_empresas USING btree (titular_cpf);


--
-- Name: idx_abertura_etapa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abertura_etapa ON public.abertura_empresas USING btree (processo_etapa);


--
-- Name: idx_abertura_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abertura_user_id ON public.abertura_empresas USING btree (user_id);


--
-- Name: idx_apuracoes_fiscais_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apuracoes_fiscais_company_id ON public.apuracoes_fiscais USING btree (company_id);


--
-- Name: idx_apuracoes_fiscais_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apuracoes_fiscais_status ON public.apuracoes_fiscais USING btree (status);


--
-- Name: idx_guias_fiscais_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guias_fiscais_company_id ON public.guias_fiscais USING btree (company_id);


--
-- Name: idx_guias_fiscais_competencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guias_fiscais_competencia ON public.guias_fiscais USING btree (competencia_ano, competencia_mes);


--
-- Name: idx_guias_fiscais_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guias_fiscais_status ON public.guias_fiscais USING btree (status);


--
-- Name: idx_honorarios_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honorarios_cliente_id ON public.honorarios USING btree (cliente_id);


--
-- Name: idx_honorarios_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honorarios_company_id ON public.honorarios USING btree (company_id);


--
-- Name: idx_honorarios_mes_referencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honorarios_mes_referencia ON public.honorarios USING btree (mes_referencia);


--
-- Name: idx_honorarios_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_honorarios_status ON public.honorarios USING btree (status);


--
-- Name: idx_notas_fiscais_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_fiscais_company_id ON public.notas_fiscais USING btree (company_id);


--
-- Name: idx_notas_fiscais_company_id_referencia; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_notas_fiscais_company_id_referencia ON public.notas_fiscais USING btree (company_id, referencia);


--
-- Name: serpro_contratante_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX serpro_contratante_singleton ON public.serpro_contratante USING btree ((true));


--
-- Name: uniq_apuracoes_company_competencia; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_apuracoes_company_competencia ON public.apuracoes_fiscais USING btree (company_id, competencia_referencia);


--
-- Name: uniq_guias_company_competencia; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_guias_company_competencia ON public.guias_fiscais USING btree (company_id, competencia_referencia);


--
-- Name: abertura_alteracoes abertura_alteracoes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER abertura_alteracoes_set_updated_at BEFORE UPDATE ON public.abertura_alteracoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: aux_produtos aux_produtos_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER aux_produtos_set_updated_at BEFORE UPDATE ON public.aux_produtos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: company_cnaes tg_company_cnaes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_company_cnaes_updated_at BEFORE UPDATE ON public.company_cnaes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: declaracoes_fiscais tg_declaracoes_fiscais_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_declaracoes_fiscais_updated_at BEFORE UPDATE ON public.declaracoes_fiscais FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: folha_mensal tg_folha_mensal_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_folha_mensal_updated_at BEFORE UPDATE ON public.folha_mensal FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: abertura_empresas trg_abertura_atualizado; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_abertura_atualizado BEFORE UPDATE ON public.abertura_empresas FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();


--
-- Name: apuracoes_fiscais trg_apuracoes_fiscais_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apuracoes_fiscais_updated_at BEFORE UPDATE ON public.apuracoes_fiscais FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: arquivos_auxiliares trg_arquivos_auxiliares_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_arquivos_auxiliares_updated_at BEFORE UPDATE ON public.arquivos_auxiliares FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: clientes trg_clientes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: companies trg_companies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: empresas_fiscais trg_empresas_fiscais_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_empresas_fiscais_updated_at BEFORE UPDATE ON public.empresas_fiscais FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: guias_fiscais trg_guias_fiscais_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guias_fiscais_updated_at BEFORE UPDATE ON public.guias_fiscais FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: honorarios trg_honorarios_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_honorarios_status BEFORE INSERT OR UPDATE ON public.honorarios FOR EACH ROW EXECUTE FUNCTION public.update_status_atrasado_honorarios();


--
-- Name: honorarios trg_honorarios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_honorarios_updated_at BEFORE UPDATE ON public.honorarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_honorarios();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: abertura_alteracoes abertura_alteracoes_abertura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_alteracoes
    ADD CONSTRAINT abertura_alteracoes_abertura_id_fkey FOREIGN KEY (abertura_id) REFERENCES public.abertura_empresas(id) ON DELETE CASCADE;


--
-- Name: abertura_alteracoes abertura_alteracoes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_alteracoes
    ADD CONSTRAINT abertura_alteracoes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abertura_empresas abertura_empresas_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_empresas
    ADD CONSTRAINT abertura_empresas_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: abertura_empresas abertura_empresas_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abertura_empresas
    ADD CONSTRAINT abertura_empresas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: apuracoes_fiscais apuracoes_fiscais_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apuracoes_fiscais
    ADD CONSTRAINT apuracoes_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: apuracoes_fiscais apuracoes_fiscais_guia_fiscal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apuracoes_fiscais
    ADD CONSTRAINT apuracoes_fiscais_guia_fiscal_id_fkey FOREIGN KEY (guia_fiscal_id) REFERENCES public.guias_fiscais(id);


--
-- Name: apuracoes_fiscais apuracoes_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apuracoes_fiscais
    ADD CONSTRAINT apuracoes_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: arquivos_auxiliares arquivos_auxiliares_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arquivos_auxiliares
    ADD CONSTRAINT arquivos_auxiliares_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: aux_produtos aux_produtos_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aux_produtos
    ADD CONSTRAINT aux_produtos_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: clientes clientes_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: companies companies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: company_cnaes company_cnaes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_cnaes
    ADD CONSTRAINT company_cnaes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: declaracoes_fiscais declaracoes_fiscais_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: declaracoes_fiscais declaracoes_fiscais_guia_fiscal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_guia_fiscal_id_fkey FOREIGN KEY (guia_fiscal_id) REFERENCES public.guias_fiscais(id);


--
-- Name: empresas_fiscais empresas_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_fiscais
    ADD CONSTRAINT empresas_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: folha_mensal folha_mensal_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folha_mensal
    ADD CONSTRAINT folha_mensal_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: guias_fiscais guias_fiscais_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guias_fiscais
    ADD CONSTRAINT guias_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: guias_fiscais guias_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guias_fiscais
    ADD CONSTRAINT guias_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: honorarios honorarios_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honorarios
    ADD CONSTRAINT honorarios_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: honorarios honorarios_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.honorarios
    ADD CONSTRAINT honorarios_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: notas_fiscais notas_fiscais_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais
    ADD CONSTRAINT notas_fiscais_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;


--
-- Name: notas_fiscais notas_fiscais_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais
    ADD CONSTRAINT notas_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_current_company_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_current_company_fkey FOREIGN KEY (current_company) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: role_types role_types_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_types
    ADD CONSTRAINT role_types_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: abertura_alteracoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abertura_alteracoes ENABLE ROW LEVEL SECURITY;

--
-- Name: abertura_alteracoes abertura_alteracoes_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY abertura_alteracoes_owner ON public.abertura_alteracoes TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: abertura_empresas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abertura_empresas ENABLE ROW LEVEL SECURITY;

--
-- Name: abertura_empresas abertura_empresas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY abertura_empresas_delete ON public.abertura_empresas FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: abertura_empresas abertura_empresas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY abertura_empresas_insert ON public.abertura_empresas FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: abertura_empresas abertura_empresas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY abertura_empresas_select ON public.abertura_empresas FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: abertura_empresas abertura_empresas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY abertura_empresas_update ON public.abertura_empresas FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: apuracoes_fiscais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.apuracoes_fiscais ENABLE ROW LEVEL SECURITY;

--
-- Name: apuracoes_fiscais apuracoes_fiscais_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY apuracoes_fiscais_delete ON public.apuracoes_fiscais FOR DELETE USING (public.user_owns_company(company_id));


--
-- Name: apuracoes_fiscais apuracoes_fiscais_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY apuracoes_fiscais_insert ON public.apuracoes_fiscais FOR INSERT WITH CHECK (public.user_owns_company(company_id));


--
-- Name: apuracoes_fiscais apuracoes_fiscais_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY apuracoes_fiscais_select ON public.apuracoes_fiscais FOR SELECT USING (public.user_owns_company(company_id));


--
-- Name: apuracoes_fiscais apuracoes_fiscais_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY apuracoes_fiscais_update ON public.apuracoes_fiscais FOR UPDATE USING (public.user_owns_company(company_id)) WITH CHECK (public.user_owns_company(company_id));


--
-- Name: arquivos_auxiliares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arquivos_auxiliares ENABLE ROW LEVEL SECURITY;

--
-- Name: arquivos_auxiliares arquivos_auxiliares_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arquivos_auxiliares_delete ON public.arquivos_auxiliares FOR DELETE USING (public.user_owns_company(company_id));


--
-- Name: arquivos_auxiliares arquivos_auxiliares_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arquivos_auxiliares_insert ON public.arquivos_auxiliares FOR INSERT WITH CHECK (public.user_owns_company(company_id));


--
-- Name: arquivos_auxiliares arquivos_auxiliares_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arquivos_auxiliares_select ON public.arquivos_auxiliares FOR SELECT USING (public.user_owns_company(company_id));


--
-- Name: arquivos_auxiliares arquivos_auxiliares_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arquivos_auxiliares_update ON public.arquivos_auxiliares FOR UPDATE USING (public.user_owns_company(company_id)) WITH CHECK (public.user_owns_company(company_id));


--
-- Name: aux_produtos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aux_produtos ENABLE ROW LEVEL SECURITY;

--
-- Name: aux_produtos aux_produtos_company_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aux_produtos_company_scope ON public.aux_produtos TO authenticated USING ((company_id IN ( SELECT public.user_company_ids() AS user_company_ids))) WITH CHECK ((company_id IN ( SELECT public.user_company_ids() AS user_company_ids)));


--
-- Name: clientes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

--
-- Name: clientes clientes_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_delete ON public.clientes FOR DELETE USING (public.user_owns_company(company_id));


--
-- Name: clientes clientes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_insert ON public.clientes FOR INSERT WITH CHECK (public.user_owns_company(company_id));


--
-- Name: clientes clientes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_select ON public.clientes FOR SELECT USING (public.user_owns_company(company_id));


--
-- Name: clientes clientes_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_update ON public.clientes FOR UPDATE USING (public.user_owns_company(company_id)) WITH CHECK (public.user_owns_company(company_id));


--
-- Name: cnae_anexo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cnae_anexo ENABLE ROW LEVEL SECURITY;

--
-- Name: cnae_anexo cnae_anexo_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cnae_anexo_select ON public.cnae_anexo FOR SELECT TO authenticated USING (true);


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_delete ON public.companies FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: companies companies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_insert ON public.companies FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: companies companies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_select ON public.companies FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: companies companies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_update ON public.companies FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: company_cnaes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_cnaes ENABLE ROW LEVEL SECURITY;

--
-- Name: company_cnaes company_cnaes_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_cnaes_owner ON public.company_cnaes TO authenticated USING ((owner_user_id = auth.uid())) WITH CHECK ((owner_user_id = auth.uid()));


--
-- Name: declaracoes_fiscais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.declaracoes_fiscais ENABLE ROW LEVEL SECURITY;

--
-- Name: declaracoes_fiscais declaracoes_fiscais_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY declaracoes_fiscais_owner ON public.declaracoes_fiscais TO authenticated USING ((owner_user_id = auth.uid())) WITH CHECK ((owner_user_id = auth.uid()));


--
-- Name: empresas_fiscais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.empresas_fiscais ENABLE ROW LEVEL SECURITY;

--
-- Name: empresas_fiscais empresas_fiscais_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_fiscais_delete ON public.empresas_fiscais FOR DELETE USING (public.user_owns_company(empresa_id));


--
-- Name: empresas_fiscais empresas_fiscais_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_fiscais_insert ON public.empresas_fiscais FOR INSERT WITH CHECK (public.user_owns_company(empresa_id));


--
-- Name: empresas_fiscais empresas_fiscais_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_fiscais_select ON public.empresas_fiscais FOR SELECT USING (public.user_owns_company(empresa_id));


--
-- Name: empresas_fiscais empresas_fiscais_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresas_fiscais_update ON public.empresas_fiscais FOR UPDATE USING (public.user_owns_company(empresa_id)) WITH CHECK (public.user_owns_company(empresa_id));


--
-- Name: folha_mensal; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.folha_mensal ENABLE ROW LEVEL SECURITY;

--
-- Name: folha_mensal folha_mensal_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY folha_mensal_owner ON public.folha_mensal TO authenticated USING ((owner_user_id = auth.uid())) WITH CHECK ((owner_user_id = auth.uid()));


--
-- Name: guias_fiscais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guias_fiscais ENABLE ROW LEVEL SECURITY;

--
-- Name: guias_fiscais guias_fiscais_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guias_fiscais_delete ON public.guias_fiscais FOR DELETE USING (public.user_owns_company(company_id));


--
-- Name: guias_fiscais guias_fiscais_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guias_fiscais_insert ON public.guias_fiscais FOR INSERT WITH CHECK (public.user_owns_company(company_id));


--
-- Name: guias_fiscais guias_fiscais_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guias_fiscais_select ON public.guias_fiscais FOR SELECT USING (public.user_owns_company(company_id));


--
-- Name: guias_fiscais guias_fiscais_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guias_fiscais_update ON public.guias_fiscais FOR UPDATE USING (public.user_owns_company(company_id)) WITH CHECK (public.user_owns_company(company_id));


--
-- Name: honorarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.honorarios ENABLE ROW LEVEL SECURITY;

--
-- Name: honorarios honorarios_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY honorarios_delete ON public.honorarios FOR DELETE USING (public.user_owns_company(company_id));


--
-- Name: honorarios honorarios_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY honorarios_insert ON public.honorarios FOR INSERT WITH CHECK (public.user_owns_company(company_id));


--
-- Name: honorarios honorarios_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY honorarios_select ON public.honorarios FOR SELECT USING (public.user_owns_company(company_id));


--
-- Name: honorarios honorarios_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY honorarios_update ON public.honorarios FOR UPDATE USING (public.user_owns_company(company_id)) WITH CHECK (public.user_owns_company(company_id));


--
-- Name: municipios_nfse; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.municipios_nfse ENABLE ROW LEVEL SECURITY;

--
-- Name: municipios_nfse municipios_nfse_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY municipios_nfse_select ON public.municipios_nfse FOR SELECT TO authenticated USING (true);


--
-- Name: notas_fiscais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;

--
-- Name: notas_fiscais notas_fiscais_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_fiscais_delete ON public.notas_fiscais FOR DELETE USING (public.user_owns_company(company_id));


--
-- Name: notas_fiscais notas_fiscais_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_fiscais_insert ON public.notas_fiscais FOR INSERT WITH CHECK (public.user_owns_company(company_id));


--
-- Name: notas_fiscais notas_fiscais_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_fiscais_select ON public.notas_fiscais FOR SELECT USING (public.user_owns_company(company_id));


--
-- Name: notas_fiscais notas_fiscais_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_fiscais_update ON public.notas_fiscais FOR UPDATE USING (public.user_owns_company(company_id)) WITH CHECK (public.user_owns_company(company_id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_delete ON public.profiles FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: profiles profiles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: profiles profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: role_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_types ENABLE ROW LEVEL SECURITY;

--
-- Name: role_types role_types_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_types_delete ON public.role_types FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: role_types role_types_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_types_insert ON public.role_types FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: role_types role_types_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_types_select ON public.role_types FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: role_types role_types_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_types_update ON public.role_types FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: serpro_contratante; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.serpro_contratante ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict eHcNHxLmTHueGGvLiqLPcTttVq2bfApkAgAL0xtLEFJt1gbBdLAj2bnfssuXQt4

