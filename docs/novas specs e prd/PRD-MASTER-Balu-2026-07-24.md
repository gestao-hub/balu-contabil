# PRD Master — Escopo Remanescente do Balu para Lançamento

> **Data:** 2026-07-24 · **Status:** aprovado (decisões de escopo fechadas nesta sessão)
> **Fontes cruzadas:** `Direcionamento/planejamento.pdf` (visão dos 8 pilares — fonte fresca) × `docs/product/PRD-Balu-V2.md` (escopo de lançamento por blocos) × `docs/novas specs e prd/PRD-Remanescente-Balu.md` + `STATUS-IMPLEMENTACAO-2026-07-22.md` (backlog priorizado, pré-sessão-4) × `Direcionamento/devolutiva-dev-preenchido.html` (decisões do Michel) × auditoria cirúrgica do código real (`app/src`, migrations até `0044`, `db_atual.sql`) feita em 2026-07-24.
> **Relação com os PRDs anteriores:** este documento **consolida e supera** o `PRD-Remanescente-Balu.md` (que era de 22/07, anterior à sessão 4). Onde houver divergência, **este vence**. Ele não reescreve o `PRD-Balu.md` original (produto já construído) nem o `PRD-Balu-V2.md` (que segue válido como enquadramento legal por bloco).
> **Papel deste documento:** é o **guarda-chuva à prova de falhas**. Ele define *o que falta*, *por que*, *com quais ferramentas se integra*, *onde exatamente o código pluga* (seams com arquivo:linha) e *quais armadilhas evitar* (landmines). As specs técnicas de implementação são escritas **por bloco, uma de cada vez**, na hora de implementar cada um (ciclo brainstorm → spec → plano). Nenhum bloco vira código sem sua spec dedicada.

---

## 0. Sumário executivo

Blocos **A** (multi-tenant do contador) e **E** (hardening/LGPD) estão **completos em `main`** (migrations 0030–0044). O app emite notas e calcula/gera guias **em homologação/dry-run/consulta**. A sessão 4 (23/07) construiu o **lado-contador da abertura** (fila + operação de etapas) e o **oversight do AdminBalu**, e investigou (sem editar código) o "destravamento fiscal".

Para lançar com pilotos reais falta ligar três coisas: **(1)** o motor que entrega a promessa "cuidamos dos seus prazos" (obrigações + notificações — buildável já), **(2)** a produção fiscal de verdade (trava em credencial do Michel) e **(3)** a monetização (Asaas). Somam-se os itens que o `planejamento.pdf` reforça e que agora **entram no escopo** por decisão desta sessão: pagamento do DAS via WhatsApp, conciliação bancária, e domínio próprio + SLA no white-label.

O trabalho remanescente foi decomposto em **7 blocos**, sequenciados para **maximizar progresso sem esperar o Michel** (buildável-agora primeiro). Cada bloco tem seção própria na §4 com seams e landmines.

---

## 1. Visão e os 8 pilares × estado atual

O Balu é uma plataforma de gestão fiscal para **MEI e Simples Nacional** com dois clientes: o **empresário leigo** (emite nota, entende e paga imposto em português simples) e o **escritório de contabilidade** (assina, coloca a carteira dentro, acompanha num painel único somente-leitura, com marca própria).

Cruzamento dos 8 pilares do `planejamento.pdf` contra o código real (pós-sessão-4):

| # | Pilar (planejamento.pdf) | Estado | O que falta | Bloco |
|---|---|---|---|---|
| 1 | Onboarding guiado com **IA educacional** | ❌ | IA conversacional (coleta os mesmos campos, valida por Zod, direciona o perfil) | **6** 🔒 |
| 2 | **Abertura de empresa** digital | 🟡 | checklist de docs com status, notificação na transição, status tempo-real, **minuta de contrato social** | **2** 🟢 |
| 3 | **Emissão de NFS-e** simplificada | ✅/🟡 | produção real (ligar a chave); IA sugere código de serviço; busca "google-like" (verificar/aprimorar) | **5** 🔒 / **6** 🔒 |
| 4 | **Apuração automática** de impostos | ✅/🟡 | motor de obrigações (cron); PGDAS-D transmissão real; aviso + **pagamento PIX via WhatsApp**; **conciliação bancária** | **1** 🟢 / **5** 🔒 / **6** 🔒 / **7** 🔒 |
| 5 | Painel **leigo** do empresário | ✅ | explicação em PT simples via IA (refino) | **6** 🔒 |
| 6 | **WhatsApp** como canal único | ❌ | atendimento IA + escalação, avisos, docs — via Envia.Click | **6** 🔒 |
| 7 | **Gestão de obrigações** básicas | ❌ | motor de obrigações + DASN-SIMEI/DEFIS assistidas | **1** 🟢 / **3** 🟢 |
| 8 | Área **white-label** do contador | ✅ | **domínio próprio** + **SLA configurável** | **7** 🔒 |

🟢 = buildável agora · 🔒 = trava (parcial ou total) em credencial/decisão externa · ✅ pronto · 🟡 parcial · ❌ ausente

---

## 2. Decisões de escopo fechadas nesta sessão (não rediscutir sem motivo novo)

