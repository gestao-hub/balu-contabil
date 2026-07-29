# Bloco 6A — roteiro do smoke manual

> **O que este bloco entrega:** o cliente abre a tela de impostos e lê, em
> português simples, o que aquele número é. O texto vem de um **catálogo por
> situação fiscal** — nunca por cliente —, aprovado por um humano antes de
> qualquer cliente ver, e a Balu troca os marcadores pelos valores dele na hora
> de exibir.
>
> **Estado:** Tasks 1 a 12 feitas, branch `feat/bloco-6a-explicacao-ia`
> (não mergeada). `tsc` 0 · vitest 1326/1326 · `next build` 0 erros.
> Migrations 0056–0060 **já aplicadas em produção**. Duas rodadas de
> `/code-review` + `/systematic-debugging`: 17 achados, todos corrigidos.

---

## ⚠️ Leia antes de começar

**1. Não existe nenhum MEI no banco.** As três empresas com ficha fiscal estão
como Simples Nacional (`regime = "1"`, `atividade_mei = null`). A explicação só
é renderizada no **card do MEI** — para Simples a tela de impostos vai por outro
layout. Então o smoke precisa promover **uma** empresa a MEI, e desfazer no fim.
O §0 faz isso **pela tela do produto**, não por script.

**Valores originais das três, para restaurar** (conferidos em 2026-07-29):

| empresa | id | regime | atividade_mei |
|---|---|---|---|
| AL PISCINAS | `3f7370a5-bfdc-4d3b-b59d-9165967d28c8` | `"1"` | `null` |
| AL PISCINAS | `c070a7ec-31c1-45e0-87ee-1aee9a7a3ae4` | `"1"` | `null` |
| ideapp | `c2410872-c9c0-47b5-a0e9-4d3e699a614e` | `"1"` | `null` |

**Use a `ideapp`** — é a empresa do cenário de teste do Bloco 4B, que já está
viva de propósito. Assim o dado de teste continua concentrado num lugar só.

**2. A chave de IA existe** (`TOKEN_OPENROUTER` no `app/.env.local`) e o caminho
de IA **já foi provado contra o provedor de verdade** — ver o topo do §7. Mesmo
assim, o caminho manual (§3) continua sendo o principal do roteiro: ele exercita
o bloco inteiro e não gasta crédito.

**3. Se a explicação não aparecer com uma guia real do SERPRO, é de propósito.**
A explicação só aparece quando o total na tela é a **soma dos componentes** que
ela cita. Guia do SERPRO divergindo da nossa estimativa (dívida do salário
mínimo de 2025) faz a explicação sumir em vez de mostrar peças que não fecham.
Por isso o roteiro usa **apuração nossa** (`Calcular agora`), não guia baixada.

**Enquanto você testa, eu não rodo a suíte** — o `afterAll` de um dos smokes
apaga dados da empresa do seed.

---

## §0 — Preparar o cenário (pela tela, não por script)

1. Entre como o dono da **ideapp** e selecione essa empresa.
2. **Configurações** → seção **Regime tributário** → botão **Editar**.
3. Em **Regime tributário**, escolha **`Simples Nacional — MEI`**.
4. O campo muda sozinho para **Atividade do MEI** — escolha
   **`Prestação de Serviços`**.
5. **Salvar**.

**Esperado:** o formulário volta a ficar bloqueado, mostrando MEI + Prestação de
Serviços.

> Anote: você acabou de mudar `regime "1" → "4"` e `atividade_mei null →
> Prestacao de Servicos`. O §9 desfaz.

---

## §1 — A tela do cliente SEM catálogo: nada aparece, e o buraco é contado

1. Vá em **Impostos**.
2. Se aparecer o card vazio ("Sem cálculo para …"), clique em **Calcular agora**
   e conclua o cálculo da competência atual.

**Esperado na tela:**
- o card da competência atual mostra o valor do DAS-MEI (**R$ 80,90** para
  Prestação de Serviços: 75,90 de INSS + 5,00 de ISS);
- **nenhum bloco de explicação abaixo do card.** Ainda não existe texto aprovado,
  e o bloco não aparece meio pronto nem com marcador cru.

**Esperado no banco** — rode:

```bash
node app/scratchpad/_probe-6a.mjs
```

No **§4** do probe tem de constar `das-mei:inss+iss` com **1 ou mais vistas**.
É a prova de que o catálogo cresce por demanda real, e não por adivinhação.

> Se aparecer `0 vistas` ou a chave não aparecer: a tela não chegou a pedir a
> explicação. Confirme que o card mostrou um **valor** (sem valor, não há o que
> explicar e a contagem não acontece de propósito).

---

## §2 — O admin vê a fila de trabalho

1. Entre com o usuário **AdminBalu**.
2. Menu lateral → **Explicações**.

**Esperado:**
- a situação `das-mei:inss+iss` aparece **no topo**, com o selo vermelho
  **`sem texto · N vezes`** — as mais pedidas primeiro;
