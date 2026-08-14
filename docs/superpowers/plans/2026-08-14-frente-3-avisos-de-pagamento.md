# Frente 3 — avisos de pagamento por duas fontes (SERPRO + Asaas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente recebe no WhatsApp **como pagar o DAS** (valor, vencimento e
a linha digitável isolada) e **quando o pagamento foi reconhecido** — pela
Receita, no caso do DAS, e pelo Asaas, no caso de honorário e despesas. De
quebra, conserta um defeito que já existe: a descoberta de pagamento pela
SERPRO hoje não notifica ninguém e não deixa rastro de auditoria.

**Architecture:** nada de infraestrutura nova. As duas fontes desaguam no
**ponto de escrita único que já existe** (`registrar_pagamento_guia`, 0072) e no
**loop de WhatsApp que já roda** (`api/cron/obrigacoes/route.ts`). O trabalho é
(a) alargar a RPC para aceitar a origem `serpro` e passar a **criar** o aviso de
confirmação, (b) tirar o sync da SERPRO do `upsert` direto, (c) consultar
pagamentos por empresa no cron, e (d) partir a mensagem de WhatsApp em duas para
a linha digitável ficar copiável.

**Tech Stack:** Postgres/Supabase (migrations + RPC, aplicadas pelo runner
node+pg do scratchpad — **nunca pelo MCP do Supabase**, que aponta para conta
errada), Next.js App Router (route handlers, server actions), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-frente-3-avisos-de-pagamento-design.md`

---

## Verificado no código antes do plano (7 achados que mudam a execução)

Tudo abaixo foi lido no repositório em 14/08/2026, não inferido da spec.

1. 🔴 **A RPC recusa a origem que a spec manda usar.**
   `0072_registrar_pagamento_guia.sql:28` faz
   `IF p_origem NOT IN ('manual','conciliacao','conciliacao_confirmada') THEN RAISE EXCEPTION`.
   Chamar com `p_origem: 'serpro'` **estoura em runtime**. A Task 2 só é
   possível com uma migration que alargue essa lista — a spec pede "origem
   própria" sem dizer que a validação mora dentro da função.

2. 🔴 **A RPC resolve notificações, mas não cria nenhuma.**
   Ela faz `UPDATE ... SET resolvida_em` nos avisos `das_a_vencer`/`das_vencido`
   (0072:70-75). Ninguém insere nada. Então `pagamento_confirmado` precisa de um
   ponto de criação — e o lugar certo é **dentro da própria RPC**: assim os
   **quatro** caminhos de baixa (manual, sugestão confirmada, cron da
   conciliação e o novo sync da SERPRO) ganham o aviso de uma vez, na mesma
   transação que já grava a auditoria. Criar no chamador daria o aviso a um
   caminho só e repetiria o erro que a 0072 existe para não repetir.

3. 🟡 **O card e a spec citam a migration errada.** A RPC é a **0072**, não a
   0073. Detalhe de referência, mas quem for aplicar procura o arquivo.

4. 🔴 **`notificacoes_pendentes_whatsapp` não consulta preferência nenhuma.**
   Última definição em `0068_coalescer_whatsapp_por_guia.sql:64-88`: filtra por
   `whatsapp_numero`/`whatsapp_habilitado_em` do profile e nada mais. E
   `notification_preferences` (0045:42-48) só tem **`email_enabled`** — não
   existe coluna de WhatsApp. Ou seja, o **critério de aceite 5 da spec**
   ("desligá-lo silencia o aviso das duas fontes") é **falso hoje para o canal
   WhatsApp**, para qualquer tipo. Ver "Decisão pendente" abaixo.

5. 🟡 **A linha digitável só é buscada para dois tipos.** O `LEFT JOIN` da
   0068:74-75 tem `CASE WHEN n.tipo IN ('das_a_vencer','das_vencido')`. Tipo novo
   que precise da linha tem de entrar nesse `CASE` — `pagamento_confirmado` não
   precisa (o pagamento já aconteceu), mas é a linha a conferir se um dia
   precisar.

6. 🟡 **O ponto de entrada do Asaas não é a rota.** A spec manda mexer em
   `api/webhooks/asaas/route.ts`, mas quem escreve o pagamento do escritório é
   `lib/billing/aplicar-cobranca-escritorio.ts`, compartilhado pelo webhook **e**
   pela varredura diária de reconciliação (`lib/billing/cron.ts`). O módulo
   existe exatamente porque "os dois têm de escrever a mesma coisa" — notificar
   só na rota faria o pagamento descoberto pela varredura passar em silêncio,
   que é o mesmo defeito do achado 2.2 da spec, em outra tabela.

7. 🟢 **`pagamento_confirmado` já existe como string no código — em outro
   namespace.** `api/webhooks/asaas/route.ts:47` usa a chave
   `pagamento_confirmado` no mapa `EFEITO_STATUS` (efeito de evento do Asaas).
   Não colide com `notifications.tipo`, e **não deve ser unificado** — são
   vocabulários diferentes. Registrado para ninguém "arrumar" isso depois.

**Números:** próxima migration é a **0086** (última aplicada: `0085_cert_enviado_por.sql`).
A lista viva do `CHECK` tem **16 tipos** (`0081:22-29`) — copiar de lá, nunca
"do plano": a 0061 já quase apagou dois tipos remontando essa lista de memória,
e a 0081 documenta o susto.

---

## Decisão tomada (14/08/2026): **(a) escopo honesto + card próprio**

O usuário escolheu (a). Entregue assim: o critério 5 vale para e-mail, a tela de
preferências ganhou um aviso dizendo o que ela governa, e o conserto virou o card
**"Preferência de notificação por canal — o WhatsApp ignora a tela"** (To Do).
O texto original da decisão fica abaixo, como registro do que foi pesado.

## ~~Decisão pendente~~ (resolvida — ver acima)

O critério de aceite 5 pede que desligar `pagamento_confirmado` silencie o aviso
nas duas fontes. Hoje a tela de preferências só governa **e-mail** (achado 4).
Três saídas:

- **(a) Escopo honesto:** o critério vale para e-mail; no WhatsApp o controle
  continua sendo o interruptor global (`whatsapp_habilitado_em`). Zero migration
  extra. É o que a spec entrega de fato.
- **(b) Preferência por canal:** coluna `whatsapp_enabled` em
  `notification_preferences` + join em `notificacoes_pendentes_whatsapp` + a tela.
  Conserta para **todos** os 17 tipos, não só o novo. Custa uma migration e uma
  tela — é a Task 7 que a spec não previu.
- **(c) Adiar:** entregar (a) agora e abrir card próprio para (b).

**Recomendação: (a) agora, com card aberto para (b).** A frente já tem um
bloqueio operacional (sem `UAZAPI_TOKEN` nada sai) — ampliar escopo para
consertar preferência de um canal mudo troca entrega por arrumação. Mas a
escolha é do usuário, e o Task 6 tem de declarar qual foi.

---

## Tasks

### - [ ] Task 1 — Migration 0086: o tipo novo e os 5 órfãos

**Arquivos:** `app/supabase/migrations/0086_pagamento_confirmado.sql` (novo),
`app/src/lib/notifications/tipos.ts`, `app/src/lib/notifications/tipos.test.ts`

1. Migration: `DROP`/`ADD CONSTRAINT notifications_tipo_check` com os **16 tipos
   da 0081** + `pagamento_confirmado`. Copiar a lista de `0081:23-28`,
   conferindo antes contra o banco vivo (`SELECT pg_get_constraintdef(...)`) —
   é o ritual que a própria 0081 pede.
2. `tipos.ts` ganha **6** entradas, não 1: `pagamento_confirmado` mais os cinco
   órfãos do achado 2.4 da spec (`assinatura_trial_acabando`,
   `assinatura_cobranca_vencida`, `whatsapp_escalado`, `sla_estourado`,
   `pagamento_nao_detectado`). Labels em português de cliente, severidades:
   `pagamento_confirmado` = `info`; os dois de assinatura = `warning`;
   `sla_estourado`/`pagamento_nao_detectado` = `warning`; `whatsapp_escalado` =
   `info`.
3. `PreferenciasNotificacao.tsx:29` já filtra `abertura_etapa` da tela. Avaliar
   se `whatsapp_escalado` e `parametro_fiscal_desatualizado` (avisos internos,
   não do cliente) merecem o mesmo filtro — decidir e comentar a decisão no
   código, não deixar implícito.
4. **Teste que fecha o buraco de vez:** um teste que compara `TIPOS_VALIDOS` com
   a lista do `CHECK` extraída da migration mais recente e falha se divergirem.
   Sem ele, o sexto órfão aparece em três meses.

**Verificação:** `vitest` do `tipos.test.ts` verde; migration aplicada pelo
runner node+pg e conferida com `SELECT` do `constraintdef` (17 tipos).

---

### - [ ] Task 2 — Migration 0087 + sync da SERPRO pela RPC (conserta o 2.2)

**Arquivos:** `app/supabase/migrations/0087_pagamento_confirmado_na_rpc.sql`
(novo), `app/src/app/(auth)/(gated)/impostos/actions.ts`

**2a. A RPC (`CREATE OR REPLACE` da `registrar_pagamento_guia`, preservando tudo
o que a 0072 já faz):**
- `p_origem` passa a aceitar `'serpro'` (achado 1).
- Depois do `UPDATE` da guia e antes do `audit_log`, **inserir** a notificação
  `pagamento_confirmado` para `companies.user_id` da empresa da guia, com:
  - `chave` = `'pagamento_confirmado:' || p_guia_id` → o `ON CONFLICT
    (owner_user_id, chave) DO NOTHING` do índice da 0045 garante o critério de
    aceite 3 (rodar o cron duas vezes não duplica aviso) **em cima do índice, não
    da esperança**;
  - `corpo` declarando a origem em português — "confirmado pela Receita"
    (`serpro`), "confirmado pelo banco" (`conciliacao`/`conciliacao_confirmada`),
    "baixa registrada no painel" (`manual`);
  - `entidade_ref` = a guia, `action_href` = `/impostos`.
- O `RETURN` ganha `notificacao_criada` (bool), para o cron poder contar.
- ⚠️ O caminho `v_ja_paga IS NOT NULL` continua retornando cedo, **sem criar
  aviso** — é o que preserva a idempotência já provada.

**2b. A action (`consultarDeclaracoesAction`, hoje em `actions.ts:327-388`):**
- As linhas do caso `pag` (`actions.ts:343-352`) deixam de carregar
  `status: 'paga'` e `data_pagamento`. Continuam carregando os **valores** do
  PAGAMENTOS71 (`valor_total`, `principal`, `multa`, `juros`,
  `data_vencimento`) — a RPC não escreve valor nenhum, só status/data.
- O `upsert` (`actions.ts:384-386`) ganha `.select('id, competencia_referencia')`
  para devolver os ids — a guia pode estar **nascendo** nesse mesmo upsert, e sem
  o id não há como chamar a RPC.
- Para cada competência que veio paga, chamar
  `registrar_pagamento_guia(p_guia_id, pag.dataPagamento, 'serpro')`. Erro por
  guia **não** é fatal: acumula e segue (o padrão de `lib/conciliacao/cron.ts:134`).
- A action roda como usuário logado → a RPC exige `user_owns_company`. Como o
  `companyId` vem de `profiles.current_company`, a checagem passa; declarar isso
  em comentário para ninguém reaproveitar a action no painel do contador sem ver
  que ali ela falharia.

**Verificação:** teste de unidade que mocka o `rpc` e prova que (i) a chamada
acontece com `p_origem: 'serpro'`, (ii) o upsert não manda mais `status: 'paga'`,
(iii) erro da RPC não derruba as outras competências. Depois, prova no banco
vivo: uma guia marcada paga por esse caminho tem **uma** linha em `audit_log`
com `origem: 'serpro'` e **uma** notificação `pagamento_confirmado`; rodar de
novo mantém 1 e 1.

---

### - [ ] Task 3 — `rodarPagamentosSerpro` no cron de obrigações

**Arquivos:** `app/src/lib/fiscal/pagamentos-serpro-cron.ts` (novo),
`app/src/app/api/cron/obrigacoes/route.ts`

- Varre empresas do Simples (regime `1`/`2` — mesmo corte de `actions.ts:298`,
  extraído para uma constante compartilhada em vez de repetir o literal) **com
  guia em aberto**, chama `consultarPagamentosDas(admin, companyId, ano)` e baixa
  por `registrar_pagamento_guia` com origem `'serpro'`. Casamento por **número do
  documento**, reutilizando `normalizarNumeroDas` — hoje privada em
  `actions.ts:272`; exportar de um módulo compartilhado, não duplicar.
- **Orçamento de tempo obrigatório.** `maxDuration = 60` já está apertado (o
  comentário de `route.ts:16-26` explica o que morre quando estoura) e isto
  adiciona **uma chamada SERPRO por empresa**. Reutilizar `dentroDoOrcamento` e
  `ordenarFila` de `lib/fiscal/apuracao-cron-plano.ts`, com fila ordenada por
  "quem está sem consultar há mais tempo" — o que não couber hoje entra amanhã na
  frente. Sem isso, o risco medido pela própria spec (30–60 empresas, volume que
  ninguém mediu) vira timeout de wall-clock, que **não é capturável por
  try/catch**.
- **Posição na rota:** depois de `rodarConciliacao` e antes de `rodarBilling`,
  dentro do seu próprio `try/catch`, seguindo a disciplina já escrita ali
  (obrigação fiscal primeiro, HTTP de terceiro por último).
- Resposta do cron ganha `pagamentos_serpro: { empresas, consultadas, baixadas,
  erros, cortada_por_orcamento }`.

**Verificação:** teste com `consultarPagamentosDas` mockado provando casamento
por número, corte por orçamento e que guia já paga **não** conta como baixa nova
(o mesmo cuidado de `conciliacao/cron.ts:135-140`). No smoke, uma rodada real
contra uma empresa com Termo válido.

---

### - [ ] Task 4 — Linha digitável em mensagem própria

**Arquivos:** `app/src/app/api/cron/obrigacoes/route.ts`
(`montarTextoWhatsapp` + o loop de envio), teste do route

Hoje `montarTextoWhatsapp` (`route.ts:35-49`) empacota tudo numa mensagem só,
com o rótulo "Código para pagar…" **acima** da linha — o toque-e-segura do
celular copia o parágrafo inteiro. A spec pede a linha **sozinha**.

- Partir em duas: `montarTextoWhatsapp` devolve `{ corpo, linhaDigitavel? }`, e o
  loop envia a segunda mensagem **só** quando há linha.
- ⚠️ **Armadilha de idempotência.** `enviada_whatsapp_em` é carimbado uma vez
  (`route.ts:160`). Se a mensagem 1 der certo e a 2 falhar, a próxima rodada
  reenvia **as duas** — o cliente recebe o aviso duplicado. Duas saídas:
  carimbar só quando as duas passarem (aceitando a duplicata rara) ou **enviar a
  linha primeiro e o corpo depois**, carimbando no sucesso do último. Escolher,
  comentar a escolha no código e cobrir com teste — não deixar isso para o
  runtime descobrir.
- Manter o `montarTextoWhatsapp` como função pura, que é o que a torna testável
  sem rede (o comentário de `route.ts:32-34` já defende isso).

**Verificação:** teste de unidade da montagem (com e sem linha) e teste do loop
com `enviarMensagem` mockado provando duas chamadas, a segunda contendo
**apenas** dígitos/espaços da linha.

---

### - [ ] Task 5 — Asaas: pagamento confirmado vira aviso

**Arquivos:** `app/src/lib/billing/aplicar-cobranca-escritorio.ts`,
`app/src/lib/billing/aplicar-cobranca-escritorio.test.ts`

- O gancho é o ramo `novo.status === 'paga'` (linha 138-143), **não** a rota
  (achado 6) — assim o webhook e a varredura diária notificam igual.
- **Dois destinatários, conforme aprovado no card:**
  - **cliente** → `companies.user_id` de `cobrancas_escritorio.empresa_cliente_id`,
    corpo "Honorário de <competência> · confirmado pelo Asaas";
  - **escritório** → membros da `contabilidade_id`, corpo de *recebimento*
    ("entrou o pagamento de <cliente>"), que é outra frase e outro leitor.
- `chave` = `'pagamento_confirmado:cobranca:' || cob.id` (+ sufixo do papel), pelo
  mesmo motivo da Task 2: o Asaas **reentrega** eventos, e a tabela
  `cobrancas_escritorio` já carrega essa cicatriz (0053:76-79).
- Inserir **depois** do compare-and-swap ter afetado linha (`afetadas.length > 0`).
  Notificar antes seria avisar de um pagamento que outro escritor pode ter
  desfeito.
- Falha ao notificar **loga e segue** — nunca derruba a escrita do dinheiro, que é
  a disciplina do módulo inteiro.

**Verificação:** testes provando que (i) `paga` gera os dois avisos, (ii)
reentrega do mesmo evento (`perdeu_corrida`/`sem_efeito`) **não** gera nenhum,
(iii) `estornada` não gera aviso de confirmação.

---

### - [ ] Task 6 — Fechamento

- `npx tsc --noEmit` → 0 erros.
- `vitest` → suíte inteira verde (baseline da sessão 25: **1700** testes).
- `next build` limpo.
- **Declarar no CHECKPOINT qual saída da "Decisão pendente" foi tomada** e, se
  for (a) ou (c), abrir o card da preferência por canal no Trello.
- Roteiro de smoke escrito para o usuário rodar, cobrindo os 6 critérios de
  aceite, com o passo 6 explícito: **sem `UAZAPI_TOKEN`, conferir no banco** que
  `enviada_whatsapp_em` continua `NULL` e o contador do cron reporta
  `whatsapp_pulados` — nunca `enviados`.

---

## O que este plano deliberadamente NÃO faz

- **Pix/QR do DAS** — a SERPRO não fornece (§2.1 da spec, confirmado na API e num
  PDF real). Intermediar pelo Asaas mudaria quem responde pelo tributo: decisão
  do cliente, não de engenharia.
- **DAS de MEI** — o corte em `actions.ts:298` fica. É **metade do piloto** sem
  aviso de DAS, declarado em vez de descoberto.
- **Mídia no WhatsApp** — `lib/uazapi/cliente.ts` só implementa `/send/text`.
- **Preferência por canal** — ver "Decisão pendente".
- **Trocar `ASAAS_ENV`** — segue sandbox.

## O bloqueio que nenhuma task remove

🔴 Sem `UAZAPI_TOKEN`, `configDeEnv()` devolve `null` e `enviarMensagem` responde
`{ok:false, skipped:true}` (`cliente.ts:26-36`): **tudo isto funciona no banco e
não chega a ninguém, sem erro nenhum**. O número anterior era pessoal e a
remoção foi deliberada (12/08). Provisionar a instância é pré-requisito de
qualquer demonstração ao cliente — e a coalescência da 0068 existe justamente
para que, no dia em que o token voltar, o backlog acumulado não vire uma rajada.
