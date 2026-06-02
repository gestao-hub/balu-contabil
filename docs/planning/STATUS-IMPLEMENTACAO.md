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

> Atualizado em **2026-06-02**. Branch: `main`. Cadência: PR a PR, com revisão.

| PR | Escopo | Estado | Commit |
|---|---|---|---|
| 1.1 | Dashboard `/` (4 cards + lista de pendências) | ✅ código (tsc + build OK); ⏳ runtime aguarda Supabase | `9d0461f` |
| 1.2 | Listagem `/notas_fiscais` (4 filtros + export CSV) | ✅ código (tsc + build OK); ⏳ runtime aguarda Supabase | `4fe1e80` |
| 1.3 | Detalhe + cancelamento `/notas_fiscais/[id]` | 🆕 próximo | — |
| Auth | Cadastro: dropdown "Tipo de conta" + "Confirmar senha"; tipo gravado em `role_types` via trigger | ✅ código (tsc OK); ⏳ aplicar trigger `0002` no Supabase | `1594e50`, `4df6899` |
| municipios | Rebuild `municipios_nfse` (schema Focus) + cron `GET /api/cron/sync-municipios` | ✅ completo — migration 0016 aplicada; 5.571 municípios upsertados; 317 testes | `ed80dd1` |

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
| 3.1 Emissor NFS-e integrado | ✅ (2026-05-29) | `src/lib/clients/focus-nfe.ts`, webhook `app/api/webhooks/focus/route.ts`, `notas_fiscais`. Rota `emissao/nfse/page.tsx` + `<EmissaoForm>` + `emitirNotaAction` + `nfse-payload.ts`. **Gate de emissão** (2026-06-02): `emitirNotaAction` e `emissao/nfse/page.tsx` verificam `municipios_nfse.status_nfse === 'ativo'` via `codigo_ibge` (substitui toggle manual `empresa_fiscal_ativada`) | emissão real só exercitada em homologação |
| 3.1b Emissor NF-e + NFC-e (multi-tipo) | ✅ código (2026-05-30) · ❌ habilitação Focus | **Emissão multi-tipo**: tela de escolha `emissao/page.tsx` (3 cards gated por flag), forms `emissao/{nfe,nfce}/`, builders `lib/fiscal/{nfe,nfce}-payload.ts` (+testes), `emitirNfeAction`/`emitirNfceAction`, `ItensField` (catálogo `aux_produtos` + criação inline), produtos compartilhados nfe/nfce. Migrations `0012` (flags `focus_habilita_nfe/nfce` + AL Piscinas) e `0013` (cria `aux_produtos`). Spec `docs/superpowers/specs/2026-05-30-emissao-multitipo-nfe-nfce-design.md` | **Bloqueio externo**: empresa não habilitada na Focus → `empresa_nao_habilitada` (mesmo padrão do gap de NFS-e prod). Verificado em homologação 2026-05-30: payload aceito/processado, Focus responde até a checagem de atividade. Impostos por item com defaults fixos (refino fiscal pendente) |
| 3.2 Histórico exportável | ✅ | **PR 1.2**: `notas_fiscais/page.tsx` + `NotasFiscaisList.tsx` (4 filtros) + `actions.ts` (`exportNotasCsvAction`) | verificação runtime (Supabase) |
| 3.3 Preview imposto ANTES de emitir | 🆕 | `apuracoes_fiscais` para RBT12 | `src/lib/fiscal/preview.ts`, componente `<PreviewImpostoCard>` reativo |
| 3.4 Alerta limite faturamento | 🆕 | `apuracoes_fiscais.rbt12`, `empresas_fiscais.Code_regime_tributario` | `<LimiteFaturamentoBanner>` no `(auth)/layout.tsx`, função `getLimiteStatus` |
| 3.5 XML + PDF automáticos | 🚧 | `focus.baixarDanfe`, `focus.baixarXmlNfe` já existem | UI para download na rota `[id]/page.tsx`, cache opcional em Storage bucket `notas-arquivos` |

