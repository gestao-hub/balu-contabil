# Resultados — RLS Supabase ligado (2026-05-29)

**Migration:** `supabase/migrations/0010_rls_policies.sql` (commits `17dd6fb` → `354a0c8` → `09014b3`)
**Plano:** `docs/superpowers/plans/2026-05-29-rls-supabase.md`
**Ambiente:** Supabase de dev real (`llykzqnugdpojwnlontj`), 1 tenant com dados (AL PISCINAS LTDA / `allanvalle@outlook.com`).

## Portão RED → GREEN (teste de isolamento entre tenants)

`tests/rls-isolation.spec.ts` — provisiona um 2º tenant (B) via service_role e prova que B não acessa dados de A.

| Momento | RLS | Resultado | Evidência |
|---|---|---|---|
| **RED** (antes da 0010) | desligado | **FAIL** ✓ (esperado) | passo 4: `B enxergou a company de A` — `Received length: 1` |
| **GREEN** (depois da 0010) | ligado | **PASS** ✓ | `PASS (1) FAIL (0)` em ~5.6s |

O GREEN cobre: B não vê company/clientes/notas_fiscais/guias_fiscais/apuracoes_fiscais/receitas_fiscais/honorarios/empresas_fiscais/arquivos_auxiliares de A; B não consegue INSERT cliente na company de A (WITH CHECK barra); A continua vendo a própria company.

## Task 6 — Fluxos do dono (Playwright logado como A, RLS ligado)

| Step | Fluxo | Resultado |
|---|---|---|
| 1 | Dashboard `/` | ✅ Receita do mês R$ 3.000,00 (1 nota), última nota R$ 4.000,00 (28/05), notas no mês 1 — dados de A |
| 2 | Clientes CRUD `/clientes` | ✅ SELECT (lista Allan Barros), INSERT (criou "RLS TESTE APAGAR"), UPDATE (telefone), DELETE (removido) — teste limpo |
| 3 | Notas `/notas_fiscais` | ✅ lista as NFS-e de A (join com clientes OK) + detalhe `/notas_fiscais/[id]` carrega |
| 4a | Impostos `/impostos` | ✅ AL PISCINAS · Maio/2026, Receita R$ 3.000,00, Anexo III · Fator R; "Sem guias anteriores" (guias_fiscais vazia) |
| 4b | Configurações leitura | ✅ Dados da empresa (companies); **Certificado A1 "enviado em 28/05, válido até 20/03/2027" (arquivos_auxiliares)**; NFS-e Londrina/PR (empresas_fiscais + municipios_nfse) |
| 4c | Configurações gravação | ✅ "Salvar" em Dados da empresa concluiu (companies_update por user_id) |

**Nota:** há 1 erro de console em todas as páginas — *hydration mismatch no `ThemeToggle`* (`aria-label "Modo claro" vs "Modo escuro"`). É do toggle de tema, **não relacionado a RLS** e pré-existente. Follow-up de UI separado.

## Task 7 — Caminhos service_role (não afetados por RLS)

| Caminho | Verificação | Resultado |
|---|---|---|
| Storage de certificado | `src/lib/clients/supabase-storage.ts` usa `createClient(url, SUPABASE_SERVICE_ROLE_KEY)`; path `${companyId}/${fileName}` | ✅ bypassa RLS; escopo por empresa no código |
| Webhook Focus | `src/app/api/webhooks/focus/route.ts` usa `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` | ✅ bypassa RLS; grava sem sessão |

## Ajustes necessários durante a execução (divergências do banco vivo)

O `db_atual.sql` estava **defasado**; corrigido por introspecção do banco vivo:
1. **`arquivos_auxiliares` não tem `company_id`** (o dump afirmava que tinha). É escopada por `unique_id_empresa`. Erro original na 1ª aplicação: `column "company_id" does not exist`.
2. **`unique_id_empresa` é `uuid`** (não `text`). Tentativa com helper de texto deu `function user_owns_company_text(uuid) does not exist`. Solução final: `user_owns_company(unique_id_empresa)`.
3. **`abertura_empresas`** ficou deny-all (sem uso no client); decisão: escopo futuro por `user_id`. **`role_types`**: grant ausente p/ service_role (não afeta o app). Ver `docs/superpowers/specs/2026-05-29-followup-saneamento-dados-legados.md`.

## Conclusão

RLS ligado nas 13 tabelas com isolamento entre tenants **provado** (RED→GREEN) e **sem regressão** nos fluxos do dono. Gate de produção da 0009 satisfeito.
