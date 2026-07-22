# Bloco E — Hardening e LGPD: Design

> **Status:** aprovado (brainstorming 2026-07-22). Próximo: writing-plans.
> **Pré-requisito de produção:** nenhum dado real de piloto antes deste bloco fechado.
> **Base legal:** LGPD (Lei 13.709/2018) arts. 6º, 7º, 9º, 16, 18, 46, 48; Marco Civil (Lei 12.965/2014) art. 15; CTN art. 173/174 e legislação fiscal (guarda de documentos ~5 anos).

## Objetivo

Fechar os 7 itens de hardening/LGPD mapeados no PRD, deixando o app seguro e conforme para onboarding de dado real. Escopo **completo** (decisão do usuário 2026-07-22): segurança de código + LGPD formal.

## Estado real no início (verificado 2026-07-22, pós-Bloco A)

- **RLS:** já ativa nas 23 tabelas públicas (o Bloco A reativou/provou; `0009` não vale mais). `serpro_contratante` tem RLS on + 0 políticas = deny-all (só `service_role`) — intencional.
- **IDOR clientes:** `updateClienteAction`/`softDeleteClienteAction` filtram só `.eq('id', id)` — mitigado pela RLS, mas a action não escopa por dono.
- **SSRF download:** `notas_fiscais/[id]/download` faz proxy de URL absoluta da nota (S3 Focus) sem allowlist de host.
- **Webhook Focus:** `api/webhooks/focus/route.ts` **não valida segredo algum** no código e confia no corpo inteiro para atualizar `notas_fiscais`. TODO explícito sobre HMAC.
- **Cifra:** `lib/crypto/envelope.ts` (AES-256-GCM, chave `CERT_ENC_KEY`) já cifra material de certificado. Credenciais NFS-e (`nfse_senha_login`, `nfse_token_api`, `nfse_chave_api`, `nfse_frase_secreta`, `token_portal`, `senha_responsavel`) estão em **texto claro**.
- **Termos:** signup grava `profiles.terms_accepted_at` (timestamp) **sem versão**.
- **Exclusão de conta:** `deleteAccountAction` faz `admin.auth.admin.deleteUser` (hard delete); UI (DangerZone) promete "dados serão permanentemente excluídos" — **conflita** com a decisão de anonimizar+reter.
- **Rate limiting / middleware / auditoria / export:** inexistentes (só o rate-limit interno do Supabase Auth).

## Decisões de design (fechadas no brainstorming)

1. **Exclusão de conta:** anonimizar dados pessoais + **reter documentos fiscais** desvinculados de identidade direta, sob base legal "obrigação legal" (LGPD art. 16, I).
2. **Conteúdo jurídico:** a IA redige minuta técnica versionada (Política + Termos) a partir do inventário real; DPO como placeholder; Michel/advogado revisa depois. A máquina (aceite versionado) já fica pronta.
3. **Auditoria:** registra **acessos** (contador abrindo drill-down do cliente) + **escritas** (honorário, carteira, convite, aprovação, branding, equipe).
4. **Rate limiting:** Postgres/Supabase (função atômica de janela), zero infra nova, só nos endpoints sensíveis.

## Arquitetura

Camadas, na ordem de implementação:

- **DB (migrations 0037+):** auditoria, versionamento/aceite de documentos, anonimização, rate-limit, teste RLS abrangente.
- **App:** escopo anti-IDOR, allowlist anti-SSRF, cifra de credenciais NFS-e, endurecimento do webhook, helper de rate-limit, export de dados, redesenho da exclusão, hooks de auditoria, UI de aceite.
- **Jurídico/docs:** minuta Política + Termos (markdown versionado), inventário de dados pessoais.

Convenções mantidas do Bloco A: migrations aplicadas via runner node+pg (ver memória `balu-migrations-e-env`); `ActionResult` local por arquivo; `createServerClient`/`createAdminClient`; Vitest + Playwright; `docs/reference/db_atual.sql` + migrations = fonte da verdade do schema.

---

## Item 1 — RLS: verificação abrangente

**Entrega:** `app/tests/rls-all-tables.spec.ts` (Playwright, mesmo padrão de `rls-isolation`/`rls-contador`: cria atores descartáveis via admin, testa com anon+signIn, teardown completo).

- Para cada tabela com dado de tenant (companies, notas_fiscais, guias_fiscais, apuracoes_fiscais, declaracoes_fiscais, clientes, empresas_fiscais, arquivos_auxiliares, honorarios, company_cnaes, abertura_empresas, abertura_alteracoes, profiles, aux_produtos, e as do Bloco A), provar que ator do tenant A **não lê nem escreve** linha do tenant B.
- Asserção estrutural: toda tabela pública `relkind='r'` tem `relrowsecurity=true`; toda tabela com dado de usuário tem ≥1 política; documentar exceções deny-all (`serpro_contratante`).
- Sem migration (RLS já on). Se o teste achar uma tabela desprotegida → migration corretiva (bloqueia o bloco, como na Task 20 do A).

