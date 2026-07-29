# Spec — Bloco 6B: canal de WhatsApp

> **Data:** 2026-07-29 · **Origem:** Bloco 6 do Master PRD (pilar C2), cindido do
> C3 (IA) já entregue como [Bloco 6A](2026-07-28-bloco-6a-explicacao-ia-design.md)
> **Estado:** desenho fechado, pronto para virar plano
> **Depende de:** um número de WhatsApp Business (WABA) conectado ao Envia.Click
> e templates aprovados pela Meta — **não bloqueia esta spec**, mas bloqueia o
> smoke ponta-a-ponta com mensagem de verdade chegando num celular.

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
não emite.** O agente de atendimento lê a situação fiscal já calculada pelo motor
determinístico — nunca decide um valor, nunca é a fonte de um número.

---

## 2. As três decisões que moldam o desenho

### 2.1 Consentimento é do número, não do assunto

Mensagem proativa de WhatsApp exige template aprovado pela Meta e, por LGPD,
consentimento explícito do titular para aquele canal. Diferente do e-mail (que
já tem opt-out por tipo de notificação), o WhatsApp nasce **opt-in, com o número
informado pelo próprio cliente no ato de ativar** — nunca herdado de um campo de
contato genérico que pode estar desatualizado ou nem ser o número certo.

v1 é um **interruptor único**: ativou, todos os tipos elegíveis passam a sair
também por WhatsApp; desativou, nenhum sai. Granularidade por tipo (como o
e-mail já tem) fica para se for pedida depois — o consentimento de canal é sobre
o número, não sobre o assunto de cada mensagem.

### 2.2 A IA de atendimento vive no Envia.Click, não no Balu

O Balu não constrói um chatbot. O Envia.Click já tem agentes de IA nativos
(dois ativos na conta hoje, atendendo outros inboxes) com runtime próprio de
conversa, threads e escalação para humano. O Balu constrói só a **skill** que
esse agente chama quando precisa saber algo sobre a situação fiscal de quem
está escrevendo — uma rota HTTP autenticada, sem estado de conversa nenhum do
nosso lado.

### 2.3 Sem cron novo

O plano Hobby da Vercel permite só 2 crons, e os dois já estão ocupados
(`obrigacoes`, `honorarios-recorrentes`) — o billing do Bloco 4A já foi embutido
dentro do cron de obrigações pela mesma razão. O disparo de WhatsApp segue o
mesmo caminho: mais um passo dentro do cron que já existe, não uma rota nova
agendada.

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

### 3.2 Motor de disparo (embutido no cron de obrigações)

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
rede pro Envia.Click é mais uma fatia desse orçamento, e o lote menor é a
válvula de segurança.

`app/src/app/api/cron/obrigacoes/route.ts` ganha um terceiro loop, depois do de
e-mail: por item, chama o cliente do Envia.Click e só em caso de sucesso marca
`enviada_whatsapp_em = now()`. Falha num item não bloqueia os outros. Sem
`ENVIACLICK_INBOX_ID_WHATSAPP` configurado (o caso de hoje, sem WABA), a chamada
é no-op logado — mesma convenção do `sendEmail` sem `RESEND_API_KEY`, nunca
derruba o cron.

Cliente novo `src/lib/envia-click/cliente.ts`: acha-ou-cria contato pelo
`whatsapp_numero`, acha-ou-cria conversa no inbox de WhatsApp, envia a mensagem
de template. Env vars novas: `ENVIACLICK_API_TOKEN`, `ENVIACLICK_ACCOUNT_ID`,
`ENVIACLICK_INBOX_ID_WHATSAPP`.

### 3.3 A skill de atendimento

```
POST /api/enviaclick/skills/situacao-fiscal
Header de segredo compartilhado (mesmo padrão de app/src/app/api/webhooks/segredo.ts,
não o CRON_SECRET — esta rota é chamada por um agente de terceiro, não pela infra Vercel)
```

- **Entrada:** `{ telefone: string }` (E.164).
- **Resolve:** `profiles.whatsapp_numero = telefone` → usuário → empresa atual.
- **Resposta:** situação fiscal atual, reaproveitando **literalmente**
  `src/lib/explicacoes/renderizar.ts` do 6A — a mesma explicação aprovada que
  aparece na tela de impostos, com os valores já trocados. Zero lógica nova
  duplicada entre os dois blocos.
- **Não encontrado:** resposta explícita de "não localizado"; a decisão de
  escalar para humano quando a IA não resolve é configuração **dentro do
  Envia.Click**, não desta rota.
- Log guarda o `profile_id` resolvido, nunca telefone nem dado fiscal em texto
  puro — mesmo princípio de nunca colocar dado sensível em log, inclusive log
  de erro.

### 3.4 Pagamento do DAS via WhatsApp: sondagem decide o escopo

