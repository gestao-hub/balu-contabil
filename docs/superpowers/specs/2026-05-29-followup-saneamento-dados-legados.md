# Follow-up — Saneamento de dados legados (pós-RLS)

> Descoberto durante a implementação do RLS (migration 0010). **Não bloqueia o RLS** —
> são tarefas independentes de higiene de dados/modelagem. Trabalhar PR a PR.

Contexto: o banco Balu veio de uma migração do **Bubble**, onde relacionamentos são
por **texto** (ids tipo `1779747182535x132468604217668370`). Várias tabelas ficaram com
referências soltas em texto em vez de FK uuid. O RLS 0010 contorna isso com segurança,
mas a modelagem continua frágil.

---

## 1. `arquivos_auxiliares` — virar FK de verdade

**Hoje:** não tem `company_id`. É escopada por `unique_id_empresa` (coluna **text**) que
guarda o `companies.id` como string. O RLS 0010 usa `user_owns_company_text(unique_id_empresa)`
(`companies.id::text = unique_id_empresa`).

**Estado dos dados (29/05/2026):** 1 company no banco, **3 linhas** em `arquivos_auxiliares`,
sendo **2 órfãs**:

| `unique_id_empresa` | casa c/ company | cert | diagnóstico |
|---|---|---|---|
| `41a9c2a4-…49359` | ✅ | AL PISCINAS (CNPJ 10358425000120) | cert válido atual |
| `5f1de1b4-…faaf64` | ❌ | AL PISCINAS (mesmo CNPJ) | cert antigo — empresa recriada com novo uuid deixou este órfão |
| `8b86b68e-…835394` | ❌ | tudo null | stub legado (`unique_id_bubble = 1779747182535x132468604217668370`, id nativo do Bubble) |

O RLS já põe as órfãs em quarentena (não casam com nenhuma company → invisíveis a qualquer
usuário autenticado). Isso resolve a **segurança**, não a **modelagem**.

**A fazer (migration própria + spec/teste, pois encosta no upload de certificado):**
- [ ] Adicionar `company_id uuid references public.companies(id)`.
- [ ] Backfill: `company_id = unique_id_empresa::uuid` onde casa com uma company existente.
- [ ] Tratar órfãs: arquivar/apagar `5f1de1b4…` (cert antigo) e `8b86b68e…` (stub null).
- [ ] Trocar `configuracoes/actions.ts` e `configuracoes/page.tsx` pra filtrar por `company_id`.
- [ ] Atualizar a policy de RLS pra `user_owns_company(company_id)` (numa 0011) e, no fim,
      remover `user_owns_company_text` + a coluna `unique_id_empresa`.

### 1b. Investigar `unique_id_bubble` (origem e necessidade)
- **De onde vem:** linhas novas usam `crypto.randomUUID()`; linhas legadas trazem o id do
  Bubble. **É usado como nome do objeto no Storage**: `configuracoes/actions.ts:187` →
  `storageUploadCertificado(blob, ` + "`${uniqueIdBubble}.enc`" + `, companyId)`.
- [ ] Confirmar se ainda **precisamos** dele: hoje é a chave do arquivo no Storage, então
      **não dá pra dropar sem migrar os nomes dos objetos** no bucket. Decidir: manter como
      nome do arquivo, ou migrar pra um esquema baseado em `company_id` + renomear objetos.

---

## 2. `abertura_empresas` — relação por **user**, não company

**Decisão do usuário (29/05/2026):** esta tabela **não precisa de relacionamento com
`company`**, apenas com **`user`**. Será usada num futuro próximo.

**Hoje:** o RLS 0010 deixa **deny-all** (RLS ligado, sem policy) porque nenhum fluxo do app
a consulta ainda. A tabela tem as colunas `company_id` e `user_id`.

**A fazer (quando a feature de abertura de empresa entrar):**
- [ ] Adicionar policies escopadas por **`user_id = auth.uid()`** (NÃO por company).
- [ ] Não criar dependência de `company_id` nesse fluxo.

---

## 3. `role_types` — GRANT ausente (baixa prioridade)

Na introspecção, o **service_role** levou `permission denied for table role_types` — é
problema de **GRANT**, não de RLS. Não afeta o app hoje: o app não lê `role_types` via
client; quem grava é o trigger `handle_new_user_role` (SECURITY DEFINER, bypassa RLS/grant).

- [ ] Se algum dia o client precisar ler `role_types`, conceder `grant select on
      public.role_types to authenticated` (além da policy own-row que a 0010 já cria).
- [ ] Verificar por que o service_role não tem grant (criação da tabela fora do padrão Supabase).
