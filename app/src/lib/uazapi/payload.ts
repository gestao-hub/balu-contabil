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

const soDigitos = (s: string): string => String(s).split('@')[0].replace(/\D+/g, '');

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
  const from = soDigitos(String(m.sender ?? m.chatid ?? m.from ?? ''));
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
