# Spec — Saneamento `arquivos_auxiliares` + `role_types` + `abertura_empresas`

**Data:** 2026-05-29
**Origem:** follow-up do RLS (migration 0010). Backlog em `docs/superpowers/specs/2026-05-29-followup-saneamento-dados-legados.md`.
**Ambiente:** Supabase de dev real (`llykzqnugdpojwnlontj`), pré-produção, 1 empresa real (AL PISCINAS, `companies.id = 41a9c2a4-241f-40b0-a1c5-da3fced49359`). Migrations aplicadas **manualmente no SQL Editor**; operações de Storage e deleção de linhas via **script Node + service_role** (não há CLI/conexão local).

## Objetivo
Formalizar a integridade de `arquivos_auxiliares` (FK real para `companies`), padronizar o nome do certificado no Storage, limpar o cruft legado do Bubble (linhas e objetos órfãos, inclusive `.pfx` crus), e fechar dois gaps do RLS: o grant ausente em `role_types` e a ausência de policies em `abertura_empresas`.

## Contexto / estado atual (introspecção do banco vivo)

`arquivos_auxiliares` tem 3 linhas; só 1 referencia uma `company` existente. `unique_id_empresa` é **uuid** (referencia `companies.id`, sem FK formal). `unique_id_bubble` (text) era o nome do arquivo `.enc` no Storage. **Nenhum código baixa/descriptografa o blob hoje** (emissão é externa, sendo migrada para o Next — ver `n8n em transição`); o `.enc` só é gravado no upload e seu `storage_key` apenas alimenta o booleano `certPresente` em `page.tsx:105`. `removeCertificado` (em `supabase-storage.ts`) é **código morto** (nenhum chamador).

Inventário (linhas):

| linha id | company (unique_id_empresa) | órfã? | objeto/observação |
|---|---|---|---|
| `0b44bdec…` | `41a9c2a4…` (AL PISCINAS) | não | **cert válido** → `41a9c2a4…/9783c30f….enc` |
| `5d8325bc…` | `5f1de1b4…` (empresa inexistente) | sim | `5f1de1b4…/d8834803….enc` |
| `5e29855c…` | `8b86b68e…` (stub Bubble) | sim | `storage_key` malformado (`company-certificates/…pfx`); objeto real é `1779747182535x….pfx` no root; `supabase_file_path` é um template literal nunca preenchido |

Inventário (bucket `company-certificates`) — objetos **sem linha válida**, a apagar: `1779747182535x….pfx` (cru), `cefa8a7e….pfx` (cru), `db2b742d…/cert-confirm-test.pfx` (teste), `42ba5775…/206f1b59….enc`, `dec3f6c6…/f7d1d91c….enc`, `5f1de1b4…/d8834803….enc`. Preservar: `.emptyFolderPlaceholder` (placeholder do Supabase) e, após o move, `41a9c2a4…/certificado.enc`.

## Decisões (brainstorming)
1. **Escopo:** os 3 itens (`arquivos_auxiliares` + `role_types` + `abertura_empresas`).
2. **FK:** `rename unique_id_empresa → company_id` + `add foreign key … references companies(id) on delete cascade`.
3. **Órfãs:** apagar as 2 linhas órfãs **e** seus objetos no Storage.
4. **`unique_id_bubble`:** padronizar o Storage para `${company_id}/certificado.enc` (nome fixo, 1 cert por empresa), renomear o objeto vivo, e **dropar a coluna**.
5. **Storage:** varrer **todos** os objetos sem referência válida (órfãos + `.pfx` crus + artefato de teste), mantendo apenas `certificado.enc` da empresa válida.

## Arquitetura / ordem de execução

Dependências, logo **script → migration → deploy de código**: (a) a FK exige zero órfãs, e quem as remove é o script; (b) o move do objeto + atualização de `storage_key` deve preceder o código que passa a usar `certificado.enc`. O script opera por `id` de linha e paths literais — não depende dos nomes de coluna que a migration altera.

### Passo 1 — Script one-time `scripts/saneamento-arquivos-auxiliares.mjs` (Node + service_role)
Idempotente quando possível; loga cada ação. Em ordem:
1. **Move** o cert válido: `storage.move('41a9c2a4…/9783c30f….enc', '41a9c2a4…/certificado.enc')`; `update arquivos_auxiliares set storage_key = supabase_file_path = '41a9c2a4…/certificado.enc' where id = '0b44bdec…'`.
2. **Apaga as 2 linhas órfãs:** `delete from arquivos_auxiliares where id in ('5d8325bc…','5e29855c…')`.
3. **Varre o bucket:** lista recursivamente `company-certificates`; remove todo objeto cujo path ≠ `41a9c2a4…/certificado.enc` e ≠ `.emptyFolderPlaceholder`. (Cobre os 2 objetos das órfãs + os 4 sem-linha.)
4. **Confere:** relista o bucket e espera apenas `certificado.enc` (+ placeholder); confere `arquivos_auxiliares` com 1 linha.

Decisão de implementação: usar IDs/paths **literais** descobertos aqui (não reconstruir paths), porque os legados têm `storage_key` malformado. O script reporta qualquer objeto inesperado em vez de apagar às cegas (sem truncamento silencioso).

