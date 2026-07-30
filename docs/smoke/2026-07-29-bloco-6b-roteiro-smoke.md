# Bloco 6B — roteiro do smoke manual (canal de WhatsApp via uazapi)

> **Status: PARCIAL, de propósito.** Não existe instância uazapi real
> conectada ainda — o usuário está provisionando em paralelo. Este roteiro
> prova tudo que dá para provar **sem** uma instância de verdade: opt-in,
> RLS/grants, o cron não quebrando o Bloco 1, e o webhook de entrada com IA +
> escalação, tudo por HTTP direto/SQL. O que **não** dá para provar sem a
> instância está isolado na seção final, não misturado no meio.
>
> **Branch:** `feat/bloco-6b-whatsapp` (não mergeada) · **Plano:**
> `docs/superpowers/plans/2026-07-29-bloco-6b-whatsapp.md` · **Spec:**
> `docs/superpowers/specs/2026-07-29-bloco-6b-whatsapp-design.md`
> **Migration:** `0061_whatsapp.sql` (aditiva; nenhuma linha do caminho de
> e-mail do Bloco 1 muda)
> **Verificação automática (2026-07-29):** `tsc --noEmit` **0 erros** ·
> `vitest run` **1358/1358** (27 pulados) · `next build` **0 erros / 60 rotas**
> (dev **parado** durante o build).

---

## ⚠️ Leia antes de começar

**1. Sem instância uazapi, dois `.env.local` ficam faltando de propósito.**
Hoje `UAZAPI_BASE_URL`, `UAZAPI_TOKEN` e `UAZAPI_WEBHOOK_SECRET` **não estão**
em `app/.env.local` (conferido nesta sessão). Isso é o cenário que o §3 do
roteiro testa (cron sem token configurado). Mas o §4/§5 (webhook de entrada)
**precisam** de um valor em `UAZAPI_WEBHOOK_SECRET` para o segredo poder ser
validado — sem ele, `segredoDaQuery` falha fechado (string vazia nunca bate
com nada) e **todo** POST vira `unauthorized`, mesmo com o segredo certo
digitado. **Antes do §4:** adicione uma linha
`UAZAPI_WEBHOOK_SECRET=smoke-6b-local-uma-string-qualquer` em
`app/.env.local` e reinicie o `npm run dev`. Não é preciso configurar
`UAZAPI_BASE_URL`/`UAZAPI_TOKEN` para o §4/§5 — sem eles, `enviarMensagem`
faz no-op (`{ ok:false, skipped:true }`), o webhook ainda responde
normalmente, e você vai ver um `console.error` de "falha ao enviar
resposta" no log — **isso é esperado neste cenário, não é bug**: é o
no-op sendo logado como qualquer falha de envio, porque o código não
distingue "não configurado" de "erro de rede" no ponto de log (mesma
convenção do `sendEmail` do Bloco 1).

