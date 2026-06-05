# Spec — `atividade_mei`: DAS-MEI com valor certo na estimativa

**Data:** 2026-06-05
**Backlog:** P0.4 (`docs/planning/BACKLOG-IMPOSTOS.md`)

## Problema

A **estimativa local** de DAS-MEI (`valorDasMei`) é parametrizada pela atividade do MEI:
- Comércio ou Indústria → R$ 76,90 (INSS + ICMS)
- Prestação de Serviços → R$ 80,90 (INSS + ISS)
- Comércio e Serviços → R$ 81,90 (INSS + ICMS + ISS)

Mas não existe campo `atividade_mei`, então `iniciarApuracaoAction` (`impostos/actions.ts:112`) e
`obterPreviewImposto` (`preview-imposto.ts:57`) passam `atividadeMei: null` **hardcoded** → a estimativa
**sempre cai em R$ 80,90** (Serviços), mesmo para um MEI de comércio.

**Importante (escopo):** o **DAS real** vem do SERPRO (PGMEI/GERARDASPDF21), que calcula sozinho pelo
cadastro na Receita e **não usa** o nosso campo. Então o valor da guia real já está correto. O P0.4
conserta apenas a **estimativa/prévia** mostrada ao usuário (dashboard `/impostos` + prévia na emissão
de NFS-e), que hoje mente para MEIs de comércio.

## Decisões fechadas

- Campo `atividade_mei` em `empresas_fiscais` (coluna TEXT), capturado no `RegimeTributarioForm`.
- Select **só aparece quando o regime é MEI** (code '4') — mesmo padrão da faixa/Fator R que somem p/ MEI.
- **Default suave:** sem o campo, `valorDasMei` já cai em "Prestação de Serviços" (comportamento atual);
  não quebra nada. O select é destacado para incentivar a escolha certa, mas não é obrigatório.
- **Fora de escopo:** fluxo SERPRO (já correto); abertura de empresa.

## Domínio (`regime.ts`)

```ts
export type AtividadeMei = 'Comercio ou Industria' | 'Prestacao de Servicos' | 'Comercio e Servicos';

export const ATIVIDADE_MEI_OPTIONS: ReadonlyArray<{ value: AtividadeMei; label: string }> = [
  { value: 'Comercio ou Industria', label: 'Comércio ou Indústria' },
  { value: 'Prestacao de Servicos', label: 'Prestação de Serviços' },
  { value: 'Comercio e Servicos', label: 'Comércio e Serviços' },
];
```

> Os `value` batem EXATAMENTE com as chaves de `DAS_MEI_2026` em `das-mei.ts` — é o contrato.

`normalizeRegimePatch`: quando `Code_regime_tributario !== '4'`, força `atividade_mei = null` (atividade
só faz sentido p/ MEI), espelhando como já zera `anexo_simples`/`usa_fator_r` p/ MEI. Adicionar
`atividade_mei?` ao type `RegimePatch`.

## Dados

- Migration **0023** `empresas_fiscais.atividade_mei TEXT` (aditiva/idempotente, `ADD COLUMN IF NOT EXISTS`).
- `app/src/types/database.ts`: `atividade_mei: string | null` em Row/Insert/Update de `empresas_fiscais`.
- `EmpresaFiscalSchema` (zod): `atividade_mei: z.enum(['Comercio ou Industria','Prestacao de Servicos','Comercio e Servicos']).nullable().optional()`.

## UI (`RegimeTributarioForm.tsx`)

- `Initial` ganha `atividade_mei?: string | null`; novo estado `atividadeMei`, resetado em `resetFromInitial`.
- Bloco condicional `{mei && (...)}` com um `<select>` "Atividade do MEI" (opções de `ATIVIDADE_MEI_OPTIONS`,
  + "Selecione…"), mesmo estilo dos outros selects.
- `handleSubmit` inclui no payload: `atividade_mei: mei ? (atividadeMei || null) : null`.

## Wiring (leitura)

- `iniciarApuracaoAction`: o `select` de `empresas_fiscais` passa a incluir `atividade_mei`; remover o
  TODO e passar `atividadeMei: (fiscal.atividade_mei ?? null) as string | null` ao `calcularApuracao`.
- `obterPreviewImposto`: idem — `select(... , atividade_mei)` e passar ao `montarPreview`.

## Testes
- `normalizeRegimePatch`: MEI mantém `atividade_mei`; não-MEI força `null` (adicionar ao `regime.test.ts`).
- `valorDasMei` já tem cobertura implícita; a tabela e o mapeamento não mudam.

## Arquivos
- **Create** `app/supabase/migrations/0023_empresas_fiscais_atividade_mei.sql`
- **Modify** `app/src/types/database.ts` (coluna)
- **Modify** `app/src/types/zod.ts` (`EmpresaFiscalSchema`)
- **Modify** `app/src/lib/fiscal/regime.ts` (`AtividadeMei`, `ATIVIDADE_MEI_OPTIONS`, `RegimePatch`, `normalizeRegimePatch`) + `regime.test.ts`
- **Modify** `app/src/app/(auth)/configuracoes/RegimeTributarioForm.tsx` (select MEI)
- **Modify** `app/src/app/(auth)/impostos/actions.ts` (`iniciarApuracaoAction`: select + pass)
- **Modify** `app/src/lib/fiscal/preview-imposto.ts` (`obterPreviewImposto`: select + pass)
