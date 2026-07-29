# Spec — Bloco 6B: canal de WhatsApp

> **Data:** 2026-07-29 · **Origem:** Bloco 6 do Master PRD (pilar C2), cindido do
> C3 (IA) já entregue como [Bloco 6A](2026-07-28-bloco-6a-explicacao-ia-design.md)
> **Estado:** desenho fechado, pronto para virar plano
> **Provedor:** [uazapi](https://uazapi.com) — API não-oficial (QR code, tipo
> Baileys/WPPConnect), conectada ao número de WhatsApp do escritório
> **Depende de:** uma instância uazapi provisionada e conectada — **não bloqueia
> esta spec**, mas bloqueia o smoke ponta-a-ponta com mensagem de verdade.

---

## 1. Objetivo e princípio

O Bloco 1 já sabe *o quê* avisar (vencimento, PGDAS-D pendente, DASN/DEFIS,
certificado, limite de faturamento) e *quando*. Hoje o único canal é e-mail.
Muito cliente da Balu não abre e-mail no dia — abre WhatsApp.

**Objetivo:** o mesmo motor de obrigações passa a também avisar por WhatsApp, com
consentimento explícito do cliente; e o cliente ganha um canal de atendimento com
IA para tirar dúvida simples sobre a própria situação fiscal, escalando para
humano quando não resolve.

**O princípio que governa o bloco:** *estender sem arriscar o que já funciona.*
Bloco 1 está em produção emitindo e-mail todo dia. Cada peça do 6B é **aditiva**
— tabela nova, coluna nova, função nova — e nada no caminho de e-mail muda uma
linha. Se o WhatsApp falhar por inteiro, o Bloco 1 continua exatamente como está.

O mesmo princípio do 6A se aplica aqui de novo: **a IA não calcula, não transmite,
não emite.** O atendimento lê a situação fiscal já calculada pelo motor
determinístico — nunca decide um valor, nunca é a fonte de um número.

---

## 2. As quatro decisões que moldam o desenho

### 2.1 Consentimento é do número, não do assunto

Mensagem proativa de WhatsApp — mesmo por API não-oficial — exige, por LGPD,
consentimento explícito do titular para aquele canal. Diferente do e-mail (que
já tem opt-out por tipo de notificação), o WhatsApp nasce **opt-in, com o número
informado pelo próprio cliente no ato de ativar** — nunca herdado de um campo de
contato genérico que pode estar desatualizado ou nem ser o número certo.

v1 é um **interruptor único**: ativou, todos os tipos elegíveis passam a sair
também por WhatsApp; desativou, nenhum sai. Granularidade por tipo (como o
e-mail já tem) fica para se for pedida depois.

### 2.2 A IA de atendimento é construída no Balu, reaproveitando o 6A

A uazapi é **só gateway de mensagem** — manda, recebe, dispara webhook. Não há
CRM nem agente de IA nativo para configurar, diferente do que uma plataforma
tipo Chatwoot ofereceria. Por isso a lógica de conversa é **código nosso**: um
webhook de entrada resolve quem está falando, monta o contexto com o que o
motor determinístico já calculou, e chama o mesmo `lib/ai/` que o 6A construiu
(mesmo `config_ia`, mesmos adaptadores) para redigir a resposta.

### 2.3 Escalação é notificação, não inbox novo

Sem CRM, não há tela de conversa pronta para o contador assumir uma conversa. Em
vez de construir um mini-inbox (escopo grande, essencialmente reconstruir o que
um Chatwoot daria de graça), a escalação é: o bot avisa o cliente que o contador
vai responder, e cria uma **notificação in-app** para o contador (reaproveitando
o motor do Bloco 1) com a pergunta original. O humano responde **pelo próprio
WhatsApp** do número conectado — conexão não-oficial normalmente deixa o
app/WhatsApp Web do número seguir funcionando em paralelo à API, então o
contador vê e responde a conversa como qualquer mensagem que chegasse no celular
dele.

### 2.4 Sem cron novo

O plano Hobby da Vercel permite só 2 crons, e os dois já estão ocupados
(`obrigacoes`, `honorarios-recorrentes`) — o billing do Bloco 4A já foi embutido
dentro do cron de obrigações pela mesma razão. O disparo proativo de WhatsApp
segue o mesmo caminho: mais um passo dentro do cron que já existe.

