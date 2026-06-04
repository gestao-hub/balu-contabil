# Fator R, CNAE e segregação de receitas — modelo + fontes de dados

**Data:** 2026-06-04
**Contexto:** estudo nascido do P0.3 (Fator R) do backlog de impostos. Documenta como o Simples
realmente funciona (Fator R + multi-atividade), o que o código faz hoje, e quais canais de dados
existem pra estruturar isso. Consulta de referência para os próximos passos.

Relacionado: `docs/planning/BACKLOG-IMPOSTOS.md` (P0.3), `docs/investigations/REVISAO-ESCOPO-IMPOSTOS.md`.

---

## 1. Como o Simples funciona de verdade (o modelo correto)

### 1.1 Duas perguntas diferentes sobre o Fator R (não confundir)

- **(A) "Esta atividade está SUJEITA ao Fator R?"** → vem da **atividade/CNAE** + a lei
  (LC 123/2006, art. 18, §5º-J e §5º-M). Cada atividade é: Anexo III sempre · Anexo IV sempre ·
  Anexo V sempre · **ou "depende do Fator R"** (oscila III↔V). É uma característica **objetiva**
  da atividade — **não deveria ser um toggle manual** ligado/desligado a gosto.
- **(B) "Qual é o Fator R deste período?"** → **NÃO vem do CNAE**. Vem de
  **folha de salários dos últimos 12 meses (com pró-labore + encargos) ÷ RBT12**. Muda mês a mês.
  Regra: **≥ 28% → Anexo III** (começa em 6%); **< 28% → Anexo V** (começa em 15,5%).
  O Fator R é **da empresa toda** (folha total ÷ RBT12 total), calculado **uma vez**, e decide
  III↔V de **todas** as atividades sujeitas.

### 1.2 Segregação de receitas (multi-atividade)

O Simples **não** usa um anexo único pra empresa. Na PGDAS-D a receita é **segregada por
atividade**, e **cada fatia é tributada pelo seu anexo**. Uma empresa pode ter **vários anexos ao
mesmo tempo**. Ex. (caso real da AL Piscinas, CNPJ 10358425000120):
- Principal `4299501` (construção de instalações esportivas) + secundários `4322301` (instalações
  hidráulicas), `4744005`/`4744003` (comércio de materiais), `4789005` (saneantes), `4120400`
  (construção de edifícios) → mistura **comércio (Anexo I)** com **serviços/construção**.

→ Logo: usar só o **CNAE principal** pra escolher um anexo único é uma simplificação que já está
errada para multi-atividade — **independente** do Fator R.

### 1.3 Fluxo correto, ponta a ponta

1. **CNAE → tabela →** anexo-base + flag "sujeito a Fator R" (por atividade).
2. Receita **segregada por atividade/anexo**.
3. **Fator R** (folha 12m ÷ RBT12, nível empresa) decide III↔V das fatias sujeitas.
4. Cada fatia → tabela do Simples sobre o RBT12 → alíquota efetiva.
5. DAS = **soma** das fatias.

---

## 2. O que o código faz hoje (e os gaps)

- `apuracao.ts` faz **dupla simplificação**: (a) **soma toda a receita num balde só** (não segrega);
  (b) aplica **um anexo único** = `empresas_fiscais.anexo_simples`, escolhido **na mão**.
- `regime.ts`: `fatorRAplicavel(anexo)` só diz se Fator R é relevante (III/V) — booleano de UI.
  `usa_fator_r` é flag manual e **nunca entra na conta**. **Não há cálculo de Fator R.**
- `cnae_principal` é **guardado** (vem da consulta de CNPJ) mas **não é usado pra nada fiscal**.
- **Correto só para empresa de atividade única** (a maioria dos MEIs/Simples pequenos — público
  inicial). Multi-atividade está estruturalmente fora.

**Decisão de direção (2026-06-04):** público inicial é pequeno (atividade única), mas **queremos já
deixar estruturado** para multi-atividade/segregação.

---

## 3. Fontes de dados (canais) — VERIFICADO

### 3.1 CNAEs ATIVOS de uma empresa (principal + secundários)

| Canal | Traz secundários? | Descrição do CNAE? | Observação |
|---|---|---|---|
| **Focus** `GET /v2/cnpjs/{cnpj}` (prod) — já integrado (`cnpj-lookup.ts`) | ❌ **NÃO** | ❌ (só código) | Resposta real só tem `cnae_principal` (código). **Confirmado** na AL Piscinas. |
| **BrasilAPI** `GET /api/cnpj/v1/{cnpj}` (público, grátis) | ✅ **SIM** (`cnaes_secundarios[]`) | ✅ (código + descrição) | **Necessário** para secundários. Tem `cnae_fiscal` + `cnae_fiscal_descricao`. ⚠️ Ver caveat de produção abaixo. |
| ReceitaWS / CNPJá | ✅ | ✅ | Alternativas (CNPJá tem plano pago/API key). |

→ **Conclusão:** pra capturar a lista completa de CNAEs da empresa, a Focus **não basta** — usar
**BrasilAPI** (ou equivalente). Hoje o `mapLookup` da Focus só extrai `cnae_principal`.

