--
-- PostgreSQL database dump
--

\restrict ly8yfipoE6OxxwgDO9WhdioqqC5omZp3dHfs3zZR9EkXVbfMjtcJnUCGlGvW47c

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


SET default_tablespace = '';

SET default_table_access_method = heap;

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
    unique_id_bubble character varying(255),
    unique_id_empresa uuid,
    supabase_file_path text,
    cert_password character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    storage_key text
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
    deleted_at timestamp with time zone
);


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
    certificado_jwt text,
    certificado_access_token text,
    certificado_token_expiration timestamp with time zone,
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
    serpro_token_procurador text,
    serpro_token_procurador_expiration timestamp with time zone
);


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
    municipio character varying(255),
    estado character(2),
    url text,
    endpoint_tipo character varying(50),
    provedor character varying(100),
    formato character varying(100),
    autenticacao character varying(100),
    cancelamento text,
    producao_disponivel character varying(10),
    producao_portal text,
    homologacao_disponivel character varying(10),
    homologacao_portal text,
    cep_exemplo character varying(10),
    campos_importantes text,
    outras_informacoes text,
    informacoes_gerais_texto text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
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
    instrucoes_configuracao text
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
    CONSTRAINT notas_fiscais_tipo_documento_check CHECK ((tipo_documento = ANY (ARRAY['NFe'::text, 'NFCe'::text, 'NFSe'::text])))
);


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
-- Name: receitas_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receitas_fiscais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    owner_user_id uuid,
    cliente_id uuid,
    tipo character varying(20),
    numero_documento character varying(50),
    descricao_servico text,
    competencia_mes integer NOT NULL,
    competencia_ano integer NOT NULL,
    competencia_referencia character varying(7),
    valor numeric(15,2) DEFAULT 0,
    valor_bruto numeric(15,2) DEFAULT 0,
    valor_deducoes numeric(15,2) DEFAULT 0,
    valor_liquido numeric(15,2) DEFAULT 0,
    valor_impostos numeric(15,2) DEFAULT 0,
    status character varying(20) DEFAULT 'pendente'::character varying,
    data_emissao date,
    data_vencimento date,
    data_pagamento date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    CONSTRAINT receitas_fiscais_ano_check CHECK (((competencia_ano >= 2000) AND (competencia_ano <= 2100))),
    CONSTRAINT receitas_fiscais_mes_check CHECK (((competencia_mes >= 1) AND (competencia_mes <= 12)))
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
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: empresas_fiscais empresas_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_fiscais
    ADD CONSTRAINT empresas_fiscais_pkey PRIMARY KEY (id);


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
-- Name: receitas_fiscais receitas_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receitas_fiscais
    ADD CONSTRAINT receitas_fiscais_pkey PRIMARY KEY (id);


--
-- Name: role_types role_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_types
    ADD CONSTRAINT role_types_pkey PRIMARY KEY (id);


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
-- Name: idx_receitas_fiscais_cliente_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receitas_fiscais_cliente_id ON public.receitas_fiscais USING btree (cliente_id);


--
-- Name: idx_receitas_fiscais_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receitas_fiscais_company_id ON public.receitas_fiscais USING btree (company_id);


--
-- Name: idx_receitas_fiscais_competencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receitas_fiscais_competencia ON public.receitas_fiscais USING btree (competencia_ano, competencia_mes);


--
-- Name: idx_receitas_fiscais_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receitas_fiscais_status ON public.receitas_fiscais USING btree (status);


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
-- Name: municipios_nfse trg_municipios_nfse_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_municipios_nfse_updated_at BEFORE UPDATE ON public.municipios_nfse FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: receitas_fiscais trg_receitas_fiscais_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_receitas_fiscais_updated_at BEFORE UPDATE ON public.receitas_fiscais FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


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
    ADD CONSTRAINT apuracoes_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: apuracoes_fiscais apuracoes_fiscais_guia_fiscal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apuracoes_fiscais
    ADD CONSTRAINT apuracoes_fiscais_guia_fiscal_id_fkey FOREIGN KEY (guia_fiscal_id) REFERENCES public.guias_fiscais(id);


--
-- Name: apuracoes_fiscais apuracoes_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apuracoes_fiscais
    ADD CONSTRAINT apuracoes_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);


--
-- Name: clientes clientes_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);


--
-- Name: companies companies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: empresas_fiscais empresas_fiscais_municipio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_fiscais
    ADD CONSTRAINT empresas_fiscais_municipio_id_fkey FOREIGN KEY (municipio_id) REFERENCES public.municipios_nfse(id);


--
-- Name: empresas_fiscais empresas_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_fiscais
    ADD CONSTRAINT empresas_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);


--
-- Name: guias_fiscais guias_fiscais_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guias_fiscais
    ADD CONSTRAINT guias_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: guias_fiscais guias_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guias_fiscais
    ADD CONSTRAINT guias_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);


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
-- Name: receitas_fiscais receitas_fiscais_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receitas_fiscais
    ADD CONSTRAINT receitas_fiscais_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: receitas_fiscais receitas_fiscais_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receitas_fiscais
    ADD CONSTRAINT receitas_fiscais_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: receitas_fiscais receitas_fiscais_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receitas_fiscais
    ADD CONSTRAINT receitas_fiscais_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);


--
-- Name: role_types role_types_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_types
    ADD CONSTRAINT role_types_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notas_fiscais Users can delete their own notas_fiscais.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own notas_fiscais." ON public.notas_fiscais FOR DELETE USING ((auth.uid() = company_id));


--
-- Name: notas_fiscais Users can insert their own notas_fiscais.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own notas_fiscais." ON public.notas_fiscais FOR INSERT WITH CHECK ((auth.uid() = company_id));


--
-- Name: notas_fiscais Users can update their own notas_fiscais.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own notas_fiscais." ON public.notas_fiscais FOR UPDATE USING ((auth.uid() = company_id));


--
-- Name: notas_fiscais Users can view their own notas_fiscais.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own notas_fiscais." ON public.notas_fiscais FOR SELECT USING ((auth.uid() = company_id));


--
-- PostgreSQL database dump complete
--

\unrestrict ly8yfipoE6OxxwgDO9WhdioqqC5omZp3dHfs3zZR9EkXVbfMjtcJnUCGlGvW47c

