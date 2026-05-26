# Status de Implementação — Balu v1

> **Para que serve este doc**: matriz que cruza as features da v1 (`V1-FUNCIONALIDADES.md`) com o estado real do código em `balu-next/`. Antes de implementar qualquer coisa, **consulte aqui** — boa parte da infra já existe e pode ser reusada.
>
> **Legenda**:
> - ✅ **pronto** — implementado e testado
> - 🚧 **parcial** — base existe (schema, cliente API, componente), falta UI ou orquestração
> - 🆕 **a fazer** — nada feito ainda
> - 🚫 **bloqueado** — depende de coisa externa (credencial, aprovação)

---

## 0. Progresso da execução (PLANO-4-DIAS)

> Atualizado em **2026-05-25**. Branch: `feat/day1-dashboard`. Cadência: PR a PR, com revisão.

| PR | Escopo | Estado | Commit |
|---|---|---|---|
| 1.1 | Dashboard `/` (4 cards + lista de pendências) | ✅ código (tsc + build OK); ⏳ runtime aguarda Supabase | `9d0461f` |
| 1.2 | Listagem `/notas_fiscais` (4 filtros + export CSV) | ✅ código (tsc + build OK); ⏳ runtime aguarda Supabase | `4fe1e80` |
| 1.3 | Detalhe + cancelamento `/notas_fiscais/[id]` | 🆕 próximo | — |
| Auth | Cadastro: dropdown "Tipo de conta" + "Confirmar senha"; tipo gravado em `role_types` via trigger | ✅ código (tsc OK); ⏳ aplicar trigger `0002` no Supabase | `1594e50`, `4df6899` |

- **Baseline git**: commit `2ff8fd6` (estado pré-Day-1). `excluviapainel.bubble` ficou **fora** do versionamento (continha PII + tokens; slices já extraídos e limpos).
- **Ambiente**: deps instaladas; `tsc --noEmit` e `next build` verificados limpos. Falta `.env.local` com credenciais Supabase para verificação de runtime.
- **Descoberta**: `Database = any` não impede o parser de select-string do supabase-js de tipar embeds to-one (`clientes(...)`) como array — usar `as unknown as` nesses joins.
- **Cadastro/auth (fora dos PRs do plano)**: `/cadastro` ganhou dropdown "Tipo de conta" (`Empresa`/`Contador`) + campo "Confirmar senha" (validação client + server). O tipo vai no metadata do usuário sob a chave `type`; o trigger `handle_new_user_role` (migration `0002`) lê `raw_user_meta_data->>'type'` e cria o registro em `role_types` (default `Empresa` quando ausente). **Pendente**: aplicar `0002` no Supabase hospedado.

---

## 1. Matriz por feature da v1

### §1. Onboarding com IA Educacional
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 1.1 Fluxo conversacional | 🆕 | nada | rota `app/(public)/onboarding/page.tsx`, chat component, server action `processOnboardingStep`, tabela `onboarding_sessions`, integração LLM |
| 1.2 Sugestão CNAE/Regime via IA | 🚧 | `lookupCnpjAction` em `app/(auth)/onboarding/actions.ts` (Focus CNPJ) | fallback IA para quem não tem CNPJ, tabela `cnae_catalog`, action `suggestCnaeFromActivity`, integração OpenRouter/Anthropic |

### §2. Abertura de Empresa Digital
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 2.1 Abertura 100% online (MEI/EI/LTDA) | 🚧 | tabela `abertura_empresas` já existe **no banco real** (~50 colunas flat: `titular_*`/`empresa_*`/`sede_*`/`doc_*`/`processo_*`, `UNIQUE(titular_cpf)`) | rota `app/(auth)/abertura/page.tsx`, wizard 5 etapas, server action `submitAberturaAction`, integração RedeSim/Portal Empreendedor via n8n |
| 2.2 Checklist automático de docs | 🆕 | `supabase-storage.ts` para upload | componente `<ChecklistAbertura>`, constante `DOC_REQUIREMENTS` por tipo societário, bucket novo `abertura-docs`, gravar caminho nas colunas `doc_*` (não jsonb) |
| 2.3 Geração contrato + envio Receita/Junta/Prefeitura | 🆕 | nada | template HTML contrato, geração PDF (puppeteer/DocRaptor), integração Clicksign, n8n workflow de submissão |
| 2.4 Status em tempo real | 🆕 | Supabase Realtime built-in | componente `<AberturaTimeline>`, enum check de `processo_etapa` |