**2. O cenário de MEI do 6A foi desfeito.** Conferido nesta sessão
(2026-07-29) direto no banco: a empresa **ideapp** está de volta a
`Code_regime_tributario = "1"` (Simples Nacional), `atividade_mei = null` —
ou seja, o §9 do roteiro do 6A foi executado depois daquele smoke. Isso
importa para o **§4** deste roteiro: `buscarSituacaoAtualMei` só devolve
texto quando a empresa está em **MEI** com uma competência calculada (a
mesma regra da tela `/impostos`). Sem repetir a promoção a MEI, o webhook
vai cair no contexto genérico ("Não encontramos informação fiscal
disponível") e o §4 não prova nada sobre a Task 6. **Repita o §0 do roteiro
do 6A antes do §4 daqui:**

   - Entrar como o dono da **ideapp**, **Configurações → Regime tributário →
     Editar → Simples Nacional — MEI → Prestação de Serviços → Salvar**.
   - Ir em **Impostos**, trocar a competência para o **mês corrente**
     (`202607`), **Calcular agora → Confirmar apuração** (esperado:
     R$ 80,90).
   - Confirme que **Impostos** mostra a explicação aprovada (`das-mei:inss+iss`,
     já **aprovada** no catálogo desde o 6A — conferido nesta sessão) com os
     valores **R$ 75,90** (INSS) e **R$ 5,00** (ISS).

   Isto é o que o §4 vai comparar contra a resposta do webhook.

**3. `config_ia` já está configurado** (provedor `openrouter`, modelo
`mistralai/mistral-small-24b-instruct-2501` — conferido nesta sessão). Ou
seja, o **§4 chama o OpenRouter de verdade** (centavos por resposta, mesmo
aviso do §7 do roteiro do 6A) — não é um caminho de fallback estático que
você estaria testando à toa.

**4. Contas de teste** (mesmo cenário do 4B/6A, para manter o dado de teste
concentrado): a empresa **ideapp**, dono `walacesssantos@gmail.com`. Use um
número de teste de sua escolha no formato E.164 (ex.: `+5511999990000`) para
o opt-in — não precisa ser um WhatsApp real, porque nenhuma mensagem vai
sair de verdade sem `UAZAPI_TOKEN`.

**5. Enquanto você testa, eu não rodo a suíte** — mesma disciplina dos
roteiros anteriores (o `afterAll` de alguns smokes mexe no banco real).

---

## §1 — Ativar WhatsApp em Conta → Notificações

1. Entrar como o dono da **ideapp** (`walacesssantos@gmail.com`).
2. **Conta → Notificações** (aba/seção com o card **WhatsApp**, abaixo das
   preferências de e-mail por tipo).
3. Preencher o campo de número com um E.164 de teste, ex. `+5511999990000`.
4. Marcar **"Ativar avisos por WhatsApp"** → **Salvar**.

**Esperado na tela:** o formulário recarrega mostrando o número salvo e o
checkbox marcado (sem erro de formato — o validador aceita `+` seguido de
7 a 15 dígitos).

**Esperado no banco (eu confiro):**

```sql
select whatsapp_numero, whatsapp_habilitado_em
  from public.profiles
 where user_id = '<user_id da ideapp>';
```

`whatsapp_habilitado_em` **não pode estar `null`**, e o número tem de bater
com o digitado.

> Se dois usuários tentarem o mesmo número, a segunda tentativa tem de
> recusar com "Este número já está em uso por outra conta." — é a UNIQUE
> parcial `profiles_whatsapp_numero_uidx` (0061). Não é o foco deste roteiro,
> mas vale confirmar de passagem se dois números de teste estiverem à mão.

---

## §2 — Desativar, e a RPC para de devolver a linha

Este item precisa de **pelo menos uma notificação pendente** para o usuário
(uma linha em `notifications` com `enviada_whatsapp_em is null`). Se não
houver nenhuma (provável, já que a materialização de obrigações roda por
competência), eu insiro uma de teste diretamente:

```sql
insert into public.notifications
  (owner_user_id, tipo, titulo, corpo, severidade, chave)
values
  ('<user_id da ideapp>', 'das_a_vencer', 'DAS a vencer (smoke 6b)',
   'Notificação de teste do smoke do Bloco 6B.', 'info', 'smoke-6b:teste-whatsapp');
```

1. **Com o WhatsApp ainda ativo** (§1), eu rodo, direto no banco:

   ```sql
   select * from public.notificacoes_pendentes_whatsapp(50);
   ```

   **Esperado:** a linha de teste aparece, com `whatsapp_numero` igual ao
   número do §1.

2. Você desativa: **Conta → Notificações → desmarcar "Ativar avisos por
   WhatsApp" → Salvar** (o número em si **fica salvo** — só o carimbo de
   habilitação zera; é a regra documentada em `salvarWhatsappAction`).

   **Esperado no banco:** `whatsapp_habilitado_em` volta a `null`,
   `whatsapp_numero` continua preenchido.

3. Eu rodo a mesma RPC de novo.

   **Esperado:** a linha **some** — `notificacoes_pendentes_whatsapp` exige
   `whatsapp_habilitado_em is not null` (0061), então desativar basta para
   tirar o usuário da fila, sem precisar apagar o número.

4. **Reative o WhatsApp antes de seguir para o §3** (mesmo número do §1) —
   os próximos itens dependem do opt-in estar ativo.

---

## §3 — O cron não quebra o Bloco 1 (sem `UAZAPI_TOKEN`)

Com o opt-in ativo (reative se saiu do §2 assim) e **sem** `UAZAPI_BASE_URL`/
`UAZAPI_TOKEN` no `.env.local` (estado atual, confirmado nesta sessão):

```bash
cd app && curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2)" \
  http://localhost:3000/api/cron/obrigacoes
```

