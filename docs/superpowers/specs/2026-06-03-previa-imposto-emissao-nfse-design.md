# Spec — Prévia de imposto (DAS/Simples) na emissão de NFS-e

> **Data:** 2026-06-03 · **Branch:** `feat/previa-imposto-nfse`
> **Escopo:** mostrar uma estimativa do DAS/Simples no form de emissão de **NFS-e**, atualizando conforme o valor é digitado.

## Problema / objetivo

No momento de emitir uma NFS-e, o usuário não tem ideia de quanto aquela nota gera de imposto. Queremos uma **prévia ao vivo** do DAS (Simples Nacional) conforme o campo de valor muda.

Para o Simples, o DAS do mês = `receita_do_mês × alíquota efetiva`, e a alíquota é fixada pelo **RBT12** (12 meses anteriores) + anexo — não muda com esta nota (o RBT12 exclui o mês corrente). Logo o imposto marginal desta nota = `valor × alíquota efetiva`. Rotulamos como **estimativa** pelos casos de borda (fator R, empresa nova, virada de faixa em meses futuros).

## Decisões (brainstorming)
- **Imposto:** DAS/Simples (a carga real recolhida). Não mostrar ISS separado (no Simples o ISS já está embutido no DAS).
- **Escopo:** só o form de **NFS-e** (`EmissaoForm`), que tem campo de valor único. NF-e/NFC-e (baseados em itens) ficam fora.
- **MEI:** DAS é fixo mensal → mostrar nota estática "DAS fixo R$X/mês, não varia por nota" (sem cálculo por valor).
- **Regime Normal / sem dados:** não renderiza nada.

## Reaproveitamento
Tudo já existe e é testado: `calcularApuracao` (devolve `aliquotaEfetiva` p/ Simples e `valorImposto` p/ MEI), `aliquotaEfetiva`/`identificarFaixa`/`calcularRbt12` (`simples.ts`/`rbt12.ts`), `lerReceitasParaApuracao` (`receitas-source.ts`), `competenciaReferenciaBrt` (`guia.ts`). A feature é fina: orquestrar + renderizar.

## Arquitetura

### Tipo (client-safe, em `apuracao-types.ts`)
```ts
export type PreviewImposto =
  | { tipo: 'simples'; aliquota: number }   // alíquota efetiva 0..1
  | { tipo: 'mei'; valorFixo: number }       // DAS fixo mensal
  | { tipo: 'indisponivel' };                // Regime Normal / sem anexo / sem regime
```
Fica em `apuracao-types.ts` (sem `server-only`) para o client (`EmissaoForm`) importar só o tipo.

### `src/lib/fiscal/preview-imposto.ts` (server-only, novo)

**`montarPreview` (puro, testável)** — mapeia o resultado da apuração para o preview:
```ts
import 'server-only';
import type { AnexoSimples } from './regime';
import type { ReceitaApuracao, PreviewImposto } from './apuracao-types';
import { calcularApuracao } from './apuracao';

export function montarPreview(input: {
  regimeCode: string;
  anexo: AnexoSimples | null;
  receitas: ReceitaApuracao[];
  competencia: string;          // YYYYMM
  atividadeMei?: string | null;
}): PreviewImposto {
  try {
    const r = calcularApuracao({
      regimeCode: input.regimeCode,
      anexo: input.anexo,
      receitas: input.receitas,
      competencia: input.competencia,
      atividadeMei: input.atividadeMei ?? null,
    });
    if (r.tipoApuracao === 'DAS-MEI') return { tipo: 'mei', valorFixo: r.valorImposto };
    return { tipo: 'simples', aliquota: r.aliquotaEfetiva ?? 0 };
  } catch {
    // RegimeNaoSuportadoError (Regime Normal) ou anexo ausente no Simples → sem prévia
    return { tipo: 'indisponivel' };
  }
}
```
> `montarPreview` mora num arquivo `server-only`, mas isso não atrapalha o teste (Vitest roda em Node; `server-only` só barra bundling client). O client nunca importa este arquivo — só o tipo de `apuracao-types`.

