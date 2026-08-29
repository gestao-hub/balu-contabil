// BUG-004 (auditoria 29/08/2026) — a validação falava inglês, e cobrava campos
// que não estavam marcados como obrigatórios.
//
// Os dois sintomas vinham de causas diferentes, e cada um tem seu bloco:
//   (a) idioma: 109 dos 174 usos de `z.` em `types/zod.ts` não têm `message`
//       própria e caíam no texto padrão da lib;
//   (b) obrigatoriedade fantasma: `.optional()` aceita AUSENTE, não VAZIO — e
//       o formulário manda `''`.
//
// Importar `@/types/zod` é o que instala o errorMap (ver o topo daquele
// arquivo), então este teste também prova que a instalação acontece de fato.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ClienteSchema } from '@/types/zod';

/** Primeira mensagem de erro de um parse que deve falhar. */
function erroDe(schema: z.ZodTypeAny, valor: unknown): string {
  const r = schema.safeParse(valor);
  if (r.success) throw new Error('esperava falha de validação, mas passou');
  return r.error.issues[0].message;
}

describe('errorMap pt-BR — nenhuma mensagem padrão em ingles escapa', () => {
  it('campo ausente vira "Campo obrigatório."', () => {
    expect(erroDe(z.object({ nome: z.string() }), {})).toBe('Campo obrigatório.');
  });

  it('e-mail invalido', () => {
    expect(erroDe(z.string().email(), 'nao-e-email')).toBe('E-mail inválido.');
  });

  // A mensagem literal que a auditoria fotografou na tela.
  it('length(2) vira "Deve ter exatamente 2 caracteres.", nao "String must contain..."', () => {
    expect(erroDe(z.string().length(2), 'SPX')).toBe('Deve ter exatamente 2 caracteres.');
  });

  it('min(2) pede o minimo, e min(1) vira obrigatorio', () => {
    expect(erroDe(z.string().min(2), 'a')).toBe('Informe ao menos 2 caracteres.');
    expect(erroDe(z.string().min(1), '')).toBe('Campo obrigatório.');
  });

  it('singular de caractere nao sai "1 caracteres"', () => {
    expect(erroDe(z.string().length(1), 'ab')).toBe('Deve ter exatamente 1 caractere.');
  });

  it('numero fora da faixa, enum e tipo errado', () => {
    expect(erroDe(z.number().min(0).max(9), 20)).toBe('Deve ser no máximo 9.');
    expect(erroDe(z.enum(['PF', 'PJ']), 'XX')).toBe('Opção inválida.');
    expect(erroDe(z.number(), 'abc')).toBe('Informe um número.');
  });

  it('array vazio pede um item', () => {
    expect(erroDe(z.array(z.string()).min(1), [])).toBe('Adicione ao menos um item.');
  });

  // A regra de precedência que torna isto seguro de instalar: nada do que já
  // estava escrito em português foi sobrescrito.
  it('mensagem propria do schema VENCE o errorMap global', () => {
    expect(erroDe(z.string().length(14, 'CNPJ deve ter 14 dígitos.'), '123'))
      .toBe('CNPJ deve ter 14 dígitos.');
    expect(erroDe(z.string().refine(() => false, 'CNPJ inválido.'), 'x'))
      .toBe('CNPJ inválido.');
  });

  it('nenhuma mensagem gerada contem texto em ingles da lib', () => {
    // Rede larga: varre os casos que o app mais produz e falha se qualquer um
    // voltar a vazar o padrão da biblioteca.
    const casos: Array<[z.ZodTypeAny, unknown]> = [
      [z.object({ a: z.string() }), {}],
      [z.string().email(), 'x'],
      [z.string().length(2), 'abc'],
      [z.string().min(3), 'a'],
      [z.string().max(2), 'abcd'],
      [z.number(), 'a'],
      [z.number().min(1), 0],
      [z.enum(['a', 'b']), 'c'],
      [z.array(z.string()).min(1), []],
      [z.string().uuid(), 'x'],
      [z.string().url(), 'x'],
    ];
    for (const [schema, valor] of casos) {
      const msg = erroDe(schema, valor);
      expect(msg).not.toMatch(/String must|Invalid|Expected|Required|Number must|Array must/i);
    }
  });
});

describe('ClienteSchema — obrigatoriedade fantasma (E-mail e UF)', () => {
  const MINIMO = {
    person_type: 'PJ' as const,
    razao_social: 'Cliente Teste LTDA',
    document: '11222333000181',
  };

  // O caso EXATO da auditoria: abrir "Novo cliente" e salvar. O formulário
  // inicializa os opcionais com '' (ver EMPTY em ClienteFormDialog).
  it('formulario com opcionais VAZIOS passa — eles nunca foram obrigatorios', () => {
    const r = ClienteSchema.safeParse({
      ...MINIMO,
      email: '', uf: '', telefone: '', cep: '', municipio: '',
      logradouro: '', numero: '', complemento: '', bairro: '',
      inscricao_estadual: '', inscricao_municipal: '',
    });
    expect(r.success).toBe(true);
  });

  // A outra metade: vazio vira AUSENTE, e não `''` gravado no banco onde o
  // certo é NULL.
  it('campo vazio nao chega como string vazia no dado validado', () => {
    const r = ClienteSchema.parse({ ...MINIMO, email: '', uf: '   ' });
    expect(r.email).toBeUndefined();
    expect(r.uf).toBeUndefined();
  });

  it('valor preenchido continua sendo validado de verdade', () => {
    expect(ClienteSchema.safeParse({ ...MINIMO, email: 'nao-e-email' }).success).toBe(false);
    expect(ClienteSchema.safeParse({ ...MINIMO, uf: 'SPX' }).success).toBe(false);
    expect(ClienteSchema.safeParse({ ...MINIMO, email: 'a@b.com', uf: 'SP' }).success).toBe(true);
  });

  it('o que E obrigatorio continua obrigatorio', () => {
    expect(ClienteSchema.safeParse({ ...MINIMO, razao_social: '' }).success).toBe(false);
    expect(ClienteSchema.safeParse({ ...MINIMO, document: '' }).success).toBe(false);
  });
});
