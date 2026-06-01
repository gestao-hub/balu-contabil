# Apuração: análise do fluxo n8n e migração pro Next

> **Status:** análise concluída (2026-05-28). Recomendação: migrar pro Next em PRs pequenos. Implementação pendente — ver "Plano de execução" no final.

**Inputs analisados:**
- `docs/n8n/Fluxo_apuração.json` (3 webhooks + 22 nós)
- `docs/n8n/api serpro integra contador.json` (auth + chamadas)
- Schema real: `balu-next/db_atual.sql` (`receitas_fiscais`, `apuracoes_fiscais`, `empresas_fiscais`)
- Código existente: `balu-next/src/lib/fiscal/regime.ts`, `guia.ts`

---

## 1. Viabilidade — mover pro Next?

**Recomendação: MOVER, confiança alta.** Justificativa em 6 eixos:

| Eixo | n8n hoje | Next (proposto) | Vantagem |
|---|---|---|---|
| Latência | 3 webhooks HTTP loopback (`webhooks.envia.click` → mesmo servidor n8n → de novo) | 1 transação SQL local | ~10× mais rápido |
| Atomicidade | nada garante que os 3 passos completem juntos | transação SQL única | sem estado parcial |
| Segurança | webhook público, sem auth/HMAC | server action atrás de session cookie + RLS | sem CSRF/SSRF |
| Testabilidade | impossível testar lógica do nó "Code" | vitest contra helpers puros | regressão zerada |
| Manutenção | editor visual + JS inline em string JSON | TS tipado com Zod + types | refactor seguro |
| Custo operacional | servidor n8n + manutenção | já temos o Next | $$ menor |

**Contra-argumento honesto:** n8n facilita edição visual por contador/admin não-técnico. Mas o caso atual do Balu é dev-driven, e as 6 vantagens compensam.

---

## 2. Inventário — temos tudo pra rodar no Next?

### ✅ JÁ TEMOS

| Item | Onde |
|---|---|
| Schema real `receitas_fiscais` | `db_atual.sql` (15 colunas, com `competencia_referencia` varchar(7), `valor` numeric, `tipo`) |
| Schema real `apuracoes_fiscais` | `db_atual.sql` (com `payload_calculo` jsonb) |
| Schema real `empresas_fiscais` | `regime_tributario`, `anexo_simples`, `usa_fator_r`, `Code_regime_tributario` |
| Supabase server client + auth | `src/lib/supabase/server.ts` |
| Padrão de helpers puros + actions | `src/lib/fiscal/*.ts`, `src/app/(auth)/*/actions.ts` |
| Regime → tipo | `regime.ts` (`tipoFromCode`, `fatorRAplicavel`) |
| Helpers de competência | `guia.ts` (`competenciaReferenciaBrt`, `competenciaLabel`) |
| Dashboard que vai consumir | PR 3.1 (`/impostos`) — mergeado 2026-05-28 |

### ❌ FALTA

| Item | Esforço |
|---|---|
| Tabela Simples Nacional (Anexo I-V) em código tipado | 1h + testes |
| `identificarFaixa(rbt12, anexo)` | 30min + testes |
| `aliquotaEfetiva(rbt12, nominal, parcela)` | 30min + testes |
| `calcularRbt12(receitas, competenciaAtual)` | 1h + testes |
| `valorDasMei(atividade)` (3 valores fixos) | 15min |
| Fator R: cálculo da folha/receita | 1-2h — **precisa de `folha_pagamento` 12m no schema** (não temos hoje) |
| **Como popular `receitas_fiscais`** — hoje as notas vivem em `notas_fiscais` mas a apuração lê `receitas_fiscais` (tabela separada do Bubble) | **RESOLVIDO (2026-05-31): opção (b)** — lê de `notas_fiscais`; `receitas_fiscais` descontinuada (drop migration 0014) |
| Cliente Serpro Integra Contador (PR 3.2 etapas 4-5) | 4-6h |
| Construtor de envelope Serpro (`contratante/autorPedidoDados/contribuinte`) | 1-2h |
| Mapping `idServico` (GERARDAS12, TRANSDECLARACAO11, GERARDASAVULSO19, etc) | 1h |