1. **Formato do entregável:** 1 Master PRD (este) + specs técnicas **por bloco**, escritas na hora de implementar cada um.
2. **Sequência:** **buildável-agora primeiro** (1 → 2 → 3 → 4 sandbox → 5 → 6 → 7). Código dos blocos 🔒 preparado atrás de flag/mock em paralelo.
3. **Escopo expandido** (itens que o `PRD-Balu-V2` marcava "fora do lançamento" e o `planejamento.pdf` reforça — **agora dentro**): pagamento do DAS via WhatsApp (Pix Copia-e-Cola), conciliação bancária (confirmação automática de pagamento), domínio próprio + SLA no white-label.
4. **Contrato social:** o app **gera uma minuta por template** a partir dos dados coletados (PDF preenchido); a equipe revisa e protocola. Sem e-assinatura no lançamento.
5. **WhatsApp:** integração via **Envia.Click** (CRM omnichannel sobre Chatwoot, com agentes de IA nativos e escalação para humano) — reaproveita a infra já conectada, em vez de integrar a Meta Cloud API do zero.
6. **DEFIS:** **fluxo assistido completo** no lançamento (builder + tela que orienta a transmissão + registro de comprovante), análogo à DASN-SIMEI.
7. **IA:** provedor **Claude/Anthropic** (`@anthropic-ai/sdk`), modelos Claude mais recentes. Guard-rail inviolável: a IA **nunca** calcula, transmite ou emite — o determinístico decide, a IA explica/sugere/conversa com confirmação humana.
8. **Open Finance** (conciliação, Bloco 7): provedor (Pluggy/Belvo/outro) decidido na spec do Bloco 7.

---

## 3. Princípios invioláveis de implementação (valem para todos os blocos)

Estes princípios existem para que o código gerado **não introduza bug** — o pedido central desta rodada.

### 3.1 A regra das três fontes de schema (o landmine nº 1 do projeto)
O schema do banco tem **três fontes que não concordam**:
- `app/supabase/migrations/` (0001→0044) — **parcialmente defasada**. O `0001_init.sql` é um schema **idealizado que nunca foi aplicado** (usa `empresa_id`/`competencia char(6)`); o banco real usa `company_id`/`competencia_referencia`/`owner_user_id`. Vários arquivos comentam a divergência (`0015`, `0025:6`).
- `app/docs/reference/db_atual.sql` (dump real, ligado ao RESTORE-POINT de 22/07) — **mais próximo da verdade para estrutura de tabelas**, mas pode estar defasado para colunas adicionadas depois (ex.: honorários v2 do `0032` podem não estar nele; a abertura, sim, está no schema moderno lá).
- `app/src/types/database.ts` (tipos TS que o código consome).

**Regra:** ao escrever qualquer migration nova, **parta do `db_atual.sql` + migrations 0025+ + `database.ts`, nunca do `0001`**. Antes de aplicar SQL que dependa de colunas de uma tabela, **confirme as colunas reais** (via o runner node+pg do usuário lendo o banco, ou pela inspeção do `db_atual.sql`). Uma migration que assuma os nomes do `0001` (ex.: `tipo_nf`/`ref`/`focus_response` em `notas_fiscais`, quando o real é `tipo_documento`/`referencia`/`payload_focusnfe`) **quebra**.

### 3.2 Segurança no banco, não na UI
RLS é a fronteira. Toda tabela nova: RLS por `owner_user_id = auth.uid()` (modelo em `0025:36-40`) ou escopo por `contabilidade_id`/`company_id` conforme o caso. UI só evita frustração. Escrita do contador sempre escopada com `.eq('contabilidade_id', ctx.id)` (anti-IDOR, padrão das actions v2).

### 3.3 Determinístico decide, IA explica
Nenhum valor fiscal sai de LLM. A IA traduz, sugere e conversa — sempre com confirmação humana e trilha de auditoria (`audit_log`). Fronteira legal: DL 9.295/46 (exercício da contabilidade).

### 3.4 Correto por construção
Regra fiscal centralizada (RPC/lib única + testes por norma citada). Dinheiro em **centavos inteiros**. Parâmetros legais em `parametros_fiscais` com vigência, **nunca hard-coded**. Competência no formato **`YYYYMM`** (PGDAS-D) e **`YYYY`** (DASN-SIMEI) — comparar com `YYYY-MM` é o bug clássico já corrigido uma vez (`0036`).

### 3.5 Fuso: BRT explícito
O semáforo e os prazos usam BRT (`lib/fiscal/tempo-brt`). Os crons da Vercel disparam em **UTC**. Todo cálculo de prazo/virada de mês usa BRT explicitamente.

### 3.6 Idempotência de cron via índice único parcial
Crons que materializam linhas seguem o padrão `gerar_honorarios_recorrentes` (`0036:164`): `INSERT ... SELECT` + `ON CONFLICT (...) WHERE ... DO NOTHING`, com o **predicado do `ON CONFLICT` idêntico ao do índice único parcial** (senão não deduplica — bug histórico, `0036` item 7).

### 3.7 Dependência externa nunca no caminho do dev
Tudo que depende de credencial de terceiro (Focus prod, SERPRO prod, Asaas, WhatsApp, LLM, Open Finance) é implementado contra **sandbox/mock**, com **virada por env ou flag por empresa**, default seguro. `sendEmail` já é no-op logado sem chave — o padrão a seguir.

### 3.8 Flag por empresa, default seguro, para o que é irreversível
Produção fiscal (emissão real na SEFAZ, transmissão real na Receita) é **por empresa, default `hom`**, flip explícito. Nunca virar uma empresa para `prod` sem o Michel confirmar cert A1 + contrato Focus prod + procuração SERPRO daquele CNPJ.

### 3.9 Design system intocado
Fontes (Syne/Outfit/Nunito), tokens Tailwind e componentes existentes. Recursos novos = composição, não redesign.