**`obterPreviewImposto` (server, glue)** — busca os dados e chama `montarPreview`:
```ts
export async function obterPreviewImposto(
  supabase: SupabaseClient,
  companyId: string,
): Promise<PreviewImposto> {
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal?.Code_regime_tributario) return { tipo: 'indisponivel' };

  const competencia = competenciaReferenciaBrt();           // YYYYMM atual (BRT)
  const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
  return montarPreview({
    regimeCode: fiscal.Code_regime_tributario as string,
    anexo: (fiscal.anexo_simples as AnexoSimples | null) ?? null,
    receitas,
    competencia,
    atividadeMei: null,   // empresas_fiscais não guarda atividade MEI hoje → valorDasMei usa o padrão
  });
}
```
(`empresas_fiscais` não tem coluna de atividade MEI nem de início de atividade — por isso `atividadeMei: null` e sem `dataInicioAtividade`. O RBT12 usa os meses disponíveis.)

### `nfse/page.tsx` (modificar)
Já resolve `companyId` e carrega flags `focus_habilita_*`. Adicionar: `const previewImposto = companyId ? await obterPreviewImposto(supabase, companyId) : { tipo: 'indisponivel' };` e passar `previewImposto` para `<EmissaoForm>`.

### `EmissaoForm.tsx` (modificar)
- Nova prop: `previewImposto: PreviewImposto` (importa o tipo de `apuracao-types`).
- Abaixo do campo de valor (input `valorReais`, ~linha 123), renderiza:
  - **simples:** `const valor = parseDecimal(valorTexto) || 0; const imposto = valor * previewImposto.aliquota;` → texto *"Imposto estimado (DAS): R$ {imposto} — ≈{(aliquota*100).toFixed(2)}% · estimativa"*. Recalcula a cada tecla (já é client state).
  - **mei:** texto estático *"MEI: DAS fixo de R$ {valorFixo}/mês — não varia por nota"*.
  - **indisponivel:** não renderiza (`null`).
- Formatação em BRL via `Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'})`.

## Tratamento de erros / bordas
- Valor vazio/0 → "R$ 0,00".
- Sem regime / sem anexo no Simples / Regime Normal → `indisponivel` (nada renderizado; emissão não é afetada).
- Falha ao ler receitas → `lerReceitasParaApuracao` já degrada (retorna `[]`); a apuração roda com receita 0 e alíquota da 1ª faixa — aceitável p/ estimativa.

## Testes (Vitest)
- `preview-imposto.test.ts` → `montarPreview` (puro, TDD):
  - Simples (cód '1', anexo 'Anexo I', receitas com RBT12 numa faixa) → `{tipo:'simples', aliquota>0}`.
  - MEI (cód '4') → `{tipo:'mei', valorFixo>0}`.
  - Regime Normal (cód '3') → `{tipo:'indisponivel'}`.
  - Simples sem anexo (cód '1', anexo null) → `{tipo:'indisponivel'}`.
- `calcularApuracao`/`aliquotaEfetiva`/`rbt12` já cobertos. O cálculo ao vivo (`valor × alíquota`) e a fiação (`page.tsx`/`EmissaoForm`) → review + smoke manual.

## Sequência de implementação
1. Tipo `PreviewImposto` em `apuracao-types.ts` + `preview-imposto.ts` (`montarPreview` puro TDD + `obterPreviewImposto` glue).
2. Fiação: `nfse/page.tsx` computa e passa; `EmissaoForm` recebe a prop e renderiza a prévia.
3. `tsc` + `vitest` verdes + smoke (emitir NFS-e numa empresa Simples e ver a estimativa mudar com o valor).

## Fora de escopo (YAGNI)
- NF-e / NFC-e (forms por itens).
- ISS separado.
- Estimativa "com a nota somada ao mês" / virada de faixa intra-mês (a prévia é marginal sobre a alíquota corrente).
- Persistir a estimativa (é só visual).