### ⚠️ DECISÕES PENDENTES

1. **`receitas_fiscais` vs `notas_fiscais`** — o n8n consulta `receitas_fiscais`, mas hoje só temos dados em `notas_fiscais` (PR 1.2/2.1). Esse é o card **"Passo 3"** no kanban ("Apuração/DAS no formato real do banco"). Solução: ou (a) cron que sincroniza notas→receitas, ou (b) helper que lê de `notas_fiscais` direto, ou (c) backfill manual. **→ Decisão (2026-05-31): opção (b)** — helper `receitas-source.ts` lê de `notas_fiscais`; `receitas_fiscais` foi dropada (migration 0014).
2. **Folha de pagamento** pro Fator R — não temos schema. MVP pode omitir Fator R e assumir Anexo III/V fixo até implementar `folhas_pagamento`.
3. **Anualização do RBT12** pra empresas < 12 meses — comportamento legal documentado no PRD/regulamentação, mas n8n ignora. Vamos implementar correto desde o Next.

---

## 3. Análise crítica dos cálculos e lógica do n8n

**6 bugs reais** e **2 limitações arquiteturais**, em ordem de gravidade.

### 🔴 Bug 1 — `receita_mes` populado com o MÊS, não com o valor

`create_apuracao` (MEI) e `create_apuracao1` (Simples):
```jsonc
{
  "fieldId": "receita_mes",
  "fieldValue": "={{ $('calcular_apuracao_pgdasd').item.json.body.competencia.split('-')[1] }}"
}
```
Pra `competencia = "2025-01"`, isso grava **`receita_mes = "01"`** (ou seja, R$ 1!). Deveria ser `$('consolidar_receitas').item.json.receitas_soma`. Afeta **tanto MEI quanto Simples** no insert.

Impacto: relatórios e cálculos posteriores que confiam em `receita_mes` são lixo.

### 🔴 Bug 2 — RBT12 cobre 13 meses, **inclui a competência atual**

`buscar_receitas_supabase_rbt12`:
```jsonc
{
  "keyName": "competencia_referencia",
  "condition": "gte",
  "keyValue": "={{ split('-').map((v,i) => i===0 ? v-1 : v).join('-') }}"
  // → "2024-01" para input "2025-01"
},
{
  "keyName": "competencia_referencia",
  "condition": "lte",
  "keyValue": "={{ $json.body.competencia }}"
  // → "2025-01" (incluído!)
}
```

Range inclusivo `2024-01..2025-01` = **13 meses**. Pior: **inclui a própria competência atual** que ainda está sendo apurada.

**Regra correta** (RFB): RBT12 de janeiro/2025 = receita acumulada dos 12 meses imediatamente anteriores = janeiro/2024 a **dezembro/2024**. Range deveria ser `[ano-1, mes]` a `[ano, mes-1]` (com tratamento de virada de ano).

Impacto: alíquota efetiva é mais alta do que deveria (pq RBT12 está inflado pela competência atual).

### 🔴 Bug 3 — Alíquota efetiva pode ser negativa (sem clamp)

`calcular_aliquota`:
```js
const aliquota_efetiva = ((rbt12 * aliquota_nominal) - parcela_deduzir) / rbt12;
```

Exemplo: RBT12 = R$ 100.000, Anexo I (nominal 4%, parcela 0). Resultado = 4%. OK.
Exemplo: RBT12 = R$ 200.000, Anexo I faixa 2 (nominal 7.3%, parcela 5.940). Resultado = (14.600 − 5.940)/200.000 = **4.33%**. OK.

