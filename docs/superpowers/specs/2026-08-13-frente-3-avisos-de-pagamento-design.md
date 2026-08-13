# Frente 3 redesenhada — avisos de pagamento por duas fontes (SERPRO + Asaas)

> **Status:** análise aprovada no desenho, pendente de aprovação para execução.
> **Substitui:** a dependência de Open Finance da Frente 3 do Bloco 7
> (`2026-08-12-bloco-7-dominio-sla-conciliacao-design.md`, §3.4 e Tasks 11–12).
> **Não substitui:** o matcher, o ponto de escrita único e as telas — tudo isso
> já foi executado e continua valendo.

## 1. O problema, na frase do cliente

Ele quer, no WhatsApp: **(a)** receber o meio de pagamento do DAS, **(b)** pagar,
**(c)** ser avisado quando o pagamento for reconhecido, e **(d)** receber
também os avisos de pagamento de honorários e despesas, que vivem no Asaas.
São **duas fontes de verdade diferentes** desaguando no mesmo canal.

## 2. O que a análise encontrou (13/08/2026)

### 2.1 🔴 A SERPRO não fornece Pix nem QR code — o pedido (a) muda de forma

`parseDasSimples` (`serpro-das-simples-parse.ts:14-23`) devolve exatamente:
`numeroDas`, `dataVencimento`, `valores`, `codigoDeBarras[]` e `pdfBase64`.
Não há campo de Pix — e a estrutura foi confirmada contra resposta real
(AL PISCINAS, competência 202604).

O PDF também não tem. Um DAS real guardado em `guias_fiscais.url_pdf`
(203 KB) contém **5 imagens**: duas de 846×237 (cabeçalho) e três de 1×1
(espaçadores). **Nenhuma imagem quadrada de tamanho de QR.** O DAS é documento
de arrecadação com código de barras.

**Consequência:** o que dá para entregar no WhatsApp é **valor, vencimento e a
linha digitável** — copiável no celular e pagável em qualquer app de banco —
mais o PDF. Pix exigiria um caminho fora da SERPRO (PSP de Pix Arrecadação, ou
intermediar pelo Asaas), e intermediar muda **quem responde pelo tributo**:
dinheiro na conta do escritório, autuação no cliente se algo falhar. É decisão
do cliente, não de engenharia, e fica **fora** desta frente.

### 2.2 🔴 O sync da SERPRO é o quarto caminho de baixa — e o único fora da RPC

`registrar_pagamento_guia` (0073) é o ponto único: marca a guia, resolve as
notificações e grava auditoria numa transação. Três caminhos o respeitam:

| Caminho | Arquivo | Passa pela RPC? |
|---|---|---|
| Baixa manual | `impostos/actions.ts:76` | ✅ |
| Confirmação de sugestão | `configuracoes/conciliacao/actions.ts:129` | ✅ |
| Cron da conciliação | `lib/conciliacao/cron.ts:128` | ✅ |
| **Sync da SERPRO** | `impostos/actions.ts:383` (`upsert` direto) | ❌ |

O sync grava `status: 'paga'` e `data_pagamento` por `upsert`. **Hoje, quando a
Receita revela que o DAS foi pago, ninguém é notificado e nada vai para a
auditoria.** É o invariante da própria Frente 3 sendo violado por código
anterior a ela — e vale corrigir independentemente do resto.

### 2.3 🟢 A conciliação já está construída e rodando

`rodarConciliacao(admin)` já é chamado pelo cron de obrigações
(`api/cron/obrigacoes/route.ts:176`), com o adapter mock. Matcher, ponto de
escrita único, telas de sugestão e o alerta `pagamento_nao_detectado` existem.
**Não é preciso construir a Frente 3 — é preciso trocar a fonte dela.**

### 2.4 🟡 `tipos.ts` está cinco tipos atrás do banco

O `CHECK` de `notifications.tipo` aceita **16** tipos; `lib/notifications/tipos.ts`
— que se declara "fonte única" — lista **11**. Faltam no arquivo:
`assinatura_trial_acabando`, `assinatura_cobranca_vencida`, `whatsapp_escalado`,
`sla_estourado`, `pagamento_nao_detectado`.

Não quebra a lista de notificações (ela renderiza `titulo`/`corpo` gravados na
linha), mas a tela de preferências itera `TIPOS_VALIDOS`
(`PreferenciasNotificacao.tsx:62`) — então **esses cinco avisos chegam e o
usuário não tem como desligá-los**, nem sabe que existem. `whatsapp_escalado`
já tem 11 linhas em produção.

Qualquer tipo novo desta frente entra **nos dois lugares**, ou vira o sexto.

### 2.5 🔴 Duas credenciais ausentes deixam a entrega muda

- **`UAZAPI_TOKEN` não existe** — nem no `.env.local`, nem na Vercel (produção
  tem `UAZAPI_BASE_URL` e `UAZAPI_WEBHOOK_SECRET`, não o token). `configDeEnv()`
  devolve `null` e `enviarMensagem` responde `{ok:false, skipped:true}`:
  **nenhuma mensagem sai, e nenhum erro aparece.**
- **`ASAAS_WEBHOOK_SECRET` não existe** — sem ele o webhook das subcontas não
  chega a ser cadastrado, e nenhum escritório fica sabendo que foi pago.