> ⚠️ **BrasilAPI em produção:** é gratuita e **sem plano pago/SLA** — tem rate-limit anti-abuso
> (devolve **403** em burst; confirmado em 2026-06-04 ao rodar o backfill). Por isso o desenho usa a
> **Focus** como fonte do CNAE **principal** (confiável, já paga; é o que a apuração da fundação
> precisa) e a BrasilAPI **só best-effort** pros secundários. Quando os secundários virarem crítico
> (multi-atividade), avaliar provedor pago (**CNPJá**) ou checar se o **SERPRO Integra Contador**
> (já integrado, mTLS) tem consulta cadastral/CNAEs oficial. Backfill em massa: throttle pesado ou
> provedor pago.

### 3.2 Catálogo de CNAE (pesquisar/validar código ↔ descrição)

| Canal | Path | Retorna |
|---|---|---|
| **Focus** (já autenticado) | `GET /v2/codigos_cnae/{codigo}` · `GET /v2/codigos_cnae?codigo=&descricao=&...` (busca, paginado 50, header `X-Total-Count`) | código, descrição, hierarquia (seção→subclasse), `codigo_formatado`. **Sem anexo/Fator R.** |
| **IBGE/CONCLA** (oficial) | `GET https://servicodados.ibge.gov.br/api/v2/cnae/subclasses/{codigo}` | código + descrição + hierarquia completa. |

→ Serve para **autocomplete/validação** de CNAE no cadastro. A Focus é o caminho de menor atrito
(auth já existe). **Nenhum** traz a classificação por anexo.

### 3.3 CNAE → Anexo do Simples / sujeição a Fator R

**NÃO existe API oficial.** A classificação sai da LC 123/2006 + Resoluções CGSN (listas de
atividades dos §5º). É publicada como **tabela curada** (softwares contábeis, Sebrae, CRC).
→ **Tem que ser construída/curada por nós** (dá pra semear com os CNAEs que aparecem na base e ir
crescendo). É o **ativo que destrava o cálculo automático** de anexo/Fator R.

---

## 4. Estrutura proposta (incremental)

1. ✅ **Catálogo de CNAE via Focus** — `focus.consultarCnae/listarCnaes` + `lib/fiscal/cnae-catalog.ts`. **Feito.**
2. ✅ **Capturar CNAEs (principal + secundários)** via BrasilAPI → tabela relacional `company_cnaes`.
   **Feito** (decidimos **tabela relacional**, não jsonb). Best-effort com fallback pro principal da Focus.
3. ✅ **Tabela de referência `cnae_anexo`** (código → `anexo_base` + `fator_r` + `anexo_iv`).
   **Feito** (migration 0020, semeada com 7 CNAEs iniciais). Curadoria completa = passo futuro.
4. ⏳ **Apuração SEGREGADA por anexo** (lista, não balde) — **futuro**. Hoje a apuração lê o anexo do
   CNAE **principal** via `resolverAnexo` (1 fatia); o modelo de dados já comporta multi-atividade.
5. ⏳ **Cálculo de Fator R** (folha ÷ RBT12, decisão III↔V) — **futuro**. Hoje só o flag `fator_r` é
   guardado; CNAE Fator-R cai no anexo manual com aviso. **Fonte da folha:** input manual (12m).

Ver `docs/superpowers/specs/2026-06-04-modelo-cnae-anexo-design.md` (spec) e
`docs/superpowers/plans/2026-06-04-modelo-cnae-anexo.md` (plano executado).

---

## 5. Decisões pendentes (para a fase de segregação/Fator R)

- **Fonte da folha de 12 meses** para o Fator R (input manual? Fator R % direto?). Sem isso, o III↔V
  não calcula — no mínimo, **sinalizar** que o anexo é suposição (não tratar valor como final).
- **Curadoria da `cnae_anexo`**: de onde semear a tabela completa (lista da LC/CGSN, planilha
  contábil de referência). Hoje só 7 CNAEs semeados.
- **Anexo IV** tem particularidade (INSS pago à parte, fora do DAS) — tratar quando entrar.
- **Conflito CNAE×manual:** quando o CNAE mapeado e o `anexo_simples` manual divergem, hoje o CNAE
  sobrescreve (ex.: AL Piscinas migrou III→IV, que é a classificação correta p/ construção). Avaliar
  se vale **sinalizar o conflito** em vez de sobrescrever em silêncio.

---

## 6. Atualização — fundação implementada (2026-06-04)

Branch `feat/fundacao-cnae-anexo`. Tabelas `cnae_anexo` + `company_cnaes` (migration 0020),
`resolverAnexo` (puro), `brasilapi.ts`, `cnae-sync.ts` (`sincronizarCnaesEmpresa` + `resolverAnexoEmpresa`),
wiring no `createCompanyAction` e na apuração. Não muda o cálculo; degrada p/ manual sem a migration.
Verificado end-to-end na AL Piscinas (principal `4299501` → **Anexo IV** via `cnae_anexo`).

**Gotchas descobertos:**
- **Índice único PARCIAL ≠ ON CONFLICT.** `company_cnaes` tem unique `(company_id,codigo) WHERE
  deleted_at IS NULL`; o Postgres rejeita `ON CONFLICT` contra índice parcial (erro `42P10`). O sync
  usa **full-replace** (delete + insert), que também reflete remoções de CNAE.
- **BrasilAPI 403 por rate-limit** (ver caveat na §3.1) — backfill em massa esbarra nisso; o fluxo
  on-demand (1 consulta/empresa) é OK e cai na Focus pro principal.