### §4. Apuração Automática de Impostos
| Feature | Status | Reusa | Falta |
|---|---|---|---|
| 4.1 Cálculo apuração (MEI+Simples) | ✅ (2026-05-29) | Motor puro reimplementado do n8n em TS testável: `lib/fiscal/{simples,rbt12,das-mei,apuracao}.ts` (+ testes), costura `receitas-source.ts` (lê `notas_fiscais`, opção b — fonte canônica é `notas_fiscais`), migration `0007` UNIQUE, `iniciarApuracaoAction`, wizard `/impostos/novo`. Corrige os 6 bugs do n8n. Smoke runtime OK (Simples). Spec `docs/superpowers/specs/2026-05-29-motor-apuracao-mei-simples-design.md` | **Atenção**: `receitas_fiscais` descontinuada (decisão final 2026-05-31, opção b): tabela órfã removida na migration `0014_drop_receitas_fiscais.sql`; apuração lê de `notas_fiscais`; anualização RBT12 não acionada (falta campo data início); DAS-MEI valores a confirmar p/ 2026. Cron mensal (PR 3.3) pendente |
| 4.2 Geração da guia (DAS-MEI via Serpro) | ✅ código (2026-05-29) · ❌ habilitação | `lib/clients/serpro.ts` (PGMEI/`GERARDASPDF21`, `emitirDasMei`, prod gated), `das-mei-parse.ts`, `serpro-env.ts`, `gerarDasMeiAction`, migration `0008`, botão "Gerar DAS". Spec `docs/superpowers/specs/2026-05-29-serpro-das-mei-design.md` | **Bloqueio externo**: app Serpro **não inscrito no Integra Contador Trial** → 403 900908 (não é bug). Produção exige cert mTLS + procuração (§8). Simples (PGDAS-D) em spec próprio |
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
| `<ClienteFormDialog>` | `ClienteFormDialog.tsx` | popup criar/editar cliente — referência de padrão. **Edit mode**: toggle PF/PJ oculto, tipo exibido como label read-only (não pode mudar na edição) |
| `<PerfilForm>` | `app/(auth)/conta/PerfilForm.tsx` | aba Perfil da /conta — nome editável (salva em `user_metadata.full_name`), alterar email inline (envia link de confirmação via Supabase), role read-only |
| `<AlterarSenhaForm>` | `app/(auth)/conta/AlterarSenhaForm.tsx` | aba Segurança — 3 campos: senha atual (re-autentica antes de trocar), nova senha, confirmar |
| `<DangerZone>` | `app/(auth)/conta/DangerZone.tsx` | seção "Zona de risco" — delete com `PopupConfirm` bloqueado até usuário digitar o próprio email; usa `deleteAccountAction` com service_role (cascade no banco) |
| `<ClientesListClient>` | `ClientesListClient.tsx` | tabela + busca + filtros — referência de padrão para listagens |
| `<CreateCompanyDialog>` | `CreateCompanyDialog.tsx` | onboarding empresa — referência de padrão para wizards; máscara CNPJ/CEP (`formatCnpj`/`formatCep`) + ViaCEP |
| `<DadosEmpresaForm>` | `app/(auth)/configuracoes/DadosEmpresaForm.tsx` | edição de empresa — modo leitura/edição (Editar → Salvar/Cancelar), CNPJ fixo, endereço (rua/cidade/estado) obrigatório; máscara CNPJ/CEP + botão Buscar (ViaCEP). CNPJ/CEP gravam só dígitos |
| `<RegimeTributarioForm>` | `app/(auth)/configuracoes/RegimeTributarioForm.tsx` | aba Regime tributário (PR 1.4) — dropdown CRT + faixa→anexo + Fator R; mesmo padrão de modo leitura/edição |
| `<NfseForm>` | `app/(auth)/configuracoes/NfseForm.tsx` | seção NFS-e — município resolvido do endereço (nome, UF, provedor, cancelamento via portal); credenciais de prefeitura (login/senha/token) **somente para provedores legados** — provedores Nacional não exibem campos nem botão Editar; sem toggle de ativação (disponibilidade ditada por `municipios_nfse.status_nfse`). **Focus 4**: virou seção da aba "Emissão fiscal" |
| `<CertificadoForm>` | `app/(auth)/configuracoes/CertificadoForm.tsx` | seção Certificado A1 (PR 1.6) — upload `.pfx`/`.p12` + senha (write-only); status "enviado em {data}"; botão Enviar/Substituir. **Focus 4**: virou seção da aba "Emissão fiscal" |
| `<EmissaoFiscalTab>` | `app/(auth)/configuracoes/EmissaoFiscalTab.tsx` | **Focus 4** — aba mesclada que substitui as abas "NFS-e" + "Certificado A1": 3 seções (Cert / NFS-e / Status na Focus) num único formulário |
| `<SaudeEmpresaTab>` | `app/(auth)/configuracoes/SaudeEmpresaTab.tsx` | **Focus 3** — aba "Diagnóstico". 4 grupos: Cidade credenciada (com badge `status_nfse` da Focus: verde/amarelo/vermelho), Certificado A1, SERPRO, Cadastro na Focus. Grupos com 2+ itens colapsáveis; roll-up `erro > pendente > ok`. **Focus 2.1**: renderiza `group.meta` abaixo dos itens |
| `<SyncFocusButton>` | `app/(auth)/configuracoes/SyncFocusButton.tsx` | **Focus 2.1** (renomeado de RetryFocusButton) — client island do botão "Sincronizar com Focus" no Diagnóstico; dispara `syncFocusEmpresaAction` (adaptativa: POST inicial se sem token, PUT se com token) via `useTransition` + toast |
| `<DashboardCard>` | `components/DashboardCard.tsx` | card de métrica do dashboard (title/Icon/value/subtitle/tone/action) — **PR 1.1** |
| `<PendingActionsList>` | `components/PendingActionsList.tsx` | lista "O que você precisa fazer" com severidade + CTA — **PR 1.1** |
| `<NotasFiscaisList>` | `app/(auth)/notas_fiscais/NotasFiscaisList.tsx` | listagem com 4 filtros + export CSV + linha clicável — **PR 1.2** (referência de listagem com filtros server-side) |

