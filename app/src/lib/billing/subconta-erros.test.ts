import { describe, it, expect } from 'vitest';
import { traduzirErroAsaas, statusDoErroAsaas, MENSAGENS_SUBCONTA, descricaoDoErroAsaas } from './subconta-erros';

/** Formato exato que `call` (clients/asaas.ts) monta ao receber !res.ok. */
const doAsaas = (status: number, corpo: string) =>
  new Error(`Asaas POST /v3/accounts → ${status}: ${corpo}`);

const erroAsaas = (code: string, description: string) =>
  JSON.stringify({ errors: [{ code, description }] });

/** Como `call` lanca de verdade: mensagem formatada E status anexado. */
const doAsaasComStatus = (status: number, corpo: string) => {
  const e = doAsaas(status, corpo) as Error & { status: number };
  e.status = status;
  return e;
};

// Esta funcao decide se a criacao da subconta vira registro de possivel
// orfandade: com status 4xx o Asaas RECUSOU e nada nasceu; sem status, ninguem
// sabe o que aconteceu do outro lado.
describe('statusDoErroAsaas', () => {
  it('le o status anexado pelo cliente', () => {
    expect(statusDoErroAsaas(doAsaasComStatus(400, 'x'))).toBe(400);
    expect(statusDoErroAsaas(doAsaasComStatus(504, 'x'))).toBe(504);
  });

  it('cai no texto quando o erro nao traz o campo', () => {
    expect(statusDoErroAsaas(doAsaas(422, 'x'))).toBe(422);
  });

  it('devolve null quando nao houve resposta HTTP', () => {
    expect(statusDoErroAsaas(new Error('fetch failed'))).toBeNull();
    expect(statusDoErroAsaas(new Error('read ECONNRESET'))).toBeNull();
    expect(statusDoErroAsaas(new TypeError('terminated'))).toBeNull();
    expect(statusDoErroAsaas(null)).toBeNull();
    expect(statusDoErroAsaas(undefined)).toBeNull();
    expect(statusDoErroAsaas({ qualquer: 'coisa' })).toBeNull();
  });

  // Mesma armadilha do `statusHttp`: o corpo carrega numeros do cadastro.
  it('não confunde número do cadastro com status HTTP', () => {
    const e = doAsaas(400, erroAsaas('invalid_incomeValue', 'incomeValue 500000 acima de 502000'));
    expect(statusDoErroAsaas(e)).toBe(400);
  });
});

describe('traduzirErroAsaas', () => {
  it.each([
    ['documento invalido', erroAsaas('invalid_cpfCnpj', 'O CPF informado é inválido.'), 'CPF/CNPJ'],
    ['e-mail invalido', erroAsaas('invalid_email', 'O e-mail informado é inválido.'), 'e-mail'],
    ['CEP invalido', erroAsaas('invalid_postalCode', 'postalCode inválido.'), 'CEP'],
    ['celular invalido', erroAsaas('invalid_mobilePhone', 'mobilePhone inválido.'), 'celular'],
    ['nascimento invalido', erroAsaas('invalid_birthDate', 'birthDate inválido.'), 'data de nascimento'],
    ['tipo de empresa', erroAsaas('invalid_companyType', 'companyType inválido.'), 'tipo da empresa'],
    ['faturamento', erroAsaas('invalid_incomeValue', 'incomeValue inválido.'), 'faturamento'],
    ['endereco', erroAsaas('invalid_province', 'province é obrigatório.'), 'endereço'],
  ])('traduz %s para português acionável', (_r, corpo, trecho) => {
    expect(traduzirErroAsaas(doAsaas(400, corpo))).toContain(trecho);
  });

  // A recusa mais confusa do onboarding: o documento esta CERTO e mesmo assim
  // o Asaas nega. Se cair na regra de "documento invalido", o escritorio fica
  // conferindo digitos que estao corretos para sempre.
  it.each([
    ['CNPJ already in use'],
    ['Já existe uma conta com este CPF/CNPJ.'],
    ['This cpfCnpj is already registered.'],
  ])('trata documento já cadastrado como duplicidade, não como dígito errado: %s', (desc) => {
    const msg = traduzirErroAsaas(doAsaas(400, erroAsaas('invalid_cpfCnpj', desc)));
    expect(msg).toContain('Já existe uma conta');
    expect(msg).not.toContain('Confira os dígitos');
  });

  // Nao e culpa do dado digitado: mandar "confira o CPF" aqui faz o
  // escritorio tentar de novo para sempre contra uma chave errada da Balu.
  it('trata 401 como problema da Balu, não do cadastro', () => {
    const msg = traduzirErroAsaas(doAsaas(401, '{"errors":[{"code":"unauthorized"}]}'));
    expect(msg).toContain('suporte da Balu');
    expect(msg).not.toContain('CPF');
  });

  it.each([429, 500, 502, 503, 504])('trata %i como indisponibilidade temporária', (status) => {
    expect(traduzirErroAsaas(doAsaas(status, 'gateway'))).toContain('tente de novo');
  });

  // O status vem do CABECALHO, nao de uma busca por numero na string toda:
  // faturamento 500000 e CEP 01503000 carregam "500" e "503" no corpo.
  it('não confunde número do cadastro com status HTTP', () => {
    const msg = traduzirErroAsaas(
      doAsaas(400, erroAsaas('invalid_incomeValue', 'incomeValue 500000 acima do limite de 502000')),
    );
    expect(msg).toContain('faturamento');
  });

  it('cai no genérico quando não reconhece a recusa', () => {
    const msg = traduzirErroAsaas(doAsaas(400, '{"errors":[{"code":"invalid_object"}]}'));
    expect(msg).toContain('recusou os dados do cadastro');
  });

  it('sobrevive a erro que não é Error', () => {
    expect(traduzirErroAsaas(null)).toContain('recusou os dados');
    expect(traduzirErroAsaas(undefined)).toContain('recusou os dados');
    expect(traduzirErroAsaas({ qualquer: 'coisa' })).toContain('recusou os dados');
  });

  it('traduz erro de rede sem status HTTP', () => {
    expect(traduzirErroAsaas(new Error('fetch failed'))).toContain('tente de novo');
    expect(traduzirErroAsaas(new Error('Asaas POST /v3/accounts → falhou apos 3 tentativas')))
      .toContain('tente de novo');
  });

  // O CONTRATO CENTRAL DESTE MODULO. O corpo de erro do Asaas pode trazer nome,
  // documento e e-mail do titular, e esta string vai para a TELA. Nenhuma saida
  // pode ser derivada da entrada — todas sao constantes deste arquivo.
  it('nunca ecoa nada do erro cru: toda saída é constante do módulo', () => {
    const vazamentos = [
      'MARIA DA SILVA SAURO', '12345678909', 'maria@escritorio.com.br',
      'invalid_cpfCnpj', 'Rua das Flores, 100', 'wallet_abc123', 'apiKey',
      '$aact_YTU5YTA0M2M4Mjc2ODZlNGZjOGE0Zjg2NmFm',
    ];
    for (const v of vazamentos) {
      for (const status of [400, 401, 429, 500]) {
        const msg = traduzirErroAsaas(doAsaas(status, `{"errors":[{"description":"${v}"}]}`));
        expect(msg).not.toContain(v);
        expect(MENSAGENS_SUBCONTA as readonly string[]).toContain(msg);
      }
    }
  });
});

