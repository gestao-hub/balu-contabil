# Resultados — Saneamento `arquivos_auxiliares` + `role_types` + `abertura_empresas` (2026-05-29)

**Plano:** `docs/superpowers/plans/2026-05-29-saneamento-arquivos-auxiliares.md`
**Spec:** `docs/superpowers/specs/2026-05-29-saneamento-arquivos-auxiliares-design.md`
**Ambiente:** Supabase de dev real (`llykzqnugdpojwnlontj`), pré-produção, 1 empresa (AL PISCINAS).

## Commits

| SHA | O quê |
|---|---|
| `5ac0e3b` | script one-time `scripts/saneamento-arquivos-auxiliares.mjs` (com hardening de erros) |
| `c68d33b` | migration `0011_arquivos_auxiliares_fk.sql` |
| `a2d476a` | código: cert por `company_id` + nome fixo `certificado.enc`; remove `unique_id_*` e `removeCertificado` morto |
| `2653ecd` | teste de isolamento por `company_id` (+ comentário corrigido) |

## Script `--apply` (Task 2)

```
[APPLY] move 41a9c2a4…/9783c30f….enc -> 41a9c2a4…/certificado.enc
[APPLY] update linha válida 0b44bdec… storage_key/supabase_file_path -> …/certificado.enc
[APPLY] delete linhas órfãs 5d8325bc…, 5e29855c…
[APPLY] objetos a remover do bucket: [6 objetos: 2 das órfãs + 4 sem-linha, incl. 2 .pfx crus + 1 teste]
[APPLY] bucket final: [".emptyFolderPlaceholder","41a9c2a4…/certificado.enc"]
[APPLY] linhas em arquivos_auxiliares: 1
```
Re-rodar em dry-run confirmou idempotência (`move pulado`, `objetos a remover: []`, 1 linha).

## Migration 0011 (Task 4 — aplicada manual no SQL Editor)

Introspecção pós-apply:
```
company_id:         PRESENTE
unique_id_empresa:  AUSENTE (42703)
unique_id_bubble:   AUSENTE (42703)
```
FK `arquivos_auxiliares_company_id_fkey` criada (`on delete cascade`). `role_types`: grant para `authenticated` + `service_role`. `abertura_empresas`: 4 policies por `user_id = auth.uid()`.

## Teste de isolamento (Task 7)

`npx playwright test rls-isolation` → **PASS (1) FAIL (0)**. A checagem de `arquivos_auxiliares` agora usa `company_id`; tenant B segue isolado de A.

## Verificação de UI (Task 8, Playwright logado como A)

- **Certificado A1**: aparece como **presente/válido** ("Certificado enviado em 29/05/2026… Válido até 20/03/2027") — o código lê `arquivos_auxiliares` por `company_id` e `storage_key = …/certificado.enc`. Sem regressão.
- **NFS-e**: Londrina/PR, "Empresa fiscal ativada" — OK.
- **Observação cosmética:** o "enviado em" passou de 28/05 para 29/05 porque o `UPDATE` do script bumpou `updated_at` (trigger na tabela); o display reflete última-modificação, não o upload original (`created_at` preserva o original).
- **Não exercitado:** re-upload de certificado pela UI (Task 8 Step 2) — não havia `.pfx`+senha de teste à mão. O caminho está coberto por inspeção: `upsert:true` + nome fixo grava sempre em `${company_id}/certificado.enc`.

## Pendência menor (follow-up)

`src/lib/clients/_endpoints.ts` (doc de referência, não-executado) ainda cita `arquivos_auxiliares?unique_id_bubble=eq.…` — referência defasada. Atualizar quando mexer nesse doc; não afeta runtime.

## Conclusão

`arquivos_auxiliares` agora tem FK real (`company_id → companies.id`, cascade), Storage padronizado em `certificado.enc` (bucket limpo, sem `.pfx` cru exposto), e os gaps de `role_types`/`abertura_empresas` fechados. Isolamento provado (GREEN) e fluxos do dono sem regressão.
