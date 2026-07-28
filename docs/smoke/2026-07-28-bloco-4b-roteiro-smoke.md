# Roteiro do smoke manual — Bloco 4B (o escritório cobrando pela subconta)

> **Status:** ⏳ **PENDENTE** · **Escrito em:** 2026-07-28
> **Branch:** `feat/bloco-4b-subcontas` (não mergeada) · **Plano:** `docs/superpowers/plans/2026-07-27-bloco-4b-subcontas-escritorio.md`
> **Verificação automática:** `tsc` 0 · vitest **1142/1142** (27 pulados) · `next build` **0 erros / 56 rotas**
> **Passou por `/code-review` + `/systematic-debugging` antes do smoke** — 6 achados, 5 corrigidos (commit `7b4a233`). O mais sério: corrida de lost-update entre o webhook e a varredura, que ressuscitava um estorno. Ver §7, que agora a exercita de propósito.

O princípio que o bloco inteiro existe para proteger: **a Balu não intermedia
dinheiro de terceiro.** A cobrança do escritório nasce na subconta Asaas dele e
o dinheiro liquida na conta dele. O §9 é a única checagem que prova isso sem
depender de eu ter escrito o código certo — se ele falhar, nada mais importa.

---

## §0 — Preparo (2 min)

**Nenhum `node` pode estar vivo antes de subir o dev.** Dois `npm run dev` ao
mesmo tempo destroem o `.next/` e o sintoma é confuso (`_document.js` ausente).

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine
```

Subir **com log em arquivo** — sem isso o `console.error` do servidor não deixa
rastro, e no 4A o diagnóstico dependeu dele duas vezes:

```bash
cd app && npm run dev > scratchpad/dev.log 2>&1
```

**Enquanto você testa, eu não rodo a suíte** — o `afterAll` de
`registrar.smoke.test.ts` apaga dados da empresa do seed.

### O cenário que já está no banco

| | |
|---|---|
| **Contador** | `testeefluxodeautomacao@gmail.com` — membro de **Escritório Teste Balu** (CNPJ `11222333000181`, status `aprovada`) |
| **Assinatura do escritório** | `cortesia` → **o gate do 4A passa**, dá para emitir |
| **Cliente do escritório** | `walacesssantos@gmail.com` — empresa **ideapp** (CNPJ `44555666000181`) |
| **Subconta Asaas** | **não existe** (`asaas_subconta_status = ausente`) |
| **Catálogo de avulsos** | **vazio** |
| **Cobranças** | **nenhuma** |
| **Honorário** | um só, R$ 1.890,00 venc. 01/08/2026, **já pago** (baixa manual) — não serve para cobrar, o §3 cria outro |
| **Ambiente Asaas** | **sandbox** (`ASAAS_ENV` ausente = sandbox, por construção) |

### Duas coisas que NÃO dá para testar em local, e por quê

1. **O webhook da subconta não pode ser cadastrado.**
   `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, e `ehUrlEntregavel` recusa
   `http` e `localhost` de propósito — cadastrar criaria no painel do
   escritório uma configuração permanente que nunca entrega. A tela vai dizer
   isso, e **isso é o comportamento certo**, não um bug. `ASAAS_WEBHOOK_SECRET`
   também não está no `.env.local`.
2. **Portanto o pagamento não chega sozinho.** É exatamente por isso que a
   Task 13 existe: em local, quem faz o pagamento aparecer é a **reconciliação**
   (§6). O caminho do webhook fica para o teste em produção, depois do merge.

---

## §1 — A conta de recebimento (a subconta)

> **⚠️ Passo irreversível.** Criar a subconta cria uma pessoa jurídica no
> Asaas, e a `apiKey` volta **uma única vez**. Não existe "desfazer" pela tela.

1. Entrar como **contador**.
2. No menu lateral, confirmar que existe a seção **COBRANÇAS** com três itens:
   **Cobranças emitidas**, **Conta de recebimento**, **Serviços avulsos**.
   *(Antes desta sessão nenhuma tela do 4B era alcançável pelo menu.)*
