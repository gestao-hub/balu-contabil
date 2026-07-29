// Bloco 6A — a rede das invariantes de `gerarRascunhoAction`.
//
// Cada teste aqui existe para MORDER uma mudança específica que hoje passa por
// `tsc --noEmit` e pelo resto da suíte:
//   1. deixar a geração sobrescrever um texto APROVADO — um clique acidental
//      apagaria conteúdo que um humano revisou e assinou;
//   2. gravar com `status: 'aprovado'`, pulando a revisão;
//   3. trocar o UPDATE por UPSERT (o do PostgREST manda NULL nas colunas
//      ausentes — regra do repo, e o que quase apagou a chave na Task 7);
//   4. chamar a IA antes de validar a chave, gastando crédito com lixo;
//   5. deixar a chave do provedor vazar por mensagem de erro ou auditoria;
//   6. chamar `lerChaveIa` fora do `try` (ela LANÇA);
//   7. mandar para a IA qualquer coisa que não seja o prompt derivado da chave.
//
// TUDO MOCKADO NA FRONTEIRA: Supabase, guard, auditoria, `next/cache` e o
// cliente de IA. Não há rede nem banco. A cifra é a DE VERDADE.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { montarPrompt } from '@/lib/explicacoes/prompt';
import { situacaoDaChave } from '@/lib/fiscal/situacao-fiscal';

const USER_ID = 'user_admin_1';
const CHAVE_FALSA = 'sk-TESTE-chave-obviamente-falsa-nunca-use-0001';
const CHAVE_SIT = 'das-mei:inss+iss';

type Chamada = { tabela: string; valores: Record<string, unknown>; eq: unknown[][]; select: string[] };

const h = vi.hoisted(() => {
  const updates: Chamada[] = [];
  const inserts: Chamada[] = [];
  const auditorias: Array<{ acao: string; meta?: Record<string, unknown> }> = [];
  const prompts: string[] = [];
  const ordem: string[] = [];

  const estado = {
    // Literal: este factory é IÇADO acima das consts do módulo.
    guard: { userId: 'user_admin_1' } as unknown,
    config: null as Record<string, unknown> | null,
    /** A linha do catálogo para esta chave hoje. `null` = ainda não existe. */
    linhaCatalogo: null as Record<string, unknown> | null,
    erroLeitura: null as { message: string } | null,
    erroEscrita: null as { message: string } | null,
    linhasAfetadas: [{ id: 'exp_1' }] as { id: string }[],
    textoGerado: 'Você paga {inss} de INSS e {iss} de ISS todo mês.',
    erroIa: null as unknown,
    /** Roda entre a leitura e a escrita, para simular o outro admin. */
    aoAplicar: null as null | (() => void),
  };

  function construir(tabela: string, kind: 'update' | 'insert', valores: Record<string, unknown>) {
    ordem.push(`${tabela}.${kind}`);
    const chamada: Chamada = { tabela, valores, eq: [], select: [] };
    (kind === 'update' ? updates : inserts).push(chamada);
    const resultado = () => {
      if (estado.erroEscrita) return { data: null, error: estado.erroEscrita };

      if (kind === 'update' && tabela === 'explicacoes_fiscais') {
        // GANCHO DA CORRIDA: roda ENTRE a leitura e a escrita, como o outro
        // admin clicando "Aprovar" no mesmo instante. Sem ele não há como
        // provar um compare-and-swap.
        estado.aoAplicar?.();

        // O MOCK HONRA AS CONDIÇÕES `.eq`. Mock que responde "afetou" sempre faz
        // um CAS quebrado parecer funcionar — é o mock provando a si mesmo
        // (lição registrada do Bloco 4B). Aqui as condições são conferidas
        // contra a linha que existe AGORA.
        const linha = estado.linhaCatalogo as Record<string, unknown> | null;
        const casou = linha !== null
          && chamada.eq.every(([col, val]) => linha[col as string] === val);
        if (!casou) return { data: chamada.select.length ? [] : null, error: null };

        Object.assign(linha, valores);
        if (chamada.select.length === 0) return { data: null, error: null };
        return { data: [{ id: linha.id }], error: null };
      }

      // FIEL AO supabase-js: sem `.select()`, `data` volta null.
      if (chamada.select.length === 0) return { data: null, error: null };
      return { data: estado.linhasAfetadas, error: null };
    };
    const b = {
      eq: (c: unknown, v: unknown) => { chamada.eq.push([c, v]); return b; },
      select: (cols: string) => { chamada.select.push(cols); return b; },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, falhou),
    };
    return b;
  }

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const b = {
        eq: (_c: unknown, _v: unknown) => b,
        maybeSingle: async () => {
          ordem.push(`${tabela}.select`);
          if (estado.erroLeitura) return { data: null, error: estado.erroLeitura };
          return {
            data: tabela === 'config_ia' ? estado.config : estado.linhaCatalogo,
            error: null,
          };
        },
      };
      return b;
    },
    update: (valores: Record<string, unknown>) => construir(tabela, 'update', valores),
    insert: (valores: Record<string, unknown>) => construir(tabela, 'insert', valores),
  }));

  const registrarAuditoria = vi.fn(async (e: { acao: string; meta?: Record<string, unknown> }) => {
    ordem.push(`audit:${e.acao}`);
    auditorias.push(e);
  });
  const revalidatePath = vi.fn((_p: string) => {});
  const gerarTexto = vi.fn(async (_cfg: Record<string, unknown>, prompt: string) => {
    ordem.push('ia.gerarTexto');
    prompts.push(prompt);
    if (estado.erroIa) throw estado.erroIa;
    return estado.textoGerado;
  });

  return { updates, inserts, auditorias, prompts, ordem, estado, from, registrarAuditoria, revalidatePath, gerarTexto };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/ai/cliente', () => ({ gerarTexto: h.gerarTexto }));

