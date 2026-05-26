# Divergência: Migrations × Banco real

> **TL;DR**: Os arquivos `balu-next/supabase/migrations/0001_init.sql` (+ `src/types/database.ts`, que vem do mesmo gerador) descrevem um schema **idealizado** do PRD/Bubble que **nunca foi aplicado** ao banco em produção. O banco real (`llykzqnugdpojwnlontj`, **PostgreSQL 17.6**) segue outro schema, desenhado para o **motor fiscal n8n**, e já contém dados.
>
> **Decisão**: o **banco é a fonte da verdade**. O caminho é **alinhar o código ao banco** (regenerar types + reescrever queries) e criar apenas o que falta de forma **aditiva**. Não remodelar o banco para o `0001`.

---

## Como esta comparação foi obtida

- **Migrations / código**: `balu-next/supabase/migrations/0001_init.sql`, `0002_signup_user_role.sql`, `balu-next/src/types/database.ts`.
- **Banco real**: `pg_dump` (schema-only) do projeto Supabase de produção:
  ```bash
  docker run --rm --network=host postgres:17 pg_dump \
    "postgresql://postgres:***@db.llykzqnugdpojwnlontj.supabase.co:5432/postgres" \
    --schema-only --schema=public --no-owner --no-privileges > db_atual.sql
  ```
- Servidor: **PostgreSQL 17.6**. Dump salvo (temporariamente) em `balu-next/db_atual.sql`.
- ⚠️ Como usei `--no-privileges`, GRANT/REVOKE (incl. o `revoke select(cert_password)` do `0001`) **não** entraram no dump e não foram verificados aqui.

---

## A) Conjunto de tabelas

| Situação | Tabelas |
|---|---|
| Nos migrations **e** no banco | `profiles`, `companies`, `clientes`, `empresas_fiscais`, `notas_fiscais`, `apuracoes_fiscais`, `guias_fiscais`, `arquivos_auxiliares`, `municipios_nfse`, `honorarios`, `abertura_empresas` |
| **Só nos migrations** (não existem no banco) | `aux_produtos`, `declaracoes_fiscais` |
| **Só no banco** (nenhum migration cria) | `receitas_fiscais` (tabela nova inteira); `role_types` (o `0002` faz `INSERT`/trigger mas nunca `CREATE`) |
| Tipo só no banco | enum `user_types` ('Empresa','Contador') — o `0002` faz cast `::user_types` mas não cria o tipo |

---

## B) Diff coluna a coluna (apenas o que diverge)

Convenção de tipos: os migrations usam `text`/`smallint`/`char(n)`; o banco usa `varchar(n)`/`integer`/`char(n)`. Abaixo só os deltas estruturais relevantes.

### `profiles`
- **Banco adiciona**: `user_id`, `company_id`, `deleted_at`.
- **Banco remove**: `empresa_fiscal_id`, `logo`, `background_color`, `user_role`.
- **Semântica da PK mudou**: no migration `id = auth.users.id` (com FK); no banco `id` é `gen_random_uuid()` próprio e o vínculo com o usuário é via `user_id` (**sem** FK declarada).
- Papel do usuário (Empresa/Contador) migrou para a tabela **`role_types`**.

### `companies`
- **Banco remove**: `status`, `bubble_id`.
- Perde o `NOT NULL` de `user_id`/`cnpj` e o índice único `companies_owner_cnpj_uniq (user_id, cnpj)`.

### `clientes`
- **Banco remove**: `bubble_id`, a FK de `company_id`, os `NOT NULL` e o índice dedup `clientes_owner_doc_uniq (owner_user_id, document)`.
- `indicador_inscricao_estadual`: `varchar(5)` no banco (era `smallint` com check `1/2/9`).

### `notas_fiscais` (muito divergente — central pro Day 1/Day 2)
Banco real (completo): `id` (default `extensions.uuid_generate_v4()`), `company_id` (NOT NULL), `tipo_documento` (check `NFe/NFCe/NFSe`, NOT NULL), `referencia` (NOT NULL), `data_emissao` (NOT NULL), `status` (NOT NULL, sem check de valores), `valor_total` (NOT NULL), `payload_focusnfe` jsonb (NOT NULL), `created_at`. + índice **único** `(company_id, referencia)`. + 4 policies (RLS **não** habilitada; condição `auth.uid() = company_id` está logicamente errada).

