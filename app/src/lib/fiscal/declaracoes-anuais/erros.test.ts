// Mensagem de erro dos formulários de declaração anual + schemas de rascunho.
// Nasceu de um bug de smoke: "Salvar rascunho" do DEFIS só dizia "Required".
import { describe, it, expect } from 'vitest';
import { mensagemDeIssues } from './erros';
import { DefisCamposSchema, DefisRascunhoSchema, rotuloCampoDefis } from '../defis/campos';
import { DasnRascunhoSchema, rotuloCampoDasn } from '../dasn/campos';
import { defisVazio } from '../defis/campos';

const erroDe = (r: { success: boolean; error?: { issues: unknown } }) =>
  (r as { error: { issues: Parameters<typeof mensagemDeIssues>[0] } }).error.issues;

describe('rascunho aceita formulário pela metade', () => {
  it('DEFIS em branco salva como rascunho', () => {
    expect(DefisRascunhoSchema.safeParse(defisVazio()).success).toBe(true);
  });

  it('DEFIS com um campo só salva como rascunho', () => {
    expect(DefisRascunhoSchema.safeParse({ receitaBrutaTotal: 4500 }).success).toBe(true);
  });

  it('DASN em branco salva como rascunho', () => {
    expect(DasnRascunhoSchema.safeParse({}).success).toBe(true);
  });

  it('mas o rascunho ainda barra valor inválido no que foi preenchido', () => {
    expect(DefisRascunhoSchema.safeParse({ receitaBrutaTotal: -1 }).success).toBe(false);
    expect(DasnRascunhoSchema.safeParse({ receitaComercio: -1 }).success).toBe(false);
  });

  // Discriminante: se o schema de entrega também tivesse virado partial, os
  // testes acima passariam sem provar nada.
  it('a ENTREGA continua exigindo o formulário inteiro', () => {
    expect(DefisCamposSchema.safeParse(defisVazio()).success).toBe(false);
  });
});

describe('mensagemDeIssues', () => {
  it('nomeia o campo em vez de devolver "Required"', () => {
    const r = DefisCamposSchema.safeParse({ ...defisVazio(), socios: [] });
    const msg = mensagemDeIssues(erroDe(r), rotuloCampoDefis);
    expect(msg).not.toMatch(/Required/i);
    expect(msg).toContain('Houve cisão, fusão, incorporação ou extinção?');
  });

  it('resume quando há muitos campos, sem despejar os 22', () => {
    const r = DefisCamposSchema.safeParse({ ...defisVazio(), socios: [] });
    const msg = mensagemDeIssues(erroDe(r), rotuloCampoDefis);
    expect(msg).toMatch(/e mais \d+ campos?\./);
    expect(msg.split('·').length).toBeLessThanOrEqual(3);
  });

  it('identifica o sócio pelo número e pelo campo', () => {
    const r = DefisCamposSchema.safeParse({
      ...defisVazio(), houveEvento: false, eventoTipo: null, eventoData: null,
      ganhosCapital: 0, doacoesCampanhaEleitoral: 0, empregadosInicio: 0, empregadosFim: 0,
      receitaMercadoInterno: 0, receitaMercadoExterno: 0, receitaBrutaTotal: 0, totalDespesas: 0,
      estoqueInicial: 0, estoqueFinal: 0, saldoCaixaInicio: 0, saldoCaixaFim: 0,
      aquisicoesMercadoInterno: 0, aquisicoesMercadoExterno: 0, creditosIcmsIssRetido: 0,
      socios: [{ cpf: '123', nome: 'Ana Maria', participacaoPct: 100, proLabore: 0, lucroDistribuido: 0, impostoRetido: 0 }],
    });
    const msg = mensagemDeIssues(erroDe(r), rotuloCampoDefis);
    expect(msg).toContain('Sócio 1');
    expect(msg).toContain('CPF');
  });

  it('preserva a mensagem de produto quando ela existe', () => {
    const r = DasnRascunhoSchema.safeParse({ receitaComercio: -1 });
    expect(mensagemDeIssues(erroDe(r), rotuloCampoDasn))
      .toContain('não pode ser negativa');
  });
});
