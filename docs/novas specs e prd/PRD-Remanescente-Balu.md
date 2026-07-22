# PRD — Escopo Remanescente do Balu (pós-Blocos A/E)

> **Data:** 2026-07-22 · **Status:** proposto · **Base:** auditoria `STATUS-IMPLEMENTACAO-2026-07-22.md` (mesma pasta).
> Consolida **tudo que ainda não foi implementado**, priorizado por importância para o lançamento. Cada item tem: problema, objetivo, escopo, fora de escopo, dependências (credenciais externas sinalizadas com 🔒), critérios de aceite e base legal.
> **Spec técnica correspondente:** `2026-07-22-remanescente-design.md` (mesma pasta).

## Contexto

Blocos A (multi-tenant contador) e E (hardening/LGPD) estão completos em `main`. O produto emite notas e calcula/gera guias **em homologação/trial**. Para lançar com pilotos reais faltam: (1) ligar a produção fiscal, (2) o motor de obrigações que entrega a promessa "cuidamos dos seus prazos", e (3) monetização. Estamos atrasados; este PRD ordena o trabalho para maximizar valor por esforço e separar o que **dá pra construir já** do que **trava em credencial externa**.

## Framework de priorização

| Nível | Significado |
|---|---|
| **P0** | Bloqueia o lançamento com pilotos reais |
| **P1** | Necessário para o lançamento comercial completo |
| **P2** | Diferencial de mercado, pós-lançamento |
| **P3** | Visão de longo prazo (V2) |

🔒 = travado em credencial/decisão externa (Michel/terceiro). 🟢 = buildável agora sem dependência externa.

---

# P0 — Bloqueadores de lançamento

## P0.1 — Produção fiscal: emissão real de notas 🔒

**Problema.** A emissão está fixada em homologação (`FocusEnv = 'hom'` hard-coded em `notas_fiscais/actions.ts` e no download). Nenhum piloto pode emitir nota válida.

**Objetivo.** Permitir emissão em produção por empresa habilitada, sem quebrar o fluxo de homologação (que segue para testes).

**Escopo.**
- Ambiente Focus por empresa (não global): coluna/flag que decide `hom` vs `prod` por `company`/`empresas_fiscais`, com o token de produção correspondente.
- Onboarding de empresa piloto: upload do certificado A1 real (já cifrado — Bloco E), habilitação NFS-e na Focus em produção, validação de credenciais municipais.
- Guarda: só emite em produção quando a empresa está totalmente habilitada (certificado válido, credenciais municipais OK); senão, erro claro.
- Telemetria mínima de emissão em produção (log de auditoria — `audit_log` já existe).

**Fora de escopo.** Reforma tributária CBS/IBS (não atinge Simples/MEI em 2026). Emissão em lote.

**Dependências 🔒.** Contrato Focus produção; certificados A1 dos pilotos; credenciais municipais NFS-e; procurações quando aplicável.

**Critérios de aceite.**
- Uma empresa piloto emite uma NFS-e **de produção** autorizada pela prefeitura, com XML+PDF baixáveis.
- Empresas não-piloto continuam em homologação sem regressão.
- Nenhuma credencial em texto claro; toda emissão de produção registrada em `audit_log`.

**Base legal.** NFS-e: LC 116/2003 + padrão nacional (Res. CGSN 169/2022, MEI obrigado desde 2023); NF-e: Ajuste SINIEF 07/05; NFC-e: Ajuste SINIEF 19/16; certificado: MP 2.200-2/2001 (ICP-Brasil).

---

## P0.2 — Motor de obrigações e notificações 🟢 (buildável agora)

**Problema.** O produto promete "cuidamos dos seus prazos", mas hoje **não há aviso proativo nenhum**: sem calendário fiscal, sem lembrete de DAS/DASN, sem alerta de certificado A1 vencendo. Tudo é disparado manualmente pelo usuário. A apuração mensal também é 100% manual (sem cron).

**Objetivo.** Um mecanismo que **materializa as obrigações de cada empresa** (DAS mensal, DASN anual, certificado vencendo, PGDAS pendente) e **notifica** o titular (in-app + e-mail) antes do prazo. Determinístico; a IA (P2) só entra para explicar depois.

**Escopo.**
- Tabela de **notificações** por usuário (tipo, título, corpo, severidade, entidade-alvo, lida/não-lida, agendada-para).
- Tabela/lógica de **calendário de obrigações** derivado dos dados reais: DAS mensal (venc. dia 20), DASN-SIMEI anual (31/05), certificado A1 (`arquivos_auxiliares.cert_not_after`), PGDAS-D do mês anterior não transmitida.
- **Cron mensal + diário** (mesmo padrão de `honorarios-recorrentes`) que gera as pendências/notificações do período e dispara e-mail (via `sendEmail` do Bloco E) para o que vence em janelas configuráveis (ex.: D-7, D-1, vencido).
- **Sino de notificações** no app (contador de não-lidas no `MenuLateral`) + página/lista.
- Preferência de opt-out por tipo (LGPD art. 18 — aviso de obrigação fiscal é legítimo interesse; marketing seria opt-in separado, fora daqui).
- Reaproveitar o cálculo determinístico existente (`lib/fiscal/*`) e as pendências de `guias_fiscais`/`declaracoes_fiscais`.

