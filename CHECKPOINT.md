# CHECKPOINT — Balu

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-07-24 (sessão 5 — Master PRD + specs/planos Blocos 1 e 2; **Bloco 1 (motor de obrigações/notificações) IMPLEMENTADO** em `feat/bloco-1-obrigacoes`, smoke test manual OK, merge para main)

---

## Sessão 5 (2026-07-24) — Master PRD + Bloco 1 (motor de obrigações/notificações)

**Planejamento cruzado (`Direcionamento/planejamento.pdf` × estado atual) → Master PRD + specs/planos.** Via /brainstorming. Entregues (também copiados p/ `D:\balu-app-v2\Direcionamento\`):
- **`docs/novas specs e prd/PRD-MASTER-Balu-2026-07-24.md`** — 8 pilares × estado, decomposto em **7 blocos**: (1) Motor Obrigações/Notificações 🟢 buildável-já; (2) Abertura completa 🟢; (3) DASN/DEFIS assistidas 🟢; (4) Billing Asaas 🔒; (5) Produção Fiscal 🔒; (6) WhatsApp/IA 🔒; (7) Domínio/SLA/Conciliação 🔒. (🔒 = trava em credencial externa do Michel.) Decisões: PIX via WhatsApp + conciliação + domínio + SLA IN de escopo; contrato social por minuta/template; WhatsApp = **Envia.Click (Chatwoot)**; DEFIS = fluxo assistido completo; IA = **Claude/Anthropic**.
- **Specs** (`docs/superpowers/specs/`): `2026-07-24-bloco-1-motor-obrigacoes-notificacoes-design.md`, `2026-07-24-bloco-2-abertura-digital-completa-design.md`.
- **Planos** (`docs/superpowers/plans/`): Bloco 1 (12 tasks) e Bloco 2 (7 tasks).

**Bloco 1 IMPLEMENTADO (branch `feat/bloco-1-obrigacoes`, subagent-driven, 12 tasks) — mergeado para main.** O que entrou:
- **Migration 0045** (`notifications` + `notification_preferences`, RLS `owner_user_id = auth.uid()`, índice único idempotência `(owner_user_id, chave)`, publicação realtime guardada) e **0045b** (RPCs). Ambas aplicadas via runner node+pg.
- **RPC `materializar_obrigacoes(p_hoje date)`** — gera notificações de DAS, cert A1, PGDAS-D, DASN-SIMEI, honorário. **RPC `notificacoes_pendentes_email(p_limite int)`** — junta `auth.users` + contabilidades p/ co-branding do e-mail. Ambas `SECURITY DEFINER` com `REVOKE ALL FROM public` + `GRANT EXECUTE TO service_role` (padrão 0034). **Provada idempotente** no banco (2ª execução = 0 duplicatas).
- **Cron diário** `0 11 * * *` (`api/cron/obrigacoes/route.ts` + `vercel.json`, auth Bearer `CRON_SECRET`): materializa + envia e-mail (marca `enviada_email_em` só quando `r.ok`).
- **UI:** sino com badge + dropdown + realtime (`SinoNotificacoes.tsx` no `MenuLateral`), página `/notificacoes` (marcar lida / todas lidas), aba **Conta → Notificações** com opt-out de e-mail por tipo (`PreferenciasNotificacao.tsx`). Card de pendência de cert A1 no dashboard (`getPendingActions`).
- **3 bugs pegos por review adversarial antes do merge:** (1) `code IN (1,2)` em coluna varchar → runtime error no 1º cron (corrigido p/ `'1'/'2'/'4'`); (2) SECURITY — `notificacoes_pendentes_email` sem filtro de auth deixava anon ler e-mails de todos (corrigido com REVOKE/GRANT); (3) chaves de idempotência PGDAS/DASN sem `company_id` → dono multi-empresa perdia notificação (corrigido).
- **Bug pego no smoke test manual:** aba de preferências — checkbox `defaultChecked` revertia ao salvar (Server Action não revalida rota sozinha). Corrigido com `revalidatePath('/conta')` (`cd13457`). Persistência já funcionava; era só UI. **Smoke test manual: OK.**
- **Follow-ups não-bloqueantes documentados** (do review final): cadência de bucket PGDAS/DASN diverge da spec §5; badge conta só entre os 15 carregados; `getSiteUrl` no cron; `marcarNotificacaoLidaAction` não fiada ao clique; blocos DEFIS/limite_faturamento na RPC (TODO).

**Próximo:** Bloco 2 (abertura digital completa) — plano pronto em `docs/superpowers/plans/2026-07-24-bloco-2-...md`, depende do Bloco 1 (usa `abertura_etapa` nas notificações).

---

## Sessão 4 (2026-07-23) — abertura lado-contador + auditoria cards 3/5

**Abertura de empresa (lado operador/contador) — CONSTRUÍDA e no ar.** O app já coletava dados (fluxo do empresário), mas o lado do contador operar a abertura estava faltando. Entregue e deployado:
- **Migration 0044** aplicada (runner node+pg): `abertura_empresas.user_id` agora nullable + 2 SELECT policies de contador (`abertura_empresas_select_contador`, `abertura_alteracoes_select_contador`, escopadas por carteira via `minha_contabilidade()`).
- `lib/abertura/form.ts` (parse compartilhado), `lib/abertura/etapas.ts` (7 etapas: recebido→em_analise→pendente_documentos→enviado_receita→enviado_junta→enviado_prefeitura→concluido, +cancelado).
- `contador/actions.ts::criarAberturaClienteAction` — abertura nasce na carteira sem dono (`user_id null`, company stub `status='em_abertura'`), não mexe no `current_company`.
- Fila `contador/aberturas/page.tsx` (botão **Abrir empresa** no header → `AbrirEmpresaButton.tsx` abre o wizard em modal; card com a lista; empty-state com prédio `Building2` + "Ainda não há solicitações de abertura") + detalhe/operação `[aberturaId]/` (`DetalheAbertura.tsx`: timeline, avançar etapa, concluir com CNPJ, aprovar/recusar alterações). Actions em `aberturas/actions.ts` (guard anti-IDOR `aberturaDaCarteira`). Item **Aberturas** (ícone FilePlus) no menu do contador.
- Menu do **AdminBalu** completado com seção de oversight própria (`lib/admin/guard.ts`, `lib/admin/users.ts`, telas `admin/`, `admin/empresas`, `admin/usuarios`; item `/` escondido pro admin). `gate-context.ts` redireciona adminbalu→/admin.
- Último commit desta frente: `aff5fc9` (pushed). Auto-deploy ok.

**Auditoria: cards 3 e 5 do HTML do Michel × app de hoje** (`Direcionamento/devolutiva-dev-preenchido.html`, respostas reais na função `prefill()`, ~L723-775). Cruzamento feito por 2 subagentes Explore.

**Card 3 (Painel do Contador & marca) → ✅ ALINHADO.** Michel: painel essencial p/ lançar (3.1); mostrar lista de clientes + irregulares + honorários não pagos + faturamento + resumo financeiro (3.2) — **os 5 EXISTEM** (`PainelClientes.tsx`, RPCs `painel_contador()`/`resumo_escritorio()`, `lib/fiscal/semaforo.ts`). 3.3 "só visualizar" → **bate exatamente** (RLS dá só SELECT nos dados fiscais do cliente, drill-down zero-botões). 3.4 white-label logo+nome+WhatsApp → EXISTE (co-branding no app do cliente); **e-mail branded só no nome do remetente, não no domínio** (⚠️ depende de verificar domínio no Resend). 3.5 vários escritórios → multitenant é a espinha dorsal. Michel NÃO pediu cores/tema nem domínio próprio → ausência OK.

**Card 5 (Impostos/declarações/emissão "valendo") → ⚠️ 2 TRAVAS de lançamento.** Fundação toda construída; faltam 2 chaves de produção que ele marcou "essencial":
1. **Transmissão oficial PGDAS-D** (5.1 "app transmite"): código real existe (`lib/fiscal/serpro-pgdasd.ts::transmitirPgdasd`) mas só é chamado com `indicadorTransmissao:false` (dry-run) em `impostos/actions.ts::previewDeclaracaoAction` (L560-580). SERPRO/Integra Contador integrado e robusto (mTLS+procurador). DASN-SIMEI (MEI) só consulta — SERPRO ainda não expõe transmissão na API.
2. **Emissão de nota em produção** (5.4 "essencial"): `notas_fiscais/actions.ts` tem `env: FocusEnv = 'hom'` **hardcoded** em emitirNotaAction (L281), emitirNfeAction (L670), emitirNfceAction (L781) e cancelarNotaAction (L452). Flag `emitir_nota_homol_antes_producao` existe (0001) mas é ignorada (`_flagIgnoradaPorEnquanto`). Provedor = Focus NFe (`lib/clients/focus-nfe.ts`, suporta 'prod'/'hom'). Regimes MEI+Simples calculam (`apuracao.ts`); LP/LR não (`RegimeNaoSuportadoError`).
   - **5.6 eSocial/SPED marcados pelo Michel = provável engano** (o próprio HTML sinaliza que são de LP/LR, não do público MEI/Simples) → confirmar antes de virar escopo. 5.7 folha "depois" ✅ (só há input p/ Fator R). 5.5 MEI+Simples ✅.

**DESTRAVAMENTO DO CARD 5 — PLANO (aprovado pelo usuário "destrave o card 5"; investigação feita, ZERO edição de código ainda).** Estratégia: destravar **atrás de flag por empresa, default seguro `hom`** — nada muda em produção até virar uma empresa explicitamente. Passos previstos:
- **(a) Nova coluna `empresas_fiscais.ambiente_atual` `text default 'hom'` (`'hom'|'prod'`)** — migration 0045 (usuário roda via runner). Substitui a leitura de `env` fixo.
- **(b) Token de produção da Focus:** hoje `companies.focus_token` guarda só o `token_homologacao` (ver `focus-empresa-sync.ts` L97: `resp.token_homologacao ?? resp.token_producao`). Para `prod` real precisa do `token_producao` — decidir: coluna nova `companies.focus_token_producao` capturada no POST /v2/empresas, OU trocar a seleção. **PENDÊNCIA: a empresa precisa de cert A1 + habilita_*_producao na Focus** (contrato Focus produção é pendência externa do Michel — ver lista abaixo). Sem isso o `prod` retorna 401/não-habilitado; a flag existe mas só funciona de fato quando a Focus liberar produção.
- **(c) notas_fiscais/actions.ts:** ler `ambiente_atual` da empresa; `env = ambiente_atual === 'prod' ? 'prod' : 'hom'`; escolher token (`focus_token_producao` p/ prod). Aplicar nos 4 pontos (emitir NFSe/NFe/NFCe + cancelar) e no polling `atualizarStatusNotaAction` (L354-360, hoje 'hom' fixo). Manter guards de habilitação.
- **(d) Declaração: nova `transmitirDeclaracaoAction(competencia)`** em `impostos/actions.ts` que chama `transmitirPgdasd(..., {indicadorTransmissao:true})`, gated pela mesma flag `ambiente_atual==='prod'` + confirmação explícita na UI, e **persiste o resultado em `declaracoes_fiscais`** (hoje o dry-run não grava). Botão em `impostos/SecaoDeclaracao.tsx` (só aparece em prod; hoje o texto diz "Fase 2: botão abre dry-run/prévia"). DASN-SIMEI segue só-consulta (limite da SERPRO).
- **(e) Verificar:** `rtk proxy npx vitest run` + `rtk proxy npx next build` a partir de `app/`. Testes de emissão que assumem 'hom' podem precisar de ajuste.
- **Arquivos já lidos nesta sessão (não re-investigar):** `notas_fiscais/actions.ts` (completo), `focus-nfe.ts` (completo), `serpro-pgdasd.ts` (completo), `impostos/actions.ts` L520-614, `focus-empresa-sync.ts` (completo). Falta ler antes de editar: `impostos/SecaoDeclaracao.tsx` e onde `declaracoes_fiscais` é gravada (consultarDeclaracoesAction).
- **RISCO:** virar `prod` = emissão real na SEFAZ + transmissão real na Receita (irreversível/consequência legal). Por isso default `hom` e flip só por empresa, explícito. NÃO virar nenhuma empresa pra `prod` sem o Michel confirmar cert A1 + contrato Focus produção + procuração SERPRO daquele CNPJ.

---

## Sessão 3 (2026-07-23) — QA manual em produção + fixes

**Auto-deploy Git↔Vercel:** ATIVO e testado — cada push na `main` deploya produção sozinho (~1 min).

**AdminBalu de produção criado:** `eufacopublicidade+admin@gmail.com` (via API admin + SQL). Contas de teste em prod: `testeefluxodeautomacao@gmail.com` (contador, escritório "Escritório Teste Balu" aprovado), `walacesssantos@gmail.com` (empresário, dona da empresa dev.ide), `eufacopublicidade+e2e@gmail.com` (E2E). Cadastros/aceites confirmados manualmente via API admin (Redirect URLs do Supabase ainda pendentes → links de e-mail caem em localhost).

**7 bugs de UX/produto corrigidos** (todos com push→deploy, exceto onde nota):
1. `2513c1a`+`3868866` — **loop de redirect pós-login (tela preta)**: gate de aceite LGPD dependia de header `x-pathname` do middleware que não chega nas navegações RSC na Vercel → loop `/aceite→/aceite`. Gates movidos p/ route group `(auth)/(gated)/` (todas as páginas menos /aceite); middleware removido; ordem aceite→onboarding corrigida.
2. `33951b0` — menu do empresário (Clientes/Notas/Impostos/Honorários/Config) aparecia p/ contador/admin sem empresa → beco "Nenhuma empresa selecionada". Marcados `precisaEmpresa` e filtrados.
3. `ee80f87` — página `/contador/honorarios` estava **órfã** (sem link no menu). Link adicionado ao NAV do contador.
4. `c3935f8` — limite do logo do escritório 1MB→**4MB** (teto de body da Vercel; 500MB pedido é inviável).
5. `937118e` — honorário rejeitava valor com separador de milhar (`1.200,00`). Novo helper `normalizarValorBRL` em `lib/format/dinheiro.ts` + `z.preprocess` no `HonorarioV2Schema`; exige >0.
6. `917b7a3` — **furo: `aceitar_convite` não conferia e-mail** → contador (sessão ativa) abriu o link do convite de cliente e assumiu a empresa do próprio cliente. **Migration 0043** aplicada no banco (trava: e-mail da conta logada = `convites.email`, case-insensitive; erro `EMAIL_NAO_CONFERE`). Vale p/ link vazado também.
7. Gap documentado: `role_types` **sem UNIQUE(user_id)** (permitiu duplicata no insert manual do admin) — candidata a migration futura.

**Migrations aplicadas em prod nesta sessão:** 0043 (via runner node+pg no scratchpad; classifier bloqueia MCP/escrita, usuário roda os scripts com `! node ...`).

**Pendências reabertas:** (a) Supabase Auth Redirect URLs (`https://balu-contabil.vercel.app/**` + Site URL) — trava links de e-mail; (b) **Resend: chave configurada** — `RESEND_API_KEY` + `EMAIL_FROM` postos no `.env.local` (corrigido de `CHAVE_API_RESENDE`, nome que o código não lia) e no Vercel/Production (pendente redeploy p/ valer). **Bloqueio restante é DNS do usuário:** conta Resend (`contato@excluvia.com.br`) sem domínio verificado → modo teste, só entrega p/ `contato@excluvia.com.br`; `EMAIL_FROM` provisório = `Balu <onboarding@resend.dev>`. Ao verificar domínio em resend.com/domains, trocar `EMAIL_FROM` p/ remetente do domínio (local + Vercel). Fluxo de convite funciona pelo **link copiável** na tela enquanto isso.

**Não confirmado ainda:** co-branding (logo/nome do escritório na sidebar do empresário) em produção.

**Rodada de code-review + systematic-debugging (fim da sessão 3):** review dos commits de hoje achou 5 pontos; 3 corrigidos, 2 rejeitados com fundamento. (a) `(gated)/layout` refazia `getUser`+`profiles`+`role_types` que o pai já rodava (custo do split em route-group) → novo `lib/auth/gate-context.ts` memoizado com React `cache()`, usado pelos dois layouts (dedup por request; redirects seguem em cada layout). (b) `.replace(',', '.')` morto nas actions de honorário removido (schema já normaliza a ponto). Rejeitados: `"10.999"→10999` é leitura pt-BR correta; `valor>0` é validação melhor (V2, sem dado legado 0). Verificado: `tsc` limpo + **494/494** testes.

---

## Onde estamos

**Fase:** **Bloco A e Bloco E concluídos em `main`; código no GitHub e app no ar na Vercel.** Próximo passo de produto: **P0.2 — motor de obrigações/notificações** (buildável já, sem depender do Michel — ver `docs/novas specs e prd/`). Bloco D/B/C dependem de credenciais externas do Michel. Fluxo por bloco: /brainstorming → spec → writing-plans → execução.

## Infraestrutura (GitHub + Vercel) — configurada em 2026-07-22

**GitHub:** repo **`gestao-hub/balu-contabil`** (⚠️ **público**). `main` + tags (`pre-preview-bloco-a`, `pre-bloco-e`) + as 5 branches antigas empurradas. Remote `origin` já configurado; **push autentica como `grupoideapps`** (colaborador, e-mail contato@grupoidecomunicacao.com). Auditoria de segredos feita antes do push: histórico limpo. `main` = `origin/main`.

**Vercel:** projeto **`balu-contabil`** no scope **`gestao-9664s-projects`** (conta do luan@grupoidecomunicacao.com — NÃO usar tryia-social nem a Vercel do grupoideapps). **App no ar: https://balu-contabil.vercel.app** (deploy de produção via CLI, aponta pro **Supabase de PRODUÇÃO**). Config: 11 env vars em prod+preview (Supabase, Focus, SERPRO, CERT_ENC_KEY, CRON_SECRET, FOCUS_WEBHOOK_SECRET, NEXT_PUBLIC_SITE_URL=https://balu-contabil.vercel.app), `rootDirectory=app`, framework nextjs. Deploy manual: `cd app && npx vercel deploy --prod --scope gestao-9664s-projects`. (Domínio `app.balu.com.br` foi configurado e depois **revertido** a pedido do usuário — projeto só tem `balu-contabil.vercel.app`.)

**Pendências de infra:**
1. ✅ **Auto-deploy (Git integration): ATIVO e testado em 2026-07-23** — usuário conectou o OAuth no navegador; push `accd874` na main disparou build automático (user `gestao-9664`), Ready em 58s, aliased para balu-contabil.vercel.app, smoke test ok (307→/login). Cada push na main deploya produção sozinho.
2. **Supabase Auth:** adicionar `https://balu-contabil.vercel.app/**` em Authentication → URL Configuration → Redirect URLs (senão cadastro/reset/convite por e-mail não redirecionam).
3. **Rotação da `SUPABASE_SERVICE_ROLE_KEY`** (recomendação pendente de incidentes anteriores; a chave também está agora nas env vars da Vercel — legítimo, mas se quiser zero risco residual, rotacionar).

**Bloco E — hardening + LGPD (COMPLETO, direto em `main`, sem branch — repo local):** 16 tasks + 2 rodadas de code-review adversarial com fixes verificados no banco vivo.
- Migrations **0037–0042** aplicadas: rate_limit, audit_log, documento_versoes/aceites, anonimizar_usuario (+ correções), triggers de validação.
- Entregue: rate-limiting (login/cadastro/convite/reset/webhook), anti-SSRF no download (allowlist S3 + redirect:manual), anti-IDOR clientes, webhook Focus com segredo constant-time (`FOCUS_WEBHOOK_SECRET`), cifra AES-256-GCM das credenciais NFS-e, aceite versionado de termos/política + gate de re-aceite (`assertAceitesEmDia` nas ações de escrita), export de dados do titular, **exclusão = anonimiza + retém fiscal + bane login (nunca deleta auth.user — FKs são CASCADE)**, trilha de auditoria, minutas jurídicas (política/termos v1.0 seedadas, DPO placeholder), inventário de dados.
- **Code review (2 rodadas) — todos os achados corrigidos e verificados:** escalação AdminBalu via role_types (0036); PGDAS competência YYYY-MM×YYYYMM; open-redirect TAB/CR/LF no safeNext; fuso BRT; SSRF por redirect-follow; anonimização incompleta (companies/empresas_fiscais/cert/**abertura CPF-RG-nome-mãe**); **regressão que eu introduzi** (0041 perdeu `contabilidade_id=NULL`, corrigida na 0042); aceites auto-fabricáveis (trigger); rate-limit case-splitting. Anonimização **provada end-to-end** no banco (nota retida, PII zerada, abertura apagada, rollback limpo).
- Verificação final: typecheck 0 · vitest **490** · build limpo · Playwright RLS 17/17.
- **Pendências de go-live (não bloqueiam código):** revisão jurídica das minutas + nome/e-mail do DPO + razão/CNPJ do controlador; definir `FOCUS_WEBHOOK_SECRET` na URL de callback da Focus; allowlist de IP da Focus no edge; rotação da service_role.
- **Itens menores documentados (aceitos):** `decifrarCampo` sem uso em runtime hoje (landmine se alguém ler credencial NFS-e do banco no futuro — tem que decifrar); `deleteAccountAction` não é atômica entre RPC e ban do auth (retorna erro se falhar, sem retry); `signOut` não revoga sessões de outros dispositivos (JWT expira naturalmente); entidades do contador (contabilidades) não anonimizadas (identidade de negócio).

**Backup/reversão do Bloco A:** tag `pre-preview-bloco-a` (f1c3f21); main pré-merge estava em `78dd189`. Reverter dados do teste: `scratchpad/reverter-preview.sql` + `docs/reference/RESTORE-POINT-preview-2026-07-22.md`.

**Backup/reversão do Bloco A:** tag `pre-preview-bloco-a` (f1c3f21); main pré-merge estava em `78dd189`. Reverter dados do teste: `scratchpad/reverter-preview.sql` + `docs/reference/RESTORE-POINT-preview-2026-07-22.md`.

**Preview Vercel:** NÃO subido (adiado pelo usuário). Não há projeto Vercel do balu em nenhuma scope da CLI logada (luan-4913: times ide-apps, tryia-social). `app/vercel.json` só tem crons — não linka projeto. Ao retomar o preview: precisa definir a conta/scope (tryia-social foi descartada pelo usuário) e as env vars vão do `app/.env.local` (menos SUPABASE_PASSWORD; NEXT_PUBLIC_SITE_URL = URL do preview). O deploy apontará para o Supabase de PRODUÇÃO (único que existe).

**Bloco A — progresso (22/07, sessão 2):**
- ✅ Tasks 1–5: migrations 0030–0034 escritas, commitadas e **aplicadas no banco real** com verificação (runner node+pg no scratchpad lendo `SUPABASE_PASSWORD` do `app/.env.local` — MCP Supabase rejeitado pelo usuário; ver memória `balu-migrations-e-env`).
- ✅ Task 6: tipos TS + Zod + helpers dinheiro (`64cc1c7`).
- ✅ Task 7: `lib/fiscal/semaforo.ts` TDD 10/10 (`ed231ab`).
- ✅ Task 8: tetos de `parametros_fiscais` com fallback (`d8cd22c`).
- ✅ Task 9: guards contador + client email (`1d1db91`) — ⚠️ incidente: `.env.example` no disco era cópia do `.env.local` com segredos reais e foi commitado por engano; commit emendado com template sanitizado (sem remote, nada vazou; considerar rotacionar SERVICE_ROLE_KEY por cautela).
- ✅ Task 10: cadastro contabilidade + aguardando (`9009cef`).
- ✅ Task 11: admin aprovação + gate do layout isentando `adminbalu`/`contador` do onboarding (`ee9513a`) — emenda ao plano registrada.
- ✅ Task 12: convites (`73817ab` + fix `01b8695` — revisão pegou open-redirect `\`, HTML injection em e-mails, checagem de dono, `next` no signup; tudo corrigido).
- ✅ Task 13: painel do contador com semáforo (`672a882`).
- ✅ Task 14: drill-down read-only com guard extra de escopo (`9f6fe0b`).
- ✅ Task 15: cliente pelo contador + refactor `posProcessarNovaEmpresa` (`c9a4f2a` + fix normCnpj `37e50bb`).
- ✅ Task 16: honorários v2 + visão do empresário (`b7ee53a`) — FK do join verificado no banco.
- ✅ Task 17: equipe (`acb4a03`).
- ✅ Task 18: white-label + co-branding + desvincular (`65783f5` + menu `29eb854`); bucket `branding` criado no banco.
- ✅ Task 19: cron honorários recorrentes (`ba51b49`).
- ✅ Task 20: **testes de RLS 8/8 verdes** (`206c46e`) — o teste pegou recursão infinita (42P17) nas policies da 0030; corrigida pela **migration 0035** (`ae8426f`, helper `minha_contabilidade_membro()` SECURITY DEFINER), aplicada no banco.
- ✅ Task 21: E2E da jornada 9/9 verde (`6072b20`, inclui fix de upsert de profiles no aceite). Verificação final: typecheck 0 erros · vitest 471/0 · build limpo · Playwright 35/36 (única falha restante: `rls-isolation.spec.ts`, conta externa hardcoded `allanvalle@outlook.com` com senha inválida — genuinamente pré-existente). A "outra falha pré-existente" apontada pelo subagente (`02-cadastro`, hydration #418) era na verdade **regressão da Task 12** — provada por bisect manual e corrigida em `adb4e0e` (useQueryParam pós-mount).

**BLOCO A COMPLETO — 21/21 tasks. Critério de merge (RLS verde) atendido.**

**Code review + systematic debugging (22/07, sessão 2):** 4 revisores (segurança, correção, SQL, UI/mocks) + verificação no banco vivo. UI limpa: zero mocks, zero botões mortos. Achados corrigidos e **verificados**:
- **Migration 0036** (`550064f`): (a) CRÍTICO — qualquer autenticado podia se auto-promover a `AdminBalu` via `role_types` (sem trigger/constraint) — provado explorável e corrigido (trigger com `current_user`/SECURITY INVOKER; atacante bloqueado, service_role liberado — testado); (b) CRÍTICO — semáforo comparava competência `YYYY-MM` mas app grava `YYYYMM` → todo Simples ficava vermelho pra sempre — provado com dados reais e corrigido; (c) `aceitar_convite` queimava convite de membro sem vincular (usuário já em outro escritório); (d) convites exigem escritório aprovado + trigger anti-vazamento de company_id; cert/guias-erro/DASN na RPC.
- **App** (`a477b90`): open-redirect por TAB/CR/LF no `safeNext` (+teste); fuso BRT em statusHonorario/semaforo/marcar-pago (novo `tempo-brt`, +testes de fronteira); erro do profiles-upsert propagado no aceite; CNAE sync disparado no aceite (antes empresa do contador ficava sem CNAE); SVG recusado no upload de logo; **dead-end de UI corrigido** — `/contador` sempre visível pro contador (caminho até o cadastro).
- Não alterado (decisão registrada): compare do cron secret segue `!==` como o cron `sync-municipios` existente (risco timing marginal); policy `apuracoes_select_contador` fica (superfície morta inócua).
- Verificação final: typecheck 0 · vitest **478/0** · build limpo · **RLS 8/8 reconfirmado** após a 0036.

**Falta: decisão de merge para main.**

**Correções ao plano descobertas na execução:**
- `arquivos_auxiliares` usa `company_id` (não `unique_id_empresa`) — plano corrigido, 0033 ajustada.
- Papel `contador` também precisava de isenção no gate `/onboarding` (Task 11 cobriu).
- Policies da 0030 recursavam (42P17) — 0035 corrige (padrão SECURITY DEFINER).

**Gaps conhecidos (aceitos para o lançamento, revisar depois):**
- CNAEs de empresa criada pelo contador ficam vazios até o cliente aceitar o convite (`company_cnaes.owner_user_id NOT NULL`) — sem backfill automático no aceite.
- Convidado NOVO que cria conta pelo botão do convite: `next` só funciona no fluxo auto-confirm; com confirmação por e-mail, ele volta pelo link do convite no e-mail original.
- Logo antigo fica órfão no bucket ao trocar de extensão (higiene de storage, sem impacto).

**Pendências desta fase:** conceder `AdminBalu` ao usuário do Michel (falta o UUID — Step 4 da Task 11; em 2026-07-23 foi criado o AdminBalu do Walace em produção — `eufacopublicidade+admin@gmail.com`, via API admin + SQL, senha temporária fora do repo). ⚠️ Gap descoberto: `role_types` **não tem UNIQUE(user_id)** — o insert manual duplicou a linha e o `.maybeSingle()` do layout falharia; duplicata removida, mas vale migration com unique index (candidata a 0043); `docs/reference/db_atual.sql` regenerado nesta sessão (conferir commit); decidir merge da branch após E2E verde.

O código do app está congelado desde 15/06/2026 (commit `52a0844`). Em 22/07 foi feita a análise cruzada dos documentos de direcionamento (`Direcionamento/`: batimento, comparativo Contabilizei e devolutiva do Michel) contra o código real, e produzidos os documentos abaixo.

## Documentos-guia (ordem de leitura para retomar contexto)

1. `docs/product/PRD-Balu-V2.md` — **escopo de lançamento**: visão, 5 blocos (A–E), enquadramento legal consolidado, dependências externas, critérios de aceite propostos, pontos a realinhar com o Michel.
2. `docs/product/2026-07-22-bloco-a-multitenant-contador-design.md` — spec aprovada do Bloco A (movida de specs/ por decisão do usuário em 22/07; specs dos próximos blocos seguem em `docs/superpowers/specs/`).
3. `docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md` — **plano de implementação do Bloco A (21 tasks, próximo passo)**.
4. `docs/investigations/BATIMENTO-PLANEJAMENTO-VERDE.md` — o que está entregue vs. planejado (jun/2026, ainda válido).
5. `Direcionamento/devolutiva-dev-preenchido.html` (fora do repo, em `D:\balu-app-v2\Direcionamento\`) — fonte da verdade das decisões do cliente.

## Sequência dos blocos

**A (multi-tenant contador) → E (hardening/LGPD) → D (produção fiscal) → B (billing Asaas) → C (notificações/WhatsApp/IA)**

| Bloco | Spec | Plano | Implementação |
|---|---|---|---|
| A — multi-tenant, painel contador, white-label, honorários v2 | ✅ aprovada | ✅ escrito (21 tasks) | ✅ **em main** (0030–0036) |
| E — hardening + LGPD | ✅ aprovada | ✅ escrito (16 tasks) | ✅ **em main** (0037–0042) |
| D — produção fiscal (Focus prod, PGDAS-D real, DASN assistida, abertura UI) | ⬜ | ⬜ | ⬜ |
| B — billing Asaas | ⬜ | ⬜ | ⬜ |
| C — notificações, WhatsApp, IA | ⬜ | ⬜ | ⬜ |

## Decisões-chave já tomadas (não rediscutir sem motivo novo)

- Multi-escritório desde o lançamento; 1 escritório = N usuários iguais (papéis = V2).
- Painel do contador é **somente visualização**; garantia no banco (RLS sem políticas de escrita).
- Cadastro de escritório com **aprovação por admin** (validação CRC — DL 9.295/46).
- Co-branding (não substituição total); e-mails de auth continuam Balu.
- Honorários v2: controle manual + recorrência via cron; Asaas pluga depois (campos `asaas_*` prontos).
- Semáforo "irregular": 5 critérios fiscais (LC 123 arts. 3º/18-A/21; Res. CGSN 140/2018 arts. 38 e 109); honorário atrasado é coluna separada.
- Tetos fiscais em tabela `parametros_fiscais`, nunca hard-coded.
- IA nunca calcula/transmite — determinístico decide, IA explica (guard-rail de todos os blocos).
- Reforma Tributária: CBS/IBS **não atinge Simples/MEI em 2026** — sem ação no lançamento.

## Pendências externas (cobrar do Michel — travam D/B/C, não A/E)

- [ ] Validar credenciais SERPRO de produção (ele diz "já tenho"; Trial dava 403)
- [ ] Credenciais Asaas de produção (não existem)
- [ ] Credenciais WhatsApp Business API (ele diz que tem)
- [ ] Contrato Focus produção + certificados A1 dos pilotos + procurações RFB
- [ ] Realinhar: "saldo disponível real" no dashboard · DASN-SIMEI sem transmissão automática (fluxo assistido) · DEFIS no lançamento ou V2 · definição de pronto + nº de pilotos

## Próximo passo imediato

Executar o plano do Bloco A (`docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md`), task por task, em branch `feat/bloco-a-multitenant`. Critério de merge: testes de RLS (Task 20) verdes.

**Retomada:** ao voltar, escolher o modo de execução (ficou pendente): (1) subagent-driven — um subagente por task com revisão entre tasks (recomendado), ou (2) inline em lotes com checkpoints. Começar pela Task 1 (migration 0030).

## Convenções da sessão

- Rodar ferramentas a partir de `balu/` (raiz do git). Specs/planos via skills brainstorming → writing-plans.
- Git identity local: Walace <eufacopublicidade@gmail.com>.
- Banco: `docs/reference/db_atual.sql` é a fonte da verdade do schema (a `0001` é idealizada e diverge — ver `docs/investigations/DB-DIVERGENCIA.md`); migrations aplicadas manualmente no SQL Editor.
