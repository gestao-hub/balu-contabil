// Bloco 6A — a busca da explicação para a tela do cliente.
//
// Cada teste aqui existe para MORDER uma mudança específica:
//   1. deixar o RASCUNHO chegar ao cliente (tirar o filtro de status);
//   2. contar pela sessão do usuário — a 0059 tirou a RPC de `authenticated`,
//      então isso passaria a falhar calado e o catálogo pararia de crescer;
//   3. deixar uma falha do contador derrubar a tela de impostos inteira;
//   4. contar como "faltante" o que na verdade foi erro de leitura.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Condicao = [string, unknown];

const h = vi.hoisted(() => {
  const consultas: Array<{ tabela: string; colunas: string; eq: Condicao[] }> = [];
  const rpcsAdmin: Array<{ nome: string; args: unknown }> = [];
  const rpcsSessao: Array<{ nome: string; args: unknown }> = [];
  const avisos: string[] = [];

  const estado = {
    linha: null as { texto: string; gerado_por?: string | null } | null,
    erroLeitura: null as { message: string } | null,
    /** `{ error }` que a RPC devolve (supabase-js NÃO lança nesse caso). */
    erroRpc: null as { message: string } | null,
    /** Exceção de verdade, do tipo que derruba a árvore de render. */
    lancaNaRpc: false,
  };

  const clienteSessao = {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        const registro = { tabela, colunas, eq: [] as Condicao[] };
        consultas.push(registro);
        const b = {
          eq: (c: string, v: unknown) => { registro.eq.push([c, v]); return b; },
          maybeSingle: async () => ({
            data: estado.erroLeitura ? null : estado.linha,
            error: estado.erroLeitura,
          }),
        };
        return b;
      },
    }),
    rpc: async (nome: string, args: unknown) => {
      rpcsSessao.push({ nome, args });
      return { data: null, error: null };
    },
  };

  const clienteAdmin = {
    rpc: async (nome: string, args: unknown) => {
      rpcsAdmin.push({ nome, args });
      if (estado.lancaNaRpc) throw new Error('rede caiu');
      return { data: null, error: estado.erroRpc };
    },
  };

  return { consultas, rpcsAdmin, rpcsSessao, avisos, estado, clienteSessao, clienteAdmin };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.clienteAdmin }));

import { buscarExplicacao } from './buscar';

const CHAVE = 'das-mei:inss+iss';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = () => h.clienteSessao as any;

beforeEach(() => {
  h.consultas.length = 0;
  h.rpcsAdmin.length = 0;
  h.rpcsSessao.length = 0;
  h.estado.linha = null;
  h.estado.erroLeitura = null;
  h.estado.erroRpc = null;
  h.estado.lancaNaRpc = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('buscarExplicacao', () => {
  it('devolve o texto quando há explicação APROVADA', async () => {
    h.estado.linha = { texto: 'Você paga {inss} de INSS.', gerado_por: null };
    const r = await buscarExplicacao(sb(), CHAVE);
    expect(r?.texto).toBe('Você paga {inss} de INSS.');
    expect(h.rpcsAdmin).toHaveLength(0);   // achou: não há buraco para contar
  });

  // ACHADO DO CODE-REVIEW. O disclaimer da tela afirmava "gerada com apoio de
  // IA" para TODO texto. Hoje não há provedor configurado, então todo texto do
  // catálogo foi escrito por um humano do começo ao fim — e a frase é uma
  // afirmação de procedência numa tela sobre tributo. Quem sabe a diferença é
  // `gerado_por`, então ele vem junto do texto.
  it('devolve a procedência do texto, não só o texto', async () => {
    h.estado.linha = { texto: 'x {inss}', gerado_por: 'groq/llama-3.3-70b' };
    expect((await buscarExplicacao(sb(), CHAVE))?.geradoPor).toBe('groq/llama-3.3-70b');
  });

  it('texto escrito à mão não inventa procedência de IA', async () => {
    h.estado.linha = { texto: 'x {inss}', gerado_por: null };
    expect((await buscarExplicacao(sb(), CHAVE))?.geradoPor).toBeNull();
  });

  // ═══ RASCUNHO NÃO VAZA ═══
  // A policy da 0056 já filtra, mas o filtro explícito é a primeira camada — e a
  // única que continua valendo se um dia alguém ler isto pelo service role.
  it('a consulta filtra por status aprovado, sempre', async () => {
    h.estado.linha = { texto: 'x', gerado_por: null };
    await buscarExplicacao(sb(), CHAVE);
    expect(h.consultas[0].eq).toContainEqual(['status', 'aprovado']);
    expect(h.consultas[0].eq).toContainEqual(['chave', CHAVE]);
  });

  it('sem texto aprovado, devolve null', async () => {
    h.estado.linha = null;
    expect(await buscarExplicacao(sb(), CHAVE)).toBeNull();
  });

  // ═══ O BURACO É CONTADO ═══
  it('situação sem texto aprovado incrementa o contador', async () => {
    h.estado.linha = null;
    await buscarExplicacao(sb(), CHAVE);
    expect(h.rpcsAdmin).toEqual([
      { nome: 'registrar_explicacao_faltando', args: { p_chave: CHAVE } },
    ]);
  });

  // ═══ A DIVERGÊNCIA DA 0059 ═══
  // A RPC saiu de `authenticated` e só o service role a executa. Contar pela
  // sessão do usuário daria 401 — e, como o erro é engolido de propósito, o
  // catálogo simplesmente pararia de crescer, em silêncio.
  it('conta pelo ADMIN client, nunca pela sessão do usuário', async () => {
    h.estado.linha = null;
    await buscarExplicacao(sb(), CHAVE);
    expect(h.rpcsAdmin).toHaveLength(1);
    expect(h.rpcsSessao).toHaveLength(0);
  });

  // ═══ CONTAR NÃO PODE DERRUBAR A TELA ═══
  // Esta função é chamada de dentro da tela de impostos. Uma explicação que não
  // existe não pode tirar do ar a página que mostra o imposto a pagar.
  it('exceção ao contar não derruba a busca', async () => {
    h.estado.linha = null;
    h.estado.lancaNaRpc = true;
    expect(await buscarExplicacao(sb(), CHAVE)).toBeNull();
  });

  // supabase-js NÃO lança quando a RPC falha: devolve `{ error }`. Um `try`
  // sozinho não pegaria isso, e a falha passaria despercebida.
  it('erro devolvido pela RPC (sem exceção) também não derruba, e é registrado', async () => {
    h.estado.linha = null;
    h.estado.erroRpc = { message: 'permission denied' };
    expect(await buscarExplicacao(sb(), CHAVE)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  // ═══ ERRO DE LEITURA NÃO É FALTANTE ═══
  // Se a consulta falhou, não se sabe se o texto existe. Contar aqui encheria a
  // fila do admin de situações que talvez já tenham explicação — e o número de
  // "vistas" deixaria de significar demanda real.
  it('erro de leitura devolve null SEM contar como faltante', async () => {
    h.estado.erroLeitura = { message: 'timeout' };
    expect(await buscarExplicacao(sb(), CHAVE)).toBeNull();
    expect(h.rpcsAdmin).toHaveLength(0);
  });

  it('texto vazio no banco conta como ausência, não como explicação', async () => {
    h.estado.linha = { texto: '   ', gerado_por: null };
    expect(await buscarExplicacao(sb(), CHAVE)).toBeNull();
    expect(h.rpcsAdmin).toHaveLength(1);
  });
});