- o rótulo legível é **`MEI · DAS · INSS + ISS`**;
- logo abaixo: *"Marcadores desta situação: `{inss}` `{iss}`"*;
- há um aviso dizendo que **nenhum provedor de IA está configurado** e que o
  botão **Gerar com IA** está desligado — com o motivo.

---

## §3 — Escrever à mão, salvar como rascunho, e provar que o rascunho não vaza

1. No campo de texto da situação, escreva algo como:

   > `Todo mês você paga um valor fixo pelo DAS. Nesta atividade ele é formado por {inss} de INSS, que conta para a sua aposentadoria, e {iss} de ISS, o imposto do município sobre serviços.`

2. Clique em **Salvar rascunho**.

**Esperado:** toast de sucesso, e o selo muda para
**`rascunho — o cliente não vê`**.

3. **Volte para a tela de impostos do cliente** e recarregue.

**Esperado: continua sem nenhuma explicação.** Esta é a trava que faz a revisão
humana valer alguma coisa — rascunho não chega a cliente nenhum.

---

## §4 — Aprovar, e a explicação aparece com os valores dele

1. Volte em **Explicações** e clique em **Aprovar**.

**Esperado:** selo verde **`aprovada`**.

2. Recarregue a tela de impostos do cliente.

**Esperado, abaixo do card:**
- o texto que você escreveu, com **`{inss}` virando `R$ 75,90`** e **`{iss}`
  virando `R$ 5,00`** — os valores dele, preenchidos pela Balu;
- e, em letra menor, o disclaimer fixo. Como **você escreveu este texto à mão**,
  ele tem de dizer *"Informação educativa **escrita e revisada pela Balu**. Não
  substitui a orientação do seu contador."*
  > A frase muda conforme a procedência real (`gerado_por`): só um texto que a
  > IA redigiu recebe *"gerada com apoio de IA"*. Afirmar IA sobre texto humano
  > seria declaração falsa numa tela sobre tributo — foi achado do 2º review.
  > No §7, depois de gerar por IA, confira que a frase vira a outra.

> Confira que **não sobrou nenhuma chave entre `{}`** no texto exibido.

---

## §5 — Marcador que a situação não fornece é recusado

1. Em **Explicações**, edite o texto e acrescente `{icms}` em algum lugar.

**Esperado, enquanto você digita:**
- aviso em vermelho: *"`{icms}` não existe nesta situação. A aprovação será
  recusada enquanto estiver no texto."*;
- o botão **Aprovar** fica **desabilitado**.

2. (Opcional, se quiser provar o servidor) Salve como rascunho e tente aprovar —
   a action recusa com a lista dos marcadores disponíveis.

**Por que isso importa:** `{icms}` numa situação de serviços chegaria à tela do
contribuinte cru, ou — pela falha fechada — faria a explicação inteira sumir sem
ninguém entender por quê.

3. Tire o `{icms}` antes de seguir.

---

## §6 — Editar um texto aprovado derruba a aprovação

1. Com o texto **aprovado**, mude qualquer palavra dele.

**Esperado antes mesmo de salvar:** aviso *"Salvar esta edição derruba a
aprovação, e a explicação some da tela do cliente até ser aprovada de novo."*

2. Clique em **Salvar rascunho**.
3. Recarregue a tela do cliente.

**Esperado: a explicação sumiu.**

4. Volte ao admin e clique em **Aprovar**.
5. Recarregue a tela do cliente.

**Esperado: voltou, com o texto novo.**

---

## §7 — O provedor de IA (a chave já está no `.env.local`)

> **Já verificado contra o OpenRouter de verdade**, com o nosso próprio código
> (`cliente.ts` + `prompt.ts`), antes deste roteiro:
> - o adaptador OpenAI-compatível **é aceito** pelo provedor;
> - chave errada dá **401 legível e sem a chave na mensagem**;
> - o prompt produz rascunho **com os marcadores certos e nenhum intruso**.
>
> Então o §7 aqui testa a **tela**, não o contrato — esse já está provado.
>
> **Use `TOKEN_OPENROUTER` do `app/.env.local`**, provedor **OpenRouter**,
> modelo **`mistralai/mistral-small-24b-instruct-2501`** (centavos por rascunho).
> ⚠️ **Evite os modelos `:free`**: o `google/gemma-4-31b-it:free` devolveu **429
> (limite upstream)** — não é bug nosso, mas atrapalha o teste.

1. Menu → **Configurações** → cartão **Provedor de IA** → **Configurar
   provedor**.
2. Escolha o provedor, informe o modelo e cole uma **chave errada** de
   propósito. **Salvar** → **Testar conexão**.

**Esperado:** erro **legível** (com o código HTTP), e **a chave não aparece na
mensagem**.

3. Troque pela chave certa. **Salvar** → **Testar conexão**.

**Esperado:** *"O provedor respondeu. Credencial e modelo estão válidos."*