---

## 3. Arquitetura

### 3.1 Consentimento e dado novo

```
profiles.whatsapp_numero          text, E.164, único
profiles.whatsapp_habilitado_em   timestamptz, nulo até o opt-in
```

Vive em `profiles` (o destinatário de `notifications` é `owner_user_id`, um
usuário — não uma empresa; o mesmo usuário pode ter várias empresas).

Tela: nova seção "WhatsApp" em `PreferenciasNotificacao.tsx` (aba Notificações de
Conta), ao lado do que já existe para e-mail. Ativar grava o número e carimba
`whatsapp_habilitado_em = now()` — **esse carimbo é a prova de consentimento**,
não um checkbox solto.

### 3.2 Disparo proativo (embutido no cron de obrigações)

```
notifications.enviada_whatsapp_em   timestamptz   -- espelha enviada_email_em
```

RPC nova, mesmo molde de `notificacoes_pendentes_email`:

```sql
CREATE FUNCTION notificacoes_pendentes_whatsapp(p_limite int DEFAULT 50)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text,
  action_href text, whatsapp_numero text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.action_href,
         p.whatsapp_numero
  FROM notifications n
  JOIN profiles p ON p.id = n.owner_user_id
  WHERE n.enviada_whatsapp_em IS NULL
    AND p.whatsapp_numero IS NOT NULL
    AND p.whatsapp_habilitado_em IS NOT NULL
  ORDER BY n.created_at
  LIMIT p_limite;
$$;
```

`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` — mesmo padrão de
sempre. `p_limite` default **50, metade do e-mail**: o cron já embute
materialização + e-mail + billing dentro de `maxDuration = 60`; a chamada de
rede pra uazapi é mais uma fatia desse orçamento, e o lote menor é a válvula de
segurança — e, como o §4.4 registra, também limita o volume de envio
automatizado por execução.

`app/src/app/api/cron/obrigacoes/route.ts` ganha um terceiro loop, depois do de
e-mail: por item, chama `src/lib/uazapi/cliente.ts` e só em caso de sucesso
marca `enviada_whatsapp_em = now()`. Falha num item não bloqueia os outros. Sem
`UAZAPI_TOKEN`/instância configurada (o caso de hoje), a chamada é no-op logado
— mesma convenção do `sendEmail` sem `RESEND_API_KEY`, nunca derruba o cron.

Env vars novas: `UAZAPI_BASE_URL` (instâncias uazapi são por URL própria),
`UAZAPI_TOKEN`, `UAZAPI_WEBHOOK_SECRET` (ver §3.3).

### 3.3 Atendimento com IA — webhook de entrada

```
POST /api/webhooks/uazapi
```

Mesmo padrão dos webhooks reais do repo (`app/src/app/api/webhooks/segredo.ts`,
comparação em tempo constante) — **mas o rate-limit é por telefone remetente,
não por IP**: quem chama esta rota é sempre o servidor da uazapi, o IP nunca
identifica o cliente final.

Fluxo, por mensagem recebida:

1. **Idempotência primeiro** — `message_id_externo` já visto em
   `whatsapp_atendimentos`? Se sim, ignora (webhook pode reenviar).
2. **Resolve** `profiles.whatsapp_numero = telefone`.
   - **Não encontrado**: não responde com nenhum dado fiscal — não dá pra
     personalizar sem saber quem é. Só uma mensagem genérica pedindo para
     confirmar identidade pelo app, e uma notificação ao contador sobre número
     desconhecido.
   - **Encontrado**: monta o contexto com `src/lib/explicacoes/renderizar.ts`
     do 6A — a mesma garantia de lá: a IA nunca inventa número, só fala sobre o
     que o motor determinístico já calculou.
3. Chama o provedor de IA já configurado (`config_ia`, do 6A) pedindo resposta
   **estruturada**: `{ resposta: string, resolvido: boolean }`.
4. `resolvido = true` → responde direto, via `src/lib/uazapi/cliente.ts`.
   `resolvido = false` → responde ao cliente avisando que o contador vai
   responder, e cria notificação in-app (motor do Bloco 1) para o contador, com
   a pergunta original.
