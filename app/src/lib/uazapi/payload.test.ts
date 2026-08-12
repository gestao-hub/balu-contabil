import { describe, it, expect } from 'vitest';
import { normalizarEntrada, formaDoPayload } from './payload';

// Objeto REAL lido de POST /message/find da instância do Balu em 12/08/2026.
const mensagemReal = {
  buttonOrListid: '',
  chatid: '553287006789@s.whatsapp.net',
  content: { text: 'Boa tarde\nPreciso do das do mês de julho' },
  edited: '',
  fromMe: false,
  id: '553291511415:A5E00DEBE',
  messageTimestamp: 1786566603000,
  messageType: 'ExtendedTextMessage',
  messageid: '3EB0ABC123',
  sender: '38105654493205@lid',   // LID real capturado ao vivo em 12/08/2026
  senderName: 'Walace',
  text: 'Boa tarde\nPreciso do das do mês de julho',
};

describe('normalizarEntrada — forma real da uazapi', () => {
  it('lê a mensagem crua da instância', () => {
    expect(normalizarEntrada(mensagemReal)).toEqual({
      messageId: '3EB0ABC123',
      from: '553287006789',      // sem o sufixo @s.whatsapp.net
      text: 'Boa tarde\nPreciso do das do mês de julho',
      fromMe: false,
    });
  });

  it('lê a mesma mensagem embrulhada em envelope', () => {
    // Não sabemos qual envelope a uazapi usa no webhook — a doc é um SPA sem
    // contrato público. Aceitar os plausíveis evita outra rodada de "chega na
    // instância e o webhook não vê nada".
    for (const envelope of [
      { event: 'messages', message: mensagemReal },
      { EventType: 'messages', data: mensagemReal },
      { payload: mensagemReal },
      { data: [mensagemReal] },
    ]) {
      expect(normalizarEntrada(envelope)?.messageId).toBe('3EB0ABC123');
    }
  });

  it('aceita a forma antiga que o código supunha', () => {
    // A hipótese do Bloco 6B continua funcionando: se algum dia ela estiver
    // certa em outra versão da API, nada quebra.
    expect(normalizarEntrada({ messageId: 'm1', from: '5532987006789', text: 'oi' }))
      .toEqual({ messageId: 'm1', from: '5532987006789', text: 'oi', fromMe: false });
  });

  it('usa a legenda quando a mensagem é mídia com caption', () => {
    const m = { ...mensagemReal, text: '', content: { caption: 'segue o comprovante' } };
    expect(normalizarEntrada(m)?.text).toBe('segue o comprovante');
  });

  it('marca fromMe quando a própria instância mandou', () => {
    expect(normalizarEntrada({ ...mensagemReal, fromMe: true })?.fromMe).toBe(true);
  });
});

describe('normalizarEntrada — LID (o bug que respondeu para o vazio)', () => {
  it('usa o chatid, NUNCA o LID do sender', () => {
    // O WhatsApp entrega `sender: "38105654493205@lid"` — identificador opaco,
    // não telefone. Tratá-lo como número fez o app responder "não conseguimos
    // identificar sua conta" e mandar essa resposta para o LID, que não chega
    // a ninguém. O telefone de verdade está no `chatid`.
    expect(normalizarEntrada(mensagemReal)?.from).toBe('553287006789');
  });

  it('só o LID, sem chatid utilizável, é recusado', () => {
    const { chatid, ...semChat } = mensagemReal;
    expect(normalizarEntrada(semChat)).toBeNull();
  });

  it('grupo e broadcast não viram atendimento', () => {
    // Confundir o id do grupo com o do cliente responderia na conversa errada.
    expect(normalizarEntrada({ ...mensagemReal, chatid: '120363000000000000@g.us' })).toBeNull();
    expect(normalizarEntrada({ ...mensagemReal, chatid: 'status@broadcast' })).toBeNull();
  });

  it('sender é aceito quando é JID de telefone de verdade', () => {
    const { chatid, ...m } = mensagemReal;
    expect(normalizarEntrada({ ...m, sender: '553287006789@s.whatsapp.net' })?.from).toBe('553287006789');
  });
});

describe('normalizarEntrada — o que precisa ser recusado', () => {
  it('sem texto não vira atendimento', () => {
    // Foto sem legenda, figurinha, áudio: não há pergunta a responder.
    expect(normalizarEntrada({ ...mensagemReal, text: '', content: {} })).toBeNull();
  });

  it('sem id de mensagem não passa (a idempotência depende dele)', () => {
    const { messageid, id, ...semId } = mensagemReal;
    expect(normalizarEntrada(semId)).toBeNull();
  });

  it('sem remetente não passa', () => {
    const { chatid, sender, ...semQuem } = mensagemReal;
    expect(normalizarEntrada(semQuem)).toBeNull();
  });

  it('lixo devolve null em vez de explodir', () => {
    expect(normalizarEntrada(null)).toBeNull();
    expect(normalizarEntrada('texto solto')).toBeNull();
    expect(normalizarEntrada({ foo: 'bar' })).toBeNull();
    expect(normalizarEntrada([])).toBeNull();
  });
});

describe('formaDoPayload — diagnóstico sem vazar conversa', () => {
  it('descreve chaves e tipos, nunca o conteúdo', () => {
    const f = JSON.stringify(formaDoPayload(mensagemReal));
    expect(f).toContain('chatid');
    expect(f).toContain('string(');
    expect(f).not.toContain('Boa tarde');
    expect(f).not.toContain('553287006789');
  });
});
