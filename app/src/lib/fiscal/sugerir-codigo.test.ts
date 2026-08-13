import { describe, it, expect } from 'vitest';
import { sugerirCodigosServico, normalizarTexto } from './sugerir-codigo';
import { CODIGOS_TRIBUTACAO_FREQUENTES } from './codigos-tributacao';

const top = (d: string, cnae?: string | null) => sugerirCodigosServico(d, cnae)[0]?.codigo;

describe('sugerirCodigosServico — o caso comum', () => {
  it.each([
    ['Desenvolvimento de software sob encomenda conforme contrato', '010101'],
    ['Consultoria em informática para migração de servidor', '010701'],
    ['Suporte técnico mensal aos sistemas do cliente', '010601'],
    ['Serviços de contabilidade referentes a agosto', '170501'],
    ['Honorários advocatícios — acompanhamento processual', '170601'],
    ['Gestão de redes sociais e tráfego pago', '170801'],
    ['Manutenção e instalação de ar condicionado', '060201'],
    ['Treinamento e capacitação da equipe comercial', '140201'],
    ['Consultoria empresarial e planejamento estratégico', '170101'],
  ])('%s → %s', (descricao, esperado) => {
    expect(top(descricao)).toBe(esperado);
  });

  it('a frase mais específica ganha da palavra solta', () => {
    // "consultoria" sozinha é 170101; com "em informática" o serviço é outro.
    expect(top('Consultoria')).toBe('170101');
    expect(top('Consultoria em informática')).toBe('010701');
    // Mesma disputa do outro lado: manutenção genérica vs. de sistemas.
    expect(top('Manutenção de portões')).toBe('060201');
    expect(top('Manutenção de sistemas legados')).toBe('010601');
  });

  it('acento e caixa não mudam o resultado', () => {
    expect(top('MANUTENCAO E INSTALACAO DE AR CONDICIONADO')).toBe('060201');
    expect(top('serviços de contabilidade')).toBe(top('SERVICOS DE CONTABILIDADE'));
  });
});

describe('sugerirCodigosServico — o CNAE é pista, não veredito', () => {
  it('desempata quando a descrição é ambígua', () => {
    // "consultoria" sozinha vai para 170101; o CNAE de consultoria em TI puxa.
    expect(top('Consultoria prestada em agosto', '6204-0/00')).toBe('010701');
  });

  it('não decide sozinho: descrição sem pista nenhuma não gera sugestão', () => {
    // Um escritório contábil que digita "serviço prestado" receberia
    // "contabilidade" só por causa do CNAE — sugestão que não veio de evidência.
    expect(sugerirCodigosServico('Serviço prestado em julho', '6920-6/01')).toEqual([]);
  });

  it('a descrição vence o CNAE quando ela é clara', () => {
    // Escritório de contabilidade emitindo nota de desenvolvimento.
    expect(top('Desenvolvimento de software sob encomenda', '6920-6/01')).toBe('010101');
  });

  it('o serviço que abre a frase pesa mais que o complemento', () => {
    // "Treinamento ... em rotinas de departamento pessoal" é treinamento. Sem o
    // peso da cabeça da frase, o complemento de duas palavras ganharia.
    expect(top('Treinamento de equipe em rotinas de departamento pessoal')).toBe('140201');
  });

  it('caso ambíguo de verdade: o determinístico não escolhe, oferece', () => {
    // Mesma frase, mas o CNAE do emissor é de contabilidade — e aí as duas
    // leituras são defensáveis. O contrato desta camada é montar a lista curta
    // SEM perder a opção certa; ordenar entre duas leituras plausíveis é o que
    // a IA (e, no fim, o contador) faz na tela.
    const r = sugerirCodigosServico('Treinamento de equipe em rotinas de departamento pessoal', '6920-6/01');
    expect(r.map((s) => s.codigo)).toContain('140201');
    expect(r.map((s) => s.codigo)).toContain('170501');
  });
});

describe('sugerirCodigosServico — o que NÃO se sugere', () => {
  it('descrição vazia ou sem termo conhecido devolve lista vazia', () => {
    expect(sugerirCodigosServico('')).toEqual([]);
    expect(sugerirCodigosServico('   ')).toEqual([]);
    expect(sugerirCodigosServico('Prestação de serviços diversos')).toEqual([]);
  });

  it('casa por palavra inteira — nada de código de TI em nota de clínica', () => {
    // "terapia" contém "api"; "designação" contém "design". Sem casamento por
    // palavra inteira, os dois virariam sugestão de TI e de publicidade.
    expect(sugerirCodigosServico('Sessões de terapia ocupacional')).toEqual([]);
    expect(sugerirCodigosServico('Designação de responsável técnico')).toEqual([]);
  });
});

describe('sugerirCodigosServico — contrato com quem chama', () => {
  it('devolve no máximo o limite pedido, do mais provável para o menos', () => {
    const r = sugerirCodigosServico('Consultoria em informática, programação e treinamento');
    expect(r.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.pontos).toBeGreaterThanOrEqual(r[i]!.pontos);
    }
  });

  it('só sugere código que o formulário sabe selecionar', () => {
    const catalogo = new Set(CODIGOS_TRIBUTACAO_FREQUENTES.map((c) => c.codigo));
    const r = sugerirCodigosServico('Desenvolvimento de site e suporte técnico', '6201-5/01');
    expect(r.length).toBeGreaterThan(0);
    for (const s of r) expect(catalogo.has(s.codigo)).toBe(true);
  });

  it('toda sugestão traz um motivo em pt-BR', () => {
    const r = sugerirCodigosServico('Serviços advocatícios', '6911-7/01');
    expect(r[0]!.motivos.length).toBeGreaterThan(0);
    expect(r[0]!.motivos[0]).toContain('advocatícios');
  });

  it('é estável: mesma entrada, mesma saída', () => {
    const a = sugerirCodigosServico('Marketing digital e design', '7311-4/00');
    const b = sugerirCodigosServico('Marketing digital e design', '7311-4/00');
    expect(a).toEqual(b);
  });
});

describe('normalizarTexto', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizarTexto('Análise & Desenvolvimento, de Sistemas!')).toBe('analise desenvolvimento de sistemas');
  });
});