### 2.2 Server Actions prontas

| Action | Arquivo | Função |
|---|---|---|
| `loginAction` | `app/(public)/login/actions.ts` | Supabase signin |
| `signupAction` | `app/(public)/cadastro/actions.ts` | Supabase signup; envia `full_name` + `type` no metadata; trigger cria registro em `role_types` |
| `requestResetAction` + `updatePasswordAction` | `app/(public)/reset_pw/actions.ts` | Reset 2 telas |
| `updateNomeAction` + `updateEmailAction` + `updateSenhaAction` + `deleteAccountAction` | `app/(auth)/conta/actions.ts` | Conta: salva `full_name`; envia link de troca de email (com `emailRedirectTo`); troca senha (verifica atual via `signInWithPassword`); delete via `auth.admin.deleteUser` (service_role) + signOut + redirect |
| `createClienteAction` + `updateClienteAction` + `softDeleteClienteAction` + `lookupCnpjAction` | `app/(auth)/clientes/actions.ts` | CRUD cliente com dedup CPF/CNPJ; `lookupCnpjAction` consulta Focus p/ pré-preencher cliente PJ |
| `updateCompanyAction` + `upsertEmpresaFiscalAction` + `uploadCertificadoAction` + `syncFocusEmpresaAction` | `app/(auth)/configuracoes/actions.ts` | PATCH companies; upsert `empresas_fiscais` (PR 1.4); upload de certificado A1 → Storage + upsert `arquivos_auxiliares` + SERPRO best-effort (PR 1.6). **Focus 2.1**: `syncFocusEmpresaAction` adaptativa (POST `/v2/empresas` se sem token / PUT `/v2/empresas/:id` se com), chamada pelo botão "Sincronizar com Focus" no Diagnóstico. **Focus 2.2** (best-effort, não bloqueia save local): (a) `uploadCertificadoAction` envia PFX+senha pra Focus (via `atualizarEmpresaNaFocus` com `extras.certificado`) — só momento em que a senha está em memória; (b) `upsertEmpresaFiscalAction` envia login+senha prefeitura quando município é legado (via `extras.credenciaisPrefeitura`). Erros viram `warning` no return |
| `lookupCepAction` + `createCompanyAction` | `app/(auth)/onboarding/actions.ts` | ViaCEP + insert via `CompanyCreateSchema` (CNPJ validado por dígitos + endereço obrigatório). **Focus 1**: `CompanyCreateSchema` agora exige `Code_regime_tributario`; `createCompanyAction` insere `companies` → upsert `profiles.current_company` → insert `empresas_fiscais` (regime via `normalizeRegimePatch`) → **POST best-effort `/v2/empresas` na Focus** (helper `syncEmpresaNaFocus`). Falha da Focus não rejeita o cadastro — grava `companies.focus_status='erro'` + `focus_last_error` (exibido no painel Saúde, com botão de retry) |
| `exportNotasCsvAction` | `app/(auth)/notas_fiscais/actions.ts` | re-consulta notas com filtros e devolve CSV (BOM UTF-8, `;`) — **PR 1.2** |

