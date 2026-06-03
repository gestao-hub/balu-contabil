-- 0017: fluxo procurador SERPRO com cert do contratante.
-- (a) tabela singleton com cert+senha do contratante (cifrados) e cache do /authenticate;
-- (b) colunas do token_procurador por empresa em empresas_fiscais.

CREATE TABLE IF NOT EXISTS public.serpro_contratante (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    cnpj character varying(20) NOT NULL,
    nome text,
    cert_pfx_enc text NOT NULL,            -- PFX cru, cifrado (envelope AES-GCM, CERT_ENC_KEY), base64
    cert_password_enc text NOT NULL,       -- senha do PFX, cifrada (envelope AES-GCM), base64
    cert_not_after timestamp with time zone,
    cert_subject_cn text,
    auth_access_token text,                -- cache do /authenticate (~1h)
    auth_jwt_token text,
    auth_token_expiration timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Singleton: no máximo 1 linha.
CREATE UNIQUE INDEX IF NOT EXISTS serpro_contratante_singleton
    ON public.serpro_contratante ((true));

-- RLS ligada SEM policies → só service_role (que bypassa RLS) acessa.
ALTER TABLE public.serpro_contratante ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.empresas_fiscais
    ADD COLUMN IF NOT EXISTS serpro_token_procurador text,
    ADD COLUMN IF NOT EXISTS serpro_token_procurador_expiration timestamp with time zone;