Risco: se `rbt12 < parcela/nominal`, alíquota fica negativa. A busca de faixa `find(f => rbt12 <= f.ate)` ordena pela primeira faixa cuja condição é verdadeira — se ordenado por `ate` crescente (está), faixas baixas com `parcela = 0` blindam o pior caso. Mas falta `Math.max(0, …)` como guard defensivo.

### 🔴 Bug 4 — Lucro Real / Presumido não tratado

Switch `Mei_simples` só tem 2 branches: `mei` e `simples`. Empresa com `regime_tributario = 'lucro_real'` ou `'presumido'` cai num **void** — não retorna nada útil.

E pior: nosso `tipoFromCode('3')` em `regime.ts:24` retorna `'simples'`. Empresas Lucro Real (`Code_regime_tributario = '3'`) **entram no fluxo Simples no n8n e dão resultado errado** (rodam a tabela de Simples sobre receita que não é simples). Bug nosso + bug deles.

### 🟡 Bug 5 — Race condition no `existe_apuracao`

`procurar_apuracao_das` → `IF (id !== undefined)` → `att_apuracao` (UPDATE) OU `create_apuracao` (INSERT).

Sem `UNIQUE (company_id, competencia_referencia)` na tabela, 2 requisições concorrentes podem ambas ler "não existe" e ambas inserir. Verifiquei o `db_atual.sql` — **a constraint UNIQUE não existe**.

**Fix necessário ao migrar**: migration aditiva
```sql
CREATE UNIQUE INDEX uniq_apuracoes_company_competencia
  ON apuracoes_fiscais (company_id, competencia_referencia)
  WHERE deleted_at IS NULL;
```

### 🟡 Bug 6 — `att_apuracao` filtra por id errado

```jsonc
{
  "keyName": "id",
  "condition": "eq",
  "keyValue": "={{ $json.empresa_id }}"
}
```

Filtra `apuracoes_fiscais.id = empresa_id` — UUIDs **nunca batem** (id é da apuração, empresa_id é da empresa). UPDATE sempre afeta 0 linhas → todo fluxo cai pro INSERT.

Combinado com Bug 5: cada execução cria registro novo. Banco enche de duplicatas silenciosas.

**Fix correto**: filtrar por `id = $('procurar_apuracao_das').item.json.id`.

### ⚠️ Limitação 1 — RBT12 não anualiza pra empresas novas

Regra real (RFB): empresa em atividade < 12 meses calcula RBT12 **proporcional**:
```
RBT12 = receita_acumulada_real × (12 / meses_atividade)
```

Fluxo n8n soma simples. Resultado: subestima alíquota efetiva pra empresas no primeiro ano.

### ⚠️ Limitação 2 — Tabela do Simples hardcoded, sem versionamento por vigência

Tabela está embutida no JS dentro de string JSON do nó. Não tem versão por data de vigência (caso Receita atualize, como ocorreu na transição LC 155/2016 → LC 214/2025 da Reforma Tributária).

**As tabelas atuais (no n8n) são da LC 155/2016 — válidas em 2026.** Vão precisar revisão pra 2033+ (transição IBS/CBS). Em Next, ficaria `const TABELA_2026: Tabela = …` com helper `getTabela(competencia)` que retorna a versão certa.

---

## 4. Comparação: regimes suportados

| Regime | Code | tipoFromCode | n8n suporta? | Observação |
|---|---|---|---|---|
| Simples Nacional | 1 | 'simples' | ✓ | Fluxo Simples |
| Simples + excesso sublimite | 2 | 'simples' | ✓ | Mesma tabela |
| Regime Normal (Lucro Real/Presumido) | 3 | 'simples' ⚠ | ❌ | **Bug 4** — cai no Simples errado |
| MEI | 4 | 'mei' | ✓ | Valor fixo |

Fix necessário em `regime.ts`:
```ts
export function tipoFromCode(code: string | null | undefined): RegimeTipo {
  if (code === '4') return 'mei';
  if (code === '3') return 'normal';  // NOVO
  return 'simples';
}
```
E adicionar branch `normal` no orquestrador.

