// Bloco 4A — a rede do REAJUSTE DE PLANO.
//
// ─── O DEFEITO QUE MOTIVOU O ARQUIVO (02/09/2026) ───────────────────────────
// `salvarPlanoAction` gravava o novo preço em `planos` e NÃO falava com o
// Asaas. O admin subia de R$199 para R$249, a tela mostrava R$249,
// `lib/admin/metricas.ts` passava a contar R$249 de MRR — e o Asaas seguia
// cobrando R$199 de todo assinante, para sempre. Receita registrada e nunca
// cobrada, com o painel que denunciaria o problema sendo justamente o que
// reporta o número errado.
//
// É o MESMO defeito que `lib/billing/cron.ts` já tinha achado e consertado no
// caminho da troca de faixa — o buraco ficou aberto no caminho do admin.
//
// Cada teste morde uma mutação que hoje passa por `tsc` e pelo resto da suíte:
//   1. remover a chamada a `atualizarAssinatura` (volta o defeito original);
//   2. gravar local mesmo quando o Asaas recusou (os dois lados divergem em
//      silêncio, que é o estado que ninguém percebe);
//   3. propagar para 'cortesia'/'cancelada' (cobrar quem não tem cobrança, ou
//      ressuscitar assinatura cancelada por um reajuste de tabela);
//   4. chamar o Asaas quando o preço NÃO mudou (N chamadas de rede para
//      renomear um plano).
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, guard, auditoria, `next/cache` e o
// cliente Asaas. Não há rede nem banco.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const upserts: Array<Record<string, unknown>> = [];
  const auditorias: Array<{ acao: string; alvoId?: string | null; meta?: Record<string, unknown> }> = [];
  const atualizacoesAsaas: Array<{ id: string; value: number; description: string }> = [];

  const estado = {
    // Preço ATUAL no banco. Os testes mudam para simular "mudou"/"não mudou".
    precoAtual: 19900 as number | null,
    assinaturas: [] as Array<Record<string, unknown>>,
    /** ids de assinatura do Asaas que devem FALHAR na atualização. */
    falharEm: [] as string[],
    /** força erro na leitura do preço atual / da lista de assinaturas. */
    erroLeituraPlano: null as { message: string } | null,
    erroLeituraAssinaturas: null as { message: string } | null,
    upsertError: null as { message: string } | null,
  };

  function from(tabela: string) {
    const q: Record<string, unknown> = {};
    // ⚠️ O MOCK FILTRA DE VERDADE (achado do /code-review de 02/09).
    // A primeira versao fazia `q[m] = () => q`, descartando os argumentos: a
    // fixture voltava inteira independentemente de `.eq('plano_id')`,
    // `.in('status', VIVOS)` e `.not('asaas_subscription_id','is',null)`.
    // Resultado: apagar qualquer um dos tres deixava os 9 testes verdes, e o
    // cabecalho deste arquivo AFIRMAVA morder essa mutacao. Um teste que diz
    // cobrir o que nao cobre e pior que a ausencia dele.
    const filtros: unknown[][] = [];
    q.select = () => q;
    q.limit = () => q;
    for (const m of ['eq', 'in', 'not', 'neq']) {
      q[m] = (...args: unknown[]) => { filtros.push([m, ...args]); return q; };
    }

    /** Aplica na fixture os MESMOS filtros que a action montou. */
    const aplicar = (linhas: Array<Record<string, unknown>>) => linhas.filter((l) => {
      for (const [op, campo, valor] of filtros as [string, string, unknown][]) {
        if (op === 'eq' && l[campo] !== valor) return false;
        if (op === 'in' && !(valor as unknown[]).includes(l[campo])) return false;
        // `.not(campo, 'is', null)` — o terceiro argumento e o valor.
        if (op === 'not' && campo in l && l[campo] == null) return false;
      }
      return true;
    });

    q.maybeSingle = async () => {
      if (tabela === 'planos') {
        if (estado.erroLeituraPlano) return { data: null, error: estado.erroLeituraPlano };
        return { data: estado.precoAtual == null ? null : { valor_centavos: estado.precoAtual }, error: null };
      }
      return { data: null, error: null };
    };
    // `assinaturas` termina como thenable (select+filtros, sem .single()).
    q.then = (resolve: (v: unknown) => unknown) => {
      if (tabela === 'assinaturas') {
        if (estado.erroLeituraAssinaturas) {
          return resolve({ data: null, error: estado.erroLeituraAssinaturas });
        }
        return resolve({ data: aplicar(estado.assinaturas), error: null });
      }
      // `planos` também é lido como lista na validação de faixas.
      return resolve({ data: [], error: null });
    };
    q.upsert = async (valores: Record<string, unknown>) => {
      upserts.push(valores);
      return { error: estado.upsertError };
    };
    return q;
  }

  return { upserts, auditorias, atualizacoesAsaas, estado, from };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => ({ userId: 'admin-1' }) }));
