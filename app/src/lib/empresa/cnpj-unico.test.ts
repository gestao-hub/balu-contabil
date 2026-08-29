// Regra de 29/08/2026: um CNPJ, uma empresa ativa (migration 0106).
//
// O que estes testes protegem NÃO é o texto da mensagem — é a decisão de só
// dizer "CNPJ duplicado" quando foi mesmo o índice do CNPJ. `companies` tem
// outros índices únicos; responder "peça o desligamento do outro escritório"
// para a violação de qualquer um deles manda a pessoa caçar um problema que
// não existe.
import { describe, it, expect } from 'vitest';
import {
  ehCnpjDuplicado, mensagemDeErroDeEmpresa,
  MENSAGEM_CNPJ_DUPLICADO_TITULAR, MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO,
} from './cnpj-unico';

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
  it('cada publico recebe a SUA saida, e nao a do outro', () => {
    // O titular que esbarra no proprio CNPJ quase sempre esbarrou na empresa
    // pre-cadastrada pelo contador dele. Manda-lo "pedir desligamento" seria
    // manda-lo abrir chamado contra o proprio contador; o caminho e aceitar o
    // convite. Ja o escritorio colide mesmo com outro escritorio.
    expect(mensagemDeErroDeEmpresa(violacaoCnpj, 'x', 'titular'))
      .toBe(MENSAGEM_CNPJ_DUPLICADO_TITULAR);
    expect(mensagemDeErroDeEmpresa(violacaoCnpj, 'x', 'escritorio'))
      .toBe(MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO);
    expect(MENSAGEM_CNPJ_DUPLICADO_TITULAR).not.toBe(MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO);
  });

  it('cada mensagem diz o CAMINHO certo do seu publico', () => {
    expect(MENSAGEM_CNPJ_DUPLICADO_TITULAR).toMatch(/convite/i);
    expect(MENSAGEM_CNPJ_DUPLICADO_TITULAR).not.toMatch(/desligamento/i);
    expect(MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO).toMatch(/desligamento/i);
    for (const m of [MENSAGEM_CNPJ_DUPLICADO_TITULAR, MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO]) {
      expect(m).not.toMatch(/constraint|unique|23505/i);
    }
  });

  it('preserva a mensagem original dos outros erros', () => {
    const outro = { code: '23503', message: 'violates foreign key constraint' };
    expect(mensagemDeErroDeEmpresa(outro, 'Falha ao criar empresa.', 'titular'))
      .toBe('violates foreign key constraint');
  });

  it('usa o fallback quando nao ha erro nenhum (row nula)', () => {
    expect(mensagemDeErroDeEmpresa(null, 'Falha ao criar empresa.', 'escritorio'))
      .toBe('Falha ao criar empresa.');
  });
});