### §3. Emissão de Notas Fiscais Simplificada
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 3.1 Emissor NFS-e integrado | 🚧 | `src/lib/clients/focus-nfe.ts` (emit + status + cancel + download + retry + `generateRef`), webhook receiver `app/api/webhooks/focus/route.ts`, tabela `notas_fiscais` | rota `app/(auth)/notas_fiscais/emissao/page.tsx` (hoje stub), `<EmissaoForm>`, server action `emitirNotaAction` |
| 3.2 Histórico exportável | ✅ | **PR 1.2**: `notas_fiscais/page.tsx` + `NotasFiscaisList.tsx` (4 filtros) + `actions.ts` (`exportNotasCsvAction`) | verificação runtime (Supabase) |
| 3.3 Preview imposto ANTES de emitir | 🆕 | `apuracoes_fiscais` para RBT12 | `src/lib/fiscal/preview.ts`, componente `<PreviewImpostoCard>` reativo |
| 3.4 Alerta limite faturamento | 🆕 | `apuracoes_fiscais.rbt12`, `empresas_fiscais.Code_regime_tributario` | `<LimiteFaturamentoBanner>` no `(auth)/layout.tsx`, função `getLimiteStatus` |
| 3.5 XML + PDF automáticos | 🚧 | `focus.baixarDanfe`, `focus.baixarXmlNfe` já existem | UI para download na rota `[id]/page.tsx`, cache opcional em Storage bucket `notas-arquivos` |

### §4. Apuração Automática de Impostos
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 4.1 Cálculo DAS mensal + DAS-MEI | 🚧 | `src/lib/clients/n8n.ts` (`consolidarReceitas`, `calcularRbt12`, `consultaDasMei`), tabelas `apuracoes_fiscais` + `guias_fiscais` | cron mensal (Vercel Cron ou Supabase Edge), rota `app/(auth)/impostos/page.tsx` (stub), `<ApuracaoWizard>` em `impostos/novo/page.tsx` |
| 4.2 Geração da guia | 🚧 | `src/lib/clients/serpro.ts` (`emitirDas` + `SERPRO_SERVICES.GERAR_DAS` + `buildEnvelope`) | server action `emitirGuiaAction`, componente `<GuiaCard>` |
| 4.3 Explicação em pt-BR simples | 🆕 | nada | `src/lib/fiscal/explicacoes.ts` (templates por regime), componente `<ResumoApuracao>` |

### §5. Painel Leigo do Empresário
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 5.1 Dashboard 24/7 | ✅ | **PR 1.1**: `app/(auth)/page.tsx` + `<DashboardCard>` + `lib/dashboard/queries.ts` (`getDashboardMetrics`, queries em paralelo) | verificação runtime; cards "limite de faturamento" (§3.4) ainda não |
| 5.2 Lista "O que você precisa fazer" | 🚧 | **PR 1.1**: `getPendingActions` + `<PendingActionsList>` (DAS vencido/vencendo, notas pendentes) | badge no `MenuLateral`; pendência de certificado A1 (schema não guarda validade) |
| 5.3 Visualizar/pagar impostos em poucos cliques | 🆕 | `guias_fiscais` schema | componente `<PagarGuiaModal>`, action `marcarGuiaPagaAction` |
| 5.4 Repositório de documentos | 🆕 | `notas_fiscais`, `guias_fiscais`, `arquivos_auxiliares`, `declaracoes_fiscais`, `supabase-storage.ts` | rota `app/(auth)/documentos/page.tsx`, agrupamento client-side |

### §7. Gestão de Obrigações Básicas
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 7.1 DASN-SIMEI automática | 🆕 | `n8n.ts` cliente existe | cron anual, n8n workflow `entregar-dasn-simei`, tabela `declaracoes_fiscais` já no schema |
| 7.2 Alertas automáticos | 🆕 | nada | tabela `notifications`, componente `<NotificationsBell>` no `MenuLateral`, cliente Resend `src/lib/clients/resend.ts` |
| 7.3 Zero ação manual (princípio) | 🆕 (conceitual) | n/a | revisão de cada feature aplicando o princípio |