---

## 4. Os 7 blocos

Cada bloco abaixo tem: **Problema · Objetivo · Escopo · Fora de escopo · Ferramentas de integração · Seams de código · Landmines · Dependências · Critérios de aceite · Base legal.** As seções de seam citam arquivo:linha reais (auditoria 2026-07-24).

---

### Bloco 1 — Motor de Obrigações + Notificações 🟢 (buildável agora — o núcleo do valor)

**Problema.** O produto promete "cuidamos dos seus prazos", mas não há **aviso proativo nenhum**: sem calendário fiscal, sem lembrete de DAS/DASN, sem alerta de certificado A1 vencendo. A apuração mensal é 100% manual (sem cron). O comentário `queries.ts:147-149` afirma (erradamente) que a pendência de cert A1 é impossível.

**Objetivo.** Um mecanismo determinístico que **materializa as obrigações de cada empresa** (DAS mensal venc. dia 20, DASN-SIMEI 31/05, DEFIS 31/03, PGDAS-D do mês anterior não transmitida, certificado A1 vencendo, honorário vencendo) e **notifica o titular** (in-app + e-mail, com co-branding do escritório) em janelas configuráveis (D-7/D-3/D-0/vencido). A IA (Bloco 6) só entra depois, para explicar.

**Escopo.**
- Tabela `notifications` por usuário: `owner_user_id`, `company_id`, `tipo`, `titulo`, `corpo`, `severidade` (`info`/`warning`/`danger`), `entidade_ref`, `agendada_para`, `lida_em`, `enviada_email_em`, `created_at`. RLS por `owner_user_id = auth.uid()`.
- Tabela `notification_preferences` (opt-out por tipo, por usuário).
- **RPC de materialização** (`SECURITY DEFINER STABLE SET search_path=public`) que espelha as expressões de `painel_contador` (`0036:71`) para computar as pendências e insere notificações idempotentemente.
- **Cron diário + mensal** (novo `src/app/api/cron/obrigacoes/route.ts` + entradas em `vercel.json`) copiando a auth de `honorarios-recorrentes/route.ts` (Bearer `CRON_SECRET`, `createAdminClient()`).
- **Sino** no `MenuLateral` (contador de não-lidas) + página/lista de notificações.
- **E-mail** via `sendEmail` (co-branding pelo `fromName`).
- **Certificado A1 vencendo** como pendência no dashboard (corrige o TODO desatualizado).
- Opt-out (LGPD art. 18) — aviso de obrigação é legítimo interesse; marketing seria opt-in separado (fora daqui).
- **Gancho de notificação nas transições de abertura** (usado pelo Bloco 2).

**Fora de escopo.** Canal WhatsApp (Bloco 6). IA que explica (Bloco 6). Push/SMS.

**Ferramentas de integração.** Resend (via `sendEmail` já existente — sem SDK, `fetch` direto). Cron da Vercel (padrão existente). Nenhuma credencial nova.

**Seams de código.**
- Migration nova (próxima livre: **`0045`**) — convenções do `db_atual.sql`/`0025`, **não** do `0001`.
- RPC espelha `painel_contador` (`0036_fix_code_review_bloco_a.sql:71-116`): `das_vencidos`, `pgdas_mes_anterior_transmitida`, `dasn_ano_anterior_transmitida`, `cert_not_after` (de `arquivos_auxiliares`, coluna existe desde `0003`).
- Limiar de irregularidade: fonte única em `classificarSemaforo` (`src/lib/fiscal/semaforo.ts:19`) — 80% do limite, 30 dias de cert, prazo dia 20 / 31-05. Reusar, não reimplementar.
- Pré-motor de pendências já existente a estender: `getPendingActions` (`src/lib/dashboard/queries.ts:87`).
- Cron template: `src/app/api/cron/honorarios-recorrentes/route.ts` (auth) + `vercel.json`.
- E-mail: `src/lib/clients/email.ts` (`sendEmail`, `fromName = contabilidades.email_remetente_nome ?? nome`; tratar retorno `{skipped:true}`).
- Sino: `src/components/MenuLateral.tsx` (nav ~192 desktop / header mobile ~163). Importar `Bell` de `lucide-react`; tratar estado `open` (recolhido `md:w-16`); reusar o padrão de dropdown com fechar-ao-clicar-fora (`companyMenuRef`, linhas 94-102). Realtime via `createBrowserClient()`.
- Opt-out: nova aba no array `TABS` de `src/app/(auth)/(gated)/conta/page.tsx:10` + tabela de preferências.

**Landmines.**
- Competência `YYYYMM`/`YYYY` (não `YYYY-MM`).
- Cron em UTC vs. prazos em BRT — usar `tempo-brt`.
- `sendEmail` é **no-op silencioso** sem `RESEND_API_KEY`/`EMAIL_FROM`; registrar/reagendar quando `skipped:true` para não "perder" avisos.
- `declaracoes_fiscais` **não tem `deleted_at`** (design intencional) — não filtrar por `deleted_at` nela (ao contrário de `guias_fiscais`/`arquivos_auxiliares`).
- `apuracoes_fiscais` não é usada por `src/` — não assumir que está populada.
- Idempotência: predicado do `ON CONFLICT` = predicado do índice parcial.

**Dependências.** Nenhuma externa. (E-mail: chave Resend já prevista; sem chave, no-op logado.)