- **Nenhum token Asaas na Vercel de produção.** Decisão do cliente (13/08): por
  ora **chaves de teste**. Como `ASAAS_ENV` ausente já significa sandbox
  (`clients/asaas.ts:14`), basta publicar `TOKEN_ASAAS_SANDBOX` no ambiente para
  exercitar o fluxo — **sem tocar em `ASAAS_ENV`**.

Enquanto o primeiro item não for resolvido, tudo que esta frente construir
funciona no banco e não chega a ninguém.

## 3. O desenho

Três peças, nenhuma dependendo de credencial nova além das que já faltam.

### 3.1 Aviso de DAS disponível (substitui o pedido de QR/Pix)

Quando o DAS é gerado, o cliente recebe no WhatsApp: valor, vencimento e a
**linha digitável em mensagem própria** — sozinha, sem texto em volta, para o
toque-e-segura do celular copiar só o número — mais o link para o PDF na
plataforma.

Não enviamos o PDF como mídia nesta frente: `lib/uazapi/cliente.ts` só implementa
`/send/text`, e endpoint de mídia é escopo à parte.

### 3.2 Confirmação de pagamento do DAS (fonte: Receita)

O cron passa a consultar `consultarPagamentosDas` (PAGTOWEB / PAGAMENTOS71) por
empresa. Quando um DAS aparecer pago, a baixa é feita **por
`registrar_pagamento_guia`**, com origem própria — o que conserta o 2.2 e faz o
aviso de "pagamento confirmado" sair pelo caminho que já existe.

O casamento é por **número do documento**, não por valor: é chave real, e por
isso esta fonte não tem o risco de falso-positivo que fez a spec original exigir
"match inequívoco".

### 3.3 Confirmação de pagamento de honorário/despesa (fonte: Asaas)

No `PAYMENT_CONFIRMED` do webhook (`api/webhooks/asaas/route.ts`), criar a
notificação equivalente, com rótulo de origem diferente. Mesma saída de
WhatsApp, mesma coalescência.

### 3.4 O que as duas fontes compartilham

Um único tipo novo de notificação — `pagamento_confirmado` — com o `corpo`
dizendo a origem ("DAS de 04/2026 · confirmado pela Receita" × "Honorário de
maio · confirmado pelo Asaas"). Um tipo por fonte duplicaria a preferência do
usuário para a mesma pergunta ("quero saber quando um pagamento meu for
confirmado?").

## 4. Riscos e limites, declarados

- **Só Simples.** `impostos/actions.ts:298` corta em regime 1 ou 2 e o código diz
  "MEI virá depois" — ou seja, **metade do piloto não recebe o aviso de DAS**.
  Estender ao MEI é trabalho próprio (a consulta de pagamentos do MEI não foi
  investigada) e fica **fora** desta frente, declarado em vez de descoberto.
- **É polling.** O aviso chega no ritmo do cron, e a compensação na Receita não é
  instantânea. "Pagou agora, avisou agora" não existe por este caminho.
- **Depende do Termo/A1** de cada cliente, como tudo na SERPRO.
- **Volume de chamadas:** uma consulta PAGTOWEB por empresa por rodada. Com 30–60
  empresas isso é volume de contrato SERPRO que ninguém mediu — medir antes de
  subir a frequência do cron.
- **Idempotência:** guia já paga não pode gerar aviso de novo. A RPC já é
  idempotente; o teste tem que provar isso pelo caminho novo.

## 5. Tasks propostas

| # | O quê | Depende de |
|---|---|---|
| 1 | Migration: tipo `pagamento_confirmado` no `CHECK` **e** em `tipos.ts` (+ os 5 tipos órfãos do 2.4, que é a mesma linha de código) | — |
| 2 | Sync da SERPRO passa a baixar por `registrar_pagamento_guia` (conserta 2.2); teste que prova notificação e auditoria | 1 |
| 3 | `rodarPagamentosSerpro` no cron de obrigações: consulta por empresa, baixa pela RPC, contagens na resposta | 2 |
| 4 | Aviso de DAS disponível com linha digitável em mensagem própria | 1 |
| 5 | `PAYMENT_CONFIRMED` do Asaas → notificação `pagamento_confirmado` | 1 |
| 6 | Fechamento: suíte, `tsc`, build, roteiro de smoke | 1–5 |

## 6. Critérios de aceite

1. DAS gerado → mensagem no WhatsApp com valor, vencimento e a linha digitável
   isolada e copiável.
2. DAS pago na Receita → na rodada seguinte do cron a guia fica `paga` **pela
   RPC**, com linha em `audit_log` e aviso de confirmação no WhatsApp.
3. Rodar o cron duas vezes seguidas **não** gera aviso duplicado.
4. Honorário pago no Asaas (chave de teste) → aviso de confirmação pelo mesmo
   canal, com origem distinta na mensagem.
5. `pagamento_confirmado` aparece na tela de preferências e desligá-lo silencia
   o aviso das duas fontes.
6. Sem `UAZAPI_TOKEN`, tudo acima continua verdadeiro no banco e o envio é
   registrado como pulado — nunca como enviado.

## 7. Fora de escopo, explicitamente

Pix copia-e-cola e QR do DAS (§2.1) · envio de mídia no WhatsApp · aviso de DAS
para MEI · Open Finance (o adapter mock e as telas ficam onde estão, sem
provedor pago) · trocar `ASAAS_ENV` para produção.
