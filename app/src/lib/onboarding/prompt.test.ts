import { describe, it, expect } from 'vitest';
import { montarPromptOnboarding, lerRespostaModelo } from './prompt';

describe('montarPromptOnboarding', () => {
  it('não carrega dado pessoal — só o que já foi redigido', () => {
    const p = montarPromptOnboarding({
      historico: [{ de: 'usuario', texto: 'meu cnpj é ⟨CNPJ⟩ e o email ⟨EMAIL⟩' }],
      campoPendente: 'cnpj', intencaoAtual: 'empresa_existente',
    });
    expect(p).toContain('⟨CNPJ⟩');
    expect(p).not.toMatch(/\d{6,}/);
  });

  it('limita a memória aos últimos turnos', () => {
    // O estado real mora na máquina; mandar a conversa inteira só aumenta
    // custo e chance de o modelo se apoiar em algo velho.
    const historico = Array.from({ length: 20 }, (_, i) => ({ de: 'usuario' as const, texto: `turno ${i}` }));
    const p = montarPromptOnboarding({ historico, campoPendente: 'intencao', intencaoAtual: 'indefinido' });
    expect(p).toContain('turno 19');
    expect(p).not.toContain('turno 5');
  });

  it('proíbe orientação fiscal e confirmação de cadastro', () => {
    const p = montarPromptOnboarding({ historico: [], campoPendente: 'intencao', intencaoAtual: 'indefinido' });
    expect(p).toContain('Nunca confirme que algo foi cadastrado');
    expect(p).toContain('Nunca dê orientação fiscal');
  });
});

describe('lerRespostaModelo', () => {
  it('lê o JSON esperado', () => {
    expect(lerRespostaModelo('{"pergunta":"Qual o CNPJ?","intencao":"empresa_existente"}'))
      .toEqual({ pergunta: 'Qual o CNPJ?', intencao: 'empresa_existente' });
  });

  it('aceita JSON embrulhado em cerca markdown', () => {
    // Já aconteceu neste projeto (Bloco 6B): o modelo devolve ```json ... ```
    // mesmo com o prompt pedindo só JSON.
    const r = lerRespostaModelo('```json\n{"pergunta":"Oi!","intencao":"indefinido"}\n```');
    expect(r?.pergunta).toBe('Oi!');
  });

  it('devolve null quando não é JSON', () => {
    expect(lerRespostaModelo('Claro! Qual seu CNPJ?')).toBeNull();
  });

  it('devolve null quando falta a pergunta', () => {
    // JSON válido, forma errada — `pergunta: undefined` chegaria na tela como
    // bolha vazia do assistente.
    expect(lerRespostaModelo('{"intencao":"contador"}')).toBeNull();
    expect(lerRespostaModelo('{"pergunta":"   ","intencao":"contador"}')).toBeNull();
  });

  it('intenção desconhecida vira indefinido, não quebra', () => {
    expect(lerRespostaModelo('{"pergunta":"Oi","intencao":"vendedor"}'))
      .toEqual({ pergunta: 'Oi', intencao: 'indefinido' });
  });

  it('corta resposta gigante', () => {
    const r = lerRespostaModelo(JSON.stringify({ pergunta: 'a'.repeat(900), intencao: 'indefinido' }));
    expect(r?.pergunta.length).toBe(400);
  });
});
