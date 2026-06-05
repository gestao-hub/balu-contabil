# PGDAS-D transmissão · Fase 1 (builder + dry-run) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Montar a declaração PGDAS-D a partir da apuração e fazer um dry-run (`indicadorTransmissao=false`) que mostra os valores que a SERPRO calcula, SEM transmitir à Receita.

**Architecture:** Builder puro (apuração segregada + folha + RBT12 → `dados` do TRANSDECLARACAO11) + wrapper `declararComProcurador` (/Declarar) + `transmitirPgdasd` (espelha `gerarDasSimples`) + parser + action de preview + botão na UI.

**Tech Stack:** Next.js App Router, Supabase, TypeScript, Vitest, SERPRO Integra Contador (mTLS + procurador).

**Spec:** `docs/superpowers/specs/2026-06-05-pgdasd-transmissao-fase1-design.md`
**API:** `docs/investigations/PGDAS-D-TRANSDECLARACAO11.md`

---

### Task 1: `idAtividadePadrao` (puro, TDD)

**Files:** Create `app/src/lib/fiscal/pgdasd-atividade.ts` + `.test.ts`

- [ ] **Step 1: Teste (falhando)** — `app/src/lib/fiscal/pgdasd-atividade.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { idAtividadePadrao } from './pgdasd-atividade';

describe('idAtividadePadrao', () => {
  it('Fator R → 11 (serviço sujeito ao fator r; SERPRO decide III/V via folha)', () => {
    expect(idAtividadePadrao('Anexo III', true)).toBe(11);
    expect(idAtividadePadrao('Anexo V', true)).toBe(11);
    expect(idAtividadePadrao(null, true)).toBe(11);
  });
  it('Anexo I → 1 (revenda)', () => { expect(idAtividadePadrao('Anexo I', false)).toBe(1); });
  it('Anexo II → 4 (indústria)', () => { expect(idAtividadePadrao('Anexo II', false)).toBe(4); });
  it('Anexo III não-fator-r → 14', () => { expect(idAtividadePadrao('Anexo III', false)).toBe(14); });
  it('Anexo IV → 17', () => { expect(idAtividadePadrao('Anexo IV', false)).toBe(17); });
  it('Anexo V sem fator → 11 (V só ocorre via fator r)', () => { expect(idAtividadePadrao('Anexo V', false)).toBe(11); });
  it('sem anexo → 1 (fallback comércio)', () => { expect(idAtividadePadrao(null, false)).toBe(1); });
});
```

- [ ] **Step 2: Rodar/falhar** — `cd app && npx vitest run src/lib/fiscal/pgdasd-atividade.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `app/src/lib/fiscal/pgdasd-atividade.ts`:
```ts
import type { AnexoSimples } from './regime';

/**
 * idAtividade do PGDAS-D (caso comum: município próprio, sem ST, sem retenção de ISS).
 * Fator R → 11 (a SERPRO decide Anexo III↔V via folhasSalario). Ver
 * docs/investigations/PGDAS-D-TRANSDECLARACAO11.md p/ o catálogo completo (43 códigos).
 */
export function idAtividadePadrao(anexoBase: AnexoSimples | null, fatorR: boolean): number {
  if (fatorR) return 11;
  switch (anexoBase) {
    case 'Anexo I': return 1;   // revenda de mercadorias
    case 'Anexo II': return 4;  // venda de industrializados
    case 'Anexo III': return 14; // serviço não-fator-r, Anexo III
    case 'Anexo IV': return 17; // serviço Anexo IV
    case 'Anexo V': return 11;  // V só ocorre via fator r
    default: return 1;          // fallback: comércio
  }
}
```

- [ ] **Step 4: Rodar/passar** → PASS. **Step 5: Commit**
```bash
git add app/src/lib/fiscal/pgdasd-atividade.ts app/src/lib/fiscal/pgdasd-atividade.test.ts
git commit -m "feat(pgdasd): idAtividadePadrao (anexo+fatorR → código de atividade)"
```

---

### Task 2: `montarDeclaracaoPgdasd` (builder puro, TDD)

**Files:** Create `app/src/lib/fiscal/pgdasd-declaracao.ts` + `.test.ts`

- [ ] **Step 1: Teste (falhando)** — `app/src/lib/fiscal/pgdasd-declaracao.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { montarDeclaracaoPgdasd } from './pgdasd-declaracao';