**Fora de escopo.** Canal WhatsApp (P2). IA que explica (P2). Push/SMS.

**Dependências.** Nenhuma externa. (E-mail: `RESEND_API_KEY`/`EMAIL_FROM` — já previstos; sem chave vira no-op logado, não quebra.)

**Critérios de aceite.**
- Uma empresa com DAS vencendo em ≤7 dias recebe notificação in-app **e** e-mail (quando a chave Resend existe).
- Certificado A1 vencendo em <30 dias gera pendência no dashboard e notificação.
- O cron é idempotente (rodar 2× não duplica notificação da mesma competência/tipo).
- Opt-out respeitado; nada enviado a quem desativou o tipo.

**Base legal.** LGPD art. 7º IX (legítimo interesse — aviso de obrigação); art. 18 (preferências). Prazos: Res. CGSN 140/2018 arts. 38 (PGDAS dia 20) e 109 (DASN 31/05); LC 123/2006 art. 21 (DAS).

---

## P0.3 — PGDAS-D transmissão real 🔒

**Problema.** O builder de PGDAS-D existe e roda em **dry-run** (`indicadorTransmissao:false`); nenhuma action transmite de verdade. Sem isso, a declaração mensal obrigatória não é entregue pelo app.

**Objetivo.** Transmitir a PGDAS-D de produção via SERPRO/Integra Contador, com tratamento de recibo e erros, e **retificadora** desde o início.

**Escopo.**
- Action `transmitirPgdasdAction` chamando o builder com `indicadorTransmissao:true` (produção), gravando recibo/`numero_declaracao`/`data_transmissao` em `declaracoes_fiscais`.
- Tratamento de erros SERPRO (mapeamento de códigos → mensagem amigável) e reprocessamento seguro.
- **Retificadora** (art. 39): permitir retransmitir corrigindo.
- Guarda: só transmite com procuração RFB válida e credenciais de produção; senão erro claro. Registro em `audit_log`.

**Fora de escopo.** DASN transmissão automática (não existe no Integra Contador — ver P1.3, fluxo assistido).

**Dependências 🔒.** Credenciais SERPRO de produção (validar o "já tenho" do Michel — Trial dava 403); procuração eletrônica RFB por cliente.

**Critérios de aceite.** Uma PGDAS-D de produção transmitida com recibo persistido; erro de credencial/procuração retorna mensagem clara sem travar o app; retificadora funciona.

**Base legal.** Res. CGSN 140/2018 art. 38 (declaração mensal, prazo dia 20; retificação art. 39).

---

# P1 — Completar o lançamento

## P1.1 — Billing Asaas 🔒 (sandbox buildável)

**Problema.** Não há cobrança. Ganchos `asaas_charge_id`/`asaas_customer_id` existem em `honorarios`, mas sem integração.

**Objetivo.** Assinatura recorrente do escritório/empresa via Asaas, com gate de acesso por status — **sem reter dado do titular** (inadimplente perde escrita/emissão, mantém leitura e exportação).

**Escopo.**
- Tabelas `assinaturas` + `cobrancas` espelhando o Asaas.
- Cliente Asaas (`lib/clients/asaas.ts`): criar customer, assinatura, consultar cobrança.
- **Webhook Asaas** com validação de token (mesmo rigor do webhook Focus do Bloco E: segredo constant-time + rate-limit).
- Gate de acesso por status da assinatura, com **grace period** configurável antes de bloquear escrita; **nunca** bloqueia leitura/exportação (LGPD/CDC).
- Plugar nos honorários recorrentes (Bloco A já tem os ganchos).

**Fora de escopo.** Armazenar PAN/cartão (o Asaas guarda; o Balu só tokens/ids). Split de pagamento.

**Dependências 🔒.** Credenciais Asaas de produção (sandbox do Asaas permite construir e testar antes).

**Critérios de aceite.** Assinatura criada e refletida em `assinaturas`; webhook atualiza status; inadimplente perde emissão mas mantém leitura/export; cancelamento sem barreira.

**Base legal.** CDC (Lei 8.078/90) arts. 39/51 (cancelamento sem barreira, sem fidelidade oculta); LGPD para dados de pagamento.

---

## P1.2 — Gestão de etapas de abertura pela UI 🟢

**Problema.** `processo_etapa` é definido uma vez como `'recebido'` na criação e só **exibido** (`AberturaInfoView`); ninguém atualiza a etapa pela tela — é update manual no banco.