**Esperado no JSON de resposta:**
- `whatsapp_pulados` **maior que zero** (a notificação de teste do §2 conta
  aqui, mais qualquer outra pendente do usuário) — prova que
  `configDeEnv()` devolveu `null`, `enviarMensagem` virou no-op, e o item
  caiu em "pulado" em vez de travar o loop inteiro;
- `whatsapp_enviados` deve ser **0** (nada foi enviado de verdade, porque
  não há credencial);
- `enviados`/`pulados`/`billing` do caminho de **e-mail** continuam
  aparecendo normalmente, com os mesmos valores que apareceriam **sem**
  o Bloco 6B — esta é a prova de que o terceiro loop não interferiu no
  primeiro. Se o e-mail parar de enviar ou o campo `billing` sumir, é
  regressão do 6B no Bloco 1, não uma falha isolada do WhatsApp;
- HTTP **200**.

> **Conferência no banco (eu rodo):** a notificação de teste do §2 continua
> com `enviada_whatsapp_em is null` depois deste cron — ela foi contada como
> pulada, não marcada como enviada por engano.

---

## §4 — O webhook responde com a MESMA explicação da tela de impostos

**Pré-requisito: item 2 do "Leia antes de começar"** (ideapp promovida a MEI
+ competência atual calculada) **e** `UAZAPI_WEBHOOK_SECRET` definido no
`.env.local` com o dev **reiniciado** depois de definir.

1. Anote o que a tela **Impostos** mostra agora para a ideapp: o valor total
   (**R$ 80,90**) e a explicação abaixo do card, com **R$ 75,90** (INSS) e
   **R$ 5,00** (ISS) já substituídos nos marcadores.

2. Chame o webhook com uma pergunta que force a IA a usar esses valores:

```bash
cd app && curl -s -X POST \
  "http://localhost:3000/api/webhooks/uazapi?s=$(grep '^UAZAPI_WEBHOOK_SECRET=' .env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"messageId":"smoke-6b-001","from":"+5511999990000","text":"Quanto eu pago de DAS este mes e por que?"}'
```

(troque `+5511999990000` pelo número exato salvo no §1.)

**Esperado:**
- HTTP **200**, `{"ok":true}` no corpo (o contrato "sempre 200" do webhook —
  mesmo se algo dentro falhar, nunca vira 4xx/5xx para a uazapi);
- no log do dev (`console.log`/rede), a resposta da IA **cita os mesmos
  valores** que você anotou no passo 1 (R$ 75,90 / R$ 5,00 / R$ 80,90) — a
  prova de que `buscarSituacaoAtualMei` leu a **mesma** explicação aprovada
  que a tela usa, e que a IA só reformulou o texto, sem inventar número
  (o prompt em `lib/atendimento/prompt.ts` proíbe isso explicitamente);
- **Conferência no banco (eu rodo):**

  ```sql
  select message_id_externo, telefone, resposta_enviada, resolvido
    from public.whatsapp_atendimentos
   where message_id_externo = 'smoke-6b-001';
  ```

  tem de existir **uma** linha, com `resposta_enviada` preenchida (o texto
  que a IA gerou) e `profile_user_id` = o user_id da ideapp;
- no log, uma linha `console.error` **"falha ao enviar resposta"** é
  **esperada** (sem `UAZAPI_TOKEN`, o envio é no-op) — não é o teste
  falhando, é a ausência de instância real se manifestando exatamente onde
  deveria.

