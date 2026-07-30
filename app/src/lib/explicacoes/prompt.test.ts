import { describe, it, expect } from 'vitest';
import { montarPrompt } from './prompt';
import { marcadoresDaChave } from './marcadores';
import {
  situacaoDasMei, situacaoPgdas, chaveDaSituacao, type SituacaoFiscal,
} from '@/lib/fiscal/situacao-fiscal';

const TODAS: SituacaoFiscal[] = [
  situacaoDasMei('Comercio ou Industria'),
  situacaoDasMei('Prestacao de Servicos'),
  situacaoDasMei('Comercio e Servicos'),
  situacaoPgdas('Anexo I', false),
  situacaoPgdas('Anexo III', true),
  situacaoPgdas('Anexo V', true),
];

describe('prompt da explicação', () => {
  it('descreve a situação e pede marcadores', () => {
    const p = montarPrompt(situacaoDasMei('Comercio e Servicos'));
    expect(p).toContain('MEI');
    expect(p).toContain('{inss}');
  });

  // A INVARIANTE CENTRAL DO BLOCO. Se algum dia alguém alargar `SituacaoFiscal`
  // para carregar valor, competência ou documento, este teste morde.
  it('o prompt NUNCA contém número que pareça dado do contribuinte', () => {
    for (const s of TODAS) {
      const p = montarPrompt(s);
      expect(p).not.toMatch(/\d+[.,]\d{2}/);   // valor monetário
      expect(p).not.toMatch(/\d{11,14}/);      // CPF/CNPJ
      expect(p).not.toMatch(/20\d\d-\d\d/);    // competência
    }
  });

  // O PROMPT E A APROVACAO TEM DE FALAR DA MESMA LISTA. Pedir um marcador que a
  // aprovacao recusa produz rascunho impossivel de aprovar; deixar de pedir um
  // que a tela sabe preencher desperdica o valor.
  it.each(TODAS.map((s) => [chaveDaSituacao(s), s] as const))(
    'pede exatamente os marcadores permitidos de %s',
    (chave, s) => {
      const p = montarPrompt(s);
      const permitidos = marcadoresDaChave(chave);
      for (const m of permitidos) expect(p).toContain(`{${m}}`);

      // e NENHUM outro marcador: um `{icms}` num prompt de serviços faria a IA
      // redigir sobre um imposto que aquele contribuinte não paga.
      const noPrompt = [...new Set(Array.from(p.matchAll(/\{([a-z0-9_]+)\}/gi), (x) => x[1]))];
      expect(noPrompt.sort()).toEqual([...permitidos].sort());
    },
  );

  it('o PGDAS-D é descrito pelo anexo, com o Fator R quando ele vale', () => {
    expect(montarPrompt(situacaoPgdas('Anexo III', true))).toContain('Anexo III');
    expect(montarPrompt(situacaoPgdas('Anexo III', true))).toMatch(/fator r/i);
    expect(montarPrompt(situacaoPgdas('Anexo III', false))).not.toMatch(/fator r/i);
  });

  // As tres proibicoes que a spec impoe ao texto (DL 9.295/46 e o principio de
  // que a Balu nao aconselha por IA) tem de estar DITAS ao modelo, nao so
  // esperadas dele.
  it.each(['conselho', 'lei', 'valor'])('instrui explicitamente sobre %s', (assunto) => {
    const p = montarPrompt(situacaoDasMei('Prestacao de Servicos')).toLowerCase();
    expect(p).toContain(assunto);
  });

  // Mesma situacao, mesmo prompt: rascunho que muda sozinho e rascunho que
  // ninguem consegue revisar duas vezes do mesmo jeito.
  it('é determinístico', () => {
    const s = situacaoDasMei('Comercio e Servicos');
    expect(montarPrompt(s)).toBe(montarPrompt(s));
  });

  // Situacao de serviços não menciona ICMS em lugar nenhum — nem em texto solto.
  it('não menciona tributo que a situação não tem', () => {
    const p = montarPrompt(situacaoDasMei('Prestacao de Servicos')).toLowerCase();
    expect(p).not.toContain('icms');
  });
});

describe('contexto juridico de apoio (base-juridica)', () => {
  it('sem contexto, o prompt e IDENTICO ao de hoje (compatibilidade)', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    expect(montarPrompt(s)).toBe(montarPrompt(s, undefined));
    expect(montarPrompt(s)).toBe(montarPrompt(s, []));
  });

  it('com contexto, inclui os trechos numa secao separada, marcada como uso interno', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    const p = montarPrompt(s, [{ titulo: 'Resolução CGSN 140', texto: 'Teto de faturamento do MEI.' }]);
    expect(p).toContain('Resolução CGSN 140');
    expect(p).toContain('Teto de faturamento do MEI.');
    expect(p.toLowerCase()).toMatch(/uso interno|não cite|nao cite/);
  });

  // A REGRA CENTRAL NAO PODE AFROUXAR: mesmo com contexto juridico de apoio,
  // o prompt continua proibindo citar lei/norma no texto final.
  it('com contexto, a proibicao de citar lei continua presente', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    const p = montarPrompt(s, [{ titulo: 'Lei X', texto: 'Artigo Y diz Z.' }]).toLowerCase();
    expect(p).toContain('não cite lei');
  });
});