### §8. Área White-Label do Contador
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 8.1 Logo do escritório | 🆕 | `supabase-storage.ts` | tabela nova `contabilidades`, FK `profiles.contabilidade_id`, bucket `contabilidades-logos`, `<BrandLogo>`, rota `configuracoes/contabilidade/page.tsx` |
| 8.2 Nome da contabilidade | 🆕 | (deriva de 8.1) | helper `getBranding(userId)`, templates de e-mail com `{{branding.nome}}` |
| 8.3 WhatsApp do escritório | 🆕 | nada | campo `contabilidades.support_whatsapp`, componente `<SupportButton>` FloatingGroup |
| 8.4 SLA configurável | 🆕 | nada | campos `support_sla_hours` + `support_horario`, componente `<SlaCard>` |
| 8.5 Painel contador | 🆕 | `MenuLateral` filtra por role | rota `app/(auth)/contador/page.tsx`, view materializada `mv_painel_contador`, query agregada cross-table |

---

## 2. Inventário de assets reusáveis

### 2.1 Componentes React (`src/components/`)

| Componente | Arquivo | Quando usar |
|---|---|---|
| `<MenuLateral>` | `MenuLateral.tsx` | sidebar pronto; já tem troca de empresa + signOut + item ativo |
| `<ToastProvider>` + `useToast()` | `Toaster.tsx` | feedback de ação. Já plugado no `app/layout.tsx`. Chamar `useToast()('success'|'error'|'info'|'warning', mensagem)` |
| `<Loading>` | `Loading.tsx` | spinner com label + modo fullscreen |
| `<FilterPeriodo>` | `FilterPeriodo.tsx` | date range filter, devolve `{start, end}` via `onChange` |
| `<PopupConfirm>` | `PopupConfirm.tsx` | confirmação destructiva ou neutra; props `variant='destructive'`, `busy`, etc. |
| `<ClienteFormDialog>` | `ClienteFormDialog.tsx` | popup criar/editar cliente — referência de padrão para outros forms |
| `<ClientesListClient>` | `ClientesListClient.tsx` | tabela + busca + filtros — referência de padrão para listagens |
| `<CreateCompanyDialog>` | `CreateCompanyDialog.tsx` | onboarding empresa — referência de padrão para wizards |
| `<DadosEmpresaForm>` | `app/(auth)/configuracoes/DadosEmpresaForm.tsx` | edição de empresa — referência de form Zod-validado |
| `<DashboardCard>` | `components/DashboardCard.tsx` | card de métrica do dashboard (title/Icon/value/subtitle/tone/action) — **PR 1.1** |
| `<PendingActionsList>` | `components/PendingActionsList.tsx` | lista "O que você precisa fazer" com severidade + CTA — **PR 1.1** |
| `<NotasFiscaisList>` | `app/(auth)/notas_fiscais/NotasFiscaisList.tsx` | listagem com 4 filtros + export CSV + linha clicável — **PR 1.2** (referência de listagem com filtros server-side) |

### 2.2 Server Actions prontas

| Action | Arquivo | Função |
|---|---|---|
| `loginAction` | `app/(public)/login/actions.ts` | Supabase signin |
| `signupAction` | `app/(public)/cadastro/actions.ts` | Supabase signup; envia `full_name` + `type` no metadata; trigger cria registro em `role_types` |
| `requestResetAction` + `updatePasswordAction` | `app/(public)/reset_pw/actions.ts` | Reset 2 telas |
| `createClienteAction` + `updateClienteAction` + `softDeleteClienteAction` | `app/(auth)/clientes/actions.ts` | CRUD cliente com dedup CPF/CNPJ |
| `updateCompanyAction` | `app/(auth)/configuracoes/actions.ts` | PATCH companies |
| `lookupCnpjAction` + `lookupCepAction` + `createCompanyAction` | `app/(auth)/onboarding/actions.ts` | Focus CNPJ + ViaCEP + insert |
| `exportNotasCsvAction` | `app/(auth)/notas_fiscais/actions.ts` | re-consulta notas com filtros e devolve CSV (BOM UTF-8, `;`) — **PR 1.2** |

> Funções server-side (não-actions): `getDashboardMetrics` + `getPendingActions` em `lib/dashboard/queries.ts` (**PR 1.1**, `import 'server-only'`).

### 2.3 Clientes API (`src/lib/clients/`)

Todos têm `import 'server-only'` — só chamar de server actions ou route handlers.