**Aceite:** teste verde; nenhuma tabela de tenant sem RLS/política.

---

## Item 2 — IDOR em `clientes`

**Arquivo:** `app/src/app/(auth)/clientes/actions.ts`.

`updateClienteAction` e `softDeleteClienteAction`: adicionar `.eq('owner_user_id', userId)` ao `.update(...)` (mesmo escopo do insert/dedup). Defense-in-depth sobre a RLS. Se a linha não for do dono, o update afeta 0 linhas → retornar erro "Cliente não encontrado."

**Teste:** `clientes-idor` (unit/integration) — usuário A tenta editar/soft-deletar cliente do usuário B → 0 linhas afetadas / erro.

**Aceite:** mutação escopada por dono; teste verde.

---

## Item 3 — SSRF no download de notas

**Arquivo:** `app/src/app/(auth)/notas_fiscais/[id]/download/route.ts` + novo `app/src/lib/security/url-allowlist.ts`.

- `hostPermitido(url)`: só permite hostname que termine em sufixos de uma allowlist: `.focusnfe.com.br`, `.amazonaws.com` (S3 pré-assinado da Focus). Rejeita qualquer outro.
- `bloqueiaAlvoInterno(url)`: rejeita `localhost`, `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254.169.254` (metadata), `::1`, `fd00::/8` — resolvendo o host se for IP literal; hostnames não-IP passam pela allowlist acima.
- Antes de qualquer `fetch` de URL absoluta vinda do banco, validar por ambos. Falha → 400 "origem do arquivo não permitida".
- URLs relativas (prependadas com base Focus conhecida) seguem seguras por construção.

**Teste:** `url-allowlist.test.ts` (Vitest, puro) — casos: S3 Focus ✓, api.focusnfe ✓, evil.com ✗, http://169.254.169.254 ✗, http://127.0.0.1 ✗, http://10.0.0.5 ✗.

**Aceite:** proxy só de hosts allowlisted; teste verde.

---

## Item 4 — Webhook Focus: autenticar + não confiar no payload

**Arquivo:** `app/src/app/api/webhooks/focus/route.ts` + `app/src/lib/security/rate-limit.ts` (item 7).

A Focus **não assina o callback com HMAC** (confirmado: só dispara o evento; a fonte da verdade é a API). Design:

1. **Segredo na URL, comparado constant-time:** a URL de callback configurada na Focus carrega `?s=<FOCUS_WEBHOOK_SECRET>` (novo env). O handler exige o param e compara com `crypto.timingSafeEqual`. Ausente/errado → 200 `{ok:false, reason:'unauthorized'}` (200 pra Focus não reenfileirar em loop; log de aviso).
2. **Não confiar cegamente no corpo:** manter a atualização a partir do callback (fluxo atual), mas só **depois** do segredo validado, e só para uma `referencia` que já existe em `notas_fiscais` do próprio ambiente (já é o caso). *Opcional/defense-in-depth (avaliar custo na implementação): re-consultar a nota na API Focus com o token da empresa para status autoritativo em vez do corpo.*
3. **Rate-limit** por IP no endpoint (item 7) para conter flood.
4. Documentar allowlist de IP da Focus no edge/deploy (fora do código).

**Env novo:** `FOCUS_WEBHOOK_SECRET` (adicionar ao `.env.example` com comentário).

**Teste:** integração — sem `?s` → unauthorized; com segredo errado → unauthorized; com segredo certo + ref válida → atualiza.

**Aceite:** webhook rejeita chamada sem segredo válido; teste verde.

---

## Item 5 — Cifra das credenciais NFS-e em repouso

**Arquivos:** `app/src/lib/crypto/envelope.ts` (reuso), `app/src/app/(auth)/configuracoes/actions.ts`, `app/src/lib/fiscal/focus-empresa-update-payload.ts`, migration one-off.

Campos a cifrar (AES-256-GCM, `CERT_ENC_KEY`): `nfse_senha_login`, `nfse_token_api`, `nfse_chave_api`, `nfse_frase_secreta`, `token_portal`, `senha_responsavel`.