vi.mock('@/lib/security/audit', () => ({
  registrarAuditoria: async (a: { acao: string; alvoId?: string | null; meta?: Record<string, unknown> }) => {
    h.auditorias.push({ acao: a.acao, alvoId: a.alvoId ?? null, meta: a.meta });
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/clients/asaas', () => ({
  asaas: {
    atualizarAssinatura: async (id: string, d: { value: number; description: string }) => {
      if (h.estado.falharEm.includes(id)) throw new Error('Asaas fora do ar');
      h.atualizacoesAsaas.push({ id, value: d.value, description: d.description });
      return {};
    },
  },
}));

import { salvarPlanoAction } from './actions';

const PLANO = {
  id: 'plano-esc-1',
  nome: 'Escritório 50',
  publico: 'empresa' as const, // 'empresa' evita a validação de faixas
  valor_centavos: 24900,
  ciclo: 'MONTHLY' as const,
  clientes_min: null,
  clientes_max: null,
  trial_dias: 14,
  ativo: true,
};

beforeEach(() => {
  h.upserts.length = 0;
  h.auditorias.length = 0;
  h.atualizacoesAsaas.length = 0;
  h.estado.precoAtual = 19900;
  h.estado.assinaturas = [];
  h.estado.falharEm = [];
  h.estado.upsertError = null;
  h.estado.erroLeituraPlano = null;
  h.estado.erroLeituraAssinaturas = null;
});

describe('salvarPlanoAction — o reajuste tem de alcançar o Asaas', () => {
  // MUTAÇÃO 1: apagar a chamada a `atualizarAssinatura`. Sem este teste, o
  // defeito original volta e nada fica vermelho.
  it('propaga o novo preço para TODA assinatura viva com id do Asaas', async () => {
    h.estado.assinaturas = [
      { id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' },
      { id: 'a2', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_2' },
    ];

    const r = await salvarPlanoAction(PLANO);

    expect(r).toEqual({ ok: true });
    expect(h.atualizacoesAsaas).toHaveLength(2);
    // Centavos no banco, REAIS no Asaas — a conversão é onde se erra por 100x.
    expect(h.atualizacoesAsaas[0]).toEqual({ id: 'sub_1', value: 249, description: 'Balu — Escritório 50' });
    expect(h.atualizacoesAsaas[1]!.value).toBe(249);
  });

  // MUTAÇÃO 2: mover o upsert para antes do laço, ou gravar mesmo com falha.
  // É a regra que `cron.ts` estabeleceu: o Asaas primeiro, local depois.
  it('Asaas recusou → NÃO grava local, e diz o que fazer', async () => {
    h.estado.assinaturas = [
      { id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' },
      { id: 'a2', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_2' },
    ];
    h.estado.falharEm = ['sub_2'];

    const r = await salvarPlanoAction(PLANO);

    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0); // o preço NÃO foi salvo
    expect(r).toMatchObject({ error: expect.stringContaining('1 de 2') });
  });

  // A falha parcial não pode sumir do radar quando a tela recarrega.
  // O nome do campo importa: `call()` faz retry de 502/503/504 e pode lançar
  // DEPOIS de o Asaas ter aplicado. Chamar de "falharam" mandaria quem for
  // reconciliar a mão procurar o oposto do que aconteceu. (Achado do review.)
  it('falha parcial vira auditoria com os ids NÃO CONFIRMADOS', async () => {
    h.estado.assinaturas = [{ id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' }];
    h.estado.falharEm = ['sub_1'];

    await salvarPlanoAction(PLANO);

    const aud = h.auditorias.find((a) => a.acao === 'plano.reajuste_parcial');
    expect(aud).toBeDefined();
    expect(aud?.meta?.nao_confirmadas).toEqual(['a1']);
  });

  // MUTAÇÃO 4: tirar a comparação de preço. Renomear um plano passaria a
  // disparar uma chamada de rede por assinante.
  it('preço INALTERADO não fala com o Asaas', async () => {
    h.estado.precoAtual = PLANO.valor_centavos; // mesmo valor
    h.estado.assinaturas = [{ id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' }];

    const r = await salvarPlanoAction({ ...PLANO, nome: 'Escritório 50 (novo nome)' });

    expect(r).toEqual({ ok: true });
    expect(h.atualizacoesAsaas).toHaveLength(0);
    expect(h.upserts).toHaveLength(1); // mas o nome é salvo
  });

  // Plano novo (ainda não existe no banco): não há assinante para reajustar, e
  // ler `null` não pode virar "o preço mudou" e disparar propagação à toa.
  it('plano NOVO não tenta propagar', async () => {
    h.estado.precoAtual = null;
    h.estado.assinaturas = [{ id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' }];

    const r = await salvarPlanoAction(PLANO);

    expect(r).toEqual({ ok: true });
    expect(h.atualizacoesAsaas).toHaveLength(0);
  });

  // Sem assinante vivo, o reajuste é só troca de tabela.
  it('sem assinatura viva, grava direto', async () => {
    h.estado.assinaturas = [];
    const r = await salvarPlanoAction(PLANO);
    expect(r).toEqual({ ok: true });
    expect(h.atualizacoesAsaas).toHaveLength(0);
    expect(h.upserts).toHaveLength(1);
  });

  // ─── as duas guardas que o debugging sistematico acrescentou ─────────────

  // Sem conferir `error`, a leitura falha, `data` vem null, o codigo conclui
  // "plano novo / preco nao mudou", GRAVA o valor novo e NAO propaga — que e
  // exatamente a divergencia silenciosa que este bloco existe para impedir.
  it('leitura do preço atual falhou → não grava e não propaga', async () => {
    h.estado.erroLeituraPlano = { message: 'timeout' };
    h.estado.assinaturas = [{ id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' }];

    const r = await salvarPlanoAction(PLANO);

    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
    expect(h.atualizacoesAsaas).toHaveLength(0);
  });

  // O PostgREST corta em `max-rows` e devolve `error: null`: uma pagina curta e
  // indistinguivel da lista inteira. Sem o disjuntor, mais de mil assinantes
  // num plano dariam reajuste nos primeiros mil, silencio no resto e `ok:true`.
  it('mais assinaturas que o teto → RECUSA em voz alta, sem reajustar ninguém', async () => {
    h.estado.assinaturas = Array.from({ length: 51 }, (_, i) => ({
      id: `a${i}`, plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: `sub_${i}`,
    }));

    const r = await salvarPlanoAction(PLANO);

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining('50') });
    expect(h.upserts).toHaveLength(0);
    expect(h.atualizacoesAsaas).toHaveLength(0);
  });

  // ─── ACHADO 4: os filtros agora sao exercitados de verdade ───────────────

  // MUTACAO: apagar `.in('status', VIVOS)`. Reajustar 'cortesia' e 'cancelada'
  // seria cobrar quem nao tem cobranca e mexer em contrato encerrado.
  it('NAO toca em cortesia nem em cancelada', async () => {
    h.estado.assinaturas = [
      { id: 'viva', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_viva' },
      { id: 'cort', plano_id: PLANO.id, status: 'cortesia', asaas_subscription_id: 'sub_cort' },
      { id: 'canc', plano_id: PLANO.id, status: 'cancelada', asaas_subscription_id: 'sub_canc' },
    ];

    await salvarPlanoAction(PLANO);

    expect(h.atualizacoesAsaas.map((a) => a.id)).toEqual(['sub_viva']);
  });

  // MUTACAO: apagar `.eq('plano_id', input.id)` — reajustaria o plano errado.
  it('NAO toca em assinatura de OUTRO plano', async () => {
    h.estado.assinaturas = [
      { id: 'meu', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_meu' },
      { id: 'outro', plano_id: 'outro-plano', status: 'ativa', asaas_subscription_id: 'sub_outro' },
    ];

    await salvarPlanoAction(PLANO);

    expect(h.atualizacoesAsaas.map((a) => a.id)).toEqual(['sub_meu']);
  });

  // MUTACAO: apagar `.not('asaas_subscription_id','is',null)` — a action
  // chamaria o Asaas com `null` como id de assinatura.
  it('NAO tenta reajustar quem nunca contratou no Asaas', async () => {
    h.estado.assinaturas = [
      { id: 'com', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_com' },
      { id: 'sem', plano_id: PLANO.id, status: 'trial', asaas_subscription_id: null },
    ];

    await salvarPlanoAction(PLANO);

    expect(h.atualizacoesAsaas.map((a) => a.id)).toEqual(['sub_com']);
  });

  // ─── ACHADO 5: os dois modos de falha que estavam cabeados e nao testados ─

  it('leitura das assinaturas falhou → não grava e não propaga', async () => {
    h.estado.erroLeituraAssinaturas = { message: 'timeout' };
    h.estado.assinaturas = [{ id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' }];

    const r = await salvarPlanoAction(PLANO);

    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
    expect(h.atualizacoesAsaas).toHaveLength(0);
  });

  // A JANELA DO OUTRO LADO: o Asaas aceitou TUDO e a gravacao local falhou.
  // Sem tratamento, o Asaas cobra o valor novo, a tela mostra o antigo, e nao
  // ha log nem auditoria — a mesma divergencia muda, ao contrario.
  it('Asaas ok + gravação local falhou → avisa que o Asaas JÁ mudou, e audita', async () => {
    h.estado.assinaturas = [{ id: 'a1', plano_id: PLANO.id, status: 'ativa', asaas_subscription_id: 'sub_1' }];
    h.estado.upsertError = { message: 'deadlock detected' };

    const r = await salvarPlanoAction(PLANO);

    expect(r.ok).toBe(false);
    expect(h.atualizacoesAsaas).toHaveLength(1); // o Asaas foi mesmo alterado
    expect(r).toMatchObject({ error: expect.stringContaining('JÁ FOI aplicado no Asaas') });
    expect(h.auditorias.some((a) => a.acao === 'plano.divergencia_local')).toBe(true);
  });

  // ─── ACHADO 1: a auditoria precisa CHEGAR no banco ───────────────────────
  // `audit_log.alvo_id` e UUID e `planos.id` e slug de texto: mandar o id ali
  // faz o insert ser recusado (22P02) e `registrarAuditoria` engolir com warn.
  // Medido em 02/09: `audit_log` tinha ZERO linhas de plano.
  it('auditoria NUNCA manda o id do plano em alvoId (é uuid no banco)', async () => {
    h.estado.assinaturas = [];
    await salvarPlanoAction(PLANO);
    const aud = h.auditorias.find((a) => a.acao === 'plano.salvar');
    expect(aud?.alvoId ?? null).toBeNull();
    expect(aud?.meta?.plano_id).toBe(PLANO.id);
  });

  it('a auditoria do sucesso registra que o preço mudou', async () => {
    h.estado.assinaturas = [];
    await salvarPlanoAction(PLANO);
    const aud = h.auditorias.find((a) => a.acao === 'plano.salvar');
    expect(aud?.meta?.preco_mudou).toBe(true);
    expect(aud?.meta?.valor_centavos).toBe(24900);
  });
});
