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
});