**Critérios de aceite.**
- Empresa com DAS vencendo em ≤7 dias recebe notificação in-app **e** e-mail (quando a chave existe).
- Cert A1 vencendo em <30 dias gera pendência no dashboard + notificação.
- Cron idempotente (rodar 2× não duplica notificação da mesma competência/tipo).
- Opt-out respeitado.

**Base legal.** LGPD art. 7º IX (legítimo interesse — aviso de obrigação) e art. 18 (preferências). Res. CGSN 140/2018 arts. 38 (PGDAS dia 20), 72 (DEFIS 31/03), 109 (DASN 31/05); LC 123/2006 art. 21 (DAS).

---

### Bloco 2 — Abertura Digital completa 🟢 (buildável agora)

**Problema.** A sessão 4 entregou o lado-contador (fila, avanço de etapa, conclusão com CNPJ, alterações). Faltam quatro coisas do pilar 2: (a) o cliente **não é notificado** na transição de etapa; (b) não há **checklist de docs com status** (os 8 docs são upload livre); (c) o status não é **tempo-real** (é `router.refresh()`); (d) o app não **gera o contrato social**.

**Objetivo.** Fechar a promessa "abertura 100% online (MEI + ME sem sócio)": o cliente acompanha o progresso em tempo real, é avisado a cada etapa, vê o checklist de documentos com status, e recebe a **minuta de contrato social gerada pelo app**.

**Escopo.**
- **Checklist de docs**: estado por documento (`pendente`/`enviado`/`aprovado`/`recusado` + observação), em coluna nova de `abertura_empresas` ou tabela filha; UI no lado-cliente e no lado-contador.
- **Notificação na transição**: `avancarProcessoAction`/`concluirAberturaAction` disparam notificação ao cliente (via Bloco 1).
- **Status tempo-real**: Supabase Realtime channel sobre `abertura_empresas` na view do cliente (`AberturaInfoView`).
- **Minuta de contrato social**: geração de PDF por template preenchido com os dados coletados (MEI/ME sem sócio); download no lado-contador para revisão/protocolo.

**Fora de escopo.** Integração RedeSim/Portal do Empreendedor; e-assinatura (V2); execução automática nos órgãos (o modelo é "app coleta, equipe abre").

**Ferramentas de integração.** Supabase Realtime (já disponível no stack). Geração de PDF (avaliar `pdf-lib`/template server-side na spec do bloco). Bloco 1 para notificação.

**Seams de código.**
- Actions do contador: `src/app/(auth)/(gated)/contador/aberturas/actions.ts` — `avancarProcessoAction`, `concluirAberturaAction` (adicionar disparo de notificação).
- Etapas: `src/lib/abertura/etapas.ts` (`ETAPAS` 7 itens + `cancelado`), `ETAPA_LABEL`. Campo canônico `processo_etapa` (CHECK das 8 etapas em `db_atual.sql:284`).
- Contrato de campos: `src/types/abertura.ts` (`AberturaData`, `ABERTURA_TEXT_FIELDS`, `DOC_KEYS`); parse `src/lib/abertura/form.ts`; Zod `AberturaCreateSchema`.
- View do cliente: `src/app/(auth)/(gated)/configuracoes/AberturaInfoView.tsx`.
- Detalhe do contador: `.../aberturas/[aberturaId]/DetalheAbertura.tsx`.

**Landmines.**
- **Migration parte do `db_atual.sql`** (schema moderno de `abertura_empresas`, linhas 223-286, com `processo_*`/`titular_nome_completo`/`doc_*`), **não** do `0001` (schema antigo). Essas colunas vivem só no banco real.
- `DetalheAbertura.tsx` calcula `idxAtual` sobre `ETAPAS` (7, sem `cancelado`) → `cancelado` fica com `indexOf === -1`; tratar ao mexer na timeline.

**Dependências.** Nenhuma credencial. Definição do template de contrato social (formato mínimo aceito pela Junta — validar com o Michel/equipe).

**Critérios de aceite.**
- Contador avança etapa → cliente vê a etapa nova (tempo-real) **e** recebe notificação (Bloco 1).
- Checklist mostra status por doc; recusa com observação volta ao cliente.
- Minuta de contrato social gerada e baixável; ação registrada em `audit_log`; RLS impede escritório alheio de alterar.

**Base legal.** DL 9.295/46 (contrato/registro é ato do contador — o app assiste). LGPD (dados de abertura = CPF/RG/nome da mãe: dado sensível, já anonimizável pelo Bloco E).

---

### Bloco 3 — DASN-SIMEI assistida + DEFIS 🟢 (buildável agora)

**Problema.** DASN-SIMEI: o Integra Contador **não transmite** — só consulta (já implementada). DEFIS: não existe no app. Ambas são obrigações anuais que o Bloco 1 precisa avisar.

**Objetivo.** Fluxo **assistido** para as duas: o app monta o resumo a partir dos dados reais, orienta a transmissão no portal oficial e registra o comprovante. (Decisão desta sessão: DEFIS entra **completo**, análogo à DASN.)

**Escopo.**
- **DASN-SIMEI**: tela que monta o resumo (builder `montarDasnSimei` já existe), instrui a transmissão no portal, permite registrar `numero_declaracao`/comprovante em `declaracoes_fiscais` (`tipo='DASN-SIMEI'`, competência = ano `YYYY`).
- **DEFIS**: builder novo (receita bruta anual, empregados, etc. — art. 72) + tela assistida análoga + registro de comprovante.
- Aviso a partir de janeiro (DASN, multa mínima R$ 25 — art. 111) e no período do DEFIS, via Bloco 1.

**Fora de escopo.** Transmissão oficial automática de DASN (impossível no Integra Contador).

