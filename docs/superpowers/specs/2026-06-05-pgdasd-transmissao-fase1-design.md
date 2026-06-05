# Spec — PGDAS-D transmissão · Fase 1 (builder + dry-run)

**Data:** 2026-06-05
**Backlog:** P0.1 completo (transmissão da PGDAS-D).
**Base técnica:** `docs/investigations/PGDAS-D-TRANSDECLARACAO11.md` (payload + catálogo idAtividade).

## Escopo desta fase

**Fase 1 = builder + dry-run. NÃO transmite nada à Receita.** Monta o `dados` da declaração a partir
da apuração (receita segregada + folha + RBT12), chama o `/Declarar` da SERPRO com
**`indicadorTransmissao=false`** (a SERPRO **calcula e devolve os valores devidos sem transmitir**) e
mostra o resultado pro contador conferir. O transmit real (`indicadorTransmissao=true`) é a **Fase 2**,
atrás de confirmação explícita — fora desta spec.

### Decisões fechadas (brainstorming + pesquisa)
- **`indicadorTransmissao=false`** é a "homologação" — valida em produção sem efeito legal.
- **`indicadorComparacao=false`** no MVP: a SERPRO calcula os tributos; não mandamos `valoresParaComparacao`.
- **Fator R quem decide é a SERPRO** (via `folhasSalario`): usamos `idAtividade` 10/11/12 p/ serviço
  sujeito a Fator R e mandamos a folha; a SERPRO aplica Anexo III ou V.
- **`idAtividade` derivado** (sem coluna/seed novos nesta fase): função pura
  `idAtividadePadrao(anexoBase, fatorR)` cobre os casos comuns (município próprio, sem ST, sem
  retenção). Edge (construção 20/23, retenção, outro município) → refinamento futuro; o dry-run valida.
- **Sem migration** nesta fase (não persiste; `declaracoes_fiscais` já existe e é usada só na Fase 2).

## Camada pura

### `app/src/lib/fiscal/pgdasd-atividade.ts`
```ts
// idAtividade comum do PGDAS-D a partir do anexo + Fator R (caso município próprio, sem ST/retenção).
export function idAtividadePadrao(anexoBase: AnexoSimples | null, fatorR: boolean): number;
```
Regras: `fatorR=true` → **11** (serviço sujeito a Fator R; SERPRO decide III↔V via folha). Senão por
`anexoBase`: `Anexo I`→**1**, `Anexo II`→**4**, `Anexo III`→**14**, `Anexo IV`→**17**, `Anexo V`→**11**
(V só ocorre via Fator R), null→**1** (fallback comércio). (Mapa completo no doc de investigação.)

### `app/src/lib/fiscal/pgdasd-declaracao.ts`
```ts
export type PgdasdAtividade = { idAtividade: number; valor: number };
export type PgdasdDados = { /* estrutura do `dados` (ver doc) */ };

export function montarDeclaracaoPgdasd(input: {
  cnpj: string;                  // só dígitos
  competencia: string;           // YYYYMM
  atividadesMes: PgdasdAtividade[];                                  // receita do mês por idAtividade
  receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>; // 12 meses
  folhasSalario: Array<{ pa: number; valor: number }>;              // 12 meses
  indicadorTransmissao: boolean;
}): PgdasdDados;
```
Monta:
- `cnpjCompleto`, `pa` (number), `indicadorTransmissao`, `indicadorComparacao: false`.
- `declaracao.tipoDeclaracao: 1` (Original); `receitaPaCompetenciaInterno` = soma das `atividadesMes`;
  `receitaPaCompetenciaExterno: 0`; `valorFixoIcms: null`, `valorFixoIss: null`.
- `receitasBrutasAnteriores` e `folhasSalario` repassados (12 meses, ordenados).
- `estabelecimentos: [{ cnpjCompleto, atividades: atividadesMes.map(a => ({ idAtividade: a.idAtividade,
  valorAtividade: a.valor, receitasAtividade: [{ valor: a.valor, codigoOutroMunicipio: null, outraUf:
  null, isencoes: null, reducoes: null, qualificacoesTributarias: null, exigibilidadesSuspensas: null }] })) }]`.
