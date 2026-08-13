import { describe, it, expect } from 'vitest';
import { montarPromptSugestao, lerSugestaoModelo } from './sugestao-prompt';
import type { SugestaoCodigo } from './sugerir-codigo';

const CANDIDATOS: SugestaoCodigo[] = [
  { codigo: '010101', label: 'Análise e desenvolvimento de sistemas', pontos: 6, motivos: ['x'] },
  { codigo: '010601', label: 'Suporte técnico em TI', pontos: 3, motivos: ['y'] },
];
const PERMITIDOS = CANDIDATOS.map((c) => c.codigo);

describe('montarPromptSugestao', () => {
  it('leva os candidatos e a descrição, e proíbe código de fora', () => {
    const p = montarPromptSugestao({ descricaoRedigida: 'desenvolvimento de sistema', candidatos: CANDIDATOS });
    expect(p).toContain('010101');
    expect(p).toContain('010601');
    expect(p).toContain('desenvolvimento de sistema');
    expect(p).toMatch(/nunca outro/i);
  });

  it('manda não citar lei — a mesma regra do resto do produto (DL 9.295/46)', () => {
    const p = montarPromptSugestao({ descricaoRedigida: 'x y z', candidatos: CANDIDATOS });
    expect(p).toMatch(/não cite lei/i);
  });
});

describe('lerSugestaoModelo — o que se aceita', () => {
  it('lê o JSON simples', () => {
    expect(lerSugestaoModelo('{"codigo":"010101","porque":"é desenvolvimento sob encomenda"}', PERMITIDOS))
      .toEqual({ codigo: '010101', porque: 'é desenvolvimento sob encomenda' });
  });

  it('aceita cerca markdown e texto em volta', () => {
    const bruto = 'Claro!\n```json\n{"codigo":"010601","porque":"a nota é de suporte"}\n```';
    expect(lerSugestaoModelo(bruto, PERMITIDOS)?.codigo).toBe('010601');
  });

  it('aceita o código com máscara e sinônimos da justificativa', () => {
    expect(lerSugestaoModelo('{"codigo":"01.01.01","justificativa":"desenvolvimento"}', PERMITIDOS)?.codigo)
      .toBe('010101');
    expect(lerSugestaoModelo('{"code":"010101","why":"development"}', PERMITIDOS)?.porque).toBe('development');
  });

  it('corta justificativa quilométrica', () => {
    const r = lerSugestaoModelo(`{"codigo":"010101","porque":"${'a'.repeat(900)}"}`, PERMITIDOS);
    expect(r!.porque.length).toBeLessThanOrEqual(240);
  });
});

describe('lerSugestaoModelo — o que NÃO se aceita', () => {
  it('código fora da lista curta é descartado — mesmo sendo um código real', () => {
    // 170501 existe no catálogo, mas não foi oferecido neste pedido. Aceitar
    // seria deixar o modelo DECIDIR, e quem decide é o determinístico.
    expect(lerSugestaoModelo('{"codigo":"170501","porque":"achei melhor"}', PERMITIDOS)).toBeNull();
  });

  it('código inventado é descartado', () => {
    expect(lerSugestaoModelo('{"codigo":"999999","porque":"esse"}', PERMITIDOS)).toBeNull();
  });

  it('sem justificativa devolve null — a tela usa os motivos determinísticos', () => {
    expect(lerSugestaoModelo('{"codigo":"010101"}', PERMITIDOS)).toBeNull();
    expect(lerSugestaoModelo('{"codigo":"010101","porque":"   "}', PERMITIDOS)).toBeNull();
  });

  it('prosa, array ou nulo devolvem null', () => {
    expect(lerSugestaoModelo('Use o código 010101, é o certo.', PERMITIDOS)).toBeNull();
    expect(lerSugestaoModelo('[]', PERMITIDOS)).toBeNull();
    expect(lerSugestaoModelo('null', PERMITIDOS)).toBeNull();
    expect(lerSugestaoModelo('', PERMITIDOS)).toBeNull();
  });
});