/**
 * `descricaoDoErroAsaas` — 02/09/2026.
 *
 * O titular clicou em assinar e recebeu "Tente novamente" para uma recusa que
 * NUNCA mudaria de resposta. O `criarCliente` tinha funcionado (o customer
 * existe no Asaas de produção); a `criarAssinatura` foi recusada, e o motivo,
 * que o Asaas manda por escrito, morreu num `console.error`.
 *
 * Cada teste morde uma mutação:
 *   1. devolver a descrição para 5xx/401 (indisponibilidade e chave errada não
 *      são acionáveis por quem está na tela — mandá-la "conferir o valor" faz
 *      tentar de novo para sempre);
 *   2. devolver o corpo cru quando o JSON não parseia;
 *   3. deixar passar texto longo demais, que vira despejo na tela.
 */
describe('descricaoDoErroAsaas', () => {
  const erroAsaas = (status: number, corpo: unknown) => {
    const e = new Error(
      `Asaas POST /v3/subscriptions → ${status}: ${JSON.stringify(corpo)}`,
    ) as Error & { status: number };
    e.status = status;
    return e;
  };

  it('extrai a frase do Asaas num 400 de validação', () => {
    const e = erroAsaas(400, {
      errors: [{ code: 'invalid_value', description: 'O valor da cobrança não pode ser menor que R$ 5,00.' }],
    });
    expect(descricaoDoErroAsaas(e)).toBe('O valor da cobrança não pode ser menor que R$ 5,00.');
  });

  // MUTAÇÃO 1: 5xx e 401 não podem virar mensagem de "conserte o dado".
  it.each([500, 502, 503, 401, 403])('não devolve descrição para %i', (status) => {
    const e = erroAsaas(status, { errors: [{ description: 'qualquer coisa' }] });
    expect(descricaoDoErroAsaas(e)).toBeNull();
  });

  // MUTAÇÃO 2: sem JSON aproveitável, quem chama usa o genérico — nunca o cru.
  it('corpo sem JSON → null (o genérico assume)', () => {
    const e = new Error('Asaas POST /v3/subscriptions → 400: Bad Request') as Error & { status: number };
    e.status = 400;
    expect(descricaoDoErroAsaas(e)).toBeNull();
  });

  it('JSON quebrado → null, não estoura', () => {
    const e = new Error('Asaas POST /x → 400: {isso nao e json') as Error & { status: number };
    e.status = 400;
    expect(descricaoDoErroAsaas(e)).toBeNull();
  });

  // MUTAÇÃO 3: descrição gigante viraria despejo na tela.
  it('descrição longa demais é descartada', () => {
    const e = erroAsaas(400, { errors: [{ description: 'x'.repeat(201) }] });
    expect(descricaoDoErroAsaas(e)).toBeNull();
  });

  it('sem `errors` → null', () => {
    expect(descricaoDoErroAsaas(erroAsaas(400, { mensagem: 'outra forma' }))).toBeNull();
  });

  it('valor que não é Error → null', () => {
    expect(descricaoDoErroAsaas(null)).toBeNull();
    expect(descricaoDoErroAsaas(42)).toBeNull();
  });
});