import { gerarRascunhoAction, salvarTextoAction, aprovarExplicacaoAction } from './actions';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

let cifrada: string;

beforeEach(async () => {
  const { guardarChaveIa } = await import('@/lib/ai/config-ia');
  cifrada = guardarChaveIa(CHAVE_FALSA);
  h.updates.length = 0;
  h.inserts.length = 0;
  h.auditorias.length = 0;
  h.prompts.length = 0;
  h.ordem.length = 0;
  h.estado.guard = { userId: USER_ID };
  h.estado.config = {
    id: 1, provedor: 'groq', modelo: 'llama-3.3-70b', base_url: null, chave_cifrada: cifrada,
  };
  h.estado.linhaCatalogo = null;
  h.estado.erroLeitura = null;
  h.estado.erroEscrita = null;
  h.estado.linhasAfetadas = [{ id: 'exp_1' }];
  h.estado.textoGerado = 'Você paga {inss} de INSS e {iss} de ISS todo mês.';
  h.estado.erroIa = null;
  h.estado.aoAplicar = null;
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  h.gerarTexto.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('gerarRascunhoAction', () => {
  it('exige AdminBalu, e não chama a IA', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  // Validar ANTES da rede: crédito de IA é dinheiro, e lixo não vira rascunho.
  it.each(['', 'MAIUSCULA:x', 'sem-dois-pontos', 'x'.repeat(200)])(
    'chave fora de forma (%s) é recusada antes de qualquer chamada',
    async (ruim) => {
      const r = await gerarRascunhoAction(ruim);
      expect(r.ok).toBe(false);
      expect(h.gerarTexto).not.toHaveBeenCalled();
      expect(h.inserts).toHaveLength(0);
    },
  );

  // Forma válida mas significado desconhecido: 'irpf:algo' passa no regex e não
  // existe. Sem isto a IA redigiria sobre um tributo inventado.
  it('chave de forma válida mas situação desconhecida não vai para a IA', async () => {
    const r = await gerarRascunhoAction('irpf:algo');
    expect(r.ok).toBe(false);
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  it('sem provedor configurado, não tenta a rede', async () => {
    h.estado.config = null;
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  it('sem chave gravada, não tenta a rede', async () => {
    h.estado.config = { id: 1, provedor: 'groq', modelo: 'm', base_url: null, chave_cifrada: null };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  // `lerChaveIa` LANÇA. Fora de um `try`, derrubaria a action inteira.
  it('chave corrompida vira mensagem legível, não exceção', async () => {
    h.estado.config = { id: 1, provedor: 'groq', modelo: 'm', base_url: null, chave_cifrada: 'em-claro' };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/corrompida/i);
  });

  it('grava o rascunho quando a situação ainda não tem linha', async () => {
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(true);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].valores).toMatchObject({
      chave: CHAVE_SIT,
      texto: 'Você paga {inss} de INSS e {iss} de ISS todo mês.',
      status: 'rascunho',
      gerado_por: 'groq/llama-3.3-70b',
    });
    expect(h.updates).toHaveLength(0);
  });

  it('substitui o rascunho anterior por UPDATE, nunca por upsert', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'velho' };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(true);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].valores.status).toBe('rascunho');
    expect(h.updates[0].eq).toContainEqual(['chave', CHAVE_SIT]);
    expect(h.inserts).toHaveLength(0);
  });

  // ═══ A REGRA CENTRAL DESTA TASK ═══
  // Gerar NUNCA sobrescreve texto aprovado. Um clique acidental no botão de
  // gerar apagaria conteúdo que um humano leu, revisou e carimbou — e o cliente
  // passaria a ver texto que ninguém aprovou, ou nada.
  it('NUNCA sobrescreve um texto APROVADO', async () => {
    h.estado.linhaCatalogo = {
      id: 'exp_1', chave: CHAVE_SIT, status: 'aprovado', texto: 'texto revisado por humano',
    };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    // e nem gasta a chamada de IA: a recusa é decidida antes.
    expect(h.gerarTexto).not.toHaveBeenCalled();
  });

  // O prompt é DERIVADO da chave — nada mais entra nele.
  it('manda para a IA exatamente o prompt da situação', async () => {
    await gerarRascunhoAction(CHAVE_SIT);
    const esperado = montarPrompt(situacaoDaChave(CHAVE_SIT)!);
    expect(h.prompts[0]).toBe(esperado);
    expect(h.prompts[0]).not.toMatch(/\d+[.,]\d{2}/);
  });

  it('erro do provedor não carrega a chave, e nada é gravado', async () => {
    h.estado.erroIa = new Error(`401 invalid key ${CHAVE_FALSA}`);
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('401');
      expect(r.error).not.toContain(CHAVE_FALSA);
    }
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('a auditoria registra a origem do texto, e nunca a chave', async () => {
    await gerarRascunhoAction(CHAVE_SIT);
    const ev = h.auditorias.find((a) => a.acao === 'ia.gerar_rascunho');
    expect(ev).toBeTruthy();
    const serializado = JSON.stringify(ev);
    expect(serializado).not.toContain(CHAVE_FALSA);
    expect(serializado).not.toContain('enc:v1:');
    expect(ev?.meta?.gerado_por).toBe('groq/llama-3.3-70b');
    expect(ev?.meta?.chave).toBe(CHAVE_SIT);
  });

  it('erro de escrita não vira sucesso', async () => {
    h.estado.erroEscrita = { message: 'boom' };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  // Sem o `.select('id')`, o PostgREST devolve sucesso para um UPDATE que não
  // pegou linha nenhuma — e a tela diria "gerado" sobre coisa nenhuma.
  //
  // O cenário é a linha SUMIR entre a leitura e a escrita (outro admin apagou).
  // A versão anterior deste teste zerava um `linhasAfetadas` do mock, que era um
  // botão desligado da realidade — o mock provando a si mesmo. Agora o mock
  // confere as condições `.eq` contra a linha que existe de fato.
  it('UPDATE que não pega linha nenhuma não é reportado como sucesso', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'velho' };
    h.estado.aoAplicar = () => { h.estado.linhaCatalogo = null; };
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(false);
  });

  // A IA respondeu, mas com marcador que a situação não fornece. O rascunho é
  // gravado assim mesmo (é rascunho, e o admin corrige numa linha), mas a action
  // AVISA — senão o admin só descobre no momento em que a aprovação recusa.
  it('avisa quando o rascunho traz marcador fora da situação', async () => {
    h.estado.textoGerado = 'Você paga {inss}, {iss} e {icms}.';
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.marcadoresIntrusos).toEqual(['icms']);
    expect(h.inserts).toHaveLength(1);
  });

  it('sem intruso, não inventa aviso', async () => {
    const r = await gerarRascunhoAction(CHAVE_SIT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.marcadoresIntrusos).toEqual([]);
  });

  // ═══ A CORRIDA QUE A TASK 9 CRIOU ═══
  // Até a Task 8, `gerarRascunhoAction` era o único escritor desta tabela e um
  // `UPDATE ... WHERE chave` bastava. A aprovação é o TERCEIRO escritor, e a
  // trava "nunca sobrescreve aprovado" passou a valer sobre um estado lido
  // ANTES da chamada de IA — que leva segundos. Aprovar nesse intervalo fazia a
  // geração regravar por cima do texto que um humano acabara de carimbar.
  // Conserto: compare-and-swap (`.eq('status','rascunho')`) e zero linhas
  // afetadas = outro escritor mandou.
  it('não sobrescreve um texto aprovado ENTRE a leitura e a escrita', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'velho' };
    // o outro admin aprova enquanto a IA responde
    h.estado.aoAplicar = () => {
      (h.estado.linhaCatalogo as Record<string, unknown>).status = 'aprovado';
      (h.estado.linhaCatalogo as Record<string, unknown>).texto = 'texto revisado por humano';
    };

    const r = await gerarRascunhoAction(CHAVE_SIT);

    expect(r.ok).toBe(false);
    expect((h.estado.linhaCatalogo as Record<string, unknown>).texto).toBe('texto revisado por humano');
    expect((h.estado.linhaCatalogo as Record<string, unknown>).status).toBe('aprovado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 9 — revisar e aprovar.
//
// ⚠️ O CAMINHO MANUAL NÃO É SECUNDÁRIO. Enquanto não houver chave de IA
// configurada, escrever o texto à mão e aprovar é o ÚNICO caminho que funciona
// — então salvar e aprovar precisam CRIAR a linha, não só editar uma existente.
describe('salvarTextoAction', () => {
  const TEXTO = 'Você paga {inss} de INSS e {iss} de ISS por mês.';

  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarTextoAction({ chave: CHAVE_SIT, texto: TEXTO });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('cria a linha quando a situação ainda não tem texto (o caminho manual)', async () => {
    h.estado.linhaCatalogo = null;
    const r = await salvarTextoAction({ chave: CHAVE_SIT, texto: TEXTO });
    expect(r.ok).toBe(true);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].valores).toMatchObject({ chave: CHAVE_SIT, texto: TEXTO, status: 'rascunho' });
  });

  // ═══ A REGRA DA §5.6 DA SPEC ═══
  // Editar um texto APROVADO derruba a aprovação. Sem isso, "aprovado" para de
  // significar "um humano leu ISTO": significaria "um humano leu alguma versão".
  it('editar um texto APROVADO derruba a aprovação', async () => {
    h.estado.linhaCatalogo = {
      id: 'exp_1', chave: CHAVE_SIT, status: 'aprovado', texto: 'antigo',
      aprovado_por: USER_ID, aprovado_em: '2026-07-01T00:00:00Z',
    };
    const r = await salvarTextoAction({ chave: CHAVE_SIT, texto: TEXTO });
    expect(r.ok).toBe(true);
    expect(h.updates[0].valores).toMatchObject({
      texto: TEXTO, status: 'rascunho', aprovado_por: null, aprovado_em: null,
    });
  });

  it('texto vazio é recusado', async () => {
    for (const vazio of ['', '   ', '\n']) {
      const r = await salvarTextoAction({ chave: CHAVE_SIT, texto: vazio });
      expect(r.ok).toBe(false);
    }
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('chave inválida é recusada', async () => {
    const r = await salvarTextoAction({ chave: 'MAIUSCULA:x', texto: TEXTO });
    expect(r.ok).toBe(false);
  });

  it('a auditoria registra a edição', async () => {
    await salvarTextoAction({ chave: CHAVE_SIT, texto: TEXTO });
    expect(h.auditorias.some((a) => a.acao === 'explicacao.salvar_rascunho')).toBe(true);
  });
});

describe('aprovarExplicacaoAction', () => {
  const BOM = 'Você paga {inss} de INSS e {iss} de ISS por mês.';

  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: BOM });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
  });

  // ═══ A REGRA QUE MAIS IMPORTA DA TASK 9 ═══
  // Sem ela, "{icms}" apareceria cru na tela do contribuinte — ou, com a falha
  // fechada de `renderizar`, a explicação sumiria inteira e ninguém saberia por
  // quê. Validar no ato da ESCOLHA, não no envio.
  it('recusa aprovar texto com marcador que a situação não fornece', async () => {
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: 'tem {icms}' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/icms/i);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('aprova quando os marcadores cabem na situação', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'velho' };
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: BOM });
    expect(r.ok).toBe(true);
    expect(h.updates[0].valores).toMatchObject({
      texto: BOM, status: 'aprovado', aprovado_por: USER_ID,
    });
    expect(h.updates[0].valores.aprovado_em).toBeTruthy();
  });

  it('texto sem marcador nenhum é aprovável', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'v' };
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: 'O MEI paga um valor fixo por mês.' });
    expect(r.ok).toBe(true);
  });

  // Usar só parte dos marcadores é legítimo: um texto pode explicar bem sem
  // citar todos os componentes. `renderizar` aceita valor sobrando.
  it('usar só parte dos marcadores permitidos é aprovável', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'v' };
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: 'São {inss} de INSS.' });
    expect(r.ok).toBe(true);
  });

  it('aprova o texto escrito à mão numa situação sem linha (o caminho manual)', async () => {
    h.estado.linhaCatalogo = null;
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: BOM });
    expect(r.ok).toBe(true);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].valores).toMatchObject({ chave: CHAVE_SIT, status: 'aprovado' });
  });

  it('situação desconhecida não é aprovável', async () => {
    const r = await aprovarExplicacaoAction({ chave: 'irpf:algo', texto: 'texto' });
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('texto vazio é recusado', async () => {
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: '  ' });
    expect(r.ok).toBe(false);
  });

  it('a auditoria registra quem aprovou e o quê', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'v' };
    await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: BOM });
    const ev = h.auditorias.find((a) => a.acao === 'explicacao.aprovar');
    expect(ev).toBeTruthy();
    expect(ev?.meta?.chave).toBe(CHAVE_SIT);
  });

  it('erro de escrita não vira sucesso', async () => {
    h.estado.linhaCatalogo = { id: 'exp_1', chave: CHAVE_SIT, status: 'rascunho', texto: 'v' };
    h.estado.erroEscrita = { message: 'boom' };
    const r = await aprovarExplicacaoAction({ chave: CHAVE_SIT, texto: BOM });
    expect(r.ok).toBe(false);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
