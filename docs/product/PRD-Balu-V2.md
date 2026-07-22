# PRD Balu V2 — Escopo de Lançamento

**Data:** 2026-07-22
**Fonte da verdade:** devolutiva do Michel (`Direcionamento/devolutiva-dev-preenchido.html`, jul/2026) cruzada com o batimento (`docs/investigations/BATIMENTO-PLANEJAMENTO-VERDE.md`) e o comparativo Contabilizei.
**Relação com o PRD-Balu.md original:** este documento **não substitui** o PRD original (que descreve o produto já construído); ele define **o que falta para lançar** e as regras de negócio/legais de cada bloco novo. Em divergência, este documento vence.

---

## 1. Visão

O Balu é uma plataforma de gestão fiscal para **MEI e Simples Nacional** com dois clientes simultâneos:

- **Empresário/MEI** — usa direto: emite nota, vê imposto calculado, paga a guia, entende sua situação em português simples.
- **Escritório de contabilidade** — assina o Balu, coloca sua carteira de clientes dentro dele (white-label parcial) e acompanha tudo num painel único, **somente visualização**.

Modelo de receita (in-app, essencial para lançar): assinatura mensal do empresário + assinatura do escritório por nº de clientes + cobrança avulsa (ex.: abertura de empresa). Gateway: **Asaas**.

### Personas

| Persona | O que precisa | O que NUNCA pode acontecer |
|---|---|---|
| Empresário/MEI (leigo) | Emitir nota, saber quanto/quando pagar, ser avisado antes de vencer, entender o porquê | Pagar imposto errado; perder prazo sem aviso; ver dado de outra empresa |
| Contador/escritório | Carteira consolidada, quem está irregular, honorários, marca própria | Agir sem querer pelo cliente; ver cliente de outro escritório |
| Admin Balu (Michel/equipe) | Aprovar escritórios, acompanhar aberturas, operar o negócio | — |

### Estado atual (resumo do batimento, ainda válido — código congelado desde 15/06)

- ✅ **Pronto:** emissão NFS-e/NF-e/NFC-e via Focus (homologação), prévia de imposto ao vivo, alerta de limite, cálculo DAS MEI/Simples + guia, Fator R/anexos, fila de obrigações, clientes, certificado A1, PWA.
- ● **Parcial:** PGDAS-D (dry-run), DASN-SIMEI (consulta), abertura (coleta sem gestão), honorários (lista simples).
- ✗ **Não existe:** multi-escritório/painel do contador/white-label, billing, notificações, WhatsApp, IA.

---

## 2. Os 5 blocos (ordem de implementação)

Cada bloco tem spec própria em `docs/superpowers/specs/` e passa pelo ciclo brainstorm → spec → plano → implementação. Ordem definida por dependência técnica:

```
A (multi-tenant) ──► B (billing precisa do tenant)
      │        └───► C (notificações precisam do tenant + branding)
      ▼
E (hardening) ─────► D (produção fiscal só depois de RLS/segurança confirmadas)
```

**Sequência: A → E → D → B → C** (E corre em paralelo com o final de A).

---

### Bloco A — Multi-tenant do Contador, Painel, White-label, Honorários v2

**Spec:** `docs/product/2026-07-22-bloco-a-multitenant-contador-design.md` ✅ (aprovada)

Resumo das decisões: tenant `contabilidades` com aprovação por admin (validação CRC — DL 9.295/46, art. 12); 1 escritório = N usuários iguais (papéis na V2); vínculo por convite dirigido + link do escritório, com aceite informado (LGPD arts. 7º/9º) e desvínculo self-service (art. 18, IX); painel agregado (RPCs) + drill-down somente-leitura garantido por **RLS sem políticas de escrita**; semáforo de irregularidade com 5 critérios fiscais citando a norma; co-branding (logo/nome/WhatsApp do escritório, identidade Balu preservada); honorários com status derivado + recorrência via cron idempotente + ganchos `asaas_*`; tetos fiscais em tabela `parametros_fiscais` (nunca hard-coded).

---

### Bloco E — Hardening e LGPD (pré-requisito de produção)

**Spec:** a criar (`bloco-e-hardening-lgpd-design.md`)

Itens já mapeados no README + investigações, todos obrigatórios antes de qualquer dado real:

