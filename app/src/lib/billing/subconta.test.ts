import { describe, it, expect } from 'vitest';
import {
  validarDadosSubconta, montarPayloadSubconta, soDigitos, ehPessoaJuridica,
  normalizarBirthDate,
} from './subconta';

const pj = {
  name: 'Escritorio Teste Contabil LTDA', cpfCnpj: '11.222.333/0001-81',
  email: 'contato@escritorio.com.br', mobilePhone: '(11) 99999-9999',
  incomeValue: 25000, address: 'Rua das Flores', addressNumber: '100',
  province: 'Centro', postalCode: '01001-000', birthDate: null,
  companyType: 'LIMITED' as const,
};
const pf = { ...pj, cpfCnpj: '123.456.789-09', companyType: null, birthDate: '1985-03-12' };

describe('validarDadosSubconta', () => {
  it('aceita PJ completo sem data de nascimento', () => {
    expect(validarDadosSubconta(pj)).toEqual({ ok: true });
  });

  it('aceita PF com data de nascimento', () => {
    expect(validarDadosSubconta(pf)).toEqual({ ok: true });
  });

  // O achado do sandbox: birthDate so e exigido para CPF. Cobrar de PJ
  // travaria o onboarding de todo escritorio com CNPJ.
  it('exige data de nascimento apenas para CPF', () => {
    const semData = { ...pf, birthDate: null };
    const r = validarDadosSubconta(semData);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nascimento');
  });

  it('exige companyType para CNPJ', () => {
    const r = validarDadosSubconta({ ...pj, companyType: null });
    expect(r.ok).toBe(false);
    // Sem afirmar a MENSAGEM, este caso passa mesmo com a bifurcacao PJ/PF
    // invertida: o fixture `pj` tem birthDate null, entao o validador errado
    // recusaria pelo motivo errado e o teste nao notaria.
    if (!r.ok) expect(r.error).toContain('tipo da empresa');
  });

  it.each([
    ['nome', { name: '' }],
    ['documento', { cpfCnpj: '' }],
    ['e-mail', { email: '' }],
    ['celular', { mobilePhone: '' }],
    ['CEP', { postalCode: '' }],
  ])('recusa sem %s', (_r, patch) => {
    expect(validarDadosSubconta({ ...pj, ...patch }).ok).toBe(false);
  });

  it('recusa documento que nao tem 11 nem 14 digitos', () => {
    expect(validarDadosSubconta({ ...pj, cpfCnpj: '123' }).ok).toBe(false);
  });

  it('recusa faturamento estimado zerado ou negativo', () => {
    expect(validarDadosSubconta({ ...pj, incomeValue: 0 }).ok).toBe(false);
    expect(validarDadosSubconta({ ...pj, incomeValue: -1 }).ok).toBe(false);
  });

  // Campo vazio e o caso facil. O que aparece de verdade no formulario e valor
  // PRESENTE e malformado — e nenhum dos ramos abaixo tinha teste.
  it.each([
    ['CEP com 7 digitos', { postalCode: '0100100' }, 'CEP'],
    ['celular sem DDD', { mobilePhone: '99999999' }, 'celular'],
    ['e-mail sem arroba', { email: 'contatoescritorio.com.br' }, 'e-mail'],
    ['bairro em branco', { province: '  ' }, 'bairro'],
  ])('recusa %s', (_r, patch, trecho) => {
    const r = validarDadosSubconta({ ...pj, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(trecho);
  });
});

describe('ehPessoaJuridica', () => {
  // Export que o Client Component da Task 6 importa para trocar o formulario;
  // ate aqui so era coberto de raspao, por dentro do validador.
  it('14 digitos e PJ, 11 e PF, mascara nao importa', () => {
    expect(ehPessoaJuridica('11.222.333/0001-81')).toBe(true);
    expect(ehPessoaJuridica('123.456.789-09')).toBe(false);
    expect(ehPessoaJuridica('')).toBe(false);
  });
});

describe('montarPayloadSubconta', () => {
  it('manda documento e celular so com digitos', () => {
    const p = montarPayloadSubconta(pj);
    expect(p.cpfCnpj).toBe('11222333000181');
    expect(p.mobilePhone).toBe('11999999999');
    expect(p.postalCode).toBe('01001000');
  });

  it('nao manda birthDate para PJ', () => {
    expect(montarPayloadSubconta(pj).birthDate).toBeUndefined();
  });

  it('manda birthDate e omite companyType para PF', () => {
    const p = montarPayloadSubconta(pf);
    expect(p.birthDate).toBe('1985-03-12');
    expect(p.companyType).toBeUndefined();
  });
});

describe('normalizarBirthDate', () => {
  it('deixa YYYY-MM-DD como está', () => {
    expect(normalizarBirthDate('1985-03-12')).toEqual({ ok: true, valor: '1985-03-12' });
  });

  // Este repo ja converte DD/MM/YYYY → YYYY-MM-DD no cliente
  // (HonorarioFormDialog): a data em formato brasileiro e entrada real aqui.
  it('converte DD/MM/YYYY para o formato do Asaas', () => {
    expect(normalizarBirthDate('12/03/1985')).toEqual({ ok: true, valor: '1985-03-12' });
  });

  // `new Date('2001-02-31')` NAO lanca: rola para 03/03. Sem a comparacao de
  // volta, um dia inexistente seguiria para o KYC como outra data.
  it('recusa dia que não existe no mês em vez de rolar para o mês seguinte', () => {
    const r = normalizarBirthDate('2001-02-31');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('calendário');
  });

  it.each([
    ['formato americano', '03/12/1985 00:00'],
    ['texto livre', '12 de março de 1985'],
    ['ano com 2 dígitos', '12/03/85'],
    ['timestamp ISO completo', '1985-03-12T00:00:00Z'],
    ['vazio', ''],
  ])('recusa %s com mensagem em português', (_r, v) => {
    const r = normalizarBirthDate(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/data de nascimento/i);
  });

  it('recusa nulo', () => {
    expect(normalizarBirthDate(null).ok).toBe(false);
  });

  // Titular de subconta nao nasceu ano passado nem em 1750.
  it.each(['1899-12-31', `${new Date().getUTCFullYear() - 5}-01-01`])(
    'recusa ano implausível: %s', (v) => {
      expect(normalizarBirthDate(v).ok).toBe(false);
    },
  );
});

describe('soDigitos', () => {
  it('remove tudo que nao for digito', () => {
    expect(soDigitos('(11) 9 9999-9999')).toBe('11999999999');
  });
});
