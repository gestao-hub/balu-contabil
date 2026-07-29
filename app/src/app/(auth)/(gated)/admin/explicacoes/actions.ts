'use server';
// Bloco 6A — o catálogo de explicações (AdminBalu).
//
// Este arquivo é o único lugar do sistema que fala com a IA para PRODUZIR
// conteúdo. E o que ele produz é RASCUNHO: nenhum texto daqui chega a um cliente
// sem alguém ter lido e aprovado (§5.6 da spec, e DL 9.295/46 — quem explica
// tributo assina embaixo).
//
// A IA ESTÁ FORA DO CAMINHO DA REQUISIÇÃO DO CLIENTE. Ela é chamada aqui, por um
// admin, uma vez por SITUAÇÃO fiscal — não por cliente, não por competência.
// Provedor fora do ar não tira explicação nenhuma do ar.
//
// Nada de puro mora aqui: `'use server'` só pode exportar função async. O prompt
// está em `@/lib/explicacoes/prompt`, a regra de marcadores em
// `@/lib/explicacoes/marcadores` e o schema da fronteira em `@/types/zod`.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { lerChaveIa } from '@/lib/ai/config-ia';
import { gerarTexto } from '@/lib/ai/cliente';
import type { Provedor } from '@/lib/ai/provedores';
import { situacaoDaChave } from '@/lib/fiscal/situacao-fiscal';
import { montarPrompt } from '@/lib/explicacoes/prompt';
import { marcadoresDaChave } from '@/lib/explicacoes/marcadores';
import { marcadoresDe } from '@/lib/explicacoes/renderizar';
import { ChaveExplicacaoSchema, ExplicacaoTextoSchema } from '@/types/zod';

type ResultadoGeracao =
  | { ok: true; marcadoresIntrusos: string[] }
  | { ok: false; error: string };

type ActionResult = { ok: true } | { ok: false; error: string };

const ROTA = '/admin/explicacoes';

/**
 * A fronteira de `salvarTextoAction` e `aprovarExplicacaoAction`: forma da
 * chave, texto não vazio e — o que o schema não tem como julgar — a situação
 * existir de verdade. Aprovar contra uma situação que ninguém sabe descrever
 * seria aprovar no escuro.
 */
function lerEntradaDeTexto(
  entrada: unknown,
): { chave: string; texto: string; versao: string | null } | { error: string } {
  const p = ExplicacaoTextoSchema.safeParse(entrada);
  if (!p.success) return { error: p.error.errors[0]?.message ?? 'Dados inválidos.' };
  if (!situacaoDaChave(p.data.chave)) return { error: 'Situação fiscal desconhecida.' };
  return { chave: p.data.chave, texto: p.data.texto, versao: p.data.versao ?? null };
}

/** Mensagem única da trava otimista. Ela aparece nos três escritores, e uma
 *  cópia divergente faria o admin achar que são problemas diferentes. */
const MUDOU_NO_MEIO =
  'Esta explicação mudou desde que a tela carregou (outro admin salvou, aprovou ou gerou). Nada foi sobrescrito — recarregue a página e refaça.';

/**
 * A gravação que salvar e aprovar compartilham. Uma função só porque a diferença
 * entre as duas é o carimbo — duplicar isso faria uma delas esquecer de limpar
 * `aprovado_por` no dia em que a regra mudasse.
 *
 * `gerado_por` NÃO entra no patch de propósito: editar um rascunho de IA não
 * apaga o fato de que a IA o redigiu. O rastro de origem continua verdadeiro, e
 * quem aprovou está em `aprovado_por`.
 */
