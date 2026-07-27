# Roteiro do smoke manual — Bloco 4A (Assinatura da Balu)

> **Status:** **em execução — falta só o §3-bis e o §4** · **Escrito em:** 2026-07-27
> **Branch:** `bloco-4-billing-asaas` · **Spec:** `docs/superpowers/specs/2026-07-27-bloco-4a-assinatura-balu-design.md`
> **Cenário já preparado no banco** — ver §5 antes de recriar qualquer coisa.

## ⛔ RETOMAR AQUI

**Falta:** o **§3-bis** (liberação manual do admin, agora com comprovante obrigatório) e o
**fechamento** (§4). Todo o resto passou.

O escritório já está **`inadimplente` e sem contrato** — é a condição que o §3-bis pede,
nada a rearmar. Logar como **admin** (`eufacopublicidade+admin@gmail.com`) e rodar L.1→L.9.
Em seguida o **§4**.

### O que já passou

| Parte | Resultado |
|---|---|
| §1 — admin dos planos | ✅ |
| §2.1–2.3 — gate do escritório, incluindo declaração anual liberada | ✅ |
| §3 — empresário: bloqueio, DAS liberado, exportar liberado, contratar, pagar, cancelar | ✅ |
| §2.4–2.6 — cliente não sente a inadimplência do escritório | ✅ |
| §3-bis — liberação manual pelo admin, agora **com comprovante obrigatório** | ⬜ não testada |

### Os 8 bugs que este smoke achou

Nenhum deles era pego por teste automatizado:

1. **`$` do token do Asaas comido pelo dotenv-expand** — chave certa no `.env.local`, app dizia "não configurado".
2. **Guarda do erro apontando para `ASAAS_API_KEY`**, nome que não existe mais — escondia o bug 1 atrás de "Tente novamente".
3. **`TOKEN_ASAAS_PRODUÇÃO`** com `Ç`/`Ã`: mina para o dia do `ASAAS_ENV=prod`.
4. **Contratar não liberava o acesso** — `assinar.ts` gravava a data e não o status; as duas metades se contradiziam em silêncio.
5. **`cobrancas` 100% dependente do webhook**, que não alcança `localhost` — fluxo terminava sem link de pagamento.
6. **Cancelar deixava o `asaas_subscription_id` morto** → quem cancelasse nunca mais conseguiria reassinar.
7. **A tela não refletia o pagamento sem F5** — o webhook avisa o servidor, não o navegador.
8. **Re-contratar depois de cancelar nunca reconhecia o pagamento** — a linha ficava em `cancelada`, status que os três caminhos de reconciliação excluem de propósito.

E **duas decisões de produto** mudaram o comportamento durante o smoke:
contratar **não libera nada** (só o pagamento reconhecido libera), e o bloqueio é dito
**na entrada** da tela, não no envio do formulário.

**Antes de começar:** subir o dev com `npm run dev` em `balu/app`.
**Enquanto o smoke roda: NÃO rodar a suíte** — os scripts abaixo mexem em assinaturas reais e o `afterAll` dos smokes automatizados sobrescreve o estado montado.

Todos os comandos rodam a partir de `D:\balu-app-v2\balu`.

## Contas

| Login | Papel | Usar para |
|---|---|---|
| `eufacopublicidade+admin@gmail.com` | AdminBalu | `/admin/assinaturas` |
| `testeefluxodeautomacao@gmail.com` | Contador — Escritório Teste Balu | telas `/contador/*` |
| `walacesssantos@gmail.com` | Empresário — empresa `ideapp` | telas de empresa |

---

## 1. Admin dos planos

Login **admin** → menu **Assinaturas**.

| # | Ação | Esperado |
|---|---|---|
| 1.1 | Ver a lista | 4 planos: Empresário R$ 49,90 · Escritório R$ 199 / R$ 399 / R$ 799, faixas `0..50`, `51..200`, `201..∞`, teste 7 dias, **Em uso = 0** |
| 1.2 | Editar Empresário, apagar o valor e digitar **`59,90` dígito por dígito** | Aceita normalmente. *(Bug corrigido: o campo se reformatava a cada tecla e produzia `5,01`.)* Salvar, conferir na lista, **e voltar para `49,90`** |
| 1.3 | Editar `Escritório — 51 a 200`, **De** = `10` | Recusa: as faixas se sobrepõem. Cancelar |
| 1.4 | Mesmo plano, **De** = `80` | Recusa: ninguém cobre **51 a 79**. Cancelar |
| 1.5 | Editar `201 ou mais`, **Até** = `1000` | Recusa: ninguém cobre 1001 ou mais. Cancelar |

