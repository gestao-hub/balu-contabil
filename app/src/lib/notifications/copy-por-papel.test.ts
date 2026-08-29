import { describe, it, expect } from 'vitest';
import { subtituloPorPapel } from './copy-por-papel';

describe('subtituloPorPapel (BUG-007)', () => {
  it('cada papel recebe a frase dele', () => {
    expect(subtituloPorPapel('empresa')).toMatch(/sua empresa/i);
    expect(subtituloPorPapel('contador')).toMatch(/escritório/i);
    expect(subtituloPorPapel('adminbalu')).toMatch(/plataforma/i);
  });

  // O achado literal da auditoria: o Admin lendo texto de Empresa.
  it('NINGUEM alem da Empresa le "sua empresa"', () => {
    for (const papel of ['contador', 'adminbalu', null, undefined, '', 'papel-novo']) {
      expect(subtituloPorPapel(papel)).not.toMatch(/sua empresa/i);
    }
  });

  it('papel desconhecido cai no neutro, e nao na frase da Empresa', () => {
    // Um papel novo no enum sem entrada aqui é o jeito mais provável de o
    // defeito voltar. O default tem de ser verdadeiro para qualquer leitor.
    expect(subtituloPorPapel('auditor')).toBe('Seus avisos e lembretes.');
    expect(subtituloPorPapel(null)).toBe('Seus avisos e lembretes.');
  });

  it('aceita o papel como vem do banco, com maiuscula', () => {
    // `role_types.type` guarda 'Contador'/'AdminBalu'; `normalizedRole` já
    // minusculiza, mas a função não pode depender de quem chama lembrar disso.
    expect(subtituloPorPapel('AdminBalu')).toMatch(/plataforma/i);
    expect(subtituloPorPapel('Contador')).toMatch(/escritório/i);
  });
});