- `valoresParaComparacao: []`.
Puro/testável (sem Supabase).

## Camada SERPRO (impura)

### `app/src/lib/clients/serpro.ts` — `declararComProcurador`
Adicionar, espelhando `emitirComProcurador`:
```ts
export function declararComProcurador(params: ProcuradorRequest): Promise<unknown> {
  return requestComProcurador('/integra-contador/v1/Declarar', params);
}
```

### `app/src/lib/fiscal/serpro-pgdasd.ts` — `transmitirPgdasd` (impuro)
Espelha `gerarDasSimples`: lê CNPJ da empresa, `garantirAuthContratante` + `garantirTokenProcurador`,
monta as receitas/folha (12 meses) e as atividades do mês (via `idAtividade`), chama
`montarDeclaracaoPgdasd`, monta o envelope (`idSistema:'PGDASD'`, `idServico:'TRANSDECLARACAO11'`,
`versaoSistema:'1.0'`, `dados: JSON.stringify(...)`) e chama `declararComProcurador`. Recebe
`indicadorTransmissao` como parâmetro.
```ts
export async function transmitirPgdasd(
  supabase, companyId, competencia, opts: { indicadorTransmissao: boolean },
): Promise<{ ok: true; result: DeclaracaoPgdasdResult } | { ok: false; error: string }>;
```
Montagem dos insumos (dentro desta função, server-only):
- `receitas = lerReceitasParaApuracao(supabase, companyId, competencia)` (já traz `cnae`).
- **Atividades do mês:** agrupar as receitas da competência por `idAtividade` — resolver cada nota:
  `cnae → cnae_anexo(anexo_base, fator_r) → idAtividadePadrao`. Nota sem cnae/não mapeada → idAtividade
  do **CNAE principal** (fallback). Reaproveita o padrão do `anexarAnexosDasReceitas`/`segregacao.ts`.
- **receitasBrutasAnteriores:** agrupar as 12 competências anteriores (soma por mês; `valorExterno:0`).
- **folhasSalario:** `lerFolhaParaApuracao` → 12 meses anteriores (soma pró-labore+salários+encargos por mês).

### `app/src/lib/fiscal/serpro-pgdasd-parse.ts` — `parseDeclaracaoPgdasd`
Extrai do envelope SERPRO o resultado. No dry-run (`indicadorTransmissao=false`): os **valores
calculados** (tributos por `codigoTributo`, valor total devido). Tolerante a formato inesperado (lança
+ loga, padrão do `serpro-das-simples-parse.ts`). Tipos:
```ts
export type DeclaracaoPgdasdResult = {
  transmitida: boolean;                 // false no dry-run
  numeroDeclaracao: string | null;      // só quando transmitida (Fase 2)
  valorTotalDevido: number | null;
  tributos: Array<{ codigo: number; nome: string; valor: number }>;
  mensagens?: string[];                 // avisos/erros MSG_ISN_* da SERPRO
};
```

## Action + UI

### `app/src/app/(auth)/impostos/actions.ts` — `previewDeclaracaoAction`
```ts
export async function previewDeclaracaoAction(competencia: string):
  Promise<{ ok: true; result: DeclaracaoPgdasdResult } | { ok: false; error: string }>;
```
- Valida sessão + empresa ativa + regime Simples (MEI fora).
- Chama `transmitirPgdasd(supabase, companyId, competencia, { indicadorTransmissao: false })`.
- Retorna o resultado pro form (sem persistir). `revalidatePath` não necessário (não muda dados).

### UI — botão "Pré-visualizar declaração (dry-run)"
Um componente client `PreviewDeclaracaoButton` numa subseção da "Competência atual" (ou ao lado do
"Gerar DAS"), só p/ Simples. Ao clicar: chama `previewDeclaracaoAction(competenciaAtual)`, mostra:
- estado de loading; em erro, a mensagem;
- em sucesso: **"Valores calculados pela Receita (sem transmitir)"** — total devido + lista de tributos
  + eventuais `mensagens`. Deixa claro que **nada foi transmitido**.