## 2. O gate pelo lado do escritório

```bash
node app/scratchpad/smoke-bloco4a.mjs inadimplente
```

Login **contador**:

| # | Ação | Esperado |
|---|---|---|
| 2.1 | Criar cliente e lançar honorário | **Barram** com *"Sua assinatura está com pendência. Regularize em Assinatura para voltar a usar esta função."* — nunca um "não autorizado" seco |
| 2.2 | Topo da tela | Tarja **âmbar**: "Há uma cobrança em aberto — Ver assinatura" |
| 2.3 | Abrir cliente da carteira → card **Declarações anuais** → registrar comprovante | **Funciona.** Se barrar, é o bug mais grave possível do bloco: obrigação com prazo virando multa da Receita (decisão de produto nº 1) |

**Sem restaurar**, logar como **empresário**:

| # | Ação | Esperado |
|---|---|---|
| 2.4 | Emitir uma nota | **Funciona** — o escritório está inadimplente, mas o cliente não é parte do contrato (decisão nº 3.3) |
| 2.5 | `/conta` | **Nenhuma faixa de cobrança** acima de exportar/excluir dados (LGPD art. 18 §5º). Exportar deve funcionar |
| 2.6 | Menu → Assinatura | Texto de que a empresa é atendida por um escritório e **não há cobrança para ele** |

```bash
node app/scratchpad/smoke-bloco4a.mjs restore
```

## 3. O gate pelo lado do empresário

Exige a `ideapp` **desvinculada da carteira e com assinatura própria** — ver §5.

```bash
node app/scratchpad/destravar-empresario.mjs off inadimplente
```

Login **empresário**:

| # | Ação | Esperado |
|---|---|---|
| 3.1 | Emitir nota / cadastrar cliente | **Barram**, com a mensagem que leva à assinatura |
| 3.2 | `/impostos` → gerar DAS | **Funciona** — a fronteira que não pode ser cruzada |
| 3.3 | `/conta` → exportar meus dados | **Funciona**, e **sem** faixa de cobrança na tela |
| 3.4 | Menu → Assinatura | Plano, situação **Pagamento pendente**, e o bloco **Assinar** com `Empresário — mensal` |
| 3.5 | Clicar **Assinar** | Cria no **sandbox** (sem cobrança real). O bloco some, o selo vira **Aguardando pagamento** e aparece o botão **Pagar agora** |
| 3.6 | Voltar a emitir nota | **Continua barrado.** Decisão de produto de 27/07: contratar não libera nada — o acesso volta no reconhecimento do pagamento, nunca no clique |
| 3.7 | Pagar a fatura no sandbox (cartão `4444 4444 4444 4444`, validade futura, CVV `123`) e **voltar para a aba do Balu sem recarregar** | Em até 5s o selo vira **Ativa** sozinho, a cobrança aparece na lista e a tarja do topo some. Agora sim emitir nota **funciona** |
| 3.8 | **Cancelar assinatura** → confirmar | Cancela em um clique, **sem** tela de retenção nem "fale com o suporte" (CDC art. 39). O `asaas_subscription_id` é limpo, então dá para contratar de novo |
| 3.9 | **Re-assinar**, pagar de novo e esperar | Vira **Ativa** sozinho. Este passo existe porque a sequência assinar→cancelar→re-assinar→pagar deixava a linha em `cancelada`, status que os três caminhos de reconciliação excluem — o pagamento ficava invisível para sempre |

Para ver a faixa azul de trial: `node app/scratchpad/destravar-empresario.mjs off trial 1`

## 3-bis. Liberação manual pelo admin (não testada ainda)

Com um titular **bloqueado**, logar como **admin** → **Configurações**.

> **Mudança de 27/07 (migration 0052): o comprovante é OBRIGATÓRIO.** Não existe
> liberação sem arquivo anexado. A lista de formatos é de **bloqueio**, não de
> permissão: passa foto (inclusive **HEIC** do iPhone), PDF, Word, texto,
> planilha, e-mail salvo (`.eml`/`.msg`) e formato desconhecido; barra só
> executável e script (`.exe`, `.js`, `.bat`, `.html`, `.svg`…), inclusive
> disfarçado de `comprovante.pdf.exe`. Teto de 10 MB.

