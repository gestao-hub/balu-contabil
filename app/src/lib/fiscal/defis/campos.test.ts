// src/lib/fiscal/defis/campos.test.ts
import { describe, it, expect } from 'vitest';
import { DefisCamposSchema, SocioDefisSchema, defisVazio } from './campos';
import { camposPlanos } from './grupos';

const socio = (over: Partial<Record<string, unknown>> = {}) => ({
  cpf: '12345678901', nome: 'Maria Souza', participacaoPct: 100,
  proLabore: 0, lucroDistribuido: 0, impostoRetido: 0, ...over,
});

const base = () => ({
  ...defisVazio(),
  houveEvento: false,
  ganhosCapital: 0,
  doacoesCampanhaEleitoral: 0,
  empregadosInicio: 0,
  empregadosFim: 0,
  receitaMercadoInterno: 100000,
  receitaMercadoExterno: 0,
  receitaBrutaTotal: 100000,
  totalDespesas: 40000,
  estoqueInicial: 0,
  estoqueFinal: 0,
  saldoCaixaInicio: 0,
  saldoCaixaFim: 10000,
  aquisicoesMercadoInterno: 0,
  aquisicoesMercadoExterno: 0,
  creditosIcmsIssRetido: 0,
  socios: [socio()],
});

describe('SocioDefisSchema', () => {
  it('aceita um sócio válido', () => {
    expect(SocioDefisSchema.safeParse(socio()).success).toBe(true);
  });

  it('rejeita CPF fora de 11 dígitos', () => {
    expect(SocioDefisSchema.safeParse(socio({ cpf: '123' })).success).toBe(false);
  });

  it('rejeita participação acima de 100', () => {
    expect(SocioDefisSchema.safeParse(socio({ participacaoPct: 101 })).success).toBe(false);
  });
});

describe('DefisCamposSchema', () => {
  it('aceita um DEFIS completo com um sócio de 100%', () => {
    const r = DefisCamposSchema.safeParse(base());
    expect(r.success).toBe(true);
  });

  it('aceita dois sócios que somam 100%', () => {
    const r = DefisCamposSchema.safeParse({
      ...base(),
      socios: [socio({ participacaoPct: 60 }), socio({ cpf: '98765432100', participacaoPct: 40 })],
    });
    expect(r.success).toBe(true);
  });

  it('rejeita sócios que somam 99,99%', () => {
    const r = DefisCamposSchema.safeParse({
      ...base(),
      socios: [socio({ participacaoPct: 59.99 }), socio({ cpf: '98765432100', participacaoPct: 40 })],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita lista de sócios vazia', () => {
    expect(DefisCamposSchema.safeParse({ ...base(), socios: [] }).success).toBe(false);
  });

  it('rejeita valor monetário negativo', () => {
    expect(DefisCamposSchema.safeParse({ ...base(), totalDespesas: -1 }).success).toBe(false);
  });

  it('rejeita número de empregados fracionário', () => {
    expect(DefisCamposSchema.safeParse({ ...base(), empregadosFim: 1.5 }).success).toBe(false);
  });

  // Guarda contra drift: todo campo de grupos.ts precisa existir no schema.
  it('cobre todo campo plano declarado em grupos.ts', () => {
    const shape = DefisCamposSchema.innerType().shape as Record<string, unknown>;
    for (const c of camposPlanos()) expect(Object.keys(shape)).toContain(c.chave);
  });
});
