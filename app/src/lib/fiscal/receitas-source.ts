import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import type { NotaReceita } from './declaracoes-anuais/tipos';
import { competenciaAddMonths, competenciaReferenciaBrt } from './guia';

/**
 * TAMANHO DA PÁGINA. Abaixo do `max-rows` do PostgREST (1000 no padrão do
 * Supabase) de propósito: assim é ESTE código que decide onde a página termina,
 * e não o servidor. Se o teto do servidor fosse o menor, ele cortaria primeiro e
 * a paginação nunca perceberia.
 */
const PAGINA = 500;

/**
 * Teto de páginas — 250 mil notas na janela. Não é limite de negócio, é
 * disjuntor: se for atingido, alguma condição do filtro quebrou e o laço estaria
 * varrendo a tabela inteira. Estourar em voz alta é melhor que devolver base de
 * cálculo pela metade.
 */
const MAX_PAGINAS = 500;

/**
 * Lê TODAS as linhas de uma consulta de notas, em páginas.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * As duas leituras deste arquivo não tinham `.limit()` nem paginação. O
 * PostgREST corta em `max-rows` e devolve `error: null` — uma página curta é
 * indistinguível da base inteira, fato que `pagamentos-serpro-cron.ts` já
 * registra por escrito e é a razão dos tetos explícitos DE LÁ.
 *
 * Aqui o silêncio custava mais caro: são as duas fontes canônicas de RECEITA. Um
 * comerciante com mais de mil notas em 13 meses teria `receitaMes` e `rbt12`
 * calculados sobre um recorte arbitrário — faixa menor, alíquota menor, imposto
 * menor. E o mesmo array alimenta `serpro-pgdasd.ts`, então o valor subestimado
 * ia transmitido à Receita, sem erro em lugar nenhum.
 *
 * `.order('id')` não é enfeite: sem ordem estável o `range` pode repetir e pular
 * linhas entre páginas.
 */