| # | Ação | Esperado |
|---|---|---|
| L.1 | Achar o titular na lista | Aparece como **Bloqueado**. O filtro já vem em "só bloqueados ou liberados" |
| L.2 | **Liberar acesso** → preencher tudo **menos** o arquivo | O botão **Confirmar liberação** fica **desabilitado**. O bloqueio é dito na entrada, não no envio |
| L.3 | Anexar um `.exe` (ou renomear algo para `teste.pdf.exe`) | **Recusa**, dizendo que o formato não serve como comprovante |
| L.4 | Anexar uma **foto** ou um **PDF**, motivo com menos de 5 letras, e confirmar | Recusa pelo motivo. Testar também **0** e **90** dias — recusa em ambos |
| L.5 | Motivo válido + 7 dias + arquivo → confirmar | Libera. A linha passa a mostrar **Comprovante: `<nome do arquivo>`** |
| L.6 | Clicar no nome do comprovante | **Baixa** o arquivo (nunca abre inline). O link é gerado no clique e vale 5 min |
| L.7 | Voltar ao titular e usar uma função bloqueada | **Funciona**, e a tela de assinatura mostra a faixa verde *"liberado pela Balu até…"* |
| L.8 | Admin → **Revogar** | Bloqueia de novo na hora. O **comprovante continua listado** — revogar não apaga o lastro do que foi feito |
| L.9 | **Renovar** com um arquivo diferente | O comprovante novo aparece, e o antigo **não é sobrescrito** no bucket (o `audit_log` guarda o path de cada liberação) |

O caminho de storage já foi provado fora da tela: `node app/scratchpad/_probe-comprovante.mjs`
(upload com service role, URL assinada com `attachment`, acesso público negado, limpeza).

## 4. Fechamento — obrigatório

⚠️ **O `restore` dos dois scripts NÃO desfaz contratação.** Eles devolvem `status` e
`trial_termina_em`, mas `plano_id`, `asaas_subscription_id` e as cobranças ficam — e a
assinatura segue **viva no sandbox do Asaas**. Por isso o `_rearmar-contratacao` vem
primeiro:

```bash
node app/scratchpad/_rearmar-contratacao.mjs escritorio cortesia
node app/scratchpad/destravar-empresario.mjs restore
node app/scratchpad/smoke-bloco4a.mjs restore
node app/scratchpad/_verify-0050.mjs
```

Esperado no `_verify-0050`:

```
assinaturas: cortesia=3
contabilidades SEM assinatura (tem de ser 0): 0
empresas autosservico SEM assinatura (tem de ser 0): 0
```

A `ideapp` volta para a carteira do `Escritório Teste Balu`, **sem** assinatura própria, e
o escritório volta a **cortesia sem contrato**.

### Depois do fechamento, antes do merge

```bash
node app/scratchpad/_ver-escritorio.mjs   # sem subscription, sem cobranças
npx vitest run                            # a suíte SEM o cenário montado
```

E o **`next build` com o dev parado** — é o único que pega export indevido em arquivo
`'use server'`/`route.ts`, e o Bloco 4A criou dois desses (`lib/billing/cron.ts` e
`admin/configuracoes/liberacao.ts`). `tsc` limpo não é garantia neste repo.

---

## 5. Estado do banco e os scripts

Os scripts vivem em `app/scratchpad/` (não versionado, mas presente no disco). Todos têm modo `restore` e guardam o valor original em arquivo `.json` ao lado — o restore funciona mesmo noutra sessão.

