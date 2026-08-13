// Tradutor de erros da SERPRO (Integra Contador) para português humano — PR 4.2.
// Puro, sem deps. Irmão de `focus-erro.ts`, que faz o mesmo pela Focus NFe.
//
// O PROBLEMA QUE ISTO RESOLVE: os wrappers (`serpro-das-simples`, `serpro-pgdasd`,
// …) hoje devolvem o envelope HTTP cru cortado no meio, e o cliente lê coisas como
//
//   Falha na declaração (SERPRO): SERPRO /Declarar → 400: {"status":"400","mensagens":[{"codigo":"[Aviso-PGDASD-MSG_E0139]","texto":"Não foi gerado DAS…
//
// A informação útil está lá dentro — e já em português, escrita pela Receita.
// O trabalho aqui é quase todo de EXTRAÇÃO, não de tradução.
//
// REGRA DELIBERADA: só existe mapa para código cujo significado está DOCUMENTADO
// (docs/investigations/DASN-SIMEI.md) ou que é condição de transporte (401, 502,
// timeout). Para código desconhecido devolvemos o `texto` da própria SERPRO com o
// código ao lado — nunca um chute. Inventar o significado de um código fiscal é
// pior do que mostrar o texto oficial: manda o contribuinte agir por uma razão
// que ninguém verificou.

export type MensagemSerpro = { codigo: string; texto: string };

/**
 * Puxa o array `mensagens` de dentro de um erro cru da SERPRO.
 *
 * Aceita tanto a string de erro que os clients montam
 * (`SERPRO /Declarar → 400: {…}`) quanto o JSON solto, porque os dois formatos
 * circulam: o primeiro vem de `throw new Error`, o segundo de resposta 200 com
 * aviso no envelope.
 */
export function extrairMensagensSerpro(raw: string): MensagemSerpro[] {
  // O JSON começa na primeira chave; tudo antes é o prefixo do transporte.
  const inicio = raw.indexOf('{');
  if (inicio < 0) return [];

  // A string pode vir CORTADA (os wrappers faziam slice(0,160)), então um
  // JSON.parse do todo falha. Tentamos o todo e, se não der, garimpamos os
  // pares codigo/texto por regex — degradar para "achei uma mensagem" é melhor
  // que degradar para "não achei nada".
  const corpo = raw.slice(inicio);
  try {
    const env = JSON.parse(corpo) as { mensagens?: unknown };
    if (Array.isArray(env.mensagens)) {
      return env.mensagens
        .map((m) => {
          const o = (m ?? {}) as { codigo?: unknown; texto?: unknown };
          return {
            codigo: typeof o.codigo === 'string' ? o.codigo : '',
            texto: typeof o.texto === 'string' ? o.texto : '',
          };
        })
        .filter((m) => m.codigo || m.texto);
    }
  } catch {
    // cai no garimpo abaixo
  }

  const achados: MensagemSerpro[] = [];
  const re = /"codigo"\s*:\s*"([^"]*)"\s*,\s*"texto"\s*:\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo)) !== null) achados.push({ codigo: m[1], texto: m[2] });
  return achados;
}

/** `[Aviso-DASNSIMEI-10008]` → `AVISO-DASNSIMEI-10008` (sem colchetes, caixa alta). */
function normalizarCodigo(codigo: string): string {
  return codigo.replace(/^\[|\]$/g, '').trim().toUpperCase();
}

/**
 * Significados VERIFICADOS em docs/investigations/DASN-SIMEI.md.
 * A chave é o sufixo numérico porque o prefixo varia entre `Aviso-` e
 * `EntradaIncorreta-` para o mesmo sistema.
 */
