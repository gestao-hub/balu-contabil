// Regra de 29/08/2026: um CNPJ, uma empresa ativa (migration 0106).
//
// O que estes testes protegem NÃO é o texto da mensagem — é a decisão de só
// dizer "CNPJ duplicado" quando foi mesmo o índice do CNPJ. `companies` tem
// outros índices únicos; responder "peça o desligamento do outro escritório"
// para a violação de qualquer um deles manda a pessoa caçar um problema que
// não existe.
import { describe, it, expect } from 'vitest';
import { ehCnpjDuplicado, mensagemDeErroDeEmpresa, MENSAGEM_CNPJ_DUPLICADO } from './cnpj-unico';

const violacaoCnpj = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "companies_cnpj_ativo_uniq"',
};

describe('ehCnpjDuplicado', () => {
  it('reconhece a violacao do indice de CNPJ', () => {
    expect(ehCnpjDuplicado(violacaoCnpj)).toBe(true);
  });

  it('NAO reconhece violacao de outro indice unico da mesma tabela', () => {
    expect(ehCnpjDuplicado({
      code: '23505',
      message: 'duplicate key value violates unique constraint "companies_pkey"',
    })).toBe(false);
  });

  it('NAO reconhece outro erro de banco com a palavra companies', () => {
    expect(ehCnpjDuplicado({
      code: '23503',
      message: 'insert or update on table "companies" violates foreign key constraint',
    })).toBe(false);
  });

  it('null, undefined e erro sem code nao quebram', () => {
    expect(ehCnpjDuplicado(null)).toBe(false);
    expect(ehCnpjDuplicado(undefined)).toBe(false);
    expect(ehCnpjDuplicado({ message: 'algo' })).toBe(false);
    expect(ehCnpjDuplicado({ code: '23505' })).toBe(false);
  });
});

describe('mensagemDeErroDeEmpresa', () => {
  it('troca a violacao de CNPJ pela regra de negocio', () => {
    expect(mensagemDeErroDeEmpresa(violacaoCnpj, 'Falha ao criar empresa.'))
      .toBe(MENSAGEM_CNPJ_DUPLICADO);
  });

  it('a mensagem diz o CAMINHO, nao so o problema', () => {
    // Quem lê precisa saber o que fazer: desligar do escritório atual. Sem
    // isso a pessoa abre chamado em vez de resolver.
    expect(MENSAGEM_CNPJ_DUPLICADO).toMatch(/desligamento|desligada/i);
    expect(MENSAGEM_CNPJ_DUPLICADO).not.toMatch(/constraint|unique|23505/i);
  });

  it('preserva a mensagem original dos outros erros', () => {
    const outro = { code: '23503', message: 'violates foreign key constraint' };
    expect(mensagemDeErroDeEmpresa(outro, 'Falha ao criar empresa.'))
      .toBe('violates foreign key constraint');
  });

  it('usa o fallback quando nao ha erro nenhum (row nula)', () => {
    expect(mensagemDeErroDeEmpresa(null, 'Falha ao criar empresa.'))
      .toBe('Falha ao criar empresa.');
  });
});
