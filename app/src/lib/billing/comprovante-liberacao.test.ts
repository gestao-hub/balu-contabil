import { describe, it, expect } from 'vitest';
import {
  validarComprovanteLiberacao,
  caminhoComprovanteLiberacao,
  nomeSeguro,
  extensaoDe,
  carimboDe,
  MAX_COMPROVANTE_LIBERACAO_BYTES,
  ACCEPT_COMPROVANTE,
  EXTENSOES_PERMITIDAS,
} from './comprovante-liberacao';

const ok = (p: Partial<{ nome: string; mime: string; tamanho: number }> = {}) => ({
  nome: 'comprovante.pdf', mime: 'application/pdf', tamanho: 1024, ...p,
});

describe('validarComprovanteLiberacao', () => {
  it('aceita o caso comum: PDF pequeno', () => {
    expect(validarComprovanteLiberacao(ok())).toEqual({ ok: true });
  });

  // A lista de permissao e larga de proposito: e essa largura que evita travar
  // a liberacao de quem ja pagou so porque o cliente mandou foto de iPhone ou
  // e-mail do Outlook. Cada linha aqui e um formato que chega na pratica.
  it.each([
    ['foto do iPhone', 'IMG_0421.HEIC', 'image/heic'],
    ['print de tela', 'print.webp', 'image/webp'],
    ['e-mail do Outlook', 'Comprovante.msg', 'application/vnd.ms-outlook'],
    ['e-mail exportado', 'comprovante.eml', 'message/rfc822'],
    ['Word', 'recibo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['Word antigo', 'recibo.doc', 'application/msword'],
    ['texto puro', 'obs.txt', 'text/plain'],
    ['planilha', 'extrato.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['foto Android', 'foto.jpg', 'image/jpeg'],
    ['scan', 'scan.tiff', 'image/tiff'],
    ['camera que manda nome sem extensao', 'comprovante', 'image/jpeg'],
  ])('aceita %s', (_rotulo, nome, mime) => {
    expect(validarComprovanteLiberacao(ok({ nome, mime }))).toEqual({ ok: true });
  });

  it.each(['virus.exe', 'script.js', 'macro.bat', 'app.msi', 'shell.ps1', 'pagina.html', 'grafico.svg'])(
    'recusa executavel ou script: %s',
    (nome) => {
      const r = validarComprovanteLiberacao(ok({ nome, mime: 'application/octet-stream' }));
      expect(r.ok).toBe(false);
    },
  );

  // Antes passava (lista de bloqueio). O usuario decidiu que so carrega o que
  // esta na lista: formato desconhecido na tela e indistinguivel de "deu
  // certo" para um arquivo que ninguem consegue abrir depois.
  it('recusa formato desconhecido', () => {
    expect(validarComprovanteLiberacao(ok({ nome: 'comprovante.xyz', mime: 'application/octet-stream' })).ok)
      .toBe(false);
  });

  it('recusa arquivo sem extensao e com MIME que nao diz nada', () => {
    expect(validarComprovanteLiberacao(ok({ nome: 'comprovante', mime: 'application/octet-stream' })).ok)
      .toBe(false);
  });

  it('a mensagem de recusa diz o que serve, nao so o que nao serve', () => {
    const r = validarComprovanteLiberacao(ok({ nome: 'virus.exe' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('PDF');
  });

  // Truque classico: o navegador mostra o icone de PDF e o arquivo e executavel.
  // A checagem olha a extensao FINAL, nao a primeira.
  it('recusa dupla extensao com executavel no fim', () => {
    const r = validarComprovanteLiberacao(ok({ nome: 'comprovante.pdf.exe' }));
    expect(r.ok).toBe(false);
  });

  it('aceita dupla extensao inofensiva', () => {
    expect(validarComprovanteLiberacao(ok({ nome: 'comprovante.2026.pdf' }))).toEqual({ ok: true });
  });

  it('recusa arquivo vazio', () => {
    expect(validarComprovanteLiberacao(ok({ tamanho: 0 })).ok).toBe(false);
  });

  it('recusa acima de 10 MB e aceita exatamente 10 MB', () => {
    expect(validarComprovanteLiberacao(ok({ tamanho: MAX_COMPROVANTE_LIBERACAO_BYTES + 1 })).ok).toBe(false);
    expect(validarComprovanteLiberacao(ok({ tamanho: MAX_COMPROVANTE_LIBERACAO_BYTES })).ok).toBe(true);
  });

  it('recusa nome vazio', () => {
    expect(validarComprovanteLiberacao(ok({ nome: '   ' })).ok).toBe(false);
  });
});

describe('ACCEPT_COMPROVANTE', () => {
  // O `accept` do input e a lista do servidor tem de sair da MESMA fonte. Se
  // divergirem, o seletor esconde um formato que o servidor aceitaria (ou
  // oferece um que ele recusa) — e o admin descobre no clique.
  it('cobre exatamente as extensoes permitidas', () => {
    expect(ACCEPT_COMPROVANTE.split(',')).toEqual(EXTENSOES_PERMITIDAS.map((e) => `.${e}`));
  });

  it('todo formato oferecido no seletor passa na validacao', () => {
    for (const ext of EXTENSOES_PERMITIDAS) {
      const r = validarComprovanteLiberacao({ nome: `arquivo.${ext}`, mime: '', tamanho: 10 });
      expect(r, `extensao .${ext} recusada`).toEqual({ ok: true });
    }
  });
});

describe('extensaoDe', () => {
  it('le do nome, em minuscula', () => {
    expect(extensaoDe('IMG_0421.HEIC')).toBe('heic');
  });

  it('cai no MIME quando o nome nao tem extensao', () => {
    expect(extensaoDe('comprovante', 'application/pdf')).toBe('pdf');
  });

  it('ponto inicial nao e extensao', () => {
    expect(extensaoDe('.gitignore')).toBe('');
  });

  it('ignora sufixo longo demais para ser extensao', () => {
    expect(extensaoDe('boleto.pagamentoefetuado', 'application/pdf')).toBe('pdf');
  });
});

describe('nomeSeguro', () => {
  it('tira acento, espaco e caixa alta, preservando a extensao', () => {
    expect(nomeSeguro('Comprovante PIX ç ão.PDF')).toBe('comprovante-pix-c-ao.pdf');
  });

  it('descarta diretorio embutido no nome', () => {
    expect(nomeSeguro('../../etc/passwd.txt')).toBe('passwd.txt');
  });

  it('nome que vira vazio ganha rotulo', () => {
    expect(nomeSeguro('###.pdf')).toBe('comprovante.pdf');
  });
});

describe('caminhoComprovanteLiberacao', () => {
  const id = '0d15b5ca-6a3c-45a7-a19d-d6327630111a';

  it('monta assinatura/carimbo-nome', () => {
    expect(caminhoComprovanteLiberacao(id, 'Boleto Julho.pdf', 'application/pdf', '20260727-193045'))
      .toBe(`${id}/20260727-193045-boleto-julho.pdf`);
  });

  // Sem isto, renovar sobrescreveria o comprovante da liberacao anterior e o
  // audit_log apontaria para o arquivo errado — pior que nao ter historico.
  it('carimbos diferentes dao paths diferentes para o mesmo arquivo', () => {
    const a = caminhoComprovanteLiberacao(id, 'b.pdf', 'application/pdf', '20260727-100000');
    const b = caminhoComprovanteLiberacao(id, 'b.pdf', 'application/pdf', '20260728-100000');
    expect(a).not.toBe(b);
  });

  it('recusa id fora do formato (path traversal)', () => {
    expect(() => caminhoComprovanteLiberacao('../outra', 'b.pdf', 'application/pdf', '20260727-100000'))
      .toThrow();
  });
});

describe('carimboDe', () => {
  it('compacta o ISO para YYYYMMDD-HHMMSS', () => {
    expect(carimboDe('2026-07-27T19:30:45.123Z')).toBe('20260727-193045');
  });
});