3. Abrir **Conta de recebimento**.

**Esperado:** a tela oferece **dois formulários** (PJ e contador autônomo PF), não
um com campo condicional — `birthDate` só é exigido para CPF, e com
`companyType` de PJ o validador do Asaas para de pedir.

4. Criar como **PJ**. ⚠️ **NÃO use o CNPJ do escritório (`11222333000181`)** — é
   um documento de teste manjado, e o **sandbox do Asaas é ambiente
   compartilhado**: ele responde `400 "O CNPJ … já está em uso."`. O campo é
   editável; use um CNPJ válido gerado ao acaso.

   > Levar esse 400 **não é acidente perdido, é teste**: 4xx significa que nada
   > foi criado, e é a prova de que o caminho mais delicado do bloco (subconta
   > órfã com a chave perdida) não dispara à toa — sem retry, sem linha no
   > banco, sem registro `possivel_orfa`, que só existe para falha *ambígua*.

**Esperado depois de criar:**
- a tela passa a mostrar a subconta com KYC **pendente**;
- aparece um aviso sobre os avisos de pagamento — em local a mensagem é
  **"Os avisos de pagamento não estão configurados nesta instalação da Balu"**,
  porque `precondicoes()` confere **segredo → e-mail → URL** e o
  `ASAAS_WEBHOOK_SECRET` falta *antes* de a URL `localhost` ser avaliada (faltam
  os dois). O texto manda falar com o suporte da Balu e não pede nada ao
  escritório — a culpa é do ambiente da Balu, não dele;
- **a chave não aparece em lugar nenhum da tela.**

5. Clicar **Atualizar status**.
   **Esperado:** o KYC vai para **aprovada** (a conta é nova no sandbox e os
   quatro eixos vêm `APPROVED`). Se ficar em pendente, os quatro eixos não estão
   todos aprovados — é o comportamento deliberado, não um bug.
6. Clicar **Reconfigurar avisos**.
   **Esperado:** a mesma recusa do item 1, com mensagem, **sem quebrar a tela**.

> **Conferência no banco (eu rodo):** a coluna `asaas_api_key_cifrada` tem de
> começar com `enc:v1:`. Chave em claro no banco é falha de segurança, não de UI.

---

## §2 — O catálogo de serviços avulsos

1. Menu → **Cobranças → Serviços avulsos**.
2. Criar dois: um de **valor fixo** (ex.: *Certidão negativa*, R$ 90,00) e um
   **percentual** (ex.: *Assessoria*, 10%).
3. Tentar **apagar** um deles.

**Esperado:** apagar funciona **de verdade**, não só na tela. *(A trava de
"apagar" ter existido só na interface foi um dos defeitos corrigidos na sessão
14 — a regra é: garantia de servidor não pode depender da tela.)*

---

## §3 — Cobrar a mensalidade (honorário)

1. Menu → **Honorários** (o do contador).
2. Criar um honorário novo para **ideapp**: valor **R$ 450,00**, vencimento
   **daqui a 7 dias**, status **pendente**.
3. No honorário criado, clicar **Gerar cobrança**.

**Esperado:** a cobrança nasce, e a linha passa a mostrar que já tem cobrança.

4. Clicar **Gerar cobrança** de novo no **mesmo** honorário.

**Esperado:** **recusa**, com mensagem — nunca um segundo boleto. A chave de
reserva é `hon:<uuid>`, natural do honorário.

> **Conferência no banco (eu rodo):** exatamente **uma** linha em
> `cobrancas_escritorio` com este `honorario_id`.

---

## §4 — Cobrar um serviço avulso, e o duplo clique

1. Menu → **Escritório** → abrir o cliente **ideapp**.
2. Emitir uma cobrança avulsa usando o serviço de **valor fixo** do §2.
3. Abrir o diálogo de novo e emitir **o mesmo serviço, mesmo valor**.

**Esperado:** a segunda emissão **passa** e cria uma segunda cobrança. Isto não
é bug: a chave de idempotência descreve **qual submissão está se repetindo**, não
*o que* se cobra — cobrar duas vezes o mesmo serviço é legítimo.