- **Escrita** (`configuracoes/actions.ts`): cifrar antes do `insert/update` em `empresas_fiscais`. Formato do envelope: prefixo identificável (ex.: `enc:v1:<base64>`) para distinguir de linhas legadas em claro.
- **Leitura** (só onde monta payload da Focus): `decifrarCampo` que detecta o prefixo — se cifrado, decifra; se legado em claro, retorna como está (compat durante a migração).
- **Migration 003X_cifra_credenciais_nfse:** função/rotina que percorre `empresas_fiscais` e cifra os valores em claro existentes. Como a cifra precisa de `CERT_ENC_KEY` (não disponível no SQL Editor), a migração dos dados roda por um **script Node one-off** (lê em claro, cifra, grava) — a migration SQL só documenta; o script fica em `scripts/` e é registrado no plano.
- Nunca logar valores decifrados. Nunca expor cifrado/decifrado ao client (campos são write-only na UI — a UI mostra "••••• configurado", não o valor).

**Teste:** `envelope` já testado; adicionar teste do `decifrarCampo` com fallback legado (claro passa direto; `enc:v1:` decifra; tampering → erro).

**Aceite:** credenciais gravadas cifradas; leitura decifra transparente; linhas legadas migradas; teste verde.

---

## Item 6 — LGPD operacional

### 6.1 Termos/Política versionados + aceite

**Migration `003X_lgpd_documentos`:**
- `documento_versoes(id, tipo text check in ('termos','privacidade'), versao text, conteudo_md text, publicado_em timestamptz, created_at)` — RLS: SELECT público (anon+authenticated) das versões publicadas; escrita só service_role.
- `aceites(id, user_id, tipo, versao, aceito_em, ip inet)` — RLS: usuário lê/insere só os próprios; escrita via server action.

**Fluxo:**
- Signup: grava aceite da versão vigente de `termos` **e** `privacidade` (substitui o `terms_accepted_at` solto — manter a coluna por compat, mas a verdade passa a ser `aceites`).
- **Gate de re-aceite:** no `(auth)/layout.tsx`, se existe versão publicada mais nova que o último aceite do usuário → redirect para `/aceite` (tela que mostra o que mudou + botão aceitar). Bloqueia o app até aceitar (exceto rotas de logout/conta).
- Seed inicial: versão `1.0` de cada documento (a minuta abaixo).

### 6.2 Minuta jurídica (a IA redige)

- `docs/legal/politica-de-privacidade-v1.md` e `docs/legal/termos-de-uso-v1.md` — minutas técnicas baseadas no inventário real, com **[DPO: nome a definir]** e **[CNPJ/razão do controlador]** como placeholders. Seed em `documento_versoes` via migration/script.
- Aviso no topo: "minuta técnica — pendente de revisão jurídica (Michel/advogado)".

### 6.3 Inventário de dados pessoais

- `docs/reference/inventario-dados-pessoais.md`: tabela (campo · tabela · finalidade · base legal · retenção · titular). Cobrir CPF/CNPJ, endereço, e-mail, telefone, faturamento, certificado digital (dado sensível de acesso), credenciais NFS-e, logs.

### 6.4 Exportação de dados (direito de acesso — art. 18)

- `/conta` → botão "Exportar meus dados" → server action `exportarMeusDadosAction` monta JSON com: profile, companies, empresas_fiscais (sem segredos decifrados — indicar "configurado" em vez do valor), clientes, notas_fiscais, guias_fiscais, apuracoes, declaracoes, honorarios (do titular), aceites. Retorna download (JSON; ZIP se ficar grande). Escopado ao `user.id`.

### 6.5 Exclusão de conta redesenhada (anonimizar + reter)

**⚠️ Regra inviolável:** a exclusão **nunca** pode cascatear para documentos fiscais. O 1º passo do plano é **verificar o `ON DELETE` da FK `companies.user_id → auth.users`** (e demais FKs para `auth.users`). Se for `CASCADE`, deletar o auth user destruiria notas/guias — proibido. Portanto **não fazemos hard-delete do auth user**: bloqueamos o login mantendo as linhas de negócio anonimizadas.

**Migration `003X_anonimizacao`:** função `anonimizar_usuario(p_user_id uuid)` (SECURITY DEFINER, service_role):
- `profiles`: `full_name → 'Usuário removido'`, e-mail/telefone/pessoais → null, `deleted_at = now()`.
- `companies`/`empresas_fiscais`: dados fiscais **retidos**; linhas mantidas, `deleted_at = now()`, desvinculadas de escritório (`contabilidade_id = null`) se houver. `user_id` **preservado** (não pode virar null se a coluna/consultas dependem dele; a linha só fica inacessível porque o login é bloqueado).
- `clientes`: anonimizar dados pessoais conforme finalidade; documentos fiscais retidos.
- Registrar em `audit_log` o evento de exclusão (actor = próprio titular).

