# Fluxo de seleção + abertura de empresa (com solicitação de alteração)

**Data:** 2026-06-01
**Status:** implementado ✅ (sessão 2026-06-01)

## Context

Hoje, ao logar sem empresa (`profiles.current_company` vazio), o `(auth)/layout.tsx`
força um modal obrigatório (`CreateCompanyDialog`) que cadastra uma **empresa existente**
(lookup de CNPJ na Focus → grava `companies` + `empresas_fiscais` + sync Focus). Não há
caminho para o usuário que **ainda não tem CNPJ** e quer **abrir** uma empresa.

A tabela `abertura_empresas` (49 campos flat, máquina de status `processo_etapa`, escopo por
`user_id`) já existe no banco real, mas sem nenhuma UI.

Queremos: (1) um passo anterior de **seleção** — "já tenho empresa" vs "quero abrir";
(2) o **wizard de abertura** conforme spec (PRD §13 / V1 §2); (3) a empresa solicitada **não**
tem fluxos de cert/Focus/Serpro até a confirmação (a criação é manual, feita por uma equipe
administrativa fora da plataforma); (4) em Configurações, uma visão **read-only** com o status
da abertura e os dados enviados; (5) como os dados não podem ser editados livremente, um botão
**"Solicitar alteração de dados"** que registra um pedido de mudança para análise.

## Decisões (acordadas com o usuário)

- **Modelagem da empresa em abertura:** stub em `companies` com `status='em_abertura'` (sem
  CNPJ), apontado por `profiles.current_company`. Todo o app continua keyando por
  `current_company → companies`. Quando o admin concluir, vira `status` ativo com CNPJ real.
- **Escopo do wizard:** completo conforme spec (~49 campos, 5 etapas, 8 uploads de documento).
- **Entrada:** rota `/onboarding` com tela de seleção (substitui o modal forçado por rotas reais).
- **Painel admin:** fora de escopo (equipe atualiza `processo_etapa`/aplica alterações direto no
  banco por enquanto).
- **Status na visão do cliente:** estático (lido no load).
- **Alteração de dados:** cobre dados **e** documentos; reaproveita o wizard em "modo alteração".
- **Hash:** `abertura_empresas` ganha só `dados_hash text`. O hash-base é recomputado no submit da
  alteração (lê colunas + baixa docs do Storage p/ sha256), evitando colunas de snapshot.

## Arquitetura

### 1. Roteamento e entrada

Novo route group **`src/app/(onboarding)/`** com `layout.tsx` próprio:
- Checa auth (`redirect('/login')` se não houver user). **Não** checa `current_company`.
- Sem `MenuLateral`; chrome mínimo (card centrado + `Logo`, igual ao layout público).

Rotas:
- **`/onboarding`** (`(onboarding)/onboarding/page.tsx`): tela de seleção, 2 cards.
  - *"Já tenho uma empresa"* → renderiza o `CreateCompanyDialog` atual inline (`open`); no
    sucesso, `router.push('/')`.
  - *"Quero abrir uma empresa"* → `router.push('/onboarding/abertura')`.
- **`/onboarding/abertura`** (`(onboarding)/onboarding/abertura/page.tsx`): wizard. Aceita
  `?modo=alteracao` para o fluxo de solicitação de alteração (carrega dados atuais).

**`(auth)/layout.tsx`:** trocar o bloco `{needsOnboarding && <CreateCompanyDialog .../>}` por
`if (needsOnboarding) redirect('/onboarding')`. Remover o import do dialog. Sem loop: as rotas de
onboarding vivem no grupo `(onboarding)`, que não roda o gate do `(auth)`.

`createCompanyAction` permanece em `(auth)/onboarding/actions.ts` (é só server action, sem
`page.tsx` — não cria rota nem conflita). É reaproveitada pelo `CreateCompanyDialog`.

### 2. Wizard de abertura (client)

Componente **`AberturaWizard`** (`src/components/abertura/AberturaWizard.tsx`), parametrizado:
- `mode: 'criar' | 'alterar'`
- `initial?: AberturaData` e `existingDocs?: Record<DocKey, string>` (paths) — só em `'alterar'`.

