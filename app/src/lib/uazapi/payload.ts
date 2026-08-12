// Normalização do payload de ENTRADA da uazapi.
//
// Por que existe: até 12/08/2026 o webhook trabalhava com uma hipótese
// (`{ messageId, from, text }`) tirada de documentação pública — o próprio
// código avisava isso em maiúsculas. O teste ao vivo provou que a hipótese
// está errada: a mensagem chega na instância, e o webhook não produz nem
// linha de auditoria, porque os campos vêm `undefined` e o insert morre.
//
// O que sabemos do formato REAL (lido de `POST /message/find` da instância):
//
//   { id: "553291511415:A5E0…", messageid: "3EB0…",
//     chatid: "553287006789@s.whatsapp.net",
//     sender: "553287006789@s.whatsapp.net",
//     content: { text: "Boa tarde…" }, text: "Boa tarde…",
//     fromMe: false, messageTimestamp: 1786… }
//
// O envelope do webhook pode embrulhar isso (`{ event, message }`,
// `{ EventType, data }`…), e a documentação é um SPA que não expõe contrato.
// Em vez de apostar de novo numa forma só, este módulo procura a mensagem nos
// lugares plausíveis e extrai os três campos que importam.
//
// Princípio: aceitar formas conhecidas, RECUSAR o que não entende — e deixar
// quem chama registrar a forma desconhecida para virar código depois.

export type EntradaWhatsapp = {
  messageId: string;
  from: string;      // só dígitos, sem sufixo de JID
  text: string;
  fromMe: boolean;
};

/**
 * Telefone a partir de um JID — e SÓ quando o JID é de telefone.
 *
 * ⚠️ O WhatsApp passou a usar **LID** (Linked ID): um identificador opaco no
 * formato `38105654493205@lid`, que NÃO é número de telefone. Visto ao vivo em
 * 12/08/2026:
 *
 *     chatid: "553287006789@s.whatsapp.net"   ← telefone real
 *     sender: "38105654493205@lid"            ← LID
 *
 * Tratar LID como telefone tem consequência concreta: o app não acha o
 * cadastro, responde "não conseguimos identificar sua conta" — e manda essa
 * resposta PARA O LID, que não chega a ninguém. Foi exatamente o que
 * aconteceu antes desta função existir.
 *
 * `@g.us` (grupo) e `@broadcast` também são recusados: não atendemos grupo, e
 * confundir o id do grupo com o do cliente responderia a conversa errada.
 */
function telefoneDeJid(bruto: unknown): string {
  if (typeof bruto !== 'string' || !bruto) return '';
  const [parte, sufixo] = bruto.split('@');
  if (sufixo && sufixo !== 's.whatsapp.net' && sufixo !== 'c.us') return '';
  const d = parte.replace(/\D+/g, '');
  // Telefone internacional tem de 10 a 15 dígitos (E.164). O LID visto tinha
  // 14 e passaria por um teste de tamanho frouxo — por isso a barreira real é
  // o sufixo, e o tamanho só descarta lixo evidente.
  return d.length >= 10 && d.length <= 15 ? d : '';
}

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Procura o objeto de mensagem no corpo, direto ou embrulhado. */
function acharMensagem(corpo: unknown): Record<string, unknown> | null {
  const o = comoObjeto(corpo);
  if (!o) return null;

  // Já é a mensagem?
  if (o.chatid || o.messageid || o.messageId || o.from) return o;

  // Envelopes vistos em APIs desse tipo, em ordem de probabilidade.
  for (const chave of ['message', 'data', 'payload', 'body']) {
    const dentro = comoObjeto(o[chave]);
    if (dentro && (dentro.chatid || dentro.messageid || dentro.messageId || dentro.from)) return dentro;
    // `data: [ { … } ]`
    const lista = Array.isArray(o[chave]) ? (o[chave] as unknown[])[0] : null;
    const primeiro = comoObjeto(lista);
    if (primeiro && (primeiro.chatid || primeiro.messageid || primeiro.messageId)) return primeiro;
  }
  return null;
}

function extrairTexto(m: Record<string, unknown>): string {
  if (typeof m.text === 'string' && m.text.trim()) return m.text;
  const c = comoObjeto(m.content);
  if (c) {
    if (typeof c.text === 'string' && c.text.trim()) return c.text;
    // Legenda de mídia: tratar como texto é melhor que ignorar a mensagem.
    if (typeof c.caption === 'string' && c.caption.trim()) return c.caption;
  }
  if (typeof m.body === 'string' && m.body.trim()) return m.body;
  return '';
}

export function normalizarEntrada(corpo: unknown): EntradaWhatsapp | null {
  const m = acharMensagem(corpo);
  if (!m) return null;

  const messageId = String(m.messageid ?? m.messageId ?? m.id ?? '').trim();
  // ORDEM IMPORTA: `chatid` primeiro. É a conversa — o telefone do cliente.
  // `sender` vem depois porque pode ser LID; e só entra se for JID de
  // telefone. `from` fecha a lista pela forma antiga.
  const from = telefoneDeJid(m.chatid) || telefoneDeJid(m.sender) || telefoneDeJid(m.from);
  const text = extrairTexto(m);
  // `fromMe` ausente conta como recebida: o filtro de eco tem outra camada
  // (`excludeMessages: wasSentByApi` na própria uazapi), e tratar ausência
  // como "enviada por mim" descartaria mensagem legítima de cliente.
  const fromMe = m.fromMe === true;

  if (!messageId || !from || !text) return null;
  return { messageId, from, text, fromMe };
}

/**
 * Descrição da FORMA do payload — chaves e tipos, nunca conteúdo.
 *
 * Serve para registrar um formato desconhecido sem colocar conversa de
 * cliente em log ou em tabela de auditoria.
 */
export function formaDoPayload(v: unknown, prof = 0): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : [formaDoPayload(v[0], prof + 1)];
  if (typeof v === 'object') {
    if (prof > 3) return '{…}';
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, formaDoPayload(x, prof + 1)]),
    );
  }
  if (typeof v === 'string') return `string(${v.length})`;
  return typeof v;
}