| Migration | Banco |
|---|---|
| `tipo_nf` (`nfe/nfce/nfse`) | `tipo_documento` (`NFe/NFCe/NFSe`) |
| `ref` | `referencia` |
| `focus_response` | `payload_focusnfe` |
| `cliente_id`, `numero_nf`, `serie`, `chave_acesso`, `protocolo_autorizacao`, `xml_url`, `pdf_url`, `qrcode`, `cancelled_at`, `cancellation_reason`, `bubble_id`, `updated_at`, check de `status` | **não existem** |

### `apuracoes_fiscais` (reestruturada por completo)
Banco real: `id, company_id, owner_user_id, competencia_referencia (varchar7), anexo_simples, fator_r, aliquota_efetiva, guia_fiscal_id (FK guias), status, created_at, updated_at, deleted_at, tipo_apuracao, receita_mes, rbt12, valor_imposto, payload_calculo (jsonb)`.
- O detalhamento por tributo do migration (`irpj/csll/cofins/pis/inss_cpp/icms/iss/total_tributos/deducoes/total`) foi **substituído** por `valor_imposto` + `payload_calculo` (jsonb).
- `empresa_id`→`company_id`; `competencia (char6)`→`competencia_referencia`.

### `guias_fiscais`
- `empresa_id`→`company_id`; `competencia (char6)`→`competencia_mes` + `competencia_ano` (+ `competencia_referencia`).
- **Banco adiciona**: `owner_user_id`, `valor_pago`, `valor_principal/multa/juros/total`, `codigo_barras`, `numero_guia`, `numero_das`, `url_guia`, `url_pdf`, `origem` (default `'n8n'`), `observacoes`, `updated_at`, `deleted_at`.
- **Banco remove**: `tipo_guia`. `pdf_url`→`url_pdf`/`url_guia`. Valores de `status` diferentes (`pendente…` vs `gerando/gerada/paga/…`).

### `honorarios`
- `mes_referencia`: `date` no banco (era `char(6)`).
- `valor`: `numeric(10,2)` (era `14,2`).
- `data_vencimento`: `NOT NULL` no banco.
- check de `status`: `pendente/pago/**atrasado**` (migration usava `vencido`), com trigger que seta `atrasado` automaticamente.

### `empresas_fiscais`
- Banco é **superset**: mantém o núcleo e adiciona muitas colunas (`certificado_jwt/access_token/token_expiration`, flags `rps_liberado/webservice_liberado/homologacao_liberada/producao_liberada/tomador_credenciado/aidf_solicitada/cadastro_homologacao_feito/nota_homol_emitida/nfse_habilitada`, `regime_especial_tributacao`, `email_provedor`, `whatsapp_provedor`, `caminho_liberacao_rps`, `instrucoes_configuracao`, `owner_user_id`).
- FK real em `municipio_id → municipios_nfse`. `Code_regime_tributario`: `varchar(10)` (era `smallint` check 1–4). `unique_id_bubble` perdeu o `unique`.

### `municipios_nfse` (schema totalmente diferente)
- Migration: `codigo_ibge` (unique), `nome_municipio`, `uf`, `padrao_nfse`, `provedor_nfse`, `url_producao/homologacao`, flags…
- Banco: `municipio`, `estado`, `url`, `endpoint_tipo`, `provedor`, `formato`, `autenticacao`, `cancelamento`, `producao_*`, `homologacao_*`, `cep_exemplo`, `campos_importantes`, `outras_informacoes`, `informacoes_gerais_texto`, flags… **Sem** `codigo_ibge`.

### `abertura_empresas` (muito mais detalhada no banco)
- Banco: campos "flat" `titular_*`, `empresa_*`, `sede_*`, `doc_*` (uploads), checks em `empresa_tipo`/`regime`/`processo_etapa`, `UNIQUE(titular_cpf)` + índices. Usa `criado_em`/`atualizado_em` (PT).
- Migration usava `titular_endereco`/`endereco_sede`/`anexos` (jsonb) + `created_at`/`updated_at` — **não** existem no banco.

### `arquivos_auxiliares`
- **Banco adiciona**: `updated_at`, `deleted_at`, `storage_key`. Sem FK em `unique_id_empresa`.

---

## C) Funções e triggers