5 etapas + revisão final, com validação por etapa (Zod `AberturaCreateSchema`, ver §5):
1. **Titular:** `titular_nome_completo`, `titular_cpf`, `titular_rg_numero`/`_orgao_emissor`/`_uf`,
   `titular_data_nascimento`, `titular_estado_civil`, `titular_nome_mae`, `titular_nacionalidade`
   (default "brasileiro(a)"), `titular_telefone`, `titular_email`, `titular_naturalidade_cidade`/`_uf`.
2. **Endereço do titular:** `titular_cep` (botão Buscar → `lookupCepAction` já existente),
   `titular_logradouro`, `_numero`, `_complemento`, `_bairro`, `_cidade`, `_uf`.
3. **Empresa pretendida:** `empresa_razao_social_1/2/3`, `empresa_nome_fantasia`, `empresa_tipo`
   (MEI/EI/LTDA), `empresa_capital_social`, `empresa_objeto_social`, `empresa_cnae_principal`
   (texto, código manual — sem catálogo nesta v1), `empresa_cnaes_secundarios` (lista separada por
   vírgula → `text[]`), `empresa_regime_tributario`.
4. **Sede:** `sede_mesmo_que_titular` (toggle copia do passo 2), `sede_tipo_endereco`
   (Residencial/Comercial/Virtual), `sede_cep` (Buscar), `sede_logradouro`, `_numero`,
   `_complemento`, `_bairro`, `_cidade`, `_uf`.
5. **Documentos:** 8 uploads → `doc_rg_frente`, `doc_rg_verso`, `doc_cnh_frente`, `doc_cnh_verso`,
   `doc_cpf`, `doc_comprovante_titular`, `doc_comprovante_sede`, `doc_declaracao_uso`.

**Popup de confirmação no submit final** (ambos os modos), via dialog:
- `criar`: "Atenção: após o envio, as informações só poderão ser alteradas mediante **solicitação
  de alteração**. Deseja enviar a solicitação de abertura?"
- `alterar`: "Sua solicitação de alteração será enviada para análise. Deseja continuar?"
Botões Confirmar / Cancelar. Só após Confirmar dispara a action.

### 3. Submissão da abertura — `submitAberturaAction(formData)`

Em `(onboarding)/onboarding/abertura/actions.ts`:
1. Auth (`getUser`).
2. **Pré-checa `titular_cpf`** em `abertura_empresas` (coluna UNIQUE) → erro amigável se já existe.
3. Insere **stub** em `companies`:
   `{ user_id, status: 'em_abertura', razao_social: empresa_razao_social_1,
   nome: empresa_nome_fantasia || empresa_razao_social_1, cnpj: null }` → `stub.id`.
4. Upsert `profiles.current_company = stub.id` (mesmo padrão de `createCompanyAction`).
5. Upload dos documentos para o bucket **`abertura-documentos`**, path `${stub.id}/<doc>.<ext>`,
   via admin client SERVICE_ROLE (generalizar `lib/clients/supabase-storage.ts`, ver §6).
6. Calcula `dados_hash` (ver §7) e insere `abertura_empresas`: ~49 campos + `user_id`,
   `company_id = stub.id`, `processo_etapa = 'recebido'`, `doc_*` = paths, `dados_hash`.
7. Em falha do passo 6 → rollback best-effort (apaga stub + zera `current_company`).
8. `revalidatePath('/')` + `redirect('/configuracoes')`.

### 4. Configurações — visão reduzida (read-only) da empresa em abertura

Em `configuracoes/page.tsx`, após carregar `company`, ramo novo quando
`company.status === 'em_abertura'`:
- Carrega a linha de `abertura_empresas` por `company_id`.
- Renderiza **só "Informações da empresa"** (sem a nav das 4 abas; Regime/Emissão fiscal/
  Diagnóstico — que dependem de cert/Focus/Serpro — não aparecem):
  - **Status da abertura:** timeline/badge a partir de `processo_etapa`
    (`recebido → em_analise → pendente_documentos → enviado_receita → enviado_junta →
    enviado_prefeitura → concluido`/`cancelado`), + `processo_protocolo`,
    `processo_observacoes`, `processo_cnpj_emitido` quando presentes. Estático.
  - **Dados enviados (read-only):** titular, empresa pretendida, endereços. **Sem botão Editar.**
  - **Botão "Solicitar alteração de dados"** → `router.push('/onboarding/abertura?modo=alteracao')`.
- Empresas normais seguem com as 4 abas atuais, sem mudança.

### 5. Solicitação de alteração — `solicitarAlteracaoAction(formData)`