| Cliente | Métodos exportados | Notas |
|---|---|---|
| `focus` (`focus-nfe.ts`) | `consultarCnpj`, `emitirNfe`, `emitirNfce`, `emitirNfse`, `consultarStatusNfe/Nfce/Nfse`, `baixarDanfe`, `baixarXmlNfe`, `cancelarNfe/Nfce/Nfse` (valida `justificativa.length ≥ 15`), `generateRef(empresaId)` | retry exponencial em 502/503/504 |
| `serpro` (`serpro.ts`) | `transmitirDeclaracao`, `emitirDas`, `consultarDeclaracao`, helper `buildEnvelope`, `normalizeCnpj`, `_resetSerproTokenCache` (teste). Constantes `SERPRO_SERVICES`, `Tipo`, `TRIBUTO_CODIGOS` | cache de token module-scoped |
| `n8n` (`n8n.ts`) | `consolidarReceitas`, `calcularRbt12`, `consultaDasMei`, `postAutenticacao`, `uploadCertificado` | HMAC SHA-256 em todo body via `N8N_WEBHOOK_SECRET` |
| `supabase-storage` (`supabase-storage.ts`) | `uploadCertificado(file, fileName, companyId)`, `fileToBase64(File)` | usa `service_role`, bucket `company-certificates` |
| `_endpoints` (`_endpoints.ts`) | `ENDPOINTS` (catálogo bruto dos 81 endpoints do Bubble) | referência só |

### 2.4 Schema Supabase (`supabase/migrations/0001_init.sql`)

13 tabelas com RLS + triggers + RPCs:
- `profiles` (1:1 auth.users), `companies`, `clientes`, `empresas_fiscais`, `notas_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais`, `guias_fiscais`, `arquivos_auxiliares`, `municipios_nfse`, `honorarios`, `abertura_empresas`, `aux_produtos`
- RPC: `add_company_to_profile(p_user_id, p_company_id)`
- Trigger: auto-criar profile no signup (`handle_new_user`)
- Trigger: `updated_at` automático em todas as tabelas com a coluna
- Dedup índice `clientes_owner_doc_uniq` (PRD §15.2)
- Dedup índice `companies_owner_cnpj_uniq`
- Revoke `select(cert_password)` para roles `authenticated` e `anon`

### 2.5 Tipos TypeScript (`src/types/`)

- `database.ts` — `Tables` nominais + `Row<T>` helper. `Database = any` por design (sem CLI Supabase).
- `enums.ts` — 26 option sets do Bubble como const arrays
- `zod.ts` — `ClienteSchema`, `CompanySchema`, `HonorarioSchema`

### 2.6 Configuração / Tooling

| Arquivo | Função |
|---|---|
| `tailwind.config.ts` | tokens: `brand-teal`, `brand-navy`, `brand-danger`, `primary`, `destructive`, `success`, `alert`, `surface` |
| `verify.sh` | `npm i + tsc + next build` em sequência |
| `playwright.config.ts` | base URL localhost:3000, headless chromium |
| `tests/smoke.spec.ts` + `tests/walkthrough.spec.ts` | 6 smoke + 12 walkthrough (passando hoje) |

---

## 3. O que está rodando hoje (provado por Playwright)

12/12 testes Playwright passando:
- ✅ `/login` renderiza + aceita inputs
- ✅ `/cadastro` renderiza + aceita inputs
- ✅ `/reset_pw` 2 telas (request + update via `?code=`)
- ✅ Redirect protegidas → `/login` quando sem sessão (testado em `/`, `/clientes`, `/configuracoes`, `/notas_fiscais`, `/impostos`)
- ✅ 404 amigável em rota inexistente
- ✅ Responsivo: desktop 1280×800 + mobile 390×844

Build: `next build` zero erros, 12 rotas compiladas (11 estáticas + 1 dinâmica). TypeScript zero erros.

---

## 4. Como usar este doc

Antes de começar **qualquer** feature da v1:

1. Encontre a feature na matriz §1
2. Veja o **status** — se for ✅/🚧, leia "Reusa" para entender o que já está pronto
3. Veja "Falta" — esse é o escopo mínimo do PR
4. Para o componente/cliente/action que você vai reusar, consulte §2 para saber assinatura e localização
5. Implemente seguindo o padrão do componente análogo (ex: pra fazer uma nova listagem, copie `ClientesListClient.tsx`; pra um novo wizard, copie `CreateCompanyDialog.tsx`)

**Convenção**: arquivos gerados pelo pipeline (`bubble-to-prd/skills/`) têm header `// @generated` e podem ser sobrescritos. Quando você editar à mão, troque para `// @custom — <razão>`.