async function gravarTexto(
  p: { chave: string; texto: string; versao: string | null; actorUserId: string; aprovando: boolean },
): Promise<ActionResult> {
  const sb = createAdminClient();
  const agora = new Date().toISOString();

  const { data: atual, error: eLer } = await sb
    .from('explicacoes_fiscais').select('id, status, updated_at').eq('chave', p.chave).maybeSingle();
  if (eLer) {
    console.error('[6a] catalogo leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler o catálogo. Tente de novo.' };
  }

  const linha = {
    texto: p.texto,
    status: p.aprovando ? 'aprovado' : 'rascunho',
    // Editar derruba a aprovação: sem limpar o carimbo, "aprovado por fulano"
    // passaria a valer para um texto que fulano nunca leu.
    aprovado_por: p.aprovando ? p.actorUserId : null,
    aprovado_em: p.aprovando ? agora : null,
    updated_at: agora,
  };

  if (atual) {
    // ⚠️ TRAVA OTIMISTA. Sem ela, salvar e aprovar eram last-write-wins: o admin
    // com a tela de 30 segundos atrás sobrescrevia o rascunho que o outro
    // acabara de gerar — sem erro, sem sinal, e com `gerado_por` continuando a
    // apontar o modelo, ou seja, o catálogo afirmando que uma IA escreveu um
    // texto que ela nunca escreveu.
    //
    // `updated_at` é a coluna certa porque o gatilho `tg_set_updated_at` a move
    // em TODA escrita — inclusive nas que não a mencionam no payload. Provado
    // contra o PostgREST: ele devolve microssegundos e o filtro `eq` casa
    // exatamente o valor lido (uma versão anterior desta correção, com
    // `.eq('status','rascunho')`, deixava passar a escrita concorrente que não
    // mudava o status).
    if (!p.versao) {
      return {
        ok: false,
        error: 'Esta situação já tem texto no catálogo. Recarregue a página antes de salvar.',
      };
    }
    const { data, error } = await sb
      .from('explicacoes_fiscais').update(linha)
      .eq('chave', p.chave)
      .eq('updated_at', p.versao)
      .select('id');
    if (error) {
      console.error('[6a] catalogo update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) return { ok: false, error: MUDOU_NO_MEIO };
  } else {
    // Situação sem linha: o admin escreveu o texto à mão. É o caminho normal
    // enquanto não houver provedor de IA configurado.
    const { error } = await sb
      .from('explicacoes_fiscais').insert({ chave: p.chave, gerado_por: null, ...linha });
    if (error) {
      console.error('[6a] catalogo insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
  }

  await registrarAuditoria({
    actorUserId: p.actorUserId,
    acao: p.aprovando ? 'explicacao.aprovar' : 'explicacao.salvar_rascunho',
    alvoTipo: 'explicacao_fiscal', alvoId: atual?.id ?? null,
    meta: {
      chave: p.chave, tamanho: p.texto.length,
      // Registrar que a aprovação caiu é o que permite auditar "por que este
      // texto sumiu da tela do cliente" seis meses depois.
      derrubou_aprovacao: !p.aprovando && atual?.status === 'aprovado',
    },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

export async function gerarRascunhoAction(chaveBruta: unknown): Promise<ResultadoGeracao> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  // FORMA, e depois SIGNIFICADO. As duas antes de qualquer rede: crédito de IA é
  // dinheiro, e uma chave que não descreve situação nenhuma faria o modelo
  // redigir sobre um tributo inventado — com aparência de legítimo no catálogo.
  const parsed = ChaveExplicacaoSchema.safeParse(chaveBruta);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Chave inválida.' };
  }
  const chave = parsed.data;

  const situacao = situacaoDaChave(chave);
  if (!situacao) {
    return { ok: false, error: 'Situação fiscal desconhecida. Nada foi gerado.' };
  }

  const sb = createAdminClient();

  // A LINHA ATUAL VEM PRIMEIRO, e a recusa de sobrescrever aprovado é decidida
  // ANTES de chamar a IA. Gastar a chamada para depois descobrir que não pode
  // gravar seria pagar por um texto que vai para o lixo.
  const { data: atual, error: eLer } = await sb
    .from('explicacoes_fiscais')
    .select('id, status, updated_at')
    .eq('chave', chave)
    .maybeSingle();
  if (eLer) {
    console.error('[6a] catalogo leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler o catálogo. Tente de novo.' };
  }

  // ═══ GERAR NUNCA SOBRESCREVE APROVADO ═══
  // Um clique acidental apagaria texto que um humano leu, revisou e carimbou.
  // Para regerar, o caminho é derrubar a aprovação de propósito (Task 9) — um
  // ato explícito, registrado, e não efeito colateral de outro botão.
  if (atual?.status === 'aprovado') {
    return {
      ok: false,
      error: 'Esta situação já tem texto aprovado. Edite-o para derrubar a aprovação antes de gerar outro.',
    };
  }

  const { data: cfg, error: eCfg } = await sb
    .from('config_ia')
    .select('provedor, modelo, base_url, chave_cifrada')
    .eq('id', 1)
    .maybeSingle();
  if (eCfg) {
    console.error('[6a] config_ia leitura falhou:', eCfg.message);
    return { ok: false, error: 'Não foi possível ler a configuração do provedor.' };
  }
  if (!cfg?.provedor || !cfg?.modelo) {
    return { ok: false, error: 'Configure o provedor de IA antes de gerar rascunho.' };
  }

  // `lerChaveIa` LANÇA em gravação corrompida — `try` próprio, um caso por vez.
  let chaveIa: string | null;
  try {
    chaveIa = lerChaveIa(cfg.chave_cifrada);
  } catch {
    return { ok: false, error: 'A chave do provedor está corrompida. Salve a chave de novo.' };
  }
  if (!chaveIa) {
    return { ok: false, error: 'Nenhuma chave de IA gravada. Configure o provedor antes de gerar.' };
  }

  const geradoPor = `${cfg.provedor}/${cfg.modelo}`;

  let texto: string;
  try {
    // O prompt é DERIVADO DA SITUAÇÃO, e `montarPrompt` só aceita
    // `SituacaoFiscal` — tipo que não tem como carregar dado de contribuinte.
    texto = await gerarTexto(
      {
        provedor: cfg.provedor as Provedor,
        modelo: cfg.modelo,
        base_url: cfg.base_url,
        chave: chaveIa,
      },
      montarPrompt(situacao),
    );
  } catch (e) {
    const bruto = e instanceof Error ? e.message : String(e);
    // Rede de baixo: `cliente.ts` já limpa a chave da mensagem do provedor, mas
    // o erro pode vir de qualquer outro lugar.
    return { ok: false, error: bruto.split(chaveIa).join('***').slice(0, 300) };
  }

  // O rascunho é gravado mesmo com marcador intruso — é rascunho, e o admin
  // corrige numa linha. Mas a action AVISA: sem isso ele só descobriria no
  // momento em que a aprovação recusa, depois de ter lido o texto inteiro.
  const permitidos = new Set(marcadoresDaChave(chave));
  const marcadoresIntrusos = marcadoresDe(texto).filter((m) => !permitidos.has(m));

  const linha = {
    texto,
    status: 'rascunho' as const,
    gerado_por: geradoPor,
    // Gerar rascunho novo apaga o carimbo antigo: um texto que ninguém aprovou
    // não pode continuar mostrando quem aprovou o anterior.
    aprovado_por: null,
    aprovado_em: null,
    updated_at: new Date().toISOString(),
  };

  if (atual) {
    // `update`, nunca `upsert`: o upsert do PostgREST manda NULL nas colunas
    // ausentes do payload — regra do repo, e o que quase apagou a chave do
    // provedor na Task 7. O `.select('id')` distingue "gravou" de "não achou".
    //
    // ⚠️ COMPARE-AND-SWAP na VERSÃO, não no status. A leitura que autorizou esta
    // escrita aconteceu ANTES da chamada de IA, que leva segundos, e a tabela
    // tem TRÊS escritores (gerar, salvar, aprovar).
    //
    // A primeira versão desta trava usava `.eq('status','rascunho')` e cobria só
    // metade da corrida: um `salvarTextoAction` concorrente deixa o status em
    // 'rascunho', então o CAS passava e o rascunho da IA sobrescrevia a edição
    // manual do outro admin — exatamente o lost update que a mensagem de erro
    // dizia estar impedindo. `updated_at` muda em toda escrita (o gatilho
    // garante), então cobre as três.
    const { data, error } = await sb
      .from('explicacoes_fiscais').update(linha)
      .eq('chave', chave)
      .eq('updated_at', atual.updated_at)
      .select('id');
    if (error) {
      console.error('[6a] catalogo update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar o rascunho. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) return { ok: false, error: MUDOU_NO_MEIO };
  } else {
    const { error } = await sb.from('explicacoes_fiscais').insert({ chave, ...linha });
    if (error) {
      console.error('[6a] catalogo insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar o rascunho. Tente de novo.' };
    }
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'ia.gerar_rascunho',
    alvoTipo: 'explicacao_fiscal', alvoId: atual?.id ?? null,
    // Nunca a chave do provedor. `gerado_por` é rastro de origem, não segredo.
    meta: {
      chave, gerado_por: geradoPor, tamanho: texto.length,
      marcadores_intrusos: marcadoresIntrusos,
      substituiu_rascunho: Boolean(atual),
    },
  });

  revalidatePath(ROTA);
  return { ok: true, marcadoresIntrusos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 9 — revisar e aprovar.
//
// ⚠️ O CAMINHO MANUAL NÃO É SECUNDÁRIO. Sem chave de IA configurada, escrever o
// texto à mão e aprovar é o ÚNICO caminho que funciona — e é o estado do projeto
// hoje. Por isso salvar e aprovar CRIAM a linha quando ela não existe, em vez de
// exigirem um rascunho gerado antes.

/**
 * Salva o texto como RASCUNHO. Editar é sempre editar um rascunho: se o texto
 * estava aprovado, a aprovação cai junto (§5.6 da spec).
 *
 * Sem isso, "aprovado" deixaria de significar "um humano leu ISTO" e passaria a
 * significar "um humano leu alguma versão disto" — que é o mesmo que nada.
 */
export async function salvarTextoAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const dados = lerEntradaDeTexto(entrada);
  if ('error' in dados) return { ok: false, error: dados.error };

  return gravarTexto({
    chave: dados.chave, texto: dados.texto, versao: dados.versao,
    actorUserId: ctx.userId, aprovando: false,
  });
}

/**
 * Aprova o texto — o carimbo humano que a spec exige antes de qualquer cliente
 * ver explicação sobre tributo (DL 9.295/46).
 *
 * RECUSA texto com marcador que a situação não fornece. Sem esta trava,
 * `{icms}` numa situação de serviços chegaria à tela: ou cru, ou — com a falha
 * fechada de `renderizar` — fazendo a explicação inteira sumir sem ninguém
 * entender por quê. A validação é no ato da ESCOLHA, não no envio.
 */
export async function aprovarExplicacaoAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const dados = lerEntradaDeTexto(entrada);
  if ('error' in dados) return { ok: false, error: dados.error };

  const permitidos = new Set(marcadoresDaChave(dados.chave));
  const intrusos = marcadoresDe(dados.texto).filter((m) => !permitidos.has(m));
  if (intrusos.length) {
    const lista = intrusos.map((m) => `{${m}}`).join(', ');
    const ok = permitidos.size ? [...permitidos].map((m) => `{${m}}`).join(', ') : 'nenhum';
    return {
      ok: false,
      error: `Esta situação não fornece ${lista}. Marcadores disponíveis: ${ok}.`,
    };
  }

  return gravarTexto({
    chave: dados.chave, texto: dados.texto, versao: dados.versao,
    actorUserId: ctx.userId, aprovando: true,
  });
}