> Funções server-side (não-actions): `getDashboardMetrics` + `getPendingActions` em `lib/dashboard/queries.ts` (**PR 1.1**, `import 'server-only'`); `resolveMunicipioNfse(supabase, municipio, uf)` em `lib/fiscal/municipio-nfse.server.ts` (**PR 1.5**); `syncEmpresaNaFocus(supabase, companyId)` em `lib/fiscal/focus-empresa-sync.ts` (**Focus 1/2.0** — POST + snapshot via GET); `atualizarEmpresaNaFocus(supabase, companyId, env, extras?)` em mesmo arquivo (**Focus 2.1/2.2** — PUT por `focus_empresa_id` numérico; `extras.certificado` injeta PFX base64+senha; `extras.credenciaisPrefeitura` injeta login+senha NFS-e; após PUT faz GET pra refresh de snapshot). `getSiteUrl()` em `lib/site-url.ts` (canônica via `NEXT_PUBLIC_SITE_URL` — usada por links de email, evita Host Header Injection). Helpers puros: `lib/fiscal/regime.ts` (PR 1.4), `lib/fiscal/municipio-nfse.ts` (PR 1.5), `lib/fiscal/certificado.ts` (PR 1.6), `lib/fiscal/focus-empresa-payload.ts` (**Focus 1** — `buildFocusEmpresaPayload` p/ POST inicial), `lib/fiscal/focus-empresa-update-payload.ts` (**Focus 2.1/2.2** — `buildFocusEmpresaUpdatePayload` retorna **payload base puro** sem cert nem credenciais; helpers `withCertificado` / `withCredenciaisPrefeitura` injetam quando o caller tem os secrets em memória), `lib/fiscal/saude-empresa.ts` (**Focus 3** — `buildSaudeGroups(state)` retorna 4 grupos com roll-up + `detectFocusDrift` p/ comparar updated_at locais vs focus_sync_em), `lib/fiscal/municipios-nfsen-nacional.ts` (**Focus 3** — lista hardcoded; Londrina/PR desde 01/01/2026) e `lib/format/masks.ts`.

### 2.3 Clientes API (`src/lib/clients/`)

Todos têm `import 'server-only'` — só chamar de server actions ou route handlers.

| Cliente | Métodos exportados | Notas |
|---|---|---|
| `focus` (`focus-nfe.ts`) | `consultarCnpj`, `criarEmpresa` (Focus 1, POST `/v2/empresas` na revenda — sempre `api.focusnfe.com.br`), `consultarEmpresa(id)` (Focus 2.0, GET `/v2/empresas/:id`), `atualizarEmpresa(id, payload, env)` (**Focus 2.1**, PUT `/v2/empresas/:id` — id NUMÉRICO interno, não CNPJ — força base prod; aceita `arquivo_certificado_base64`+`senha_certificado` opcionais p/ Focus 2.2), `emitirNfe/Nfce/Nfse`, `consultarStatusNfe/Nfce/Nfse`, `baixarDanfe`, `baixarXmlNfe`, `cancelarNfe/Nfce/Nfse` (valida `justificativa.length ≥ 15`), `generateRef(empresaId)` | retry exponencial em 502/503/504 |
| `serpro` (`serpro.ts`) | `transmitirDeclaracao`, `emitirDas`, `consultarDeclaracao`, helper `buildEnvelope`, `normalizeCnpj`, `_resetSerproTokenCache` (teste). Constantes `SERPRO_SERVICES`, `Tipo`, `TRIBUTO_CODIGOS` | cache de token module-scoped |
| `n8n` (`n8n.ts`) | `consolidarReceitas`, `calcularRbt12`, `consultaDasMei`, `postAutenticacao`, `uploadCertificado` | HMAC SHA-256 em todo body via `N8N_WEBHOOK_SECRET` |
| `supabase-storage` (`supabase-storage.ts`) | `uploadCertificado(file, fileName, companyId)`, `removeCertificado(path)`, `fileToBase64(File)` | usa `service_role`, bucket `company-certificates` |
| `focus-municipios` (`focus-municipios.ts`) | `fetchAllMunicipiosFocus()` | pagina `GET /v2/municipios` (5.571 itens, 100/page via `x-total-count`); `server-only`; usado pelo cron |
| `_endpoints` (`_endpoints.ts`) | `ENDPOINTS` (catálogo bruto dos 81 endpoints do Bubble) | referência só |