const DASNSIMEI: Record<string, string> = {
  '10000': 'Os dados enviados para a DASN-SIMEI estão incompletos ou inválidos.',
  '10001': 'CNPJ inválido para a DASN-SIMEI.',
  '10002': 'Ano fora do período aceito pela Receita (a declaração decai depois de 6 anos).',
  '10003': 'A empresa consta como baixada neste ano-calendário.',
  '10005': 'A apuração anterior usou outra alíquota de INSS. É preciso refazer o DAS no PGMEI antes de declarar.',
  '10006': 'O DAS não foi gerado. Regularize as guias mensais no PGMEI antes de declarar.',
  '10007': 'O DAS não foi gerado. Regularize as guias mensais no PGMEI antes de declarar.',
  '10008': 'A receita bruta do ano passou do limite do MEI — o desenquadramento do SIMEI é obrigatório. Procure a contabilidade.',
  '33001': 'A empresa não consta como optante pelo SIMEI.',
  '33101': 'Não há excesso de receita para gerar DAS complementar.',
};

/**
 * Erro cru da SERPRO → uma frase que o contribuinte consegue agir em cima.
 *
 * Ordem importa: transporte primeiro (401 não é assunto do contribuinte, é
 * configuração nossa), depois código conhecido, depois o texto oficial.
 */
export function traduzirErroSerpro(raw: string): string {
  const lower = raw.toLowerCase();

  // --- Transporte / configuração: nada disso o usuário causou ou resolve ---
  if (lower.includes('consumer_key') || lower.includes('consumer_secret') || lower.includes('não configurados')) {
    return 'A integração com a SERPRO não está configurada. Avise o suporte da Balu.';
  }
  if (lower.includes('mtls') || lower.includes('certificado do contratante')) {
    return 'O certificado da Balu na SERPRO não está configurado. Avise o suporte.';
  }
  if (/→ 401|unauthorized/.test(lower)) {
    return 'A Balu perdeu a autorização na SERPRO. Avise o suporte — não é preciso fazer nada na sua empresa.';
  }
  if (/→ 403|forbidden/.test(lower)) {
    return 'A SERPRO recusou o acesso a esta empresa. Confira se a procuração eletrônica para a Balu está ativa no e-CAC.';
  }
  if (/procuraç|procurac|termo de autoriza/.test(lower)) {
    return 'A empresa ainda não autorizou a Balu na SERPRO. É preciso assinar a procuração eletrônica no e-CAC.';
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset')) {
    return 'A SERPRO demorou demais para responder. Tente de novo em alguns minutos.';
  }
  if (/→ 5\d\d/.test(lower) || lower.includes('bad gateway')) {
    return 'A SERPRO está instável agora. Tente de novo em alguns minutos — nada foi perdido.';
  }

  // --- Mensagem oficial: preferimos a Receita falando à nossa paráfrase ---
  const mensagens = extrairMensagensSerpro(raw);
  // Aviso/Sucesso não são falha; se vier junto de erro, o erro é que interessa.
  const relevante =
    mensagens.find((m) => !/sucesso/i.test(m.codigo)) ?? mensagens[0] ?? null;

  if (relevante) {
    const cod = normalizarCodigo(relevante.codigo);
    const num = cod.match(/(\d{4,6})$/)?.[1];
    if (cod.includes('DASNSIMEI') && num && DASNSIMEI[num]) return DASNSIMEI[num];

    // Código sem significado verificado: o texto oficial vale mais que um chute.
    // Mantemos o código visível porque é ele que o contador leva ao suporte da
    // Receita — sem ele, a mensagem vira um beco sem saída.
    if (relevante.texto) {
      const texto = relevante.texto.trim().slice(0, 300);
      return cod ? `${texto} (código ${cod})` : texto;
    }
    if (cod) return `A SERPRO recusou a operação (código ${cod}).`;
  }

  // --- Último recurso: limpa o envelope de transporte, não vaza JSON ---
  const limpo = raw
    .replace(/^SERPRO\s+\/?\S+\s+→\s+\d+:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return limpo ? `Erro na SERPRO: ${limpo}` : 'A SERPRO recusou a operação e não explicou o motivo.';
}
