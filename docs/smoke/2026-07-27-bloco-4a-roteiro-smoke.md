# Roteiro do smoke manual — Bloco 4A (Assinatura da Balu)

> **Status:** aguardando execução pelo usuário · **Escrito em:** 2026-07-27
> **Branch:** `bloco-4-billing-asaas` · **Spec:** `docs/superpowers/specs/2026-07-27-bloco-4a-assinatura-balu-design.md`
> **Cenário já preparado no banco** — ver §5 antes de recriar qualquer coisa.

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
| 3.5 | Clicar **Assinar** | Cria no **sandbox** (sem cobrança real). O bloco some e aparece **Próxima cobrança** em **hoje + 3 dias** |
| 3.6 | Voltar a emitir nota | **Funciona agora.** Correção do systematic-debugging: contratar libera até o 1º vencimento — senão o titular clicaria "Assinar" e continuaria barrado até o boleto compensar |
| 3.7 | **Cancelar assinatura** → confirmar | Cancela em um clique, **sem** tela de retenção nem "fale com o suporte" (CDC art. 39) |

Para ver a faixa azul de trial: `node app/scratchpad/destravar-empresario.mjs off trial 1`

## 4. Fechamento — obrigatório

```bash
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

A `ideapp` volta para a carteira do `Escritório Teste Balu`, **sem** assinatura própria.

---

## 5. Estado do banco e os scripts

Os scripts vivem em `app/scratchpad/` (não versionado, mas presente no disco). Todos têm modo `restore` e guardam o valor original em arquivo `.json` ao lado — o restore funciona mesmo noutra sessão.

| Script | O que faz |
|---|---|
| `smoke-bloco4a.mjs` | Vira o status da assinatura do **escritório** (`estado` · `inadimplente` · `trial [dias]` · `restore`) |
| `destravar-empresario.mjs` | Desvincula a `ideapp` da carteira **e cria a assinatura própria** (`estado` · `off [trial\|inadimplente] [dias]` · `restore`) |
| `_verify-0050.mjs` | Confere tabelas, planos, cortesias e órfãos |
| `_probe-asaas.mjs` | Testa conectividade com o sandbox do Asaas |

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