4. Em **Explicações**, apague o texto de uma situação (ou use outra situação sem
   texto) e clique em **Gerar com IA**.

**Esperado:** o rascunho redigido **aparece no campo** (o texto muda diante de
você), o selo vira **rascunho**, e embaixo dos botões aparece *"rascunho
redigido por `<provedor>/<modelo>`"*.

> Este é um ponto que **falhava** antes da segunda rodada de review: o campo não
> ressincronizava e continuava mostrando o texto anterior, enquanto o selo já
> dizia rascunho. Se você vir isso acontecer de novo, é regressão.

**Leia antes de aprovar, e espere ter de editar.** No teste real com o
`mistral-small-24b`, o rascunho veio com os marcadores certos, mas escreveu
*"O {inss} é a sua contribuição…"* — que, depois da troca, vira *"O R$ 75,90
é…"*. E chamou o ISS de imposto pago *"em troca dos serviços públicos que você
utiliza"*, que é uma caracterização discutível de tributo. **Nada disso é
defeito do bloco: é exatamente o que a revisão humana existe para pegar** — e é
por isso que nenhum texto de IA chega ao cliente sem alguém carimbar.

5. Tente **Gerar com IA** numa situação **já aprovada**.

**Esperado:** o botão está **desabilitado**, com o motivo: *"Edite o texto para
derrubar a aprovação antes de gerar outro."* Gerar nunca sobrescreve o que um
humano carimbou.

6. Troque o provedor (ex.: Anthropic → Groq) e gere de novo.

**Esperado:** funciona **sem deploy** — é a razão de o provedor ser
configuração, e não código.

---

## §8 — O probe: o que a tela não prova

```bash
node app/scratchpad/_probe-6a.mjs
```

**Esperado — tudo verde:**
- **§1** — se houver provedor configurado: a chave está cifrada (`enc:v1:`) e
  **decifra** com a `CERT_ENC_KEY` deste ambiente;
- **§2** — a anon key **não** lê `config_ia`, **não** lê `explicacoes_faltando`
  e **não** executa a RPC do contador (401 nos três). E, agora que existe
  rascunho no banco, o teste de vazamento **deixa de ser vacuoso**: ele compara
  quantos rascunhos existem com quantos a sessão do cliente enxerga (tem de ser
  zero);
- **§3** — nenhuma explicação **aprovada** usa marcador fora do conjunto da sua
  chave, conferido contra o banco de verdade;
- **§4** — a fila do que falta, ordenada por vistas, com `✓` no que já foi
  resolvido.

> Rode este passo **depois** do §3, para que exista pelo menos um rascunho — é o
> que torna a verificação de vazamento real.

---

## §9 — Desfazer o cenário

1. **Configurações** → **Regime tributário** → **Editar** → volte para
   **`Simples Nacional`** (code 1) e **Salvar**.
2. Confira:

```bash
node app/scratchpad/seed-6a.mjs listar
```

**Esperado:** as três empresas de volta em `regime="1"`. (A `atividade_mei` da
ideapp pode ficar preenchida — ela é ignorada fora do MEI. Se quiser zerar,
use o `restore` do `seed-6a.mjs`, que só funciona se o `aplicar` tiver sido
usado.)

3. **Decisão sua:** o texto que você aprovou no catálogo **fica ou sai?**
   - **Fica:** é conteúdo legítimo e reaproveitável — todo MEI de serviços do
     país tem essa mesma explicação. Recomendado.
   - **Sai:** `DELETE FROM explicacoes_fiscais WHERE chave = 'das-mei:inss+iss';`
     (e `explicacoes_faltando` volta a contar do zero na próxima visita).

---

## Encerramento (eu faço, depois que você passar o smoke)

Na ordem, e nada fora dela:

1. verificação completa com o cenário ainda vivo;
2. restaurar o cenário (§9);
3. **rodar a suíte de novo sem o seed** — é aqui que se descobre teste que
   dependia de dado de cenário;
4. `next build` com o `npm run dev` **parado**;
5. commits;
6. merge `--no-ff` em `main`;
7. **confirmar com você antes do push** — é auto-deploy em produção.

---

## O que este bloco NÃO resolve (registrado, não esquecido)

- **A explicação só renderiza para MEI.** O catálogo aceita chaves de PGDAS-D
  (`pgdas:anexo-iii+fator-r`) e o admin consegue aprová-las, mas nenhuma tela do
  Simples as consome ainda.
- **O DAS-MEI usa o salário mínimo de 2025** (R$ 1.518 → INSS 75,90). Enquanto
  isso não for atualizado, quem tiver **guia real do SERPRO** divergindo da
  estimativa **não verá explicação** — de propósito, mas é uma perda de alcance.
  Corrigir é trocar `INSS_MENSAL` em `src/lib/fiscal/das-mei.ts`; o total e os
  componentes se ajustam sozinhos.
- **Não existe lista oficial de códigos de serviço** e **o Pix do DAS é
  suposição do PRD** — pré-requisitos de outros blocos, não deste.
