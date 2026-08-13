import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerTabelaSimples, dataDaCompetencia } from './parametros-schema';
import { TABELA_SIMPLES_FALLBACK } from './simples';

const valida = () => JSON.parse(JSON.stringify(TABELA_SIMPLES_FALLBACK)) as Record<string, unknown>;

describe('lerTabelaSimples', () => {
  it('aceita a tabela completa e devolve as faixas', () => {
    const t = lerTabelaSimples(valida());
    expect(t).not.toBeNull();
    expect(t!['Anexo III'][0].nominal).toBe(0.06);
    expect(t!['Anexo I'][5].deduzir).toBe(378000);
  });

  it('recusa quando falta um anexo inteiro', () => {
    const t = valida();
    delete t['Anexo IV'];
    // Aceitar parcial daria `undefined` na hora de identificar a faixa desse
    // anexo — erro em runtime no meio de um cálculo de imposto.
    expect(lerTabelaSimples(t)).toBeNull();
  });

  it('recusa quando um anexo tem menos de 6 faixas', () => {
    const t = valida();
    (t['Anexo I'] as unknown[]).pop();
    expect(lerTabelaSimples(t)).toBeNull();
  });

  it('recusa nominal em percentual em vez de fração', () => {
    const t = valida();
    (t['Anexo I'] as Array<Record<string, number>>)[0].nominal = 4; // 4 em vez de 0,04
    // É o erro mais fácil de cometer copiando a linha da lei, e o mais caro:
    // multiplicaria o imposto por cem sem lançar nada.
    expect(lerTabelaSimples(t)).toBeNull();
  });

  it('recusa número vindo como string', () => {
    const t = valida();
    (t['Anexo II'] as Array<Record<string, unknown>>)[2].ate = '720000';
    // `'720000' * 0.1` é NaN, e NaN atravessa toFixed sem reclamar.
    expect(lerTabelaSimples(t)).toBeNull();
  });

  it('recusa faixas fora de ordem', () => {
    const t = valida();
    const a = t['Anexo I'] as unknown[];
    [a[0], a[1]] = [a[1], a[0]];
    expect(lerTabelaSimples(t)).toBeNull();
  });

  it('recusa tetos que não crescem', () => {
    const t = valida();
    (t['Anexo V'] as Array<Record<string, number>>)[3].ate = 100;
    expect(lerTabelaSimples(t)).toBeNull();
  });

  it('recusa null, array e primitivo', () => {
    expect(lerTabelaSimples(null)).toBeNull();
    expect(lerTabelaSimples([])).toBeNull();
    expect(lerTabelaSimples('tabela')).toBeNull();
  });
});

describe('dataDaCompetencia', () => {
  it('YYYYMM vira o primeiro dia do mês', () => {
    expect(dataDaCompetencia('202503')).toBe('2025-03-01');
    expect(dataDaCompetencia('202512')).toBe('2025-12-01');
  });

  it('competência inválida cai em hoje, nunca numa data inventada', () => {
    // Cair em hoje devolve o parâmetro mais recente — desatualizado no pior
    // caso. Uma data inventada devolveria o parâmetro de outra era.
    const hoje = new Date().toISOString().slice(0, 10);
    expect(dataDaCompetencia('')).toBe(hoje);
    expect(dataDaCompetencia('2025')).toBe(hoje);
    expect(dataDaCompetencia('202513')).toBe(hoje);
  });
});

describe('a migration 0079 e o fallback do código dizem a mesma coisa', () => {
  it('o JSON semeado é idêntico a TABELA_SIMPLES_FALLBACK', () => {
    // O fallback existe para quando o SELECT falha. Se ele discordasse do
    // banco, haveria dois impostos possíveis para a mesma empresa, decididos
    // por quem estava no ar naquele segundo.
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0079_parametros_versionados.sql'),
      'utf8',
    );
    const inicio = sql.indexOf("('tabela_simples', '") + "('tabela_simples', '".length;
    const fim = sql.indexOf("'::jsonb", inicio);
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);

    const doBanco = JSON.parse(sql.slice(inicio, fim)) as unknown;
    expect(lerTabelaSimples(doBanco)).toEqual(TABELA_SIMPLES_FALLBACK);
  });
});
