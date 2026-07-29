import { describe, it, expect } from 'vitest';
import {
  situacaoDasMei, situacaoPgdas, chaveDaSituacao, situacaoDaChave, rotuloDoAnexo,
  rotuloDaSituacao,
} from './situacao-fiscal';

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

// A volta: quem tem a CHAVE (a lista de faltantes, uma linha do catálogo)
// precisa da SITUAÇÃO para montar o prompt. `montarPrompt` recebe
// `SituacaoFiscal` de propósito — é o tipo que impede o vazamento de compilar —,
// então o parse tem de existir e ser fiel.
describe('situacaoDaChave — o caminho de volta', () => {
  const CHAVES = [
    'das-mei:inss+iss',
    'das-mei:icms+inss',
    'das-mei:icms+inss+iss',
    'pgdas:anexo-i',
    'pgdas:anexo-iii',
    'pgdas:anexo-iii+fator-r',
    'pgdas:anexo-v+fator-r',
  ];

  // A INVARIANTE QUE MANTÉM O CATÁLOGO ÍNTEGRO: ida e volta não podem mudar a
  // chave. Se mudassem, gerar um rascunho gravaria numa linha diferente da que
  // a tela do cliente vai procurar.
  it.each(CHAVES)('ida e volta preserva %s', (k) => {
    const s = situacaoDaChave(k);
    expect(s).not.toBeNull();
    expect(chaveDaSituacao(s!)).toBe(k);
  });

  it('reconstrói os componentes do DAS-MEI', () => {
    const s = situacaoDaChave('das-mei:icms+inss');
    expect(s).toEqual({ tributo: 'das-mei', componentes: ['icms', 'inss'] });
  });

  it('reconstrói anexo e Fator R do PGDAS-D', () => {
    expect(situacaoDaChave('pgdas:anexo-iii+fator-r'))
      .toEqual({ tributo: 'pgdas', anexo: 'anexo-iii', fatorR: true });
    expect(situacaoDaChave('pgdas:anexo-iii'))
      .toEqual({ tributo: 'pgdas', anexo: 'anexo-iii', fatorR: false });
  });

  // Chave vinda do banco ou da URL não é de confiar. Devolver `null` deixa quem
  // chama decidir; inventar uma situação faria a IA redigir sobre coisa nenhuma.
  it.each(['', 'das-mei:', ':inss', 'irpf:algo', 'sem-dois-pontos', 'das-mei:INSS'])(
    'recusa a chave inválida %s',
    (k) => expect(situacaoDaChave(k)).toBeNull(),
  );
});

describe('rotuloDaSituacao', () => {
  it('nomeia o DAS-MEI pelos componentes, em ordem estável', () => {
    expect(rotuloDaSituacao(situacaoDasMei('Comercio e Servicos')))
      .toBe('MEI · DAS · ICMS + INSS + ISS');
    expect(rotuloDaSituacao(situacaoDasMei('Prestacao de Servicos')))
      .toBe('MEI · DAS · INSS + ISS');
  });

  it('nomeia o PGDAS-D pelo anexo, e só cita Fator R quando ele vale', () => {
    expect(rotuloDaSituacao(situacaoPgdas('Anexo III', true)))
      .toBe('Simples Nacional · Anexo III · Fator R');
    expect(rotuloDaSituacao(situacaoPgdas('Anexo III', false)))
      .toBe('Simples Nacional · Anexo III');
  });

  // O rótulo é para ler, não para indexar: quem identifica é a chave.
  it('situação desconhecida ainda produz rótulo, sem quebrar a tela', () => {
    expect(rotuloDaSituacao(situacaoPgdas(null, false))).toContain('desconhecido');
  });
});

describe('rotuloDoAnexo', () => {
  it('devolve o rótulo canônico a partir do slug da chave', () => {
    expect(rotuloDoAnexo('anexo-iii')).toBe('Anexo III');
    expect(rotuloDoAnexo('anexo-v')).toBe('Anexo V');
  });

  it('slug desconhecido volta como veio, sem inventar anexo', () => {
    expect(rotuloDoAnexo('desconhecido')).toBe('desconhecido');
  });
});