> Se a resposta vier genérica ("Não encontramos informação fiscal
> disponível...") em vez de citar os valores, confira o pré-requisito 2: a
> ideapp provavelmente não está em MEI, ou a competência atual não foi
> calculada.

---

## §5 — Reenviar o mesmo `messageId` não duplica

```bash
cd app && curl -s -X POST \
  "http://localhost:3000/api/webhooks/uazapi?s=$(grep '^UAZAPI_WEBHOOK_SECRET=' .env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"messageId":"smoke-6b-001","from":"+5511999990000","text":"pergunta diferente desta vez"}'
```

(mesmo `messageId` do §4, texto diferente de propósito — para provar que é
o `messageId`, não o conteúdo, que decide a idempotência.)

**Esperado:**
- HTTP 200, `{"ok":true,"reason":"duplicado"}`;
- **nenhuma chamada nova à IA nem ao envio** (se você tiver logs de rede
  abertos, confirme que não houve novo round-trip ao OpenRouter — evita
  gastar de novo por uma reentrega);
- **Conferência no banco (eu rodo):** continua existindo **exatamente uma**
  linha com `message_id_externo = 'smoke-6b-001'` em
  `whatsapp_atendimentos` (a mesma do §4, não uma segunda).

---

## §6 — O probe: o que a tela não prova

```bash
node app/scratchpad/_probe-6b.mjs
```

**Já rodado nesta sessão (2026-07-29), contra o banco de produção — tudo
verde:**

```
§1 — anon não lê whatsapp_numero de ninguém (RLS profiles_select)
ok    anon NÃO lê profiles.whatsapp_numero (HTTP 200, [] — RLS filtrou todas as linhas)

§2 — anon não lê whatsapp_atendimentos (0061: REVOKE ALL)
ok    anon NÃO lê whatsapp_atendimentos (HTTP 401 — sem permissão, como esperado do REVOKE)

§3 — anon não executa notificacoes_pendentes_whatsapp (0061: REVOKE ALL FROM PUBLIC)
ok    anon NÃO executa a RPC (HTTP 401 — sem permissão, como esperado do REVOKE)

§4 — nenhum message_id_externo duplicado em whatsapp_atendimentos
      (tabela vazia — nenhuma instância uazapi real mandou tráfego ainda; nada a checar)

=== OK: tudo verde ===
```

**Rode de novo depois do §4/§5** — agora a tabela `whatsapp_atendimentos` vai
ter a linha do smoke, e o §4 do probe deixa de ser vacuoso: ele vai realmente
comparar `message_id_externo` contra o banco, não só confirmar "tabela
vazia, nada a checar".

---

## O que fica PENDENTE — não fingir testado

- **Mensagem de WhatsApp de verdade chegando num celular.** Depende da
  instância uazapi que o usuário está provisionando em paralelo. Nada neste
  roteiro substitui isso — o §3 prova que a AUSÊNCIA de credencial não
  quebra nada, e o §4/§5 provam a lógica do webhook com um payload
  simulado, mas nenhum dos dois prova que a uazapi de verdade manda ou
  recebe no formato que o código espera.

- **O contrato HTTP da uazapi (header/path/body) não está confirmado.**
  Documentado desde a Task 5, ainda sem instância para sondar contra:
  - `app/src/lib/uazapi/cliente.ts:1-18` — o aviso completo sobre
    `header: token` + `POST {baseUrl}/send/text` + `{ number, text }` serem
    a MELHOR HIPÓTESE, não um contrato confirmado (inclui o relato da
    tentativa de sondagem em 2026-07-29 contra `docs.uazapi.com`, que é um
    SPA e não expôs o contrato por fetch simples);
  - `app/src/app/api/webhooks/uazapi/route.ts:11-15` — o mesmo aviso do lado
    de entrada: `messageId`/`from`/`text` são hipótese, ajustar os nomes de
    campo assim que uma instância real confirmar o payload que ela manda.

  **Assim que houver uma instância real:** confirmar os dois contratos,
  remover os avisos dos dois arquivos, e então este roteiro deixa de ser
  parcial.

---

## Ordem do fechamento (depois que os §1-§6 passarem)

1. Verificação com o cenário ainda vivo (rodar `_probe-6b.mjs` uma última
   vez com os dados do smoke no banco).
2. Desfazer o cenário: reverter a ideapp para Simples Nacional (mesmo §9 do
   roteiro do 6A), desativar o WhatsApp de teste (ou deixar — decisão do
   usuário, como no 6A), remover a notificação de teste do §2 se tiver sido
   inserida manualmente, decidir se apaga as linhas de
   `whatsapp_atendimentos` do smoke (`message_id_externo = 'smoke-6b-001'`)
   ou deixa como prova de que o teste foi feito (convenção do 4B).
3. Rodar a suíte completa **sem** o cenário montado — é aqui que se
   descobre teste que dependia de dado de cenário.
4. `next build` com o `npm run dev` **parado**.
5. Commits.
6. Merge `--no-ff` em `main`.
7. **Confirmar com o usuário antes do push** — é auto-deploy em produção.

> Os itens 6 e 7 **não são executados por este agente** — merge e push
> exigem o aval explícito do usuário na conversa ao vivo, mesma convenção
> de todo bloco anterior deste projeto (4B, 6A).