| Script | O que faz |
|---|---|
| `smoke-bloco4a.mjs` | Vira o status da assinatura do **escritório** (`estado` · `inadimplente` · `trial [dias]` · `restore`) |
| `destravar-empresario.mjs` | Desvincula a `ideapp` da carteira **e cria a assinatura própria** (`estado` · `off [trial\|inadimplente] [dias]` · `restore`) |
| `_verify-0050.mjs` | Confere tabelas, planos, cortesias e órfãos |
| `_probe-asaas.mjs` | Testa conectividade com o sandbox do Asaas |
| `_ver-cobrancas.mjs` | Compara as cobranças da `ideapp` no banco com as do sandbox |
| `_ver-escritorio.mjs` | Despeja a linha de assinatura do escritório e suas cobranças |
| `_ver-sub.mjs <sub_id>` | Lista as cobranças de uma subscription no sandbox |
| `_rearmar-contratacao.mjs escritorio\|empresa [status]` | **Desfaz a contratação**: apaga a subscription no sandbox, remove cobranças, limpa plano/liberação e volta ao status pedido |
| `_rearmar-a5.mjs` | Idem, só para a `ideapp` (anterior ao genérico acima) |
| `_reconciliar.mjs` | Roda o cron de billing local — faz o que o webhook faria, já que ele não alcança `localhost` |
| `_reparar-cancelada.mjs` | Destrava linhas em `cancelada` **com** subscription viva (o estado que o bug 8 criava) |
| `_probe-gate.mjs` | Mostra o que o gate decidiria para cada titular, e se o PostgREST enxerga colunas novas |
| `_env-como-o-next-le.mjs` | Compara o valor cru do `.env.local` com o que o Next entrega |
| `_repro-assinar.mjs` | Reproduz a contratação fora do Next para ver o erro cru do Asaas |
| `apply-0051.mjs` | Aplica a migration da liberação manual (**já aplicada**) |

**Identificadores fixos:**
- empresa `ideapp` / `dev.ide` = `c2410872-c9c0-47b5-a0e9-4d3e699a614e`
- escritório `Escritório Teste Balu` = `1418c7fb-f578-4029-a003-a754e9cf8dcc`
- assinatura do escritório = `0d15b5ca-6a3c-45a7-a19d-d6327630111a`

**Se os scripts sumirem**, o essencial é isto:

```sql
-- destravar o empresário (em TRANSAÇÃO — ver a armadilha abaixo)
BEGIN;
UPDATE public.companies SET contabilidade_id = NULL
 WHERE id = 'c2410872-c9c0-47b5-a0e9-4d3e699a614e';
INSERT INTO public.assinaturas (company_id, status)
VALUES ('c2410872-c9c0-47b5-a0e9-4d3e699a614e', 'inadimplente');
COMMIT;

-- restaurar
DELETE FROM public.assinaturas
 WHERE company_id = 'c2410872-c9c0-47b5-a0e9-4d3e699a614e';
UPDATE public.companies SET contabilidade_id = '1418c7fb-f578-4029-a003-a754e9cf8dcc'
 WHERE id = 'c2410872-c9c0-47b5-a0e9-4d3e699a614e';
```

### ⚠️ Armadilha: desvincular sem criar a assinatura invalida o teste

A `ideapp` **não tem assinatura** — empresa de carteira não tem, por design — e a trigger da `0050` só dispara no `INSERT`. Desvinculando sozinho, o gate encontra a empresa sem assinatura e cai no **fail-open**: libera tudo, e o smoke **parece aprovado sem ter testado nada**.

Isso aconteceu de verdade ao escrever o script (faltava um cast em `$3`, o `INSERT` falhou e o `UPDATE` já tinha passado), por isso o `off` roda em transação. Se for fazer na mão, use `BEGIN`/`COMMIT`.

### Enquanto a `ideapp` estiver desvinculada

Ela **some do painel do contador** e perde as policies de carteira. É esperado — o `restore` devolve.

---

## 6. Lacuna conhecida

Não há empresa autosserviço com login utilizável neste ambiente: as duas que existem são `AL PISCINAS`, do `allanvalle@outlook.com`, cuja senha não funciona aqui (falha pré-existente, registrada desde o Bloco A). Daí o desvínculo temporário da §3.

O caminho está coberto por teste automatizado de qualquer forma: `gate.smoke.test.ts` roda 7/7 contra o banco real, incluindo trial vigente, trial vencido, cortesia, inadimplente e o discriminante da carteira.

## 7. Depois que o smoke passar

1. Restaurar tudo (§4) e conferir o `_verify-0050`.
2. Rodar a suíte **sem** o cenário montado: `npx vitest run` a partir de `app/`.
3. `npx next build` com o dev **parado**.
4. Merge `--no-ff` para `main` — **confirmar com o usuário antes do push**, é auto-deploy em produção.
5. Atualizar o `CHECKPOINT.md`.