4. Agora o teste que importa: abrir o diálogo e **clicar duas vezes bem rápido**
   no botão de emitir.

**Esperado:** **um** boleto só. O trinco é tomado **antes** de qualquer chamada
ao Asaas — quem perde a corrida não fala com o Asaas.

---

## §5 — O cliente vê a cobrança

> Esta seção **tinha de ser feita depois** do §3/§4: o item de menu só aparece
> quando existe boleto (decisão de 28/07).

1. Sair e entrar como **cliente** (`walacesssantos@gmail.com`, empresa ideapp).
2. Conferir o menu.

**Esperado:** apareceu **Cobranças**, ao lado de **Honorários**.

3. Abrir **Cobranças**.

**Esperado:**
- as cobranças do §3 e do §4, com **valor, vencimento e status**;
- o texto diz que **quem emite e recebe é o escritório**, e que o pagamento vai
  direto para ele **sem passar pela Balu**;
- botão **Pagar** abre a fatura do Asaas;
- **nenhuma tarja de bloqueio, nenhuma menção a acesso ou suspensão.** A dívida
  é dele com o escritório, e a Balu não é credora aqui.

4. Clicar **Pagar** e conferir que a fatura abre no Asaas.

---

## §6 — O pagamento aparece **sem** o webhook (Task 13)

Esta é a seção que testa o que foi construído hoje.

1. Pegar o `asaas_charge_id` da cobrança do **honorário** (§3) — eu te passo.
2. Simular o pagamento **no Asaas**, sem tocar no banco:

```bash
cd app && node scratchpad/_sandbox-pagar.mjs pagar <asaas_charge_id>
```

3. Recarregar **/cobrancas** (cliente) e **/contador/cobrancas**.

**Esperado:** **ainda em aberto** nas duas. O banco não sabe — e não deveria
saber, porque o webhook não chega em `localhost`. *Se aparecer paga aqui, algo
está lendo o Asaas na hora e não foi isso que se combinou.*

4. Disparar a reconciliação:

```bash
cd app && curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2)" \
  http://localhost:3000/api/cron/billing
```

**Esperado na resposta:**
`"escritorio": { "escritorios": 1, "atualizadas": 1, "erros": 0, "truncados": 0, "orfaos": 0 }`

> `orfaos` tem de ser **0**. Diferente de zero significa que existe no Asaas uma
> cobrança emitida por nós que **não** está no banco — o cliente com um boleto
> na mão que o painel do escritório nunca mostra. O id sai no log
> (`scratchpad/dev.log`).

5. Recarregar as duas telas.

**Esperado:**
- a cobrança está **Paga**, com data;
- em **Honorários** (contador) o honorário está **pago**;
- o botão **Pagar** sumiu da tela do cliente.

> **Conferência no banco (eu rodo):** `honorarios.pagamento_origem = 'asaas'` —
> é o que distingue "o Asaas disse" de "o contador deu baixa a mão". Se vier
> `manual` ou nulo, o semáforo está mentindo sobre quem falou por último.

---

## §7 — O estorno desfaz o semáforo

1. Estornar **a mesma cobrança** no Asaas:

```bash
cd app && node scratchpad/_sandbox-pagar.mjs estornar <asaas_charge_id>
```

2. Disparar a reconciliação de novo (comando do §6.4).
3. Conferir.

**Esperado:**
- cobrança **Estornada** nas duas telas, **sem** botão de pagar, mas **ainda
  visível** — é histórico do cliente com o escritório;
- o honorário **voltou a pendente**, com `pagamento_origem` nulo;
- em **Honorários**, o botão **Gerar cobrança** está disponível de novo.

> Este último ponto é a razão de o estorno existir no código: sem ele o
> honorário estornado ficaria impossível de recobrar pela tela, para sempre.

4. **Rodar o cron uma SEGUNDA vez**, sem estornar nada de novo.