const base = {
  cnpj: '10358425000120',
  competencia: '202606',
  atividadesMes: [{ idAtividade: 1, valor: 10000 }, { idAtividade: 11, valor: 5000 }],
  receitasBrutasAnteriores: [{ pa: 202605, valorInterno: 120000, valorExterno: 0 }],
  folhasSalario: [{ pa: 202605, valor: 3000 }],
};

describe('montarDeclaracaoPgdasd', () => {
  it('monta a estrutura do dados com pa numérico e indicadorComparacao=false', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: false });
    expect(d.cnpjCompleto).toBe('10358425000120');
    expect(d.pa).toBe(202606);
    expect(d.indicadorTransmissao).toBe(false);
    expect(d.indicadorComparacao).toBe(false);
    expect(d.valoresParaComparacao).toEqual([]);
  });
  it('receitaPaCompetenciaInterno = soma das atividades; externo 0', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: false });
    expect(d.declaracao.receitaPaCompetenciaInterno).toBe(15000);
    expect(d.declaracao.receitaPaCompetenciaExterno).toBe(0);
    expect(d.declaracao.tipoDeclaracao).toBe(1);
  });
  it('monta 1 estabelecimento com as atividades', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: false });
    expect(d.declaracao.estabelecimentos).toHaveLength(1);
    expect(d.declaracao.estabelecimentos[0]!.cnpjCompleto).toBe('10358425000120');
    const ats = d.declaracao.estabelecimentos[0]!.atividades;
    expect(ats).toHaveLength(2);
    expect(ats[1]!.idAtividade).toBe(11);
    expect(ats[1]!.valorAtividade).toBe(5000);
    expect(ats[1]!.receitasAtividade[0]!.valor).toBe(5000);
  });
  it('repassa receitasBrutasAnteriores e folhasSalario', () => {
    const d = montarDeclaracaoPgdasd({ ...base, indicadorTransmissao: true });
    expect(d.indicadorTransmissao).toBe(true);
    expect(d.declaracao.receitasBrutasAnteriores).toEqual(base.receitasBrutasAnteriores);
    expect(d.declaracao.folhasSalario).toEqual(base.folhasSalario);
  });
});
```

- [ ] **Step 2: Rodar/falhar** → FAIL.

- [ ] **Step 3: Implementar** — `app/src/lib/fiscal/pgdasd-declaracao.ts`:
```ts
export type PgdasdAtividade = { idAtividade: number; valor: number };

export type PgdasdDados = {
  cnpjCompleto: string;
  pa: number;
  indicadorTransmissao: boolean;
  indicadorComparacao: boolean;
  declaracao: {
    tipoDeclaracao: number;
    receitaPaCompetenciaInterno: number;
    receitaPaCompetenciaExterno: number;
    receitaPaCaixaInterno: number | null;
    receitaPaCaixaExterno: number | null;
    valorFixoIcms: number | null;
    valorFixoIss: number | null;
    receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>;
    folhasSalario: Array<{ pa: number; valor: number }>;
    naoOptante: null;
    estabelecimentos: Array<{
      cnpjCompleto: string;
      atividades: Array<{
        idAtividade: number;
        valorAtividade: number;
        receitasAtividade: Array<{
          valor: number;
          codigoOutroMunicipio: number | null;
          outraUf: string | null;
          isencoes: null;
          reducoes: null;
          qualificacoesTributarias: null;
          exigibilidadesSuspensas: null;
        }>;
      }>;
    }>;
  };
  valoresParaComparacao: never[];
};

