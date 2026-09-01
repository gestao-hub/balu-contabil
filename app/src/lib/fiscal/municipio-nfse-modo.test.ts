import { describe, it, expect, vi } from 'vitest';
import { classificarModoNfse, modoNfseDoMunicipio } from './municipio-nfse-modo';

// Stub mínimo de `supabase.from('municipios_nfse').select().eq().maybeSingle()`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(resposta: { data?: unknown; error?: { message: string } }): any {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: resposta.data ?? null, error: resposta.error ?? null }),
        }),
      }),
    }),
  };
}

const FLORIPA = '4205407';
const LONDRINA = '4113700';

describe('classificarModoNfse', () => {
  it('provedor Nacional → nacional', () => {
    expect(classificarModoNfse({ provedor_nfse: 'Nacional', nfse_habilitada: true })).toBe('nacional');
  });

  // 117 municípios usam as variantes; comparar por igualdade exata os deixaria
  // de fora à toa, e todos são atendidos pelo mesmo /v2/nfsen.
  it('variantes NacionalBetha101 / NacionalPronim101 também são nacional', () => {
    expect(classificarModoNfse({ provedor_nfse: 'NacionalBetha101', nfse_habilitada: true })).toBe('nacional');
    expect(classificarModoNfse({ provedor_nfse: 'NacionalPronim101', nfse_habilitada: true })).toBe('nacional');
  });

  it('provedor próprio do município → legado (vai exigir login/senha da prefeitura)', () => {
    expect(classificarModoNfse({ provedor_nfse: 'Fiorilli', nfse_habilitada: true })).toBe('legado');
    expect(classificarModoNfse({ provedor_nfse: 'WebISS2', nfse_habilitada: true })).toBe('legado');
  });

  it('sem provedor → indisponível (a Focus não atende NFS-e ali)', () => {
    expect(classificarModoNfse({ provedor_nfse: null, nfse_habilitada: false })).toBe('indisponivel');
    expect(classificarModoNfse({ provedor_nfse: '', nfse_habilitada: true })).toBe('indisponivel');
    expect(classificarModoNfse(null)).toBe('indisponivel');
  });

  it('provedor presente mas nfse_habilitada=false → indisponível', () => {
    expect(classificarModoNfse({ provedor_nfse: 'Fiorilli', nfse_habilitada: false })).toBe('indisponivel');
  });
});

describe('modoNfseDoMunicipio', () => {
  // O CASO QUE MOTIVOU O MÓDULO. Até 01/09/2026 a resposta saía de um Map
  // escrito à mão com Londrina e mais nada — Florianópolis (a MCB MARKETING)
  // era tratada como município legado, e o Balu tentaria habilitar NFS-e por um
  // caminho que exige login e senha de prefeitura que ele não tem.
  it('Florianópolis é nacional — o banco decide, não a lista escrita à mão', async () => {
    const modo = await modoNfseDoMunicipio(sb({ data: { provedor_nfse: 'Nacional', nfse_habilitada: true } }), FLORIPA);
    expect(modo).toBe('nacional');
  });

  it('sem código IBGE → indisponível, sem ir ao banco', async () => {
    expect(await modoNfseDoMunicipio(sb({ data: null }), null)).toBe('indisponivel');
    expect(await modoNfseDoMunicipio(sb({ data: null }), '')).toBe('indisponivel');
  });

  // A lista escrita à mão continua servindo para o município que aderiu DEPOIS
  // da última sincronização do cron — mas só pode dizer SIM.
  it('lista escrita à mão promove a nacional o que o banco ainda não sabe', async () => {
    const modo = await modoNfseDoMunicipio(
      sb({ data: { provedor_nfse: 'Fiorilli', nfse_habilitada: true } }),
      LONDRINA,
      new Date('2026-05-28'),
    );
    expect(modo).toBe('nacional');
  });

  it('a lista NUNCA rebaixa: banco diz nacional e ela não conhece → nacional', async () => {
    const modo = await modoNfseDoMunicipio(sb({ data: { provedor_nfse: 'Nacional', nfse_habilitada: true } }), '9999999');
    expect(modo).toBe('nacional');
  });

  // Direção segura: ligar NFS-e nacional num município que não adere faz a Focus
  // aceitar o cadastro e a emissão falhar depois, na frente do cliente.
  it('falha de leitura NÃO vira nacional', async () => {
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    const modo = await modoNfseDoMunicipio(sb({ error: { message: 'timeout' } }), FLORIPA);
    expect(modo).toBe('indisponivel');
    aviso.mockRestore();
  });

  it('falha de leitura cai para a lista escrita à mão quando ela conhece o município', async () => {
    const aviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    const modo = await modoNfseDoMunicipio(sb({ error: { message: 'timeout' } }), LONDRINA, new Date('2026-05-28'));
    expect(modo).toBe('nacional');
    aviso.mockRestore();
  });
});