### Passo 2 — Migration `0011_arquivos_auxiliares_fk.sql` (SQL Editor)
```sql
-- arquivos_auxiliares: formaliza FK (coluna já é uuid; órfãs já removidas pelo script)
alter table public.arquivos_auxiliares rename column unique_id_empresa to company_id;
alter table public.arquivos_auxiliares
  add constraint arquivos_auxiliares_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete cascade;
alter table public.arquivos_auxiliares drop column unique_id_bubble;

-- recria as policies referenciando company_id (rename atualizaria sozinho, mas explicitamos)
drop policy if exists arquivos_auxiliares_select on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_insert on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_update on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_delete on public.arquivos_auxiliares;
create policy arquivos_auxiliares_select on public.arquivos_auxiliares for select using (public.user_owns_company(company_id));
create policy arquivos_auxiliares_insert on public.arquivos_auxiliares for insert with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_update on public.arquivos_auxiliares for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_delete on public.arquivos_auxiliares for delete using (public.user_owns_company(company_id));

-- role_types: fecha o gap de GRANT (RLS já tinha policies own-row na 0010)
grant select, insert, update, delete on public.role_types to authenticated;
grant all on public.role_types to service_role;

-- abertura_empresas: policies por user_id (decisão: relação por user, não company)
drop policy if exists abertura_empresas_select on public.abertura_empresas;
drop policy if exists abertura_empresas_insert on public.abertura_empresas;
drop policy if exists abertura_empresas_update on public.abertura_empresas;
drop policy if exists abertura_empresas_delete on public.abertura_empresas;
create policy abertura_empresas_select on public.abertura_empresas for select using (user_id = auth.uid());
create policy abertura_empresas_insert on public.abertura_empresas for insert with check (user_id = auth.uid());
create policy abertura_empresas_update on public.abertura_empresas for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy abertura_empresas_delete on public.abertura_empresas for delete using (user_id = auth.uid());
```

### Passo 3 — Código (deploy junto com a migration)
- `src/app/(auth)/configuracoes/actions.ts`:
  - Constante `const CERT_FILENAME = 'certificado.enc'`. Upload: `storageUploadCertificado(blob, CERT_FILENAME, companyId)` → path `${companyId}/certificado.enc` (já com `upsert:true`).
  - Remover a busca/reuso de `unique_id_bubble`; o `upsert` por nome fixo dispensa "reaproveitar id".
  - `insert`/`update` sem `unique_id_bubble`; filtrar o `select` de existência por `company_id`.
- `src/app/(auth)/configuracoes/page.tsx`: filtrar o cert por `company_id` (era `unique_id_empresa`).
- `src/lib/clients/supabase-storage.ts`: remover `removeCertificado` (morto).
- `src/types/database.ts`: regenerar/ajustar o tipo de `arquivos_auxiliares` (remove `unique_id_empresa`/`unique_id_bubble`, adiciona `company_id`).

### Passo 4 — Teste
`tests/rls-isolation.spec.ts`: a checagem de `arquivos_auxiliares` passa a usar `.eq('company_id', aCompanyId)` (era `unique_id_empresa`).

## Verificação (como provamos)
- **DB:** `\d arquivos_auxiliares` mostra `company_id` com FK; sem `unique_id_empresa`/`unique_id_bubble`; 1 linha.
- **Storage:** bucket contém só `41a9c2a4…/certificado.enc` (+ `.emptyFolderPlaceholder`).
- **RLS:** `npx playwright test rls-isolation` continua **PASS** (com a checagem ajustada para `company_id`).
- **UI (Playwright, logado como A):** aba "Emissão fiscal" segue mostrando o certificado como presente/válido; um **re-upload** de cert grava em `certificado.enc` e a tela atualiza.
- **typecheck:** `npm run typecheck` verde.

## Riscos / mitigações
- **Renomear objeto vivo:** baixo risco — nenhum leitor baixa o blob hoje; o blob é **preservado** (move, não apaga) para quando a emissão entrar no Next. `storage_key` atualizado mantém `certPresente` verdadeiro.
- **Apagar objetos:** o script só apaga o que **não** está no keep-set explícito; reporta qualquer objeto inesperado antes de remover.
- **Janela script↔deploy:** entre o script (Storage em `certificado.enc`) e o deploy do código (que passa a usar `certificado.enc`), só o dono opera; em pré-produção é controlado. Se um upload ocorrer com o código antigo nessa janela, ele grava em `${companyId}/${unique_id_bubble}.enc` de novo — re-rodar o script resolve.
- **FK `on delete cascade`:** apagar uma `company` apaga seus certs — comportamento desejado.

## Rollback
- Migration: `alter table … rename column company_id to unique_id_empresa`, `drop constraint …_fkey`, re-`add column unique_id_bubble text`. As linhas/objetos apagados **não** voltam (são cruft; backup do bucket não previsto neste PR pré-produção).
- Código: revert dos commits.

## Fora de escopo
- Migrar a leitura/descriptografia do cert para dentro do Next (emissão) — tarefa do desmonte do n8n.
- Hardening de `nfse_senha_login`/`nfse_token_api` (plaintext) — item separado.
- Qualquer alteração em `companies`/`empresas_fiscais`.