1. **RLS ativa em produção** — `0009_disable_rls.sql` desabilitou; `0010` criou as políticas. Reativar, aplicar e provar com o teste `rls-isolation` + os novos testes do Bloco A.
2. **IDOR em `clientes`** — `update`/`softDelete` escopados por `company_id`/`owner_user_id`, não só `id`.
3. **SSRF no download de notas** — `notas_fiscais/[id]/download` com allowlist de hosts (S3 da Focus + endpoints conhecidos).
4. **Webhook Focus com HMAC** — hoje só segredo na URL + IP allowlist.
5. **Credenciais NFS-e cifradas** — `nfse_senha_login`/`nfse_token_api` com cifra app-level (chave em env, ex. AES-256-GCM); certificado A1 `.pfx` idem (revisar como está hoje).
6. **LGPD operacional:** Política de Privacidade + Termos de Uso versionados com aceite no signup (guardar versão + timestamp); inventário de dados pessoais (o app guarda CPF, CNPJ, endereço, faturamento, certificado digital = dado de alto impacto); direitos do titular (exportação e exclusão de conta — a exclusão já existe em `/conta`, revisar cascata); logs de acesso do contador a dados do cliente (trilha de auditoria mínima); DPO/encarregado nomeado nos Termos (decisão do Michel).
7. **Rate limiting** nos endpoints públicos (login, convites, webhooks) — proteção básica anti-abuso.

**Base legal:** LGPD (Lei 13.709/2018) arts. 5º, 6º, 7º, 9º, 18, 46 (segurança), 48 (comunicação de incidente); Marco Civil (Lei 12.965/2014) art. 15 (guarda de logs).

---

### Bloco D — Produção Fiscal (ligar a chave)

**Spec:** a criar (`bloco-d-producao-fiscal-design.md`)

| Item | O que falta | Base legal / dependência externa |
|---|---|---|
| **Emissão em produção** | Trocar gate de homologação; onboarding de empresas piloto com certificado A1 real e credenciais municipais NFS-e | NFS-e: LC 116/2003 + padrão nacional (MEI obrigado à NFS-e padrão nacional desde 2023 — Res. CGSN 169/2022); NF-e: Ajuste SINIEF 07/05; NFC-e: Ajuste SINIEF 19/16; certificado: MP 2.200-2/2001 (ICP-Brasil). **Depende:** contrato Focus produção + certificados dos pilotos |
| **PGDAS-D transmissão real (Fase 2)** | Builder/dry-run prontos; implementar `transmitir` + tratamento de recibo/erros SERPRO | Res. CGSN 140/2018, art. 38: declaração mensal obrigatória, **prazo dia 20 do mês seguinte**; retificação até 5 anos (art. 39 — importante: implementar retificadora desde o início). **Depende:** credenciais SERPRO de produção (validar a afirmação "já tenho" da devolutiva — no Trial retornava 403) + procuração eletrônica RFB de cada cliente |
| **DASN-SIMEI** | Consulta pronta; transmissão **não existe no Integra Contador** — redesenhar como fluxo assistido (app prepara os dados, orienta o MEI/contador a transmitir no portal, registra comprovante) e **realinhar a expectativa do Michel** ("app transmite oficialmente" não é possível aqui) | Res. CGSN 140/2018, art. 109: DASN-SIMEI até 31/05; multa mínima R$ 25 (art. 111) — a fila de obrigações deve avisar a partir de janeiro |
| **DEFIS** | Não existe no app; avaliar escopo (obrigação anual do Simples, 31/03) — decidir com o Michel se entra no lançamento ou fica V2 com aviso na fila | Res. CGSN 140/2018, art. 72 |
| **Gestão de abertura pela UI** | Contador/equipe atualiza etapa do processo e checklist de docs pela tela (hoje é update manual no banco); notificação ao cliente a cada mudança de etapa (integra com Bloco C) | Fluxo confirmado: app **coleta** dados/docs; execução nos órgãos é manual pela equipe (sem RedeSim no lançamento) |
| **Reforma Tributária (risco monitorado, sem ação em 2026)** | Nada a implementar agora: o destaque CBS/IBS obrigatório (jan/2026 informativo, ago/2026 campos obrigatórios) **não se aplica a empresas do Simples Nacional/MEI**; NFS-e tem destaque opcional no início; 2026 é ano-teste sem multa (Ato Conjunto RFB/CGIBS 1/2025) | EC 132/2023; LC 214/2025. **Ação:** registrar no roadmap V2 a revisão quando o Balu atender regime normal (Lucro Presumido está fora do lançamento) |

---

### Bloco B — Billing Asaas

**Spec:** a criar (`bloco-b-billing-asaas-design.md`)