Reaproveita o `AberturaWizard` em `modo=alteracao`:
- A página `/onboarding/abertura?modo=alteracao` carrega (server) a `abertura_empresas` do
  `current_company` do usuário e passa `initial` + `existingDocs` ao wizard.
- No submit:
  1. Monta o **objeto canônico novo** `C_novo` (campos textuais + content-hash sha256 de cada doc:
     para docs re-enviados, hash dos bytes novos; para docs mantidos, lê o arquivo atual do Storage
     e hasheia).
  2. Recomputa o **canônico base** `C_base` a partir de `abertura_empresas` (colunas + sha256 dos
     docs atuais no Storage). Sanidade: `hash(C_base)` deve bater com `abertura_empresas.dados_hash`.
  3. Se `hash(C_novo) === hash(C_base)` → **bloqueia**: "Nenhuma alteração detectada." (não cria
     solicitação).
  4. Senão: faz upload dos docs alterados em
     `abertura-documentos/${aberturaId}/alteracoes/<uuid>/<doc>` e insere uma linha em
     **`abertura_alteracoes`**: `{ abertura_id, user_id, dados: <raw_json>, dados_hash: hash(C_novo),
     status: 'pendente' }`. O `raw_json` traz os valores textuais propostos + paths dos docs
     (novos ou mantidos), com **as mesmas chaves das colunas de `abertura_empresas`**.
  5. `redirect('/configuracoes')` com feedback de "solicitação enviada".

**Aplicação pelo admin (fora de escopo):** ao aprovar, o fluxo administrativo apenas faz
`UPDATE abertura_empresas SET <colunas> = dados_alteracao.dados ...` e recalcula `dados_hash`,
marcando a alteração como `aprovada`. O `raw_json` é estruturado para mapear 1:1 nas colunas.

### 6. Storage

Generalizar `lib/clients/supabase-storage.ts` (hoje `uploadCertificado` no bucket
`company-certificates`) para uma função genérica `uploadToBucket(bucket, path, data)` reutilizável,
e adicionar helper `uploadAberturaDoc(aberturaScopeId, docKey, file)` que grava em
`abertura-documentos`. Ownership é garantida na action (user dono da abertura); o admin client
ignora RLS (mesmo padrão do cert).

**Setup manual:** criar o bucket privado **`abertura-documentos`** no Supabase (passo manual,
sinalizar ao usuário antes de testar uploads).

### 7. Hash canônico

Helper `lib/abertura/hash.ts`:
- `canonical(data, docHashes)` → objeto com chaves **ordenadas**: campos textuais normalizados
  (trim, arrays ordenados de forma estável) + `docs: { <docKey>: <sha256|null> }`.
- `dadosHash(canonicalObj)` → `sha256(JSON.stringify(canonicalObj))` (hex). `crypto` do Node.
- `sha256File(bytes)` → content-hash de um documento.

`abertura_empresas.dados_hash` é gravado na criação e seria recalculado pelo admin ao aplicar uma
alteração.

## Mudanças de banco — migration `0015_abertura_alteracoes.sql`

> ⚠️ Convenção do projeto: migrations são aplicadas **manualmente** no banco real (a source of
> truth é o DB, não os arquivos). Esta migration precisa ser rodada à mão após o merge.