**Objetivo.** Contador/equipe atualiza a etapa e o checklist de docs pela UI; o cliente vê o progresso e é notificado a cada mudança (integra com P0.2).

**Escopo.**
- Máquina de estados de etapas (ex.: recebido → em análise → protocolado → deferido → concluído; definir a lista final com o Michel).
- Action de atualização de etapa escopada ao escritório (só o contador/admin do vínculo), registrada em `audit_log`.
- UI no painel do contador para avançar etapa + observação; visão read-only do cliente já existe, ampliar para a nova etapa.
- Notificação ao cliente na transição (via P0.2).

**Fora de escopo.** Integração RedeSim/Portal do Empreendedor; geração de contrato social; e-assinatura (V2).

**Dependências.** Definição de negócio das etapas (Michel). Nenhuma credencial.

**Critérios de aceite.** Contador avança a etapa pela UI; cliente vê a etapa nova e recebe notificação; ação registrada em auditoria; RLS impede escritório alheio de alterar.

---

## P1.3 — DASN-SIMEI assistida + DEFIS 🟢

**Problema.** DASN-SIMEI: o Integra Contador **não transmite** — só consulta (já implementada). DEFIS: não existe no app. Ambas são obrigações anuais que a fila (P0.2) precisa avisar.

**Objetivo.** Fluxo **assistido**: o app prepara os dados (builder `montarDasnSimei` já existe), orienta o MEI/contador a transmitir no portal oficial e registra o comprovante. DEFIS: avaliar builder + fluxo assistido análogo (decidir com Michel se entra no lançamento).

**Escopo.**
- DASN-SIMEI: tela que monta o resumo a partir dos dados reais, instrui a transmissão no portal, e permite registrar `numero_declaracao`/comprovante em `declaracoes_fiscais`.
- Aviso a partir de janeiro (multa mínima R$ 25 — art. 111) via P0.2.
- DEFIS: escopo a confirmar (obrigação anual do Simples, 31/03) — no mínimo entrar na fila de obrigações com aviso; construção do builder se decidido para o lançamento.

**Fora de escopo.** Transmissão oficial automática de DASN (impossível no Integra Contador).

**Dependências.** Decisão do Michel (DEFIS no lançamento ou V2; realinhar expectativa "app transmite DASN oficialmente" — não é possível).

**Critérios de aceite.** DASN-SIMEI preparada e comprovante registrável; obrigação anual aparece na fila no período correto; DEFIS ao menos avisada.

**Base legal.** Res. CGSN 140/2018 art. 109 (DASN 31/05), art. 111 (multa), art. 72 (DEFIS).

---

# P2 — Diferencial pós-lançamento

## P2.1 — Notificações por WhatsApp 🔒
Estender o motor de obrigações (P0.2) para o canal WhatsApp Business API: avisos de vencimento, Pix Copia-e-Cola, confirmação. **Dep. 🔒:** credenciais WhatsApp Business API; consentimento de canal registrado (LGPD + política WhatsApp). Guard-rail: IA nunca transmite/emite; determinístico decide.

## P2.2 — IA assistente 🔒
Onboarding conversacional leigo; explicação da apuração em português simples; sugestão de código de serviço (LC 116) e CNAE/regime. **Dep. 🔒:** chave de LLM. Guard-rail inviolável (todos os blocos): **a IA nunca calcula nem transmite** — o determinístico decide e a IA explica, sempre com confirmação do usuário.

## P2.3 — Repositório de documentos · conciliação bancária
Rota `/documentos` (guarda organizada de XML/PDF/comprovantes). Conciliação bancária via Open Finance (**dep. 🔒:** provedor Open Finance).

---

# P3 — Visão futura (V2)

Domínio customizado por escritório (host-routing no middleware + API de domínios Vercel); busca semântica LC116 (pgvector); SLA configurável; Lucro Presumido/Real; eSocial/SPED/EFD-Reinf/folha; app nativo; push/SMS. Todos explicitamente **fora do lançamento** e sem código hoje.

---

## Sequência recomendada de execução

Dado que P0.1 e P0.3 travam no Michel, a ordem que **maximiza progresso sem esperar**:

1. **P0.2 — Motor de obrigações/notificações** (buildável já; entrega o núcleo do valor).
2. **P1.2 — Gestão de etapas de abertura** (buildável já; curto).
3. **P1.3 — DASN assistida + DEFIS** (buildável já).
4. **P1.1 — Billing Asaas** (buildável no sandbox do Asaas enquanto a prod não chega).
5. **P0.1 / P0.3 — Produção fiscal** assim que as credenciais do Michel chegarem (código de "ligar a chave" preparado em paralelo).
6. **P2 / P3** conforme credenciais e prioridade comercial.

Em paralelo e continuamente: **cobrar do Michel** as credenciais que destravam P0.1, P0.3 e P1.1.