**Ferramentas de integração.** Reuso do builder/consulta SERPRO existentes. Bloco 1 para avisos.

**Seams de código.**
- `src/app/(auth)/(gated)/impostos/actions.ts`: `consultarDasnSimeiAction` (L374) já faz upsert em `declaracoes_fiscais` (tipo DASN-SIMEI). Estender para registrar comprovante manual.
- `declaracoes_fiscais` (`0025`): UNIQUE `(company_id, competencia_referencia, tipo)`; **sem `deleted_at`**.
- Builder DASN existente (`montarDasnSimei`).

**Landmines.** Competência DASN = ano puro `YYYY` (não `YYYYMM`). Não confundir com PGDAS. Realinhar a expectativa do Michel de que "o app transmite a DASN oficialmente" — não é possível; é assistido.

**Dependências.** Definição do escopo mínimo do DEFIS com o Michel (campos exigidos).

**Critérios de aceite.** DASN-SIMEI e DEFIS preparadas, com comprovante registrável; obrigação anual aparece na fila (Bloco 1) no período correto.

**Base legal.** Res. CGSN 140/2018 art. 109 (DASN 31/05), art. 111 (multa), art. 72 (DEFIS 31/03).

---

### Bloco 4 — Billing Asaas 🔒 (buildável em sandbox)

**Problema.** Não há cobrança. Só existem as colunas-gancho `asaas_charge_id`/`asaas_customer_id` em `honorarios` (`0032:9-10`) — **nunca lidas nem escritas** em TS.

**Objetivo.** Assinatura recorrente (escritório/empresa) via Asaas, com gate de acesso por status **sem reter dado do titular**: inadimplente perde escrita/emissão, **mantém leitura e exportação**.

**Escopo.**
- Novo cliente `src/lib/clients/asaas.ts` (espelha `focus-nfe.ts`): `server-only`, base `https://api.asaas.com` vs `https://api-sandbox.asaas.com` por env, auth via header `access_token: process.env.ASAAS_API_KEY`, `call<T>` com retry copiado da Focus. Objeto `asaas = { criarCliente, criarCobranca, criarAssinatura, consultarCobranca }`. Adicionar ao barrel `src/lib/clients/index.ts`.
- Tabelas `assinaturas` + `cobrancas` espelhando o Asaas (migration `0045+`).
- **Webhook** `src/app/api/webhooks/asaas/route.ts` espelhando o da Focus, com **adaptação**: o Asaas envia o segredo via header `asaas-access-token` (não query `?s=`). Reusar `timingSafeEqual` (`segredo.ts`), `limitar`/`ipDe` (rate-limit), e o padrão "sempre HTTP 200".
- **3 produtos de cobrança:** assinatura mensal do empresário; assinatura do escritório **por faixa de nº de clientes** (recalculada mensalmente antes da cobrança); avulso (ex.: abertura).
- **Gate de acesso** por status da assinatura com **grace period** configurável; **nunca** bloqueia leitura/exportação.
- Plugar nos honorários recorrentes: popular `honorarios.asaas_charge_id`/`asaas_customer_id` a partir das actions v2 do contador (`src/app/(auth)/(gated)/contador/honorarios/actions.ts` — padrão `createAdminClient` + `getContabilidadeCtx` + `registrarAuditoria` + `.eq('contabilidade_id', ctx.id)`).

**Fora de escopo.** Armazenar PAN/cartão (o Asaas guarda; o Balu só tokens/ids). Split de pagamento.

**Ferramentas de integração.** **Asaas** (sandbox → prod por env). Webhook seguro (padrão Bloco E). Env var nova `ASAAS_API_KEY` + `ASAAS_WEBHOOK_SECRET` (adicionar ao `.env.example`).

**Seams de código.** `src/lib/clients/focus-nfe.ts` (padrão de cliente); `src/app/api/webhooks/focus/route.ts` + `segredo.ts` (padrão de webhook); `src/lib/security/rate-limit.ts` (`limitar`/`ipDe`); `contador/honorarios/actions.ts` (padrão de escrita v2).

**Landmines.**
- Confirmar via banco se o `0032` (colunas asaas + honorários v2) **já está aplicado** no ambiente-alvo — o `db_atual.sql` pode ser anterior a ele.
- O segredo do webhook Asaas vem por **header**, não query — adaptar `segredo.ts`.
- Gate **nunca** pode bloquear leitura/export (implicação LGPD/CDC).

**Dependências 🔒.** Credenciais Asaas de produção (sandbox permite construir/testar antes).

**Critérios de aceite.** Assinatura criada e refletida em `assinaturas`; webhook atualiza status; inadimplente perde emissão mas mantém leitura/export; cancelamento sem barreira.

**Base legal.** CDC (Lei 8.078/90) arts. 39/51 (cancelamento sem barreira, sem fidelidade oculta); LGPD para dados de pagamento.

---

### Bloco 5 — Produção Fiscal: ligar a chave 🔒 (flag por empresa, default seguro)

**Problema.** Tudo roda travado em homologação/dry-run. Emissão: `env: FocusEnv = 'hom'` hard-coded em 5 pontos. PGDAS-D: só `indicadorTransmissao: false`. `companies.focus_token` guarda **só o token de homologação** — virar `env='prod'` sem migrar o token de produção dá **401 na SEFAZ**.

**Objetivo.** Permitir emissão em produção e transmissão real de PGDAS-D **por empresa habilitada**, sem quebrar o fluxo de homologação. Estratégia: **flag `ambiente_atual` por empresa, default `hom`** — nada muda em produção até virar uma empresa explicitamente.