| Função | Migration | Banco |
|---|---|---|
| `handle_new_user` (auto-cria `profiles` no signup) | existe (0001) | **não existe** → profile **não** é criado automaticamente no signup |
| `user_company_ids` (helper das policies) | existe (0001) | **não existe** |
| `tg_set_updated_at` | existe (0001) | substituída por `update_updated_at` / `update_updated_at_honorarios` |
| `add_company_to_profile` | `returns void`; `UPDATE profiles SET current_company WHERE id` | **assinatura/corpo diferentes**: `returns json`; `UPDATE profiles SET company_id WHERE user_id` |
| `handle_new_user_role` (0002) | — | ✅ confere (cria `role_types`) |
| `set_atualizado_em`, `update_status_atrasado_honorarios` | — | extras (só no banco) |

> O trigger `on_auth_user_created_role` vive em `auth.users` (fora do dump `public`); a função correspondente existe e bate com o `0002`. Não há equivalente para a auto-criação de `profiles`.

---

## D) RLS (registrado; tratamento adiado por decisão do time)

- O `0001` habilita RLS + ~16 policies em 13 tabelas. **No banco real, RLS não está habilitada em nenhuma tabela.**
- A única tabela com policies é `notas_fiscais` (4), porém **inertes** (RLS desabilitada) e com condição **errada** (`auth.uid() = company_id`).
- Efeito medido: a chave anônima lê dados de `clientes` (23 linhas), `notas_fiscais`, `guias_fiscais`, etc.
- **Não bloqueia funcionalidade**, mas é dívida de segurança a resolver depois.

---

## E) Impacto no código (o que quebra hoje em runtime)

`src/types/database.ts` é gerado pelo mesmo `gen_schema.py` → bate com os migrations, **não** com o banco. Por isso o `tsc` passa mas o runtime falha. Pontos confirmados:

- **`src/lib/dashboard/queries.ts`**: `guias_fiscais.eq('empresa_id', …)` e `select('id, competencia, …')` → no banco é `company_id` e não há `competencia`. Quebra.
- **Notas** (`notas_fiscais/*`, `actions.ts`, webhook Focus): usam `tipo_nf`, `ref`, `chave_acesso`, `numero_nf`, `focus_response` → banco tem `tipo_documento`, `referencia`, `payload_focusnfe` e não tem o resto.
- Ocorrências no código (fora de `types/database.ts`): `empresa_id` ×13, `competencia` ×9, `tipo_nf`/`chave_acesso`/`numero_nf` ×8 cada, `declaracoes_fiscais` ×2, `user_role` ×2.

Os PRs marcados "✅ FEITO" no `PLANO-4-DIAS.md` trazem a ressalva *"runtime pendente Supabase"* — compilam, mas nunca rodaram contra o banco.

---

## F) Plano de reconciliação (Banco = fonte da verdade)

**Passo 0** — Regenerar `src/types/database.ts` a partir do banco real → `tsc --noEmit` vira a checklist de divergências.
**Passo 1** — Reescrever `lib/dashboard/queries.ts` + telas de notas pros nomes reais (`company_id`, `competencia_referencia`, `tipo_documento`, `referencia`, `payload_focusnfe`); papel do usuário via `role_types`. Ajustar `types/enums.ts`/`zod.ts` (valores `NFe/NFCe/NFSe`).
**Passo 2** — Migration `0003` **aditivo**: `ALTER TABLE notas_fiscais ADD COLUMN …` para os campos que emissão/cancelamento precisam (`cliente_id`, `chave_acesso`, `protocolo_autorizacao`, `xml_url`, `pdf_url`, `qrcode`, `numero_nf`, `serie`, `cancelled_at`, `cancellation_reason`, `updated_at`).
**Passo 3** — Day 3: reescrever o wizard de apuração/DAS para o formato real (`apuracoes_fiscais`/`guias_fiscais`/`receitas_fiscais` do motor n8n). Decidir `declaracoes_fiscais`: criar mínima (aditivo) ou cortar da v1.
**Passo 4** — Versionar no repo o que só existe no banco: `CREATE TYPE user_types`, `CREATE TABLE role_types`, `CREATE TABLE receitas_fiscais` (reprodutibilidade).

> **Nada destrutivo**: o banco só recebe `ADD COLUMN`/`CREATE` aditivos; o grosso do trabalho é alinhar o **código**.
