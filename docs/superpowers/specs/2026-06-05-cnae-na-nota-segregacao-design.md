# Spec — CNAE na nota + apuração segregada por anexo

**Data:** 2026-06-05
**Origem:** continuação do P0.3 (segregação ficou fora de escopo lá). Brainstorming 2026-06-05.
**Relacionado:** `docs/investigations/FATOR-R-CNAE-SEGREGACAO.md`, specs de `modelo-cnae-anexo` e `fator-r-calculo`.

## Problema

Hoje a apuração soma **toda** a receita do mês num balde só e aplica **um** anexo (o do CNAE
principal). Para empresas multi-atividade, o Simples exige **segregar a receita por atividade**: cada
fatia tributada pela tabela do seu anexo. Falta (a) saber a que atividade cada nota pertence e (b) a
apuração fatiar por anexo.

## Decisões fechadas (brainstorming)

1. **Escopo B:** capturar a atividade na nota **e** segregar a apuração (não só capturar).
2. **Guarda-se o CNAE na nota, não o anexo.** O anexo de um serviço Fator-R é III ou V conforme o
   Fator R da competência (muda mês a mês). Congelar o anexo na emissão defasaria; guardando o CNAE,
   a apuração resolve o anexo na hora, reaproveitando o Fator R do P0.3.
3. **Fator R é da empresa, não da nota.** A tag de CNAE só roteia a nota para o balde certo; qual III
   ou V é o resultado do Fator R da empresa (uma conta só). Dois serviços Fator-R caem no mesmo III/V.
4. **Dropdown na emissão de NFS-e:** opções = `company_cnaes` (principal + secundários), rotulados
   com o anexo. **1 CNAE → principal pré-selecionado e travado**; **>1 → obrigatório** escolher (não
   emite sem selecionar); **0 conhecido →** cai no `cnae_principal` do regime (travado) ou, sem isso,
   emite sem tag (apuração usa o fallback do principal). **Nunca bloqueia emitir por falta de CNAE.**
5. **Fora de escopo:** prévia ao vivo reagir ao dropdown (segue a estimativa da empresa); NFe/NFCe
   ganham a coluna mas sem selector dedicado nesta entrega (caem no fallback do principal); filtrar o
   dropdown por "atividade operada" (mostra todos os company_cnaes por ora).

## Modelo de dados

- Migration **0024** `notas_fiscais.cnae TEXT` (aditiva/idempotente, `ADD COLUMN IF NOT EXISTS`).
  Guarda o código de 7 dígitos (sem máscara). NULL = sem tag (fallback no principal).
- `app/src/types/database.ts`: `cnae: string | null` em Row/Insert/Update de `notas_fiscais`.
- A descrição do CNAE **não** é snapshotada na nota — deriva de `company_cnaes`/`cnae_anexo` ao exibir.

## Captura (emissão de NFS-e)

- **Carregar os CNAEs:** nova action/leitura `listarCnaesEmpresaAction()` → `CnaeOption[]`
  (`{ codigo, descricao, anexoLabel }`) a partir de `company_cnaes` (LEFT JOIN `cnae_anexo` p/ o
  rótulo do anexo). `nfse/page.tsx` passa essa lista ao `EmissaoForm`.
- **`EmissaoForm`:** novo `<select>` "Atividade (CNAE)" com as opções. Regras da decisão 4
  (1 travado pré-selecionado / >1 obrigatório / 0 fallback). Hidden input `name="cnae"`. Validação
  client: se há >1 opção e nenhuma escolhida → erro "Selecione a atividade (CNAE)".
- **Action:** `EmitirNotaInput` ganha `cnae?: string | null`; `emitirNotaFormAction` lê `cnae` do
  FormData; `emitirNotaAction` grava `cnae` no insert de `notas_fiscais`. Default seguro: se vier
  vazio e a empresa tiver exatamente 1 CNAE conhecido, usa esse (espelha o travado da UI no servidor).

## Apuração segregada

### Núcleo puro — `calcularApuracao` (apuracao.ts) + `ReceitaApuracao`

- `ReceitaApuracao` ganha `anexo?: AnexoSimples | null` (o anexo **já resolvido** da nota; só as
  receitas da própria competência precisam dele). `cnae?: string | null` também, p/ rastreio.
- O caminho Simples passa a **agrupar a receita da competência por anexo**, usando `r.anexo ?? anexo`
  (o param `anexo` vira o **fallback** p/ notas sem tag):
  ```
  rbt12 = calcularRbt12(receitas, competencia)            // total, inalterado
  doMes = receitas.filter(r => r.competencia === competencia)
  buckets: Map<AnexoSimples, number>                       // soma por anexo
  for r of doMes: a = r.anexo ?? anexoFallback; if (!a) throw; buckets[a] += r.valor
  valorImposto = 0; porAnexo = []
  for [a, receita] of buckets:
    faixa = identificarFaixa(rbt12, a, competencia)
    aliq  = aliquotaEfetiva(rbt12, faixa)
    valor = receita * aliq
    valorImposto += valor
    porAnexo.push({ anexo: a, receita, aliquotaEfetiva: aliq, valor, faixa: faixa.faixa })
  aliquotaEfetiva (geral) = receitaMes > 0 ? valorImposto / receitaMes : 0
  ```