**Esperado:** `"atualizadas": 0` e a cobrança **continua estornada**. É a trava
"estorno é terminal": o Asaas ainda lista a cobrança com um status de pagamento,
e a varredura não pode ressuscitá-la. Se ela voltar para **Paga** aqui, é o bug
de lost-update de volta.

---

## §8 — A navegação

1. Como contador, abrir **Cobranças → Conta de recebimento**.

**Esperado:** acende **um** item só — "Conta de recebimento". *(Antes desta
sessão acendiam dois: "Config. escritório" também, porque uma URL é prefixo da
outra.)*

2. Abrir **Cobranças emitidas** e passar pelas abas **Todas / Em aberto /
   Vencidas / Pagas / Estornadas**.

**Esperado:** o filtro sobrevive ao **recarregar a página** (está na URL), os
totais "A receber" e "Recebido" refletem **a aba atual**, e cada linha diz se
veio de **honorário** ou **avulso**.

3. Recolher o menu lateral (o botão de colapsar).

**Esperado:** a seção vira um traço separador, sem texto espremido.

---

## §9 — ⭐ A CHECAGEM QUE VALE O BLOCO

```bash
cd app && node scratchpad/_probe-4b.mjs
```

**Esperado — e é isto que decide se o bloco pode ser mergeado:**

```
3. O dinheiro do escritório NÃO passa pela Balu
  OK      pay_xxx (…): visível pela subconta, 404 pela conta-mãe
```

Cada cobrança é consultada **duas vezes**: pela subconta (tem de dar **200**) e
pela conta-mãe da Balu (tem de dar **404**). O 200 é o que faz o 404 valer
alguma coisa — sem ele, um id errado daria 404 e o probe diria "separado" sem
ter olhado para nada.

**Se a conta-mãe enxergar qualquer cobrança, o bloco não vai para `main`**, por
mais que todas as telas acima tenham funcionado: significa que o dinheiro do
cliente do escritório passou pela conta da Balu.

O probe ainda confere que a `apiKey` está **cifrada** no banco e que o semáforo
do honorário concorda com o estado da cobrança.

---

## §10 — As fronteiras (o gate não pode alcançar isto)

Eu suspendo a assinatura do escritório no banco (com o valor original anotado
para restaurar) e você confere:

1. **Emitir** cobrança nova → **bloqueado**, com o motivo dito **na entrada da
   tela**, não no envio.
2. **Ver** `/contador/cobrancas` → **funciona**.
3. **Reconciliar** (o cron do §6) → **funciona**.
4. O **cliente** em `/cobrancas` → **funciona**, e **sem faixa de cobrança** —
   a inadimplência do escritório com a Balu não respinga nele.

> O gate alcança **criar**, nunca **ver** nem **receber** — é com esse dinheiro
> que o escritório paga a Balu.

---

## O que fica para depois do merge (não dá para provar em local)

- **O webhook da subconta**, ponta a ponta: cadastro real + pagamento real
  chegando sozinho. Exige `NEXT_PUBLIC_SITE_URL` público e
  `ASAAS_WEBHOOK_SECRET` (**mínimo 32 caracteres** — o Asaas recusa menor, e o
  modo de falha é silencioso: a conta-mãe segue funcionando e nenhuma subconta
  registra webhook).
- **Criar subconta em PRODUÇÃO**, que depende da aprovação comercial do Asaas.
  O sandbox já funciona.
- **`consultarStatusConta` com KYC de verdade pendente** — no sandbox só o valor
  `APPROVED` foi observado ao vivo. `scratchpad/_probe-kyc-subconta.mjs` existe
  para o dia em que houver uma subconta pendente.

---

## Ordem do fechamento (depois que tudo passar)

1. Conferência final com o cenário vivo + `_probe-4b.mjs`.
2. Desfazer o que o teste criou: subconta, cobranças, honorário de teste,
   catálogo de avulsos. *(Restaurar seed ≠ desfazer o que você fez testando.)*
3. Rodar a suíte **sem** o cenário montado — é aqui que se descobre teste que
   depende de dado de seed.
4. `next build` com o dev **parado**.
5. Merge `--no-ff` → **confirmar com você antes do push** (é auto-deploy em
   produção).