---

## 5. Plano de execução proposto

PRs pequenos, em ordem de dependência:

| PR | Escopo | Estimativa | Bug que corrige |
|---|---|---|---|
| **3.x.1** — `lib/fiscal/simples.ts` | Tabela tipada (Anexos I-V) + `identificarFaixa` + `aliquotaEfetiva` + `Math.max(0, …)` + 20+ testes (boundary cases) | 2h | 3 (clamp), 6 |
| **3.x.2** — `lib/fiscal/rbt12.ts` | `calcularRbt12(receitas, competencia, dataInicioAtividade?)` puro com **anualização proporcional** + testes | 2h | 2, ⚠1 |
| **3.x.3** — `lib/fiscal/das-mei.ts` | Valores fixos 2026 + `valorDasMei(atividade)` | 30min | — |
| **3.x.4** — migration aditiva | `UNIQUE (company_id, competencia_referencia)` em `apuracoes_fiscais` | 30min | 5 |
| **3.x.5** — `lib/fiscal/apuracao.ts` orquestrador puro | `calcularApuracao({regime, anexo, receitas, competencia})` → `{rbt12, aliquotaEfetiva, valorImposto, breakdown}` | 2h | 1 (recebe receita correta) |
| **3.x.6** — server action `iniciarApuracaoAction` | Lê empresa + receitas → chama orquestrador → upsert atomicamente em `apuracoes_fiscais` | 3h | 5 |
| **3.x.7** — UI wizard `/impostos/novo` | 2 etapas (preview com breakdown + confirmar) | 4h | — |
| **3.x.8** — Cliente Serpro + envelope + `emitirDAS` | Após core funcionar | 6h | — |
| **3.x.9** — `gerarGuiaAction` (chama Serpro, persiste em `guias_fiscais`) | | 2h | — |

**Total estimado: ~22h** (vs 12-16h da estimativa original do PR 3.2, antes da análise descobrir os bugs e a falta de Lucro Real).

**Pré-requisito** ~~obsoleto~~ (decisão tomada 2026-05-31: opção b) — a origem das receitas já foi resolvida: helper `receitas-source.ts` lê de `notas_fiscais` e `receitas_fiscais` foi dropada (migration 0014). Não há mais sync `notas_fiscais → receitas_fiscais` a fazer.

---

## 6. Decisão sobre Fator R (Anexo III vs V)

Hoje o n8n **não calcula Fator R** — usa o `anexo_simples` cadastrado na empresa direto. Isso é aceitável pra MVP, mas tecnicamente incorreto: Fator R é apurado **mês a mês** (folha últimos 12m ÷ receita últimos 12m). Se ≥ 28%, anexo III; senão, V.

**Decisão recomendada**: MVP usa o anexo cadastrado (mesmo comportamento do n8n). Quando `folhas_pagamento` for adicionado ao schema, implementar `calcularFatorR(folha12m, rbt12)` e migrar.

---

## 7. Anexo: bugs encontrados no fluxo Serpro (`api serpro integra contador.json`)

Análise rasa do segundo JSON, ainda não detalhada:
- Endpoint de autenticação OAuth (`post-autenticacao`) usa Buffer + base64 — OK.
- 27 nós no total — não inspecionei todos. Análise completa entra no PR 3.x.8 quando formos integrar Serpro.

---

## 8. Conclusão

**Mover pro Next é viável e recomendado.** O fluxo n8n tem 6 bugs reais (2 críticos de cálculo, 1 grosseiro de campo, 2 de race condition, 1 de filtro) e 2 limitações estruturais. Reimplementar em TS testável corrige tudo e ganha latência, segurança e manutenibilidade.

**Próximo passo concreto**: decidir entre **PR Passo 3** (refactor schema notas→receitas) ou **PR 3.x.1** (helper `simples.ts` — já dá pra começar mesmo sem dados reais, com testes unitários).