async function lerTodasAsPaginas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  montarConsulta: () => any,
  rotulo: string,
): Promise<Record<string, unknown>[]> {
  const todas: Record<string, unknown>[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * PAGINA;
    const { data, error } = await montarConsulta().order('id', { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new Error(`${rotulo}: ${error.message}`);
    const linhas = (data ?? []) as Record<string, unknown>[];
    todas.push(...linhas);
    if (linhas.length < PAGINA) return todas;
  }
  throw new Error(
    `${rotulo}: mais de ${MAX_PAGINAS * PAGINA} notas na janela — filtro provavelmente quebrado. ` +
    'Base de cálculo NÃO devolvida pela metade de propósito.',
  );
}

/**
 * Lê as receitas necessárias para apurar `ateCompetencia` (a própria + 12 meses anteriores).
 *
 * DECISÃO FINAL (2026-05-31): OPÇÃO (b) — fonte canônica de receita é `notas_fiscais`.
 * A tabela `receitas_fiscais` é órfã (ninguém a popula, esvaziada sem backup) e está
 * descontinuada. Toda leitura de receita para apuração passa por esta função.
 *
 * ─── AMBIENTE (2026-09-02) ──────────────────────────────────────────────────
 * Esta leitura filtrava `status` e `tipo_documento` e IGNORAVA `ambiente`. O
 * smoke fiscal de 02/09 mediu o efeito no banco: 100% da receita existente era
 * de homologação, e a apuração devolveu R$ 112,50 de imposto sobre nota de
 * teste, sem sinalizar nada.
 *
 * Não é caso de laboratório: o produto OFERECE emissão em homologação antes da
 * produção (`emitir_nota_homol_antes_producao`), então o cliente testa — e o
 * teste virava imposto e ia dentro do PGDAS-D transmitido à Receita.
 *
 * O filtro é POSITIVO (`= 'prod'`), não negativo (`!= 'hom'`): se um terceiro
 * valor de ambiente aparecer um dia, ele fica de fora da base de imposto até
 * alguém decidir o contrário — errar para fora da declaração é recuperável,
 * declarar receita que não existiu não é.
 *
 * ⚠️ `lancada` (lançamento manual de NF emitida fora do Balu) nasce com
 * `ambiente: 'prod'` explícito em `lancarNotaManualAction` — o DEFAULT 'hom' da
 * coluna a apagaria daqui. Ver o comentário de lá antes de mexer.
 *
 * ⚠️⚠️ O DEFAULT DA COLUNA É UMA ARMADILHA PARA IMPORTAÇÃO EM MASSA.
 * A 0096 criou `ambiente` como `NOT NULL DEFAULT 'hom'` e NENHUMA migration faz
 * backfill. Toda linha que nasça sem declarar o ambiente — carga inicial,
 * migração de sistema antigo, script de seed — vira nota de teste aos olhos
 * deste filtro e SOME da base de imposto, do teto e da declaração anual, em
 * silêncio e na direção cara do erro.
 *
 * Hoje isso é risco latente, não perda: medido em 02/09/2026, o banco tem 3
 * notas no total, todas de homologação e todas de teste — não existe nota de
 * produção anterior à 0096 para perder, e a coluna `bubble_id` da `0001` sequer
 * existe no banco real (ver docs/investigations/DB-DIVERGENCIA.md).
 *
 * **Por isso NÃO cabe backfill**: carimbar as pré-0096 como `'prod'` hoje
 * ressuscitaria exatamente as notas de teste que este filtro veio remover. O
 * que cabe é a regra para quem for importar: **quem insere em massa DECLARA o
 * ambiente**, sempre. Conferir com `scratchpad/_medir-ambiente-notas.mjs` antes
 * e depois de qualquer carga.
 */
export async function lerReceitasParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string, // YYYYMM
): Promise<ReceitaApuracao[]> {
  const inicio = competenciaAddMonths(ateCompetencia, -12); // janela de 13 meses (incl. a atual)
  const inicioIso = `${inicio.slice(0, 4)}-${inicio.slice(4, 6)}-01T00:00:00-03:00`;

  const data = await lerTodasAsPaginas(
    () => supabase
      .from('notas_fiscais')
      .select('id, data_emissao, valor_total, status, tipo_documento, cnae')
      .eq('company_id', companyId)
      // 'ativa' = emissão real autorizada; 'lancada' = lançamento manual (NF emitida fora).
      // Ambas são receita válida → entram na base de imposto.
      .in('status', ['ativa', 'lancada'])
      // AMBIENTE: só nota de PRODUÇÃO é receita. Ver o bloco de comentário
      // acima da função — nota de homologação é teste, não faturamento.
      .eq('ambiente', 'prod')
      .in('tipo_documento', ['NFSe', 'NFe', 'NFCe'])
      .gte('data_emissao', inicioIso),
    'Falha ao ler notas para apuração',
  );

  return data
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => {
      const competencia = competenciaReferenciaBrt(new Date(n.data_emissao as string));
      return { competencia, valor: Number(n.valor_total), cnae: (n.cnae as string | null) ?? null };
    });
}

/**
 * Lê as notas de um ano-calendário para montar a declaração anual (DASN/DEFIS).
 *
 * A janela SQL é generosa de propósito (±1 dia nas pontas, em UTC): o recorte
 * exato do ano em BRT é feito por `resumirReceitasAno` (dasn/resumo.ts), que é
 * puro e testado. Filtrar por ano direto no SQL erraria a nota de 31/12 à noite.
 */
export async function lerNotasAnoCalendario(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<NotaReceita[]> {
  const inicio = `${ano - 1}-12-31T00:00:00Z`;
  const fim = `${ano + 1}-01-02T00:00:00Z`;

  const data = await lerTodasAsPaginas(
    () => supabase
      .from('notas_fiscais')
      .select('id, data_emissao, valor_total, tipo_documento')
      .eq('company_id', companyId)
      .in('status', ['ativa', 'lancada'])
      // AMBIENTE: mesma regra da apuração — a declaração anual não declara nota
      // de teste. Ver o bloco acima de `lerReceitasParaApuracao`.
      .eq('ambiente', 'prod')
      .in('tipo_documento', ['NFSe', 'NFe', 'NFCe'])
      .gte('data_emissao', inicio)
      .lt('data_emissao', fim),
    `Falha ao ler notas do ano ${ano}`,
  );

  return data
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => ({
      dataEmissao: n.data_emissao as string,
      valor: Number(n.valor_total),
      tipoDocumento: n.tipo_documento as NotaReceita['tipoDocumento'],
    }));
}
