import { describe, it, expect } from 'vitest';
import { parseDasMei } from './das-mei-parse';

// SMOKE: envelope REAL capturado do ambiente Trial da SERPRO (PGMEI / GERARDASPDF21),
// CNPJ demo 00000000000100, período 201901, em 2026-06-06.
// Auth do Trial = só o Bearer demo fixo (sem mTLS/consumer-key/procurador).
// Endpoint: gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Emitir
// PDF redigido (era ~213k chars base64). Mantém composicao/observacao/dataLimiteAcolhimento
// de propósito: provam que o parser tolera campos extras do envelope real.
const TRIAL_ENVELOPE = {
  status: '200',
  mensagens: [{ codigo: '[Sucesso-PGMEI]', texto: 'Requisição efetuada com sucesso.' }],
  dados: JSON.stringify([
    {
      cnpjCompleto: '00000000000100',
      razaoSocial: 'EXEMPLO',
      pdf: 'JVBERi0xLjUK', // redigido
      detalhamento: [
        {
          periodoApuracao: '201901',
          numeroDocumento: '00000000000000000',
          dataVencimento: '20190220',
          dataLimiteAcolhimento: '20220831',
          valores: { principal: 55.9, multa: 11.18, juros: 10.71, total: 77.79 },
          observacao1: 'CPF: 000.000.000-00',
          observacao2: 'Tributos (R$): INSS 49,90 ICMS 1,00 ISS 5,00',
          observacao3: 'PGMEI(Versao:3.8.0)',
          composicao: [
            { periodoApuracao: 201901, codigo: '0151', denominacao: 'INSS - SIMPLES NACIONAL - MEI - 01/2019', valores: { principal: 49.9, multa: 9.98, juros: 9.56, total: 69.44 } },
            { periodoApuracao: 201901, codigo: '0083', denominacao: 'ICMS - SIMPLES NACIONAL - MEI - PB - 01/2019', valores: { principal: 1, multa: 0.2, juros: 0.19, total: 1.39 } },
            { periodoApuracao: 201901, codigo: '0125', denominacao: 'ISS - SIMPLES NACIONAL - MEI - SUME (PB) - 01/2019', valores: { principal: 5, multa: 1, juros: 0.96, total: 6.96 } },
          ],
        },
      ],
    },
  ]),
};

describe('parseDasMei — smoke contra resposta real do Trial SERPRO', () => {
  it('parseia o envelope real (GERARDASPDF21) sem erro', () => {
    const r = parseDasMei(TRIAL_ENVELOPE);
    expect(r.numeroDocumento).toBe('00000000000000000');
    expect(r.dataVencimento).toBe('2019-02-20'); // AAAAMMDD → ISO
    expect(r.valores).toEqual({ principal: 55.9, multa: 11.18, juros: 10.71, total: 77.79 });
    expect(r.pdfBase64).toBe('JVBERi0xLjUK');
  });

  it('GERARDASPDF21 não traz codigoDeBarras → array vazio (não quebra)', () => {
    // O código de barras vem só no GERARDASCODBARRA22; o parser deve tolerar a ausência.
    expect(parseDasMei(TRIAL_ENVELOPE).codigoDeBarras).toEqual([]);
  });
});