**Primeira tarefa do plano**, antes de qualquer código de UI: sondar (leitura,
sobre guia já emitida, sem gerar nada novo) o retorno real do Focus/SERPRO atrás
de um campo de Pix Copia-e-Cola — hoje `src/lib/fiscal/das-mei.ts` não lê esse
campo e descarta em silêncio o que não reconhece (dívida já registrada na spec
do 6A, §7).

- **Se existir:** o parser passa a capturá-lo; o template de vencimento no
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

### 4.2 Sem credencial, sem WABA: no-op logado, nunca erro que derruba

Idêntico ao `sendEmail` sem chave. O cron de obrigações não pode quebrar por
causa de uma peça do 6B que ainda não tem número real conectado — isso vale
para todo o período entre este merge e o WABA existir.

### 4.3 A skill nunca inventa dado — só lê o que o motor já calculou

Mesma garantia do 6A (§5.5), pelo mesmo motivo: a rota chama
`renderizar.ts`, que só substitui marcador por valor já calculado. Não há
caminho em que a IA do Envia.Click veja um número que não passou pelo motor
determinístico — porque a skill nunca devolve um número que ela mesma calculou.

### 4.4 Contrato do Chatwoot para template fora da janela de 24h: sondar, não supor

Não sondado ainda — não há WABA para testar contra. Registrado aqui em vez de
assumido: o plano inclui uma tarefa de sondagem contra a API real do Envia.Click
(usando um inbox que já existe, sem WhatsApp, só para provar criação de
contato/conversa) antes de escrever o cliente definitivo.

---

## 5. Escopo

### Entra

- Migration: `profiles.whatsapp_numero` (único) + `profiles.whatsapp_habilitado_em`;
  `notifications.enviada_whatsapp_em`; RPC `notificacoes_pendentes_whatsapp`.
- Tela: seção de opt-in de WhatsApp em Conta → Notificações.
- Terceiro loop no cron de obrigações, com o cliente novo `src/lib/envia-click/cliente.ts`.
- Rota `POST /api/enviaclick/skills/situacao-fiscal`, autenticada por segredo
  compartilhado, reaproveitando `renderizar.ts` do 6A.
- Sondagem do Pix Copia-e-Cola do SERPRO, com o parser atualizado se o campo existir.
- Probe `scratchpad/_probe-6b.mjs` (fronteiras: anon não lê número nem executa a RPC).

### Não entra

- **O WABA real e os templates aprovados pela Meta** — provisionamento externo,
  em paralelo, fora do código.
- **A configuração do agente de IA dentro do Envia.Click** — feita na própria
  plataforma quando o WABA existir, não é código deste repo.
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
3. Com opt-in e sem WABA configurado, o cron continua rodando normalmente
   (no-op logado), sem afetar o envio de e-mail nem o billing que já dividem o
   mesmo cron.
4. A rota da skill devolve a mesma explicação que a tela de impostos mostraria
   para aquele cliente, dado o telefone certo — e "não encontrado" para um
   telefone sem perfil correspondente.
5. `anon`/`authenticated` não leem `profiles.whatsapp_numero` de outro usuário
   nem executam a RPC de disparo — provado por HTTP, sem login.
6. A suíte inteira roda sem rede e sem nenhuma das três credenciais novas do
   Envia.Click configuradas.
7. Sondagem do Pix do SERPRO documentada com resultado (achou ou não achou), não
   deixada como suposição.

---

## 7. Testes

- RPC `notificacoes_pendentes_whatsapp`: sem os dois campos de opt-in
  preenchidos, nunca aparece — sabotagem removendo o filtro prova que o teste
  morde.
- Loop do cron: item que falha não bloqueia os seguintes; sucesso marca
  `enviada_whatsapp_em`; ausência de credencial não derruba o cron.
- Cliente `envia-click`: unitário com fetch mockado (sucesso, erro, contato já
  existente vs. novo). Fora da suíte offline, um teste isolado (mesmo padrão do
  `scratchpad/vitest.ia.config.ts` do 6A) contra a API real do Envia.Click, num
  inbox que já existe, só para provar o contrato de contato/conversa.
- Rota da skill: segredo errado/ausente rejeitado; rate-limit respeitado;
  telefone sem perfil correspondente devolve "não encontrado"; telefone válido
  devolve o mesmo texto que `renderizar.ts` produziria.
- Probe `_probe-6b.mjs`: `anon` não lê `whatsapp_numero` nem executa a RPC —
  401 nos dois, sondado contra o banco real como os probes anteriores.

---

## 8. Base legal

- **LGPD** — consentimento explícito e específico para o canal WhatsApp,
  carimbado no momento do opt-in (não inferido, não herdado de outro cadastro).
- **Política de mensagem proativa da Meta/WhatsApp Business** — janela de 24h
  para resposta livre; fora dela, só template pré-aprovado. É por isso que a
  sondagem do §4.4 é pré-requisito do cliente definitivo, não um detalhe de
  implementação.
- **DL 9.295/46** — mesma fronteira do 6A: a skill de atendimento nunca é fonte
  de um número, só lê o que o motor determinístico já calculou.