- `breakdown` ganha `porAnexo` (lista acima) + `segregado: boolean` (true se >1 bucket).
- **Compatibilidade:** sem `r.anexo` em nenhuma receita (estado de hoje), tudo cai no `anexoFallback`
  → 1 bucket → resultado idêntico ao atual. Apurações antigas e atividade única não mudam.

### Camada impura — resolver os anexos das notas

Novo `app/src/lib/fiscal/segregacao.ts` (server-only):

```ts
export async function anexarAnexosDasReceitas(
  supabase, companyId, competencia, receitas: ReceitaApuracao[], fallbackAnexo: AnexoSimples | null,
): Promise<ReceitaApuracao[]>
```
- Coleta os `cnae` distintos das receitas da competência. Se nenhum tem `cnae` → retorna as receitas
  inalteradas (fast path → fallback).
- Carrega `cnae_anexo` desses códigos. Calcula o **Fator R da empresa uma vez**
  (`lerFolhaParaApuracao` + `calcularRbt12(receitas)` → `calcularFatorR`).
- Resolve cada nota da competência → anexo:
  - sem `cnae` ou `cnae_anexo` ausente → `fallbackAnexo`;
  - `fator_r=true` → `fatorR.suficiente ? fatorR.anexoDecidido : fallbackAnexo`;
  - senão → `anexo_base ?? fallbackAnexo`.
- Anexa `anexo` às receitas da competência; demais (janela do RBT12) seguem sem `anexo`.

### Wiring

- `iniciarApuracaoAction`: depois de `lerReceitasParaApuracao`, chama `anexarAnexosDasReceitas(...,
  fallbackAnexo = resolvido.anexo)` e passa as receitas anotadas ao `calcularApuracao`. Persiste o
  `breakdown` (com `porAnexo`) em `payload_calculo` (já acontece). `lerReceitasParaApuracao` passa a
  ler também `cnae` (`select(..., notas_fiscais.cnae)` via payload? não — coluna direta).
- `obterPreviewImposto`: idem (mesma anotação antes do `montarPreview`), p/ a estimativa refletir a
  segregação das notas já existentes. A prévia por-nota no form **não** muda (decisão 5).

### `receitas-source.ts`

`lerReceitasParaApuracao` passa a selecionar `cnae` e a devolvê-lo em `ReceitaApuracao.cnae`.

## Exibição (`/impostos`)

No card da competência (`CompetenciaAtualCard`), quando `breakdown.segregado`, mostrar uma lista
compacta **por anexo** (receita · alíquota · valor). Quando não segregado, segue como hoje. Mudança
mínima e tolerante a apurações antigas (sem `porAnexo`).

## Bordas
- Nota sem `cnae` → fallback do principal (comportamento de hoje).
- CNAE Fator-R com Fator R insuficiente (sem folha) → fallback (não chuta III/V).
- CNAE da nota que não está em `company_cnaes` (ex.: removido depois) → ainda resolve por `cnae_anexo`
  pelo código gravado na nota; se não mapeado, fallback.
- RBT12 = 0 → alíquotas 0 (clamp já existe), sem divisão por zero (guardas presentes).

## Testes (TDD)
- `calcularApuracao` segregado: 2 anexos (ex.: Anexo I comércio + Anexo III serviço) → soma das
  fatias com alíquotas distintas; `porAnexo` correto; `segregado=true`. Caso 1 anexo (fallback) →
  idêntico ao atual (`segregado=false`). Receita só com `anexo` por-nota e mistura com fallback.
- Fronteira: receita do mês = 0 → imposto 0.
- `anexarAnexosDasReceitas` é I/O — coberto indiretamente; foco no puro.

## Arquivos
- **Create** `app/supabase/migrations/0024_notas_fiscais_cnae.sql`
- **Modify** `app/src/types/database.ts` (`notas_fiscais.cnae`)
- **Modify** `app/src/lib/fiscal/apuracao-types.ts` (`ReceitaApuracao.anexo`/`cnae`)
- **Modify** `app/src/lib/fiscal/apuracao.ts` (segregação) + `apuracao.test.ts`
- **Create** `app/src/lib/fiscal/segregacao.ts` (`anexarAnexosDasReceitas`)
- **Modify** `app/src/lib/fiscal/receitas-source.ts` (ler `cnae`)
- **Modify** `app/src/app/(auth)/notas_fiscais/actions.ts` (`EmitirNotaInput.cnae`, form action, insert; `listarCnaesEmpresaAction`)
- **Modify** `app/src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx` (select CNAE)
- **Modify** `app/src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx` (carregar + passar CNAEs)
- **Modify** `app/src/app/(auth)/impostos/actions.ts` + `preview-imposto.ts` (anotar receitas antes de calcular)
- **Modify** `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx` (breakdown por anexo)