- **3 produtos de cobrança:** assinatura mensal do empresário (empresa solta); assinatura do escritório **por faixa de nº de clientes** (recalculada mensalmente antes da cobrança); avulso (abertura de empresa etc.).
- **Arquitetura prevista:** tabela `assinaturas` + `cobrancas` espelhando o Asaas; webhook Asaas (com validação de token) atualiza status; gate de acesso por status da assinatura (grace period configurável antes de bloquear — bloquear acesso a dado fiscal do próprio usuário tem implicação LGPD/CDC: **nunca reter dado**; inadimplente perde funções de escrita/emissão, mantém leitura e exportação).
- **Honorários × Asaas:** o honorário do contador (Bloco A) ganha "gerar cobrança Asaas" — o escritório cobra o cliente pelo app (subconta/split a decidir na spec).
- **Base legal:** CDC (Lei 8.078/90) arts. 39/51 — cancelamento sem barreira, sem fidelidade oculta; LGPD para dados de pagamento (o Asaas guarda cartão — o Balu não armazena PAN, só tokens/ids).
- **Dependência externa (bloqueio):** credenciais Asaas de produção — **não existem ainda** (devolutiva 1.4). Implementar contra sandbox; virada de chave por env.

---

### Bloco C — Notificações, WhatsApp e IA

**Spec:** a criar (`bloco-c-notificacoes-whatsapp-ia-design.md`) — internamente faseado em C1 → C2 → C3.

**C1 — Motor de notificações (e-mail primeiro):**
- Tabela `notifications` (evento, canal, destinatário, agendamento, status de envio) + cron diário que materializa avisos a partir das mesmas fontes do semáforo do Bloco A: guia vencendo (D-7/D-3/D-0 — vencimento DAS dia 20, art. 38/40 Res. 140), PGDAS-D pendente, DASN-SIMEI (janela jan–mai, art. 109), limite ≥80%, certificado vencendo, documento de abertura faltante, honorário vencendo (para o cliente do contador).
- E-mail transacional com marca do escritório (co-branding do Bloco A); provedor a decidir na spec (Resend/SES).
- Preferências do usuário (opt-out por tipo, LGPD art. 18) — aviso de obrigação fiscal é legítimo interesse, marketing é opt-in separado.

**C2 — WhatsApp:**
- Mesmos eventos do C1 via WhatsApp Business API (templates aprovados pela Meta — mensagens proativas exigem template; janela de 24h para respostas livres).
- **Dependência externa:** conta WABA do Michel (devolutiva 7.4 diz "Sim" — coletar credenciais e verificar se é API oficial).
- Consentimento de canal registrado (LGPD + política WhatsApp Business).

**C3 — IA (três recursos, nesta ordem de risco/esforço):**
1. **Explicação de impostos em português simples** — menor risco: gera explicação do painel/guia a partir de dados estruturados já calculados (nunca calcula imposto — só explica o que o motor determinístico produziu). Disclaimer obrigatório: "informação educativa, não substitui orientação do seu contador" (fronteira com exercício da contabilidade, DL 9.295/46).
2. **Sugestão de código de serviço na emissão** — IA sugere a partir do CNAE/descrição; **usuário confirma**; código final validado contra a lista oficial do município/LC 116. A IA nunca emite sozinha — responsabilidade tributária é do contribuinte (CTN art. 121); o app registra a sugestão + confirmação.
3. **Onboarding conversacional (3 fluxos: contador, empresa existente, abertura)** — maior esforço; conversa coleta os mesmos campos dos formulários atuais (validação idêntica via Zod, IA não inventa dados) e identifica o perfil para direcionar o painel certo. Fallback permanente para o formulário tradicional.
4. **Atendimento WhatsApp com IA** (junto de C2): tira dúvidas simples, explica pendências, pede documentos, **escala para humano** quando não sabe (requisito explícito da devolutiva) — handoff para o WhatsApp de suporte do escritório.
- Guard-rails comuns: IA **nunca** transmite declaração, emite nota ou altera dado fiscal; toda ação de escrita passa pelo fluxo determinístico com confirmação do usuário; logs de conversa retidos com base LGPD.

---

## 3. Enquadramento legal consolidado (referência rápida)

| Norma | O que rege no Balu |
|---|---|
| LC 123/2006 | Simples Nacional: limites (art. 3º), MEI (art. 18-A, teto R$ 81.000 — §1º), anexos/Fator R (art. 18), DAS (art. 21) |
| Res. CGSN 140/2018 (alterada pela Res. 183/2025 — monitorar) | Regulamento vivo do Simples/MEI: PGDAS-D mensal até dia 20 (art. 38), retificação 5 anos (art. 39), DEFIS 31/03 (art. 72), DASN-SIMEI 31/05 (art. 109), multas (art. 111) |
| LC 116/2003 + padrão nacional NFS-e (Res. CGSN 169/2022 p/ MEI) | Emissão de NFS-e; código de serviço |
| Ajustes SINIEF 07/05 e 19/16 | NF-e e NFC-e |
| MP 2.200-2/2001 | Certificado digital ICP-Brasil (A1) |
| DL 9.295/46 + Res. CFC | Exercício da contabilidade — gate de CRC; fronteira do que a IA pode "orientar" |
| LGPD (Lei 13.709/2018) | Bases legais de acesso do contador, consentimento de canais, direitos do titular, segurança (art. 46), incidentes (art. 48) |
| Marco Civil (Lei 12.965/2014) | Guarda de logs (art. 15) |
| CDC (Lei 8.078/90) | Assinaturas: cancelamento, transparência de cobrança |
| EC 132/2023 + LC 214/2025 | Reforma: CBS/IBS **não atinge Simples/MEI em 2026**; risco só se/quando atender regime normal |