5. Grava a linha em `whatsapp_atendimentos` (telefone, mensagem recebida,
   resposta, `resolvido`, `message_id_externo`) — **auditoria e idempotência,
   sem tela nova nesta rodada.**

`whatsapp_atendimentos`: sem RLS para `authenticated`/`anon` (mesmo tratamento
de `config_ia` no 6A — só `service_role` e leitura direta no banco quando
precisar auditar).

### 3.4 Pagamento do DAS via WhatsApp: sondagem decide o escopo

**Primeira tarefa do plano**, antes de qualquer código de UI: sondar (leitura,
sobre guia já emitida, sem gerar nada novo) o retorno real do Focus/SERPRO atrás
de um campo de Pix Copia-e-Cola — hoje `src/lib/fiscal/das-mei.ts` não lê esse
campo e descarta em silêncio o que não reconhece (dívida já registrada na spec
do 6A, §7).

- **Se existir:** o parser passa a capturá-lo; a mensagem de vencimento no
  WhatsApp inclui o Pix como texto — sem gateway novo, é texto na mensagem.
- **Se não existir:** fica documentado como adiado nesta seção mesmo, e a
  mensagem de vencimento segue só com o link para o app. Não bloqueia as outras
  duas frentes (notificação e atendimento).

---

## 4. Modos de falha, e como cada um é fechado

### 4.1 Opt-in é o único portão — nunca herdar número de outro lugar

`companies.telefone` existe e é tentador de reaproveitar, mas é campo de
contato genérico (pode estar errado, desatualizado, ou nem ser WhatsApp). A RPC
de disparo só olha `profiles.whatsapp_numero` + `whatsapp_habilitado_em` — os
dois preenchidos **pelo próprio ato de ativar na tela**, nunca por migração de
dado existente.

### 4.2 Sem credencial, sem instância: no-op logado, nunca erro que derruba

Idêntico ao `sendEmail` sem chave. O cron de obrigações não pode quebrar por
causa de uma peça do 6B que ainda não tem instância uazapi real conectada.

### 4.3 O atendimento nunca inventa dado — só lê o que o motor já calculou

Mesma garantia do 6A (§5.5), pelo mesmo motivo: o webhook chama
`renderizar.ts`, que só substitui marcador por valor já calculado. Não há
caminho em que a IA veja um número que não passou pelo motor determinístico —
porque o prompt nunca carrega um número que ela mesma teria que inventar.

### 4.4 Risco operacional: número em API não-oficial pode ser bloqueado

Conexão via QR code (Baileys/WPPConnect) não exige template aprovado pela Meta,
mas está **fora do Termos de Serviço oficial do WhatsApp Business** — envio
proativo automatizado em volume é o padrão clássico que sistemas antispam do
WhatsApp detectam, com risco real de bloqueio do número.

Isso não bloqueia o desenho, mas é registrado como risco operacional a
observar: o `p_limite=50` do §3.2 já limita o volume por execução do cron, e
**a primeira janela de envios proativos em produção deve ser acompanhada** —
se o número for sinalizado, a mitigação é reduzir o `p_limite` e espaçar os
envios, não desligar o consentimento já dado.

### 4.5 Contrato do webhook da uazapi: sondar, não supor

O formato exato do payload que a uazapi envia (estrutura da mensagem, como ela
assina/autentica o webhook) não foi sondado ainda — não há instância
conectada. O plano inclui uma tarefa de sondagem contra a documentação e, assim
que houver instância, contra o webhook real, antes de fechar o parser do
payload.

---

## 5. Escopo

### Entra

- Migration: `profiles.whatsapp_numero` (único) + `profiles.whatsapp_habilitado_em`;
  `notifications.enviada_whatsapp_em`; RPC `notificacoes_pendentes_whatsapp`;
  tabela `whatsapp_atendimentos`.
- Tela: seção de opt-in de WhatsApp em Conta → Notificações.
- Terceiro loop no cron de obrigações, com o cliente novo `src/lib/uazapi/cliente.ts`.
- Rota `POST /api/webhooks/uazapi`: resolve remetente, monta contexto com
  `renderizar.ts` do 6A, chama `lib/ai/` para responder ou decidir escalar,
  cria notificação (Bloco 1) em caso de escalação.