/**
 * Monta o `dados` do TRANSDECLARACAO11 a partir da apuração. MVP: 1 estabelecimento (matriz),
 * mercado interno, sem ISS/ICMS fixo, sem isenções/reduções/ST. indicadorComparacao=false (a SERPRO
 * calcula os tributos). Ver docs/investigations/PGDAS-D-TRANSDECLARACAO11.md.
 */
export function montarDeclaracaoPgdasd(input: {
  cnpj: string;
  competencia: string; // YYYYMM
  atividadesMes: PgdasdAtividade[];
  receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>;
  folhasSalario: Array<{ pa: number; valor: number }>;
  indicadorTransmissao: boolean;
}): PgdasdDados {
  const cnpj = input.cnpj.replace(/\D+/g, '');
  const receitaInterno = Number(
    input.atividadesMes.reduce((acc, a) => acc + a.valor, 0).toFixed(2),
  );
  return {
    cnpjCompleto: cnpj,
    pa: Number(input.competencia),
    indicadorTransmissao: input.indicadorTransmissao,
    indicadorComparacao: false,
    declaracao: {
      tipoDeclaracao: 1,
      receitaPaCompetenciaInterno: receitaInterno,
      receitaPaCompetenciaExterno: 0,
      receitaPaCaixaInterno: null,
      receitaPaCaixaExterno: null,
      valorFixoIcms: null,
      valorFixoIss: null,
      receitasBrutasAnteriores: input.receitasBrutasAnteriores,
      folhasSalario: input.folhasSalario,
      naoOptante: null,
      estabelecimentos: [
        {
          cnpjCompleto: cnpj,
          atividades: input.atividadesMes.map((a) => ({
            idAtividade: a.idAtividade,
            valorAtividade: Number(a.valor.toFixed(2)),
            receitasAtividade: [
              {
                valor: Number(a.valor.toFixed(2)),
                codigoOutroMunicipio: null,
                outraUf: null,
                isencoes: null,
                reducoes: null,
                qualificacoesTributarias: null,
                exigibilidadesSuspensas: null,
              },
            ],
          })),
        },
      ],
    },
    valoresParaComparacao: [],
  };
}
```

- [ ] **Step 4: Rodar/passar** → PASS. **Step 5: Commit**
```bash
git add app/src/lib/fiscal/pgdasd-declaracao.ts app/src/lib/fiscal/pgdasd-declaracao.test.ts
git commit -m "feat(pgdasd): montarDeclaracaoPgdasd (builder do dados TRANSDECLARACAO11)"
```

---

### Task 3: `parseDeclaracaoPgdasd` (parser, TDD)

**Files:** Create `app/src/lib/fiscal/serpro-pgdasd-parse.ts` + `.test.ts`

- [ ] **Step 1: Teste (falhando)** — `app/src/lib/fiscal/serpro-pgdasd-parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDeclaracaoPgdasd } from './serpro-pgdasd-parse';

const envelope = {
  status: '200',
  mensagens: [{ codigo: 'Sucesso-PGDASD', texto: 'Requisição efetuada com sucesso.' }],
  dados: JSON.stringify({
    idDeclaracao: '00000000202104001',
    dataHoraTransmissao: '20220803044803',
    valoresDevidos: [
      { codigoTributo: 1001, valor: 44.0 },
      { codigoTributo: 1006, valor: 332.0 },
      { codigoTributo: 1010, valor: 120.6 },
    ],
    declaracao: 'JVBERi0xLjUK...',
  }),
};

