import { describe, it, expect, vi, beforeEach } from 'vitest';
import { valorDasMei } from '@/lib/fiscal/das-mei';
import { brl } from '@/lib/fiscal/guia';

// `buscarSituacaoAtualMei` chama `buscarExplicacao` diretamente — ela já tem
// suíte própria (`buscar.test.ts`) para as regras de status/contador/RLS.
// Aqui ela é mockada de propósito: este arquivo testa a MONTAGEM da cadeia
// (fiscal → apurações/guias → valores → chave → explicação → render), não a
// busca da explicação em si.
const h = vi.hoisted(() => ({ buscarExplicacao: vi.fn() }));
vi.mock('@/lib/explicacoes/buscar', () => ({ buscarExplicacao: h.buscarExplicacao }));

import { buscarSituacaoAtualMei } from './situacao-atual-mei';

// A cadeia real (ver page.tsx:58-71 e a implementação deste módulo):
//   empresas_fiscais: .select().eq('empresa_id', ...).is('deleted_at', null).maybeSingle()
//   apuracoes_fiscais / guias_fiscais: .select().eq('company_id', ...).is('deleted_at', null)
//                                       .order('competencia_referencia', {...}).limit(N)
// As duas cadeias compartilham o mesmo prefixo (.select().eq().is()) e só
// divergem no método final — por isso o objeto devolvido por `is()` abaixo
// oferece tanto `maybeSingle` quanto `order().limit`. Os arrays de
// apurações/guias são devolvidos JÁ "paginados" (como o Supabase real faria);
// é a própria `buscarSituacaoAtualMei` que faz o `.find()` pela competência —
// por isso o mock nunca precisa filtrar, só devolver o array completo.
function clienteFalso(tabelas: Record<string, unknown>) {
  return {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({ data: tabelas[t] ?? null, error: null }),
            order: () => ({
              limit: async () => ({ data: (tabelas[t] as unknown[]) ?? [], error: null }),
            }),
          }),
        }),
      }),
    }),
  } as never;
}

const COMPETENCIA = '202607';
const ATIVIDADE = 'Prestacao de Servicos';
// O total real que `valoresDoDasMei` aceita para esta atividade — derivado da
// mesma função que o código de produção usa, nunca digitado à parte (mesma
// razão de `valores-mei.test.ts`: mudar o INSS não pode quebrar o teste em
// silêncio nem exigir editar um número solto aqui).
const TOTAL_VALIDO = valorDasMei(ATIVIDADE);
const TEXTO_CATALOGO = 'Você paga {inss} de INSS e {iss} de ISS.';
const TEXTO_ESPERADO = `Você paga ${brl(75.90)} de INSS e ${brl(5.00)} de ISS.`;

beforeEach(() => {
  h.buscarExplicacao.mockReset();
});

describe('buscarSituacaoAtualMei', () => {
  it('sem ficha fiscal devolve null', async () => {
    const r = await buscarSituacaoAtualMei(clienteFalso({}), 'empresa-1', COMPETENCIA);
    expect(r).toBeNull();
  });

  // ═══ CAMINHO FELIZ, PONTA A PONTA ═══
  // Prova que a cadeia inteira — fiscal, `.find()` pela competência, soma dos
  // componentes, chave, explicação aprovada e render — produz exatamente o
  // texto que o cliente veria na tela de impostos.
  it('com ficha fiscal e apuração da competência, devolve o texto renderizado', async () => {
    h.buscarExplicacao.mockResolvedValue({ texto: TEXTO_CATALOGO, geradoPor: null });

    const sb = clienteFalso({
      empresas_fiscais: { atividade_mei: ATIVIDADE },
      apuracoes_fiscais: [
        { competencia_referencia: '202606', valor_imposto: 12.34 }, // outra competência, ignorada
        { competencia_referencia: COMPETENCIA, valor_imposto: TOTAL_VALIDO },
      ],
      guias_fiscais: [], // sem guia emitida ainda — a apuração é quem fornece o total
    });

    const r = await buscarSituacaoAtualMei(sb, 'empresa-1', COMPETENCIA);

    expect(r).toEqual({ texto: TEXTO_ESPERADO, geradoPor: null });
    // a chave desta situação é 'das-mei:inss+iss' (Prestação de Serviços)
    expect(h.buscarExplicacao).toHaveBeenCalledWith(sb, 'das-mei:inss+iss');
  });

  // ═══ PRIORIDADE: GUIA VENCE APURAÇÃO ═══
  // `totalExibido = guiaAtual?.valor_total ?? apuracaoAtual?.valor_imposto ?? null`.
  // Aqui os dois existem e DIVERGEM: só o valor da guia bate com a soma dos
  // componentes. Se a prioridade fosse invertida (ou trocada por `||`), o
  // total usado seria o da apuração — inválido — e a função devolveria `null`
  // em vez do texto. Esta asserção morde essa troca.
  it('quando guia e apuração da mesma competência divergem, o valor da guia vence', async () => {
    h.buscarExplicacao.mockResolvedValue({ texto: TEXTO_CATALOGO, geradoPor: null });

    const sb = clienteFalso({
      empresas_fiscais: { atividade_mei: ATIVIDADE },
      apuracoes_fiscais: [
        { competencia_referencia: COMPETENCIA, valor_imposto: TOTAL_VALIDO + 5 }, // não bate
      ],
      guias_fiscais: [
        { competencia_referencia: COMPETENCIA, valor_total: TOTAL_VALIDO }, // bate
      ],
    });

    const r = await buscarSituacaoAtualMei(sb, 'empresa-1', COMPETENCIA);

    expect(r).toEqual({ texto: TEXTO_ESPERADO, geradoPor: null });
  });

  // ═══ SEM COMPETÊNCIA CORRESPONDENTE ═══
  // Ficha fiscal existe, mas nem apurações nem guias têm uma linha para a
  // competência pedida: `totalExibido` fica `null`, `valoresDoDasMei` recusa,
  // e a função nunca chega a consultar a explicação.
  it('sem apuração nem guia da competência atual, devolve null e não busca explicação', async () => {
    const sb = clienteFalso({
      empresas_fiscais: { atividade_mei: ATIVIDADE },
      apuracoes_fiscais: [{ competencia_referencia: '202606', valor_imposto: TOTAL_VALIDO }],
      guias_fiscais: [{ competencia_referencia: '202605', valor_total: TOTAL_VALIDO }],
    });

    const r = await buscarSituacaoAtualMei(sb, 'empresa-1', COMPETENCIA);

    expect(r).toBeNull();
    expect(h.buscarExplicacao).not.toHaveBeenCalled();
  });
});
