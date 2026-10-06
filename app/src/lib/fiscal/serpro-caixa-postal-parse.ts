// Parser puro das respostas da Caixa Postal do e-CAC (Integra-CaixaPostal).
// Sem rede, sem banco.
//
// ⚠️ MODELADO PELA DOC (06/10/2026), não por um envelope real: nenhuma chamada
// de produção a CAIXAPOSTAL tinha sido feita até aqui. Por isso o parser é
// TOLERANTE à forma: o `dados` vem como STRING JSON ou objeto, e os campos podem
// vir direto nele ou dentro de `conteudo[0]` (é como o MSGDETALHAMENTO62 está
// documentado). Ajustar quando a primeira resposta real chegar.
//
// Serviços:
//   INNOVAMSG63        — indicador de mensagens novas (0 nenhuma, 1 uma, 2 várias)
//   MSGCONTRIBUINTE61  — lista de mensagens (assunto, origem, data) — NÃO dá ciência
//   MSGDETALHAMENTO62  — detalhe da mensagem — DÁ CIÊNCIA (Decreto 70.235/72, art. 23)

export type MensagemResumo = {
  isn: string;
  numeroControle: string | null;
  assunto: string;
  origem: string | null;
  relevante: boolean;
  /** YYYY-MM-DD */
  dataEnvio: string | null;
  lidaNaReceita: boolean;
  /** YYYY-MM-DD */
  dataCiencia: string | null;
};

export type ListaMensagens = {
  mensagens: MensagemResumo[];
  ultimaPagina: boolean;
  /** Para pedir a próxima página (`ponteiroPagina` + `indicadorPagina: 1`). */
  proximoPonteiro: string | null;
};

export type MensagemDetalhe = MensagemResumo & {
  /** Corpo já com as variáveis substituídas, em TEXTO (sem HTML). */
  corpo: string;
};

type Obj = Record<string, unknown>;

/** `dados` do envelope como objeto; o primeiro item de `conteudo` quando vier embrulhado. */
function lerDados(envelope: unknown): Obj {
  const env = (envelope ?? {}) as { dados?: unknown };
  let dados: unknown = env.dados;
  if (typeof dados === 'string') {
    if (!dados.trim()) return {};
    try { dados = JSON.parse(dados); } catch { throw new Error('Resposta da Caixa Postal em formato inesperado.'); }
  }
  return (dados && typeof dados === 'object' ? dados : {}) as Obj;
}

/** Os campos podem vir direto em `dados` ou em `dados.conteudo[0]`. */
function nivelUtil(d: Obj, campo: string): Obj {
  if (campo in d) return d;
  const c = d.conteudo;
  if (Array.isArray(c) && c[0] && typeof c[0] === 'object' && campo in (c[0] as Obj)) return c[0] as Obj;
  return d;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** 20261005 / "20261005" → "2026-10-05". Zero e vazio viram null. */
export function dataDaReceita(v: unknown): string | null {
  const s = String(v ?? '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(s) || s === '00000000') return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Assunto com o parâmetro no lugar de `++VARIAVEL++`. */
export function montarAssunto(modelo: unknown, parametro: unknown): string {
  const m = String(modelo ?? '').trim();
  const p = String(parametro ?? '').trim();
  return (m.replace(/\+\+VARIAVEL\+\+/gi, p).trim() || 'Mensagem da Receita Federal');
}

/** Corpo com `++1++`, `++2++`… trocados pelas `variaveis`, na ordem. */
export function montarCorpo(modelo: unknown, variaveis: unknown): string {
  const vs = Array.isArray(variaveis) ? variaveis.map((v) => String(v ?? '')) : [];
  return String(modelo ?? '').replace(/\+\+(\d+)\+\+/g, (_, n: string) => vs[Number(n) - 1] ?? '');
}

/**
 * HTML do corpo → texto. O corpo vem da Receita, mas é conteúdo de FORA: a
 * Balu nunca o renderiza como HTML. Quebras de bloco viram linha nova e as
 * entidades mais comuns são decodificadas.
 */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resumoDe(m: Obj): MensagemResumo | null {
  const isn = texto(m.isn);
  if (!isn) return null;
  return {
    isn,
    numeroControle: texto(m.numeroControle),
    assunto: montarAssunto(m.assuntoModelo, m.valorParametroAssunto),
    origem: texto(m.descricaoOrigem),
    relevante: String(m.relevancia ?? '') === '2',
    dataEnvio: dataDaReceita(m.dataEnvio),
    // indicadorLeitura na lista; no detalhe, existir dataLeitura é a prova.
    lidaNaReceita: String(m.indicadorLeitura ?? '') === '1' || dataDaReceita(m.dataLeitura) !== null,
    dataCiencia: dataDaReceita(m.dataCiencia),
  };
}

/** INNOVAMSG63: 0 = nenhuma nova, 1 = uma, 2 = várias. `null` se não veio. */
export function parseIndicador(envelope: unknown): 0 | 1 | 2 | null {
  const d = nivelUtil(lerDados(envelope), 'indicadorMensagensNovas');
  const v = String(d.indicadorMensagensNovas ?? '').trim();
  return v === '0' || v === '1' || v === '2' ? (Number(v) as 0 | 1 | 2) : null;
}

/** MSGCONTRIBUINTE61. */
export function parseListaMensagens(envelope: unknown): ListaMensagens {
  const d = nivelUtil(lerDados(envelope), 'listaMensagens');
  const lista = Array.isArray(d.listaMensagens) ? (d.listaMensagens as Obj[]) : [];
  const mensagens = lista.map(resumoDe).filter((m): m is MensagemResumo => m !== null);
  // Sem o indicador, assume-se ÚLTIMA página: pedir "a próxima" sem ponteiro
  // repetiria a primeira para sempre.
  const ultima = d.indicadorUltimaPagina === undefined ? true : String(d.indicadorUltimaPagina).toUpperCase() !== 'N'
    && String(d.indicadorUltimaPagina) !== '0';
  return { mensagens, ultimaPagina: ultima, proximoPonteiro: ultima ? null : texto(d.ponteiroProximaPagina) };
}

/** MSGDETALHAMENTO62. `null` quando não veio mensagem nenhuma. */
export function parseDetalhe(envelope: unknown): MensagemDetalhe | null {
  const d = nivelUtil(lerDados(envelope), 'isn');
  const resumo = resumoDe(d);
  if (!resumo) return null;
  return { ...resumo, corpo: htmlParaTexto(montarCorpo(d.corpoModelo, d.variaveis)) };
}
