import { describe, it, expect } from 'vitest';
import { marcadoresDe, renderizar } from './renderizar';

describe('renderização da explicação', () => {
  it('troca marcador por valor', () => {
    const r = renderizar('São {inss} de INSS e {iss} de ISS.',
      { inss: 'R$ 75,90', iss: 'R$ 5,00' });
    expect(r).toEqual({ ok: true, texto: 'São R$ 75,90 de INSS e R$ 5,00 de ISS.' });
  });

  // FALHA FECHADA. Exibir "{iss}" cru na cara do cliente é pior que não explicar.
  it('recusa quando falta valor para um marcador', () => {
    const r = renderizar('São {inss} e {iss}.', { inss: 'R$ 75,90' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.faltando).toEqual(['iss']);
  });

  it('valor a mais não atrapalha', () => {
    const r = renderizar('São {inss}.', { inss: 'R$ 75,90', icms: 'R$ 1,00' });
    expect(r.ok).toBe(true);
  });

  it('texto sem marcador nenhum passa', () => {
    expect(renderizar('O MEI paga valor fixo.', {})).toEqual(
      { ok: true, texto: 'O MEI paga valor fixo.' });
  });

  it('lista os marcadores de um texto, sem repetir', () => {
    expect(marcadoresDe('{a} e {b} e {a}')).toEqual(['a', 'b']);
  });

  // O marcador repetido tem de ser trocado em TODAS as ocorrencias — uma
  // substituicao que para na primeira deixaria "{inss}" cru na segunda, que e
  // exatamente o que a falha fechada existe para impedir.
  it('troca todas as ocorrências do mesmo marcador', () => {
    const r = renderizar('{inss} hoje e {inss} no mês que vem.', { inss: 'R$ 75,90' });
    expect(r).toEqual({ ok: true, texto: 'R$ 75,90 hoje e R$ 75,90 no mês que vem.' });
  });

  // Valor vazio e um valor — string vazia e resposta legitima. Recusar aqui
  // faria a tela sumir por causa de um componente de R$ 0,00.
  it('valor vazio conta como fornecido', () => {
    expect(renderizar('a{x}b', { x: '' })).toEqual({ ok: true, texto: 'ab' });
  });

  // ACHADO DO CODE-REVIEW. `valores[m] === undefined` percorre a CADEIA DE
  // PROTOTIPOS: `valores['constructor']` nao e undefined, e o marcador passava
  // pela falha fechada. O texto ia para a tela do contribuinte com
  // "function Object() { [native code] }" no lugar de um valor de imposto —
  // pior que o "{iss}" cru que este modulo existe para impedir.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'marcador herdado do Object.prototype (%s) NÃO passa pela falha fechada',
    (herdado) => {
      const r = renderizar(`Você paga {${herdado}} de INSS.`, { inss: 'R$ 75,90' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.faltando).toEqual([herdado]);
    },
  );

  it('marcador herdado também não aparece como fornecido em texto misto', () => {
    const r = renderizar('{inss} e {toString}', { inss: 'R$ 75,90' });
    expect(r.ok).toBe(false);
  });

  // Valor com `undefined` explicito e ausencia, nao presenca.
  it('valor explicitamente undefined conta como faltando', () => {
    const r = renderizar('{x}', { x: undefined as unknown as string });
    expect(r.ok).toBe(false);
  });
});