---

## 4. Dependências externas (colher ANTES de cada bloco — caminho crítico)

| Credencial/contrato | Bloco | Status declarado | Ação |
|---|---|---|---|
| Asaas produção | B | ❌ não tem (devolutiva 1.4) | Michel abrir conta/contratar; dev implementa em sandbox |
| SERPRO Integra Contador produção | D | "Sim, já tenho" (5.2) — **não validado**; Trial dava 403 | Testar as credenciais reais ANTES de planejar o Bloco D |
| Procuração eletrônica RFB por cliente | D | "De alguns clientes" (5.3) | Mapear quais pilotos têm; roteiro de outorga p/ os demais |
| Focus NFe produção | D | homologação por design | Confirmar plano/contrato de produção |
| Certificados A1 + credenciais municipais dos pilotos | D | — | Colher no onboarding dos pilotos |
| WhatsApp Business API | C | "Sim" (7.4) | Coletar credenciais; confirmar que é API oficial (Cloud API) |
| Provedor de e-mail transacional | C | — | Decidir na spec C (Resend/SES) |
| Chave de API do provedor de IA | C | — | Decidir modelo/provedor na spec C |

---

## 5. Critérios de aceite do lançamento

O Michel respondeu "nada pode ficar para depois" (8.2) mas não preencheu prioridades (8.1) nem definição de pronto (8.5). **Este PRD propõe a definição de pronto** (a validar com ele):

1. Escritório piloto cadastrado, aprovado e com ≥ N clientes vinculados vendo o painel com semáforo correto.
2. Cliente piloto emite NFS-e **em produção** e recebe XML/PDF.
3. DAS calculado, guia gerada e PGDAS-D **transmitida de verdade** para ≥ 1 competência de piloto.
4. Aviso automático de vencimento chegando por e-mail e WhatsApp.
5. Assinatura cobrada via Asaas (ao menos 1 ciclo em produção).
6. IA: explicação de imposto + sugestão de código ativos; onboarding conversacional com fallback.
7. Bloco E 100% (RLS provada por teste, sem itens de hardening abertos).
8. Testes: unitários + RLS + E2E verdes contra build de produção (padrão atual do repo mantido).

**Pontos a realinhar com o Michel (não travam A/E, travam D/B/C):**
- "Saldo disponível real" no dashboard (cli_2_2) — não existe fonte de dado bancário; propor "resumo financeiro" derivado de notas + honorários OU adiar integração bancária.
- DASN-SIMEI: transmissão automática impossível via SERPRO — apresentar o fluxo assistido.
- DEFIS: entra no lançamento ou V2?
- Validação real das credenciais SERPRO ("já tenho").
- Definição de pronto (seção acima) + nº de pilotos.

---

## 6. Fora do lançamento (V2+, confirmado na devolutiva)

Lucro Presumido/Real · eSocial/SPED/DCTFWeb/EFD-Reinf (cli_5_6: "não é necessário por enquanto") · folha/pró-labore (5.7) · pagamento de imposto via WhatsApp/PIX com conciliação (7.3) · cores da marca/domínio próprio/SLA no white-label · integração RedeSim · papéis internos no escritório · views materializadas do painel · app nativo (PWA cobre) · push/SMS.

---

## 7. Princípios de implementação (aplicam-se a todos os blocos)

1. **Correto por construção:** regra fiscal centralizada (RPC/lib única + testes por norma citada); dinheiro em centavos inteiros; parâmetros legais em tabela com vigência, nunca hard-coded.
2. **Segurança no banco, não na UI:** RLS é a fronteira; UI apenas evita frustração.
3. **Didático:** toda pendência/status fiscal tem explicação em português simples + citação da norma (tooltip/ajuda), no tom do produto.
4. **Design system atual intocado:** fontes (Syne/Outfit/Nunito), tokens Tailwind e componentes existentes; novos recursos = composição, não redesign.
5. **Determinístico decide, IA explica:** nenhum valor fiscal sai de LLM; IA traduz, sugere e conversa — com confirmação humana e trilha de auditoria.
6. **Dependência externa nunca no caminho do dev:** tudo que depende de credencial de terceiro é implementado contra sandbox/mock com virada por env.
