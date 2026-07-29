import { describe, it, expect } from 'vitest';
import { situacaoDasMei, situacaoPgdas, chaveDaSituacao } from './situacao-fiscal';

describe('chave da situação fiscal', () => {
  it('DAS-MEI de serviços', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    expect(s.tributo).toBe('das-mei');
    expect(chaveDaSituacao(s)).toBe('das-mei:inss+iss');
  });

  it('DAS-MEI de comércio e serviços', () => {
    expect(chaveDaSituacao(situacaoDasMei('Comercio e Servicos')))
      .toBe('das-mei:icms+inss+iss');
  });

  // A ORDEM É CANÔNICA. Sem isso, 'inss+icms' e 'icms+inss' viram duas linhas do
  // catálogo para a MESMA situação, e o admin aprova a mesma coisa duas vezes.
  it('a ordem dos componentes é alfabética, sempre', () => {
    const k = chaveDaSituacao(situacaoDasMei('Comercio e Servicos'));
    const partes = k.split(':')[1].split('+');
    expect(partes).toEqual([...partes].sort());
  });

  it('a mesma atividade sempre dá a mesma chave', () => {
    expect(chaveDaSituacao(situacaoDasMei('Comercio ou Industria')))
      .toBe(chaveDaSituacao(situacaoDasMei('Comercio ou Industria')));
  });

  it('PGDAS-D distingue o anexo e o Fator R', () => {
    expect(chaveDaSituacao(situacaoPgdas('Anexo III', true))).toBe('pgdas:anexo-iii+fator-r');
    expect(chaveDaSituacao(situacaoPgdas('Anexo III', false))).toBe('pgdas:anexo-iii');
    expect(chaveDaSituacao(situacaoPgdas('Anexo I', false))).toBe('pgdas:anexo-i');
  });

  // Fator R nao existe em Anexo I/II — pedir nao o cria. A regra mora em
  // `regime.ts` e nao e reimplementada aqui; este teste prova que a delegacao
  // acontece de verdade.
  it('Fator R pedido num anexo que não o tem é ignorado', () => {
    expect(chaveDaSituacao(situacaoPgdas('Anexo I', true))).toBe('pgdas:anexo-i');
  });

  // ACHADO DO CODE-REVIEW. A chave normalizava o anexo (minúscula + traço), mas
  // o valor CRU ia para `fatorRAplicavel`, que compara com os literais exatos
  // 'Anexo III'/'Anexo V'. Resultado: 'anexo iii' e 'Anexo III' — o MESMO anexo
  // depois da normalização — caíam em chaves diferentes, e a versão em
  // minúscula recebia a explicação sem o Fator R. É exatamente a "chave
  // instável" que o cabeçalho do módulo chama de pior falha do bloco.
  it.each(['Anexo III', 'anexo iii', 'ANEXO III', ' Anexo  III '])(
    'a caixa e o espaço do anexo (%s) não mudam a chave',
    (escrito) => {
      expect(chaveDaSituacao(situacaoPgdas(escrito, true))).toBe('pgdas:anexo-iii+fator-r');
    },
  );

  it('a normalização não inventa Fator R onde ele não existe', () => {
    expect(chaveDaSituacao(situacaoPgdas('anexo i', true))).toBe('pgdas:anexo-i');
    expect(chaveDaSituacao(situacaoPgdas('ANEXO V', true))).toBe('pgdas:anexo-v+fator-r');
  });

  // O QUE A CHAVE NÃO PODE CARREGAR: nada que mude o NÚMERO sem mudar a
  // EXPLICAÇÃO. R$ 61,60 e R$ 75,00 se explicam igual.
  it('a chave não depende de valor, competência nem empresa', () => {
    const k = chaveDaSituacao(situacaoDasMei('Prestacao de Servicos'));
    expect(k).not.toMatch(/\d{2,}/);   // sem valores
    expect(k).not.toMatch(/20\d\d/);   // sem ano/competência
  });
});