**Bloqueio de login (sem hard-delete):** desabilitar o acesso via Supabase Auth — `admin.auth.admin.updateUserById(id, { ban_duration: 'none'→permanente })` (ban) **ou** troca por senha aleatória irrecuperável + revogação de todas as sessões/refresh tokens. Escolher na implementação o que o Supabase suportar de forma durável; o e-mail em `auth.users` deve ser neutralizado (ex.: `deleted+<hash>@invalid`) para permitir re-cadastro futuro e não vazar o e-mail original.

**Action:** `deleteAccountAction` passa a: `anonimizar_usuario` → neutralizar/banir o auth user → revogar sessões → redirect `/login`. Ajustar a cópia da **DangerZone**: "Sua conta e seus dados pessoais serão removidos e o acesso, encerrado. Documentos fiscais são retidos de forma anonimizada pelo prazo legal (obrigação legal, LGPD art. 16, I)."

### 6.6 Trilha de auditoria

**Migration `003X_audit_log`:** `audit_log(id, actor_user_id, acao text, alvo_tipo text, alvo_id uuid, contabilidade_id uuid, meta jsonb, ip inet, created_at)` — RLS: sem SELECT para authenticated (só service_role/AdminBalu lê); INSERT via service_role.
- Helper `registrarAuditoria(...)` (server, admin client).
- **Acessos:** RSC do drill-down do cliente (`contador/clientes/[companyId]/page.tsx`) registra "contador abriu dados do cliente X" (1 linha por carregamento; dedup opcional por janela curta para não duplicar em refresh).
- **Escritas:** honorário (create/update/marcarPago/delete), remover da carteira, convites (criar/aceitar), aprovação de contabilidade, branding, equipe (add/remove).
- Meta mínima: quem, o quê, alvo, quando, ip.

---

## Item 7 — Rate limiting (Postgres)

**Migration `003X_rate_limit`:** `rate_limit_hits(chave text, janela_inicio timestamptz, contador int, primary key(chave, janela_inicio))` + função `check_rate_limit(p_chave text, p_max int, p_janela_segs int) returns boolean` (SECURITY DEFINER): calcula a janela corrente, faz upsert atômico incrementando o contador, retorna `true` se dentro do limite, `false` se estourou. Poda linhas com `janela_inicio < now() - interval`.

**Helper app:** `app/src/lib/security/rate-limit.ts` → `limitar(chave, max, janelaSegs): Promise<boolean>` (chama a RPC via admin). Chave = `ação:identificador` (ip do header `x-forwarded-for` e/ou e-mail).

**Aplicar em:** `loginAction`, `signupAction`, `aceitarConviteAction`, reset de senha, webhook Focus. Ao estourar: erro amigável ("Muitas tentativas. Tente novamente em alguns minutos.") sem vazar qual limite.

**Limites iniciais (parametrizáveis):** login 10/5min por ip+email; signup 5/hora por ip; convite 20/hora por ip; webhook 300/min por ip.

**Teste:** `rate-limit` — chamar acima do limite retorna false; janela nova reseta.

**Aceite:** endpoints sensíveis rejeitam flood; teste verde.

---

## Testes e critério de "pronto"

- Vitest: url-allowlist, decifrarCampo, rate-limit (lógica), clientes-idor (se unit-ável), + suíte existente verde.
- Playwright: `rls-all-tables`, `rls-contador` (regressão), webhook (auth), + walkthroughs existentes.
- `npm run typecheck` 0 erros · `npm run build` limpo.
- Migrations 0037+ aplicadas no banco com verificação (runner node+pg).
- **Critério de merge do bloco:** todos os testes de segurança verdes + nenhuma credencial em claro no banco + gate de re-aceite funcionando.

## Dependências externas / pendências (não bloqueiam o código, bloqueiam o "go-live")

- **Revisão jurídica** da minuta (Política + Termos) e **nome do DPO/encarregado** — Michel/advogado.
- **Razão social/CNPJ do controlador** (Balu) para os documentos.
- **`FOCUS_WEBHOOK_SECRET`** definido e configurado na URL de callback da Focus.
- Rotação da `SUPABASE_SERVICE_ROLE_KEY` (recomendação pendente desde incidentes anteriores — decisão do usuário).
- Allowlist de IP da Focus no edge (config de deploy, quando houver).

## Fora de escopo (V2 / outros blocos)

- UI de visualização da trilha de auditoria (a tabela + inserts bastam para o lançamento; leitura via SQL/admin).
- Portabilidade em formato interoperável padronizado além do JSON.
- Consentimento granular de canais (é do Bloco C — notificações).
- Purga física diferida pós-retenção (agendar quando o prazo legal se aproximar; fora do lançamento).