describe('parseDeclaracaoPgdasd', () => {
  it('extrai tributos, total e número da declaração', () => {
    const r = parseDeclaracaoPgdasd(envelope);
    expect(r.numeroDeclaracao).toBe('00000000202104001');
    expect(r.valorTotalDevido).toBeCloseTo(496.6, 2);
    expect(r.tributos.find((t) => t.codigo === 1006)!.nome).toBe('INSS/CPP');
    expect(r.tributos).toHaveLength(3);
    expect(r.transmitida).toBe(true); // tem idDeclaracao
  });
  it('dry-run sem idDeclaracao → transmitida=false, ainda traz valores', () => {
    const dry = { ...envelope, dados: JSON.stringify({ valoresDevidos: [{ codigoTributo: 1010, valor: 50 }] }) };
    const r = parseDeclaracaoPgdasd(dry);
    expect(r.transmitida).toBe(false);
    expect(r.numeroDeclaracao).toBeNull();
    expect(r.valorTotalDevido).toBeCloseTo(50, 2);
  });
  it('formato inesperado → lança', () => {
    expect(() => parseDeclaracaoPgdasd({ foo: 'bar' })).toThrow();
  });
});
```

- [ ] **Step 2: Rodar/falhar** → FAIL.

- [ ] **Step 3: Implementar** — `app/src/lib/fiscal/serpro-pgdasd-parse.ts`:
```ts
export type DeclaracaoPgdasdResult = {
  transmitida: boolean;
  numeroDeclaracao: string | null;
  dataHoraTransmissao: string | null;
  valorTotalDevido: number | null;
  tributos: Array<{ codigo: number; nome: string; valor: number }>;
  mensagens: string[];
};

const NOME_TRIBUTO: Record<number, string> = {
  1001: 'IRPJ', 1002: 'CSLL', 1004: 'COFINS', 1005: 'PIS',
  1006: 'INSS/CPP', 1007: 'ICMS', 1008: 'IPI', 1010: 'ISS',
};

/** Parseia o envelope do TRANSDECLARACAO11. Lança em formato inesperado (loga). */
export function parseDeclaracaoPgdasd(resp: unknown): DeclaracaoPgdasdResult {
  const env = resp as { dados?: unknown; mensagens?: Array<{ codigo?: string; texto?: string }> };
  if (!env || typeof env.dados !== 'string') {
    console.error('[parseDeclaracaoPgdasd] formato inesperado:', JSON.stringify(resp)?.slice(0, 300));
    throw new Error('Resposta da declaração em formato inesperado.');
  }
  let dados: {
    idDeclaracao?: string; dataHoraTransmissao?: string;
    valoresDevidos?: Array<{ codigoTributo?: number; valor?: number }>;
  };
  try {
    dados = JSON.parse(env.dados);
  } catch {
    console.error('[parseDeclaracaoPgdasd] dados não-JSON:', env.dados.slice(0, 300));
    throw new Error('Resposta da declaração em formato inesperado (dados).');
  }

  const tributos = (dados.valoresDevidos ?? [])
    .filter((t) => t.codigoTributo != null && t.valor != null)
    .map((t) => ({ codigo: t.codigoTributo as number, nome: NOME_TRIBUTO[t.codigoTributo as number] ?? `Tributo ${t.codigoTributo}`, valor: Number(t.valor) }));
  const valorTotalDevido = tributos.length
    ? Number(tributos.reduce((acc, t) => acc + t.valor, 0).toFixed(2))
    : null;
  const numeroDeclaracao = dados.idDeclaracao ?? null;

  return {
    transmitida: !!numeroDeclaracao,
    numeroDeclaracao,
    dataHoraTransmissao: dados.dataHoraTransmissao ?? null,
    valorTotalDevido,
    tributos,
    mensagens: (env.mensagens ?? []).map((m) => m.texto ?? '').filter(Boolean),
  };
}
```

- [ ] **Step 4: Rodar/passar** → PASS. **Step 5: Commit**
```bash
git add app/src/lib/fiscal/serpro-pgdasd-parse.ts app/src/lib/fiscal/serpro-pgdasd-parse.test.ts
git commit -m "feat(pgdasd): parseDeclaracaoPgdasd (valoresDevidos + recibo)"
```

---

### Task 4: `declararComProcurador` (rota /Declarar)

**Files:** Modify `app/src/lib/clients/serpro.ts`

- [ ] **Step 1: Alargar o tipo do `path` + adicionar o wrapper.**

Em `app/src/lib/clients/serpro.ts`, na assinatura de `requestComProcurador`, incluir o `/Declarar` no union do `path`:
```ts
async function requestComProcurador(
  path: '/integra-contador/v1/Consultar' | '/integra-contador/v1/Emitir' | '/integra-contador/v1/Declarar',
  params: ProcuradorRequest,
): Promise<unknown> {
```
E ao lado de `emitirComProcurador` (fim do arquivo), adicionar:
```ts
/** POST /Declarar (produção) via mTLS + token do procurador. PGDAS-D (TRANSDECLARACAO11). */
export function declararComProcurador(params: ProcuradorRequest): Promise<unknown> {
  return requestComProcurador('/integra-contador/v1/Declarar', params);
}
```

- [ ] **Step 2: tsc** — `cd app && npx tsc --noEmit` → sem erros.

- [ ] **Step 3: Commit**
```bash
git add app/src/lib/clients/serpro.ts
git commit -m "feat(serpro): declararComProcurador (rota /Declarar)"
```

---

### Task 5: `transmitirPgdasd` (impuro — monta insumos + chama)

**Files:** Create `app/src/lib/fiscal/serpro-pgdasd.ts`

- [ ] **Step 1: Implementar** — `app/src/lib/fiscal/serpro-pgdasd.ts` (espelha `serpro-das-simples.ts`):
```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnexoSimples } from '@/lib/fiscal/regime';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { declararComProcurador, Tipo } from '@/lib/clients/serpro';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';
import { lerFolhaParaApuracao } from '@/lib/fiscal/folha-source';
import { competenciaAddMonths } from '@/lib/fiscal/guia';
import { idAtividadePadrao } from '@/lib/fiscal/pgdasd-atividade';
import { montarDeclaracaoPgdasd, type PgdasdAtividade } from '@/lib/fiscal/pgdasd-declaracao';
import { parseDeclaracaoPgdasd, type DeclaracaoPgdasdResult } from '@/lib/fiscal/serpro-pgdasd-parse';

