// Leitura da resposta do modelo no atendimento — com desconfiança calibrada.
//
// Nasceu de um caso real (12/08/2026): o modelo devolveu a resposta CERTA,
// com valor e data corretos, e escreveu a chave como `"resovido"` — sem o
// "l". A validação exigia `resolvido` booleano, não encontrou, jogou a
// resposta boa no lixo e mandou ao cliente "não consegui responder agora".
//
// A régua aqui não é "aceitar qualquer coisa". É:
//
//   • o TEXTO da resposta é obrigatório e não se adivinha;
//   • o SINAL de resolvido é acessório — e a falta dele resolve para `false`,
//     que é o lado seguro: o cliente recebe a resposta E o contador é
//     acionado. O contrário (assumir `true`) fecharia um atendimento que
//     ninguém garantiu.
//
// Modelo que erra o nome de um campo hoje pode inventar outra coisa amanhã;
// por isso a tolerância cobre variação de grafia, nunca ausência de conteúdo.

export type RespostaAtendimento = { resposta: string; resolvido: boolean };

/** Tira cerca markdown (```json … ```), que vários modelos põem mesmo proibidos. */
function semCerca(bruto: string): string {
  return bruto.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? bruto;
}

const chaveNormalizada = (k: string): string =>
  k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

/** Distância de edição pequena — só para pegar erro de digitação de 1 letra. */
function pertoDe(a: string, alvo: string): boolean {
  if (a === alvo) return true;
  if (Math.abs(a.length - alvo.length) > 1) return false;
  // Uma remoção, uma inserção ou uma troca.
  for (let i = 0; i < Math.max(a.length, alvo.length); i++) {
    if (a[i] === alvo[i]) continue;
    return (
      a.slice(i + 1) === alvo.slice(i + 1) ||   // troca
      a.slice(i) === alvo.slice(i + 1) ||       // faltou letra em `a`
      a.slice(i + 1) === alvo.slice(i)          // sobrou letra em `a`
    );
  }
  return true;
}

function acharChave(o: Record<string, unknown>, alvo: string, sinonimos: string[]): unknown {
  for (const [k, v] of Object.entries(o)) {
    const n = chaveNormalizada(k);
    if (n === alvo || sinonimos.includes(n) || pertoDe(n, alvo)) return v;
  }
  return undefined;
}

export function lerRespostaAtendimento(bruto: string): RespostaAtendimento | null {
  const limpo = semCerca(String(bruto ?? '')).trim();
  if (!limpo) return null;

  let j: unknown = null;
  let parseou = true;
  try { j = JSON.parse(limpo); } catch { parseou = false; }

  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = j as Record<string, unknown>;
    const texto = acharChave(o, 'resposta', ['mensagem', 'answer', 'reply', 'text']);
    if (typeof texto === 'string' && texto.trim()) {
      const sinal = acharChave(o, 'resolvido', ['resolved', 'solucionado', 'finalizado']);
      // Só `true` de verdade fecha o atendimento. String "true" também vale —
      // modelo às vezes devolve booleano como texto —, e qualquer outra coisa
      // (inclusive ausência) cai no lado seguro.
      const resolvido = sinal === true || (typeof sinal === 'string' && sinal.trim().toLowerCase() === 'true');
      return { resposta: texto.trim(), resolvido };
    }
  }

  // ═══ SALVAMENTO DE TEXTO CORRIDO (19/08/2026) ═══
  //
  // O modelo às vezes ignora o formato e responde em prosa — a explicação
  // CERTA, sem as chaves. Até aqui isso virava `null`, e o cliente recebia
  // "não consegui responder agora" com a resposta boa no lixo. É a mesma
  // classe do caso `"resovido"` que originou este arquivo, um passo adiante:
  // o que não se adivinha é o CONTEÚDO; a embalagem, sim.
  //
  // JSON malformado NÃO entra aqui: mandar chave e chave-de-fechamento ao
  // cliente seria pior que o fallback. Tentamos extrair a chave `resposta` de
  // um JSON truncado e, falhando, desistimos.
  if (parseou) {
    // Uma string JSON pura ("O ICMS é ...") é resposta utilizável: o modelo
    // acertou o conteúdo e errou só o envelope.
    if (typeof j === 'string' && j.trim()) return { resposta: j.trim(), resolvido: false };
    // JSON VÁLIDO sem resposta dentro — `null`, `[]`, um número. Não há texto a
    // entregar, e mandar a palavra "null" ao cliente seria pior que o fallback.
    return null;
  }

  if (/^[[{]/.test(limpo)) {
    const resgatado = limpo.match(/"respo?s?t?a?"\s*:\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
    if (resgatado?.trim()) {
      return { resposta: resgatado.replace(/\\"/g, '"').replace(/\\n/g, '\n').trim(), resolvido: false };
    }
    return null;
  }

  // Prosa limpa: entrega ao cliente e mantém `resolvido:false`, que aciona o
  // contador quando existe um. Responder E escalar é o lado seguro; calar não é.
  return { resposta: limpo, resolvido: false };
}