### 2.4 Schema Supabase

13 tabelas com RLS + triggers + RPCs:
- `profiles` (1:1 auth.users), `companies`, `clientes`, `empresas_fiscais`, `notas_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais`, `guias_fiscais`, `arquivos_auxiliares`, `municipios_nfse`, `honorarios`, `abertura_empresas`, `aux_produtos`
- **`municipios_nfse`** recriada em `0016_rebuild_municipios_nfse.sql` (2026-06-02): schema alinhado à Focus API — `codigo_ibge` (UNIQUE), `nfse_habilitada`, `status_nfse`, `provedor_nfse`, `possui_cancelamento_nfse`, `possui_ambiente_homologacao_nfse`, `focus_synced_at`, etc. Populada via cron `GET /api/cron/sync-municipios`. Spec em `docs/superpowers/specs/2026-06-02-municipios-nfse-sync-design.md`.
- RPC: `add_company_to_profile(p_user_id, p_company_id)`
- Trigger: auto-criar profile no signup (`handle_new_user`)
- Trigger: `updated_at` automático em todas as tabelas com a coluna
- Dedup índice `clientes_owner_doc_uniq` (PRD §15.2)
- Dedup índice `companies_owner_cnpj_uniq`
- Revoke `select(cert_password)` para roles `authenticated` e `anon`

> **RLS — estado real (2026-05-29): ✅ LIGADA.** O `0001` definia RLS mas o banco real estava sem. Sequência aplicada: `0009_disable_rls` (rollback do toggle manual sem policies) → `0010_rls_policies` (re-liga as 13 tabelas com policies corretas; helper `user_owns_company`) → `0011_arquivos_auxiliares_fk` (FK `company_id` em `arquivos_auxiliares` + grant `role_types` + policies `abertura_empresas` por `user_id`). Isolamento provado por `tests/rls-isolation.spec.ts` (RED→GREEN). Detalhes em `DB-DIVERGENCIA.md §D` e `balu-next/docs/{rls-test,saneamento}-results-2026-05-29.md`.

### 2.5 Tipos TypeScript (`src/types/`)

- `database.ts` — `Tables` nominais + `Row<T>` helper. `Database = any` por design (sem CLI Supabase).
- `enums.ts` — 26 option sets do Bubble como const arrays
- `zod.ts` — `ClienteSchema`, `CompanySchema` (endereço rua/número/cidade/estado obrigatório; número com `sem_numero`), `CompanyCreateSchema` (CNPJ por dígitos verificadores), `EmpresaFiscalSchema` (regime + NFS-e), `HonorarioSchema`. Validador em `src/lib/validators/cnpj.ts` (`isValidCnpj`)

### 2.6 Rota `/conta` (2026-06-02)

| Aba | Conteúdo | Status |
|---|---|---|
| Perfil | Nome de exibição (editável), email (troca via link), role (read-only) | ✅ |
| Segurança | Alterar senha (exige senha atual), Zona de risco (delete com confirmação por email) | ✅ |

**Auth callback** (`app/auth/callback/route.ts`) — atualizado para tratar dois fluxos:
- `code` (PKCE): reset de senha, convites → `exchangeCodeForSession`
- `token_hash + type` (OTP): troca de email, confirmação de cadastro → `verifyOtp`

**`src/lib/supabase/admin.ts`** — `createAdminClient()` com service_role; usado exclusivamente em server actions para operações privilegiadas (deleteUser).

**Menu:** item "Conta" com `UserCircle` visível para todos os roles. `layout.tsx` prefere `user_metadata.full_name` no `userName`.

**Spec:** `docs/superpowers/specs/2026-06-02-conta-page-design.md`

---

### 2.7 Crons Vercel (`vercel.json`)

| Rota | Schedule | Função |
|---|---|---|
| `GET /api/cron/sync-municipios` | `0 0 * * *` (diário, 00:00 UTC) | Pagina `GET /v2/municipios` da Focus e faz upsert de todos os 5.571 municípios em `municipios_nfse` (chunks de 500). Supabase Edge Function — auth via service_role key (JWT verification padrão). Executada manualmente na primeira carga (2026-06-02). |

### 2.8 Configuração / Tooling

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