type Result = { ok: true; result: DeclaracaoPgdasdResult } | { ok: false; error: string };

/**
 * Monta a PGDAS-D (TRANSDECLARACAO11) da competência e chama o /Declarar via procurador.
 * `indicadorTransmissao=false` → dry-run (SERPRO calcula sem transmitir). Espelha gerarDasSimples.
 */
export async function transmitirPgdasd(
  supabase: SupabaseClient,
  companyId: string,
  competencia: string, // YYYYMM
  opts: { indicadorTransmissao: boolean },
): Promise<Result> {
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO).' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  // CNAE principal (fallback de atividade) + mapa cnae→(anexo,fatorR) p/ idAtividade.
  const { data: cnaePrinc } = await supabase
    .from('company_cnaes').select('codigo')
    .eq('company_id', companyId).eq('tipo', 'principal').is('deleted_at', null).maybeSingle();
  const cnaePrincipal = (cnaePrinc?.codigo as string | null) ?? null;

  const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
  const doMes = receitas.filter((r) => r.competencia === competencia);
  const cnaes = Array.from(new Set([cnaePrincipal, ...doMes.map((r) => r.cnae)].filter((c): c is string => !!c)));
  const refMap = new Map<string, { anexo_base: AnexoSimples | null; fator_r: boolean }>();
  if (cnaes.length) {
    const { data: refs } = await supabase
      .from('cnae_anexo').select('codigo, anexo_base, fator_r').in('codigo', cnaes);
    for (const r of refs ?? []) {
      refMap.set(r.codigo as string, { anexo_base: (r.anexo_base as AnexoSimples | null) ?? null, fator_r: r.fator_r === true });
    }
  }
  const idAtivDe = (cnae: string | null | undefined): number => {
    const ref = (cnae && refMap.get(cnae)) || (cnaePrincipal && refMap.get(cnaePrincipal)) || null;
    return idAtividadePadrao(ref?.anexo_base ?? null, ref?.fator_r ?? false);
  };

  // Atividades do mês: agrupa receita por idAtividade.
  const porId = new Map<number, number>();
  for (const r of doMes) {
    const id = idAtivDe(r.cnae);
    porId.set(id, (porId.get(id) ?? 0) + r.valor);
  }
  const atividadesMes: PgdasdAtividade[] = Array.from(porId, ([idAtividade, valor]) => ({ idAtividade, valor }));
  if (atividadesMes.length === 0) return { ok: false, error: 'Sem receita na competência para declarar.' };

  // receitasBrutasAnteriores: 12 meses anteriores (interno).
  const receitasBrutasAnteriores = Array.from({ length: 12 }, (_, i) => {
    const pa = competenciaAddMonths(competencia, -(i + 1));
    const valorInterno = receitas.filter((r) => r.competencia === pa).reduce((acc, r) => acc + r.valor, 0);
    return { pa: Number(pa), valorInterno: Number(valorInterno.toFixed(2)), valorExterno: 0 };
  }).reverse();

  // folhasSalario: 12 meses anteriores (total do mês = pró-labore+salários+encargos).
  const folhas = await lerFolhaParaApuracao(supabase, companyId, competencia);
  const folhasSalario = Array.from({ length: 12 }, (_, i) => {
    const pa = competenciaAddMonths(competencia, -(i + 1));
    const valor = folhas
      .filter((f) => f.competencia === pa)
      .reduce((acc, f) => acc + f.proLabore + f.salarios + f.encargos, 0);
    return { pa: Number(pa), valor: Number(valor.toFixed(2)) };
  }).reverse();

  const dados = montarDeclaracaoPgdasd({
    cnpj: empresaCnpj, competencia, atividadesMes,
    receitasBrutasAnteriores, folhasSalario, indicadorTransmissao: opts.indicadorTransmissao,
  });

  const envelope = {
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', versaoSistema: '1.0', dados: JSON.stringify(dados) },
  };

  try {
    const resp = await declararComProcurador({
      pfx: auth.pfx, passphrase: auth.passphrase, accessToken: auth.accessToken,
      jwt: auth.jwt, procuradorToken: tk.token, envelope,
    });
    return { ok: true, result: parseDeclaracaoPgdasd(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha na declaração (SERPRO): ${msg.slice(0, 200)}` };
  }
}
```

- [ ] **Step 2: tsc** — `cd app && npx tsc --noEmit` → sem erros.

- [ ] **Step 3: Commit**
```bash
git add app/src/lib/fiscal/serpro-pgdasd.ts
git commit -m "feat(pgdasd): transmitirPgdasd (monta insumos + /Declarar via procurador)"
```

---

### Task 6: `previewDeclaracaoAction` + botão de dry-run

**Files:** Modify `app/src/app/(auth)/impostos/actions.ts`; Create `app/src/app/(auth)/impostos/PreviewDeclaracaoButton.tsx`; Modify `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx`

- [ ] **Step 1: Action** — em `app/src/app/(auth)/impostos/actions.ts`, importar e adicionar ao fim:
```ts
import { transmitirPgdasd } from '@/lib/fiscal/serpro-pgdasd';
import type { DeclaracaoPgdasdResult } from '@/lib/fiscal/serpro-pgdasd-parse';

export type PreviewDeclaracaoResult =
  | { ok: true; result: DeclaracaoPgdasdResult }
  | { ok: false; error: string };

/** Dry-run da PGDAS-D (indicadorTransmissao=false): a SERPRO calcula SEM transmitir. */
export async function previewDeclaracaoAction(competencia: string): Promise<PreviewDeclaracaoResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };
  const { data: fiscal } = await supabase
    .from('empresas_fiscais').select('Code_regime_tributario')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };
  if (tipoFromCode((fiscal.Code_regime_tributario ?? '') as string) !== 'simples') {
    return { ok: false, error: 'A declaração PGDAS-D cobre Simples; MEI usa a DASN-SIMEI.' };
  }
  return transmitirPgdasd(supabase, companyId, competencia, { indicadorTransmissao: false });
}
```
(`createServerClient`, `tipoFromCode` já são importados no arquivo — não duplicar.)

- [ ] **Step 2: Botão** — `app/src/app/(auth)/impostos/PreviewDeclaracaoButton.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { FileSearch } from 'lucide-react';
import { previewDeclaracaoAction, type PreviewDeclaracaoResult } from './actions';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PreviewDeclaracaoButton({ competencia }: { competencia: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<PreviewDeclaracaoResult | null>(null);

  function run() {
    setRes(null);
    start(async () => setRes(await previewDeclaracaoAction(competencia)));
  }

  return (
    <div className="mt-3">
      <button
        type="button" onClick={run} disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
      >
        <FileSearch className="size-4" />
        {pending ? 'Calculando na Receita…' : 'Pré-visualizar declaração (dry-run)'}
      </button>

      {res && res.ok && (
        <div className="mt-2 rounded-md border border-border bg-surface p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Valores calculados pela Receita {res.result.transmitida ? '' : '— nada foi transmitido'}
          </p>
          {res.result.valorTotalDevido != null && (
            <p className="font-semibold tabular-nums">Total devido: {brl(res.result.valorTotalDevido)}</p>
          )}
          <ul className="mt-1 space-y-0.5">
            {res.result.tributos.map((t) => (
              <li key={t.codigo} className="flex justify-between tabular-nums">
                <span className="text-muted-foreground-2">{t.nome}</span><span>{brl(t.valor)}</span>
              </li>
            ))}
          </ul>
          {res.result.mensagens.length > 0 && (
            <ul className="mt-2 text-xs text-muted-foreground list-disc pl-4">
              {res.result.mensagens.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}
      {res && !res.ok && (
        <p className="mt-2 text-sm text-red-600">{res.error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Montar o botão** — em `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx`, READ o arquivo e renderizar `<PreviewDeclaracaoButton competencia={competencia} />` só p/ Simples, dentro da coluna de ações ou abaixo do `<dl>`. Importar no topo:
```ts
import PreviewDeclaracaoButton from './PreviewDeclaracaoButton';
```
E onde houver o bloco condicional de Simples (existe `isSimples` nas props), adicionar o botão (ex.: logo após a `</dl>` ou na coluna `sm:w-56`):
```tsx
{isSimples && <PreviewDeclaracaoButton competencia={competencia} />}
```
> NOTA AO EXECUTOR: leia o card; encaixe o botão sem quebrar o layout (a coluna de ações já tem `GerarDasSimplesButton`). Não duplicar imports.

- [ ] **Step 4: tsc** — `cd app && npx tsc --noEmit` → sem erros.

- [ ] **Step 5: Commit**
```bash
git add "app/src/app/(auth)/impostos/actions.ts" "app/src/app/(auth)/impostos/PreviewDeclaracaoButton.tsx" "app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx"
git commit -m "feat(impostos): dry-run da PGDAS-D (previewDeclaracaoAction + botão)"
```

---

## Self-Review
- **Spec coverage:** idAtividade (T1) ✓; builder (T2) ✓; parser (T3) ✓; /Declarar wrapper (T4) ✓; transmitirPgdasd impuro (T5) ✓; action+UI dry-run (T6) ✓.
- **Segurança:** `previewDeclaracaoAction` chama SEMPRE `indicadorTransmissao:false`. O parâmetro existe em `transmitirPgdasd` p/ a Fase 2, mas nenhum caminho desta fase passa `true`.
- **Type consistency:** `PgdasdAtividade` (pgdasd-declaracao) usado em transmitirPgdasd; `DeclaracaoPgdasdResult` (parse) fluindo parse→transmitirPgdasd→action→botão; `idAtividadePadrao(anexoBase,fatorR)` ↔ `cnae_anexo`. Envelope/`Tipo`/auth iguais ao `gerarDasSimples`.
- **Placeholders:** nenhum. T5/T6 reusam helpers existentes (lerReceitas/lerFolha/somarFolha12/competenciaAddMonths). T6/Step3 pede leitura do card real p/ encaixe.
