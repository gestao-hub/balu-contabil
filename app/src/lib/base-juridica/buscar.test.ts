import { describe, it, expect, vi } from 'vitest';
import { buscarContextoJuridico } from './buscar';
import { situacaoDasMei } from '@/lib/fiscal/situacao-fiscal';

function clienteFalso(resultado: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn(async (_fn: string, _params: unknown) => resultado),
  } as never;
}

describe('buscarContextoJuridico', () => {
  it('devolve os trechos encontrados (titulo e texto), chamando a RPC de ranking com os params certos', async () => {
    const sb = clienteFalso({
      data: [{ titulo: 'Resolução X', texto: 'Trecho relevante.' }],
      error: null,
    });
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([{ titulo: 'Resolução X', texto: 'Trecho relevante.' }]);
    // Regressão: isto pegaria uma volta silenciosa ao antigo
    // .from().select().textSearch().limit() sem ORDER BY por relevância —
    // a chamada precisa ser à RPC que faz ts_rank_cd no banco.
    expect((sb as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'buscar_documentos_juridicos',
      { p_consulta: expect.any(String), p_limite: 5 },
    );
  });

  // NUNCA LANÇA — quem chama (gerarRascunhoAction) trata ausencia de contexto
  // como "gerar sem contexto extra", o mesmo estado de hoje sem esta feature.
  // Se este modulo lançasse, um erro de busca derrubaria a geração de
  // rascunho inteira por causa de uma peça que é só apoio.
  it('erro do banco devolve lista vazia, nunca lança', async () => {
    const sb = clienteFalso({ data: null, error: { message: 'falhou' } });
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([]);
  });

  // Estado real que o PostgREST pode devolver: sem erro, mas sem dado (ex.:
  // resposta 204/corpo vazio). Se o código só checar `error` e não `data`,
  // `data as TrechoJuridico[]` vira `null` e quebra quem itera o retorno.
  it('data null sem erro devolve lista vazia, nunca lança', async () => {
    const sb = clienteFalso({ data: null, error: null });
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([]);
  });

  it('exceção na chamada devolve lista vazia, nunca lança', async () => {
    const sb = {
      rpc: () => { throw new Error('conexão caiu'); },
    } as never;
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([]);
  });
});