**Escopo.**
- Migration `0045+`: coluna `empresas_fiscais.ambiente_atual text default 'hom'` (`'hom'`/`'prod'`) + coluna de **token de produção separado** (`companies.focus_token_producao`, ou em `empresas_fiscais`), populada a partir de `resp.token_producao` (hoje **descartado**).
- Emissão/cancelamento/polling: derivar `env` da empresa e escolher o token correspondente nos 5 pontos.
- **`transmitirDeclaracaoAction(competencia)`** nova: chama `transmitirPgdasd(..., {indicadorTransmissao:true})`, gated por `ambiente_atual==='prod'` + confirmação explícita, **persiste** recibo/`numero_declaracao`/`data_transmissao` em `declaracoes_fiscais` (o dry-run atual não grava). **Retificadora** desde o início (art. 39).
- UI: botão de transmitir em `SecaoDeclaracao.tsx` (só aparece em `prod`).
- Guards de habilitação mantidos; toda emissão de produção em `audit_log`.

**Fora de escopo.** Reforma tributária CBS/IBS (não atinge Simples/MEI em 2026). Emissão em lote. DASN transmissão automática (Bloco 3, assistida).

**Ferramentas de integração.** Focus NFe produção; SERPRO Integra Contador produção (mTLS + procurador, já robusto).

**Seams de código** (todos em `src/app/(auth)/(gated)/notas_fiscais/actions.ts`, salvo nota):
- `emitirNotaAction` L281 (`const env: FocusEnv = 'hom'`); `emitirNfeAction` L670; `emitirNfceAction` L781; `atualizarStatusNotaAction` L355/L357/L359; `cancelarNotaAction` L452 — trocar `'hom'` literal por `env` derivado da empresa.
- Token hoje sempre de `companies.focus_token` (hom). Origem a corrigir: `src/lib/fiscal/focus-empresa-sync.ts:97` (`token_homologacao ?? token_producao` — persistir também o de produção).
- Flag existente `emitir_nota_homol_antes_producao` (`0001` L96) hoje ignorada (`_flagIgnoradaPorEnquanto`, actions L280) — substituir pela leitura de `ambiente_atual`.
- PGDAS: `src/app/(auth)/(gated)/impostos/actions.ts:579` (`previewDeclaracaoAction`, `indicadorTransmissao:false`) é o molde da nova action com `true`. Builder: `src/lib/fiscal/serpro-pgdasd.ts` (`transmitirPgdasd`, param `indicadorTransmissao`). UI: `impostos/SecaoDeclaracao.tsx` L21-27 + `PreviewDeclaracaoButton.tsx`.

**Landmines.**
- **Env e token mudam juntos**: token-hom em URL-prod → 401 "HTTP Basic: Access denied" (`focus-nfe.ts:213-216`).
- Endpoints de **revenda** (`criarEmpresa`/`consultarEmpresa`/`atualizarEmpresa`) forçam `'prod'` internamente e ignoram `env` por design — não confundir com o eixo hom/prod das emissões.
- `snapshotFocusEmpresa` (`focus-empresa-sync.ts:139-150`) regrava `focus_habilita_*` após cada sync — pode resetar flags de habilitação.
- Divergência banco↔migration em `notas_fiscais` (nomes reais `tipo_documento`/`referencia`/`payload_focusnfe`) — migration nova parte do banco real.
- `cancelarNotaAction` L491-495: se Focus cancela mas o update do banco falha, fica inconsistente — mexer no `env` amplia a superfície.
- `gerarDasSimplesAction` (L451-464) exige PGDAS-D transmitida — ligar a transmissão real muda esse fluxo.
- Coluna legada `empresa_fiscal_ativada` nunca é setada `true` — **não** reusar como flag de ambiente.

**Dependências 🔒.** Contrato Focus produção; certificados A1 dos pilotos; credenciais municipais NFS-e; credenciais SERPRO de produção (validar o "já tenho" — Trial dava 403); procuração eletrônica RFB por cliente.

**Critérios de aceite.**
- Uma empresa piloto emite uma NFS-e **de produção** autorizada, com XML+PDF baixáveis.
- Uma PGDAS-D de produção transmitida com recibo persistido; retificadora funciona.
- Empresas não-piloto seguem em homologação sem regressão; nenhuma credencial em texto claro; tudo em `audit_log`.

**Base legal.** NFS-e: LC 116/2003 + padrão nacional (Res. CGSN 169/2022, MEI obrigado desde 2023); NF-e: Ajuste SINIEF 07/05; NFC-e: Ajuste SINIEF 19/16; certificado: MP 2.200-2/2001 (ICP-Brasil). PGDAS-D: Res. CGSN 140/2018 arts. 38/39.

---

### Bloco 6 — WhatsApp (via Envia.Click) + IA (Claude) 🔒

**Problema.** Zero canal WhatsApp e zero IA. O pilar 6 pede WhatsApp como canal único (atendimento IA + escalação); os pilares 1/3/4/5 pedem IA educacional (onboarding, explicação de imposto, sugestão de código, aviso/pagamento).

**Objetivo.** (C2) WhatsApp como canal de avisos + pagamento do DAS (Pix Copia-e-Cola) + atendimento com IA e escalação para humano, **via Envia.Click**. (C3) IA que explica imposto, sugere código de serviço e conduz o onboarding conversacional — **nunca calcula/transmite/emite**.