- Sondagem do Pix Copia-e-Cola do SERPRO, com o parser atualizado se o campo existir.
- Sondagem do contrato do webhook da uazapi (payload, autenticação).
- Probe `scratchpad/_probe-6b.mjs` (fronteiras: anon não lê número, não executa
  a RPC, não lê `whatsapp_atendimentos`).

### Não entra

- **A instância uazapi conectada de verdade** — provisionamento externo, em
  paralelo, fora do código.
- **Tela de inbox/conversa** — escalação é notificação in-app; o humano
  responde pelo próprio WhatsApp do número.
- Granularidade por tipo de notificação no opt-in do WhatsApp (v1 é interruptor
  único).
- Pagamento via WhatsApp, **se** a sondagem do SERPRO não achar o Pix.
- Qualquer coisa de IA que já não exista no 6A (o motor de explicação é
  reaproveitado, não reescrito).

---

## 6. Critérios de aceite

1. Cliente ativa WhatsApp em Conta → Notificações, informa o número, e o opt-in
   fica registrado com carimbo de data/hora.
2. Sem opt-in, nenhuma notificação sai por WhatsApp — provado pela RPC, não pela
   tela.
3. Com opt-in e sem instância uazapi configurada, o cron continua rodando
   normalmente (no-op logado), sem afetar o envio de e-mail nem o billing que
   já dividem o mesmo cron.
4. Mensagem recebida de um telefone conhecido gera resposta com a mesma
   explicação que a tela de impostos mostraria para aquele cliente; de um
   telefone desconhecido, resposta genérica + notificação de número
   desconhecido, nunca dado fiscal de terceiro.
5. Quando a IA não resolve, o cliente recebe aviso de escalação e o contador
   recebe notificação in-app com a pergunta original.
6. Reenvio do mesmo `message_id_externo` pela uazapi não gera resposta
   duplicada.
7. `anon`/`authenticated` não leem `profiles.whatsapp_numero` de outro usuário,
   não leem `whatsapp_atendimentos` nem executam a RPC de disparo — provado por
   HTTP, sem login.
8. A suíte inteira roda sem rede e sem nenhuma das credenciais novas da uazapi
   configuradas.
9. Sondagem do Pix do SERPRO documentada com resultado (achou ou não achou), não
   deixada como suposição.

---

## 7. Testes

- RPC `notificacoes_pendentes_whatsapp`: sem os dois campos de opt-in
  preenchidos, nunca aparece — sabotagem removendo o filtro prova que o teste
  morde.
- Loop do cron: item que falha não bloqueia os seguintes; sucesso marca
  `enviada_whatsapp_em`; ausência de credencial não derruba o cron.
- Cliente `uazapi`: unitário com fetch mockado (sucesso, erro). Fora da suíte
  offline, um teste isolado (mesmo padrão do `scratchpad/vitest.ia.config.ts`
  do 6A) contra a instância real, quando existir.
- Webhook `/api/webhooks/uazapi`: segredo errado/ausente rejeitado; rate-limit
  por telefone respeitado; `message_id_externo` repetido não duplica resposta;
  telefone sem perfil correspondente não recebe dado fiscal; telefone válido
  recebe o mesmo texto que `renderizar.ts` produziria quando `resolvido=true`;
  `resolvido=false` gera notificação de escalação com a pergunta original.
- Probe `_probe-6b.mjs`: `anon` não lê `whatsapp_numero`, não lê
  `whatsapp_atendimentos`, não executa a RPC — 401 em todos, sondado contra o
  banco real.

---

## 8. Base legal e riscos operacionais

- **LGPD** — consentimento explícito e específico para o canal WhatsApp,
  carimbado no momento do opt-in (não inferido, não herdado de outro cadastro).
- **DL 9.295/46** — mesma fronteira do 6A: o atendimento nunca é fonte de um
  número, só lê o que o motor determinístico já calculou.
- **Risco de bloqueio do número** (não é base legal, é risco operacional
  registrado no §4.4): API não-oficial está fora do ToS do WhatsApp Business;
  envio proativo automatizado exige volume controlado e acompanhamento nas
  primeiras semanas em produção.