```sql
-- hash dos dados da solicitação de abertura (detecção de alteração real)
ALTER TABLE public.abertura_empresas ADD COLUMN IF NOT EXISTS dados_hash text;

-- solicitações de alteração de dados (payload em jsonb, sem duplicar colunas)
CREATE TABLE IF NOT EXISTS public.abertura_alteracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abertura_id uuid NOT NULL REFERENCES public.abertura_empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dados jsonb NOT NULL,
  dados_hash text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovada','rejeitada')),
  observacoes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- updated_at automático (trigger já existente no schema)
CREATE TRIGGER abertura_alteracoes_set_updated_at BEFORE UPDATE
  ON public.abertura_alteracoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS: dono
ALTER TABLE public.abertura_alteracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY abertura_alteracoes_owner ON public.abertura_alteracoes FOR ALL
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

Confirmar que `companies.status` aceita texto livre (sem CHECK que rejeite `'em_abertura'`); se
houver CHECK, incluir o valor na migration.

## Componentes / arquivos

**Novos:**
- `src/app/(onboarding)/layout.tsx`
- `src/app/(onboarding)/onboarding/page.tsx` (seleção — primeiro login)
- `src/app/(onboarding)/onboarding/abertura/page.tsx` (wizard standalone + modo alteração)
- `src/app/(onboarding)/onboarding/abertura/actions.ts` (`submitAberturaAction`, `solicitarAlteracaoAction`, `loadAberturaAtual`)
- `src/components/abertura/AberturaWizard.tsx` (wizard data-driven, prop `onBack` opcional)
- `src/components/abertura/ConfirmacaoEnvioDialog.tsx`
- `src/components/AddEmpresaDialog.tsx` (popup contador: seleção → existente ou wizard embutido)
- `src/app/(auth)/configuracoes/AberturaInfoView.tsx` (visão read-only + status + botão alterar)
- `src/lib/abertura/hash.ts` (canonical + dadosHash + sha256File)
- `src/lib/abertura/queries.ts` (getAberturaByCompany)
- `src/types/abertura.ts` (AberturaData, DOC_KEYS, ABERTURA_TEXT_FIELDS, EMPTY_ABERTURA)
- `supabase/migrations/0015_abertura_alteracoes.sql`

**Modificados:**
- `src/app/(auth)/layout.tsx` (redirect → /onboarding quando sem empresa)
- `src/app/(auth)/configuracoes/page.tsx` (ramo `status==='em_abertura'` + banner alteração)
- `src/components/MenuLateral.tsx` (botão "Adicionar empresa" para contador abre AddEmpresaDialog)
- `src/lib/clients/supabase-storage.ts` (uploadToBucket/downloadFromBucket/uploadAberturaDoc)
- `src/lib/format/masks.ts` (formatCpf + formatTel adicionados)
- `src/types/zod.ts` (AberturaCreateSchema, isValidCpf)
- `src/components/CreateCompanyDialog.tsx` (UF dropdown, telefone mask)
- `src/app/(auth)/configuracoes/DadosEmpresaForm.tsx` (UF dropdown, telefone mask, IBGE digits)
- `src/components/ClienteFormDialog.tsx` (CPF mask PF, CEP visual, telefone mask, UF dropdown, busca CEP)
- `next.config.ts` (serverActions.bodySizeLimit 20mb)

## Ajustes pós-implementação (correções de UX/segurança nessa sessão)

- **Wizard:** máscaras CPF/CEP/Tel/Data BR, lookup CEP via import estático, botão Voltar etapa 0,
  validações por tipo (alpha/digits/decimal/uf/select), estado civil + órgão emissor como selects,
  27 UFs como dropdown em todos os forms, `accept="image/*,.pdf"` nos uploads.
- **Segurança:** `.passthrough()` removido do Zod (mass assignment), path traversal em Storage,
  IDOR na RLS `abertura_alteracoes`, `user_id` assert explícito em `solicitarAlteracaoAction`.
- **Contador:** `AddEmpresaDialog` no menu lateral — wizard de abertura embutido no popup
  (sem navegar para /onboarding); prop `onBack` no wizard para voltar à seleção.

## Fora de escopo

Painel administrativo, realtime, catálogo CNAE pesquisável, integração RedeSim/Receita,
pós-conclusão automático (admin aplica manualmente).

## Passos manuais (pós-merge)

1. Criar bucket privado `abertura-documentos` no Supabase.
2. Aplicar `0015_abertura_alteracoes.sql` no banco real.
3. Confirmar que `companies.status` não tem CHECK restritivo (a migration já cuida disso com `ADD COLUMN IF NOT EXISTS`).

## Verificação

1. App em dev (`next dev`, http://localhost:3000).
2. Login novo (sem empresa) → `/onboarding` → seleção funcional.
3. "Já tenho empresa" → `CreateCompanyDialog` → home.
4. "Quero abrir" (onboarding) → wizard 5 etapas + uploads → stub `em_abertura` + `abertura_empresas`.
5. `/configuracoes` empresa `em_abertura`: só aba Informações + timeline + botão alterar.
6. Alteração sem mudança → "Nenhuma alteração detectada".
7. Alteração com mudança → `abertura_alteracoes` (pendente).
8. Contador logado → menu lateral → "Adicionar empresa" → popup → wizard embutido ou existente.
9. Empresa ativa → 4 abas intactas.
10. `npm run typecheck` limpo.