**Escopo — C2 (WhatsApp via Envia.Click).**
- Estender o motor de notificações (Bloco 1) para o canal WhatsApp: os mesmos eventos (vencimento, PGDAS pendente, DASN/DEFIS, limite, cert) disparam mensagem via Envia.Click.
- **Pagamento do DAS via WhatsApp**: enviar o **Pix Copia-e-Cola** do DAS (o SERPRO já retorna o código na geração da guia) na mensagem de vencimento.
- **Atendimento com IA + escalação**: aproveitar os agentes de IA nativos do Envia.Click (Chatwoot) — o bot tira dúvidas simples/pede documentos e **escala para humano** quando não resolve (requisito explícito da devolutiva).
- Consentimento de canal registrado (LGPD + política WhatsApp Business).

**Escopo — C3 (IA Claude).**
1. **Explicação de impostos em PT simples** (menor risco): gera explicação do painel/guia a partir de dados **já calculados** pelo motor determinístico. Disclaimer obrigatório ("informação educativa, não substitui seu contador").
2. **Sugestão de código de serviço na emissão**: IA sugere a partir de CNAE/descrição; **usuário confirma**; código validado contra a lista oficial do município/LC 116. Registrar sugestão + confirmação.
3. **Onboarding conversacional** (3 fluxos: contador, empresa existente, abertura): a conversa **produz o mesmo `AberturaData`/`FormData`** que o `AberturaWizard` monta e chama a action existente (validação Zod idêntica, IA não inventa dados). Fallback permanente para o formulário.

**Fora de escopo.** IA que emite/transmite/calcula. Push/SMS. Voz.

**Ferramentas de integração.** **Envia.Click** (API sobre Chatwoot — conversas, reply, agentes de IA, escalação) para WhatsApp. **Claude/Anthropic** (`@anthropic-ai/sdk`, chave nova) para a IA. Pix do DAS: reuso do retorno SERPRO. Bloco 1 como base de eventos.

**Seams de código.**
- IA: novo `src/lib/ai/` + rota(s) de action; **nenhuma** integração LLM existe hoje (grep vazio; `package.json` sem SDK).
- Onboarding IA: contrato de campos `src/types/abertura.ts` (`AberturaData`); parse `src/lib/abertura/form.ts` (`parseAberturaForm`); Zod `AberturaCreateSchema`; action `src/app/(onboarding)/onboarding/abertura/actions.ts` (`submitAberturaAction`) — a IA reusa isto, não cria caminho paralelo.
- Sugestão de código: emissão em `notas_fiscais/actions.ts`; CNAE em `company_cnaes`/`empresas_fiscais`.
- WhatsApp: canal novo plugado na materialização do Bloco 1; Pix do DAS vem de `gerarDasMeiAction`/`gerarDasSimplesAction` (`impostos/actions.ts`).

**Landmines.**
- Guard-rail inviolável: a IA nunca calcula/transmite/emite — toda ação de escrita passa pelo fluxo determinístico com confirmação. Logs de conversa retidos com base LGPD.
- Envia.Click: mensagens proativas de WhatsApp exigem template aprovado pela Meta (janela de 24h para resposta livre) — validar se o Envia.Click gerencia os templates.
- Sugestão de código: nunca emitir sozinho — responsabilidade tributária é do contribuinte (CTN art. 121).

**Dependências 🔒.** Conta/credenciais WhatsApp Business dentro do Envia.Click; chave de API do Envia.Click; chave de API Anthropic; templates de WhatsApp aprovados.

**Critérios de aceite.** Aviso de vencimento chega por WhatsApp com o Pix Copia-e-Cola; atendimento IA responde e escala para humano; IA explica um imposto e sugere um código (com confirmação do usuário); onboarding conversacional coleta e valida como o formulário, com fallback.

**Base legal.** DL 9.295/46 (fronteira da orientação da IA); CTN art. 121; LGPD (consentimento de canal, retenção de conversa); política WhatsApp Business.

---

### Bloco 7 — White-label domínio próprio + SLA + Conciliação bancária 🔒

**Problema.** O Bloco A entregou co-branding (logo/nome/WhatsApp), mas não **domínio próprio** nem **SLA configurável** (pilar 8). E o pilar 4 pede **confirmação automática de pagamento** (conciliação bancária), que hoje é manual (`marcarGuiaPagaAction`).

**Objetivo.** (a) Cada escritório pode usar um domínio próprio apontando para a sua carteira, com SLA configurável exibido. (b) Pagamentos de DAS/honorário são confirmados automaticamente via Open Finance, dando baixa em `guias_fiscais.data_pagamento`.

**Escopo.**
- **Domínio próprio**: mapeamento host → `contabilidade`; host-routing no `middleware`; provisionamento via API de domínios da Vercel. Co-branding já resolvido (Bloco A) — aqui é só a camada de domínio.
- **SLA configurável**: campo no white-label (`contabilidades`), exibido ao cliente; opcionalmente alertas de SLA no motor (Bloco 1).
- **Conciliação bancária**: integração Open Finance (provedor a decidir na spec) que concilia entradas com guias/honorários e **confirma o pagamento automaticamente**; alerta se passou da data e não detectou pagamento (pilar 4).

**Fora de escopo.** Emissão de boleto próprio do escritório (é do Bloco 4/Asaas). Múltiplos domínios por escritório (1 por escritório no lançamento).

**Ferramentas de integração.** **Vercel Domains API** + Next middleware (host-routing). **Open Finance** (Pluggy/Belvo/outro — decidir na spec). Bloco 1 (alertas de SLA e de "não pago").