## Fora de escopo (Fase 2 / futuro)
- `indicadorTransmissao=true` (transmit real) + persistência em `declaracoes_fiscais` + `numeroDeclaracao`/recibo.
- `indicadorComparacao=true` + `valoresParaComparacao` (repartição por tributo da nossa apuração).
- Override `id_atividade_pgdas` por CNAE (construção 20/23, retenção, outro município, ST), múltiplos
  estabelecimentos (filiais), receita de exportação, regime de caixa, isenções/reduções.

## Testes (TDD)
- `idAtividadePadrao`: cada anexo + fator_r → código certo (1/4/14/17/11); fallback null→1.
- `montarDeclaracaoPgdasd`: estrutura correta (pa number, indicadorTransmissao repassado,
  indicadorComparacao false, receitaPaCompetenciaInterno = soma, estabelecimentos/atividades montados,
  12 meses repassados). Caso 1 atividade e multi-atividade.
- `parseDeclaracaoPgdasd`: extrai tributos+total de um envelope exemplo; lança em formato inesperado.
- Validação ao vivo (manual): `previewDeclaracaoAction` numa competência real (AL Piscinas) com
  `indicadorTransmissao=false` → conferir que devolve valores e **não** gera recibo/transmissão.

## Arquivos
- **Create** `app/src/lib/fiscal/pgdasd-atividade.ts` + teste
- **Create** `app/src/lib/fiscal/pgdasd-declaracao.ts` + teste
- **Create** `app/src/lib/fiscal/serpro-pgdasd.ts`
- **Create** `app/src/lib/fiscal/serpro-pgdasd-parse.ts` + teste
- **Modify** `app/src/lib/clients/serpro.ts` (`declararComProcurador`)
- **Modify** `app/src/app/(auth)/impostos/actions.ts` (`previewDeclaracaoAction`)
- **Create** `app/src/app/(auth)/impostos/PreviewDeclaracaoButton.tsx`
- **Modify** `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx` (ou page) — montar o botão

---

## Validação ao vivo (2026-06-05) — ✅ FEITA + refinamentos

Dry-run real (`indicadorTransmissao=false`) na **AL Piscinas, competência 202605**:
- A SERPRO calculou **R$ 1.746,55** e devolveu *"Requisição efetuada com sucesso"*, `transmitida=false`.
- Guard antes/depois (CONSDECLARACAO13): **202605 seguiu não-declarada** → nada foi transmitido. ✅
- `indicadorTransmissao=false` confirmado na doc oficial: *"serão devolvidos os valores devidos sem transmissão"*.

**3 ajustes que o dry-run revelou (todos implementados):**
1. **Folha só p/ atividade Fator R** — a SERPRO recusa `folhasSalario` se nenhuma atividade for
   idAtividade 10/11/12/29 (*"Foi informada a lista de Folha de Salários mas não há atividade com este
   requisito"*). `transmitirPgdasd` envia `folhasSalario: []` quando não há atividade Fator R.
2. **Todos os estabelecimentos** — a SERPRO exige matriz + filiais ativas, mesmo zeradas (*"Um ou mais
   nis... não foram enviados no campo Estabelecimento: <CNPJ>"*). Sem API pública limpa de filiais por
   raiz → a SERPRO nomeia os faltantes no erro; `transmitirPgdasd` extrai os CNPJs e **reenvia uma vez**
   com eles como estabelecimentos vazios (`montarDeclaracaoPgdasd` ganhou `cnpjsAdicionais?`).
3. **Surface de erro da SERPRO** — `requestComProcurador` passou a extrair `mensagens[].texto` do
   envelope em status ≥ 400 (antes truncava no eco do request). Vale p/ todos os serviços SERPRO.

**Refinamentos futuros (Fase 2 ou antes):** override `id_atividade_pgdas` por CNAE (construção 20/23,
retenção/ST, outro município); fonte própria de filiais (em vez do retry pelo erro); export/regime de caixa.