**Seams de código.**
- Middleware: `src/middleware.ts` (host-routing). Co-branding: componentes de branding no `MenuLateral` (Bloco A).
- White-label: tabela `contabilidades` (adicionar `dominio_customizado`, `sla_config`).
- Conciliação: `marcarGuiaPagaAction` (`impostos/actions.ts:31`) é o ponto que hoje dá baixa manual; a conciliação automatiza isso; `guias_fiscais.data_pagamento`/`status`.

**Landmines.**
- Domínio próprio interage com a auth do Supabase (Redirect URLs) e com o co-branding — testar o fluxo de login sob o host customizado.
- Conciliação: casar valor+data+identificador do Pix do DAS sem falso-positivo; Open Finance é credencial externa nova (não existe hoje).

**Dependências 🔒.** Contas de domínio dos escritórios + acesso à API de domínios da Vercel; provedor Open Finance + credenciais.

**Critérios de aceite.** Escritório acessa a carteira por domínio próprio com login funcionando; SLA exibido; um pagamento de DAS é conciliado e dá baixa automática; alerta de "não detectado" dispara após o vencimento.

**Base legal.** LGPD (dados bancários via Open Finance = consentimento explícito); CDC. Marco Civil (guarda de logs).

---

## 5. Matriz de dependências externas (cobrar do Michel — caminho crítico)

| Credencial / decisão | Bloco | Status declarado | Ação |
|---|---|---|---|
| SERPRO Integra Contador **produção** | 5 | "já tenho" (5.2) — **não validado**; Trial dava 403 | Testar as credenciais reais ANTES de virar qualquer empresa para `prod` |
| Procuração eletrônica RFB por cliente | 5 | "de alguns" (5.3) | Mapear quais pilotos têm; roteiro de outorga para os demais |
| Focus NFe **produção** + cert A1 dos pilotos + credenciais municipais | 5 | homologação por design | Confirmar contrato/plano de produção; colher certs no onboarding |
| Credenciais **Asaas** produção | 4 | ❌ não tem (1.4) | Abrir conta; dev implementa em sandbox |
| WhatsApp Business dentro do **Envia.Click** + templates aprovados | 6 | "Sim" (7.4) | Confirmar que o WABA vive no Envia.Click; aprovar templates |
| Chave **Anthropic** (IA) | 6 | — | Provisionar chave |
| Provedor **Open Finance** (conciliação) | 7 | ❌ não existe | Escolher provedor (Pluggy/Belvo) + contratar |
| API de **domínios Vercel** + domínios dos escritórios | 7 | — | Acesso à conta Vercel + domínios dos pilotos |
| Chave **Resend** + domínio verificado (e-mail) | 1 | chave posta; domínio pendente (DNS do usuário) | Verificar domínio em resend.com/domains; trocar `EMAIL_FROM` |
| Supabase Auth **Redirect URLs** (`https://balu-contabil.vercel.app/**`) | todos | pendente | Configurar (senão e-mails de auth caem em localhost) |

---

## 6. Sequência de execução e definição de pronto

**Sequência recomendada** (buildável-agora primeiro):

1. **Bloco 1 — Motor de Obrigações + Notificações** (núcleo do valor; sem dependência externa).
2. **Bloco 2 — Abertura Digital completa** (curto; usa o Bloco 1 para notificar).
3. **Bloco 3 — DASN-SIMEI assistida + DEFIS** (usa o Bloco 1 para avisar).
4. **Bloco 4 — Billing Asaas** (construir/testar em sandbox enquanto a prod não chega).
5. **Bloco 5 — Produção Fiscal** (código atrás de flag preparado em paralelo; virar empresa só quando as credenciais do Michel chegarem e forem validadas).
6. **Bloco 6 — WhatsApp (Envia.Click) + IA (Claude)**.
7. **Bloco 7 — Domínio + SLA + Conciliação bancária**.

Em paralelo e continuamente: **cobrar do Michel** as credenciais que destravam 5, 6 e 7 (§5).

**Definição de pronto do lançamento** (proposta — validar com o Michel):
1. Escritório piloto aprovado com ≥ N clientes vendo o painel com semáforo correto.
2. Cliente piloto emite NFS-e **em produção** e recebe XML/PDF.
3. DAS calculado, guia gerada e PGDAS-D **transmitida de verdade** para ≥ 1 competência.
4. Aviso automático de vencimento chegando por e-mail **e** WhatsApp (com Pix).
5. Assinatura cobrada via Asaas (≥ 1 ciclo).
6. IA: explicação de imposto + sugestão de código ativos; onboarding conversacional com fallback.
7. Abertura: cliente acompanha em tempo-real, recebe minuta de contrato social.
8. Testes: unitários + RLS + E2E verdes contra build de produção (padrão atual do repo).

---

## 7. Fora do lançamento (permanece V2)

Lucro Presumido/Real · eSocial/SPED/DCTFWeb/EFD-Reinf/folha (devolutiva 5.6/5.7) · e-assinatura do contrato social · integração RedeSim/automação nos órgãos · papéis internos diferenciados no escritório · views materializadas do painel · app nativo (PWA cobre) · push/SMS · busca semântica LC116 (pgvector) · múltiplos domínios por escritório.

---

## 8. Próximo passo

Este Master PRD aprovado → escrever a **spec técnica do Bloco 1** (motor de obrigações + notificações) via o ciclo brainstorm → spec → plano, e então implementar. Os demais blocos seguem a mesma disciplina, um de cada vez, cada um com sua spec cirúrgica antes de qualquer código.
