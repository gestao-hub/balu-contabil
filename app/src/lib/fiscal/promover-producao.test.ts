// Sessão 35 — `decidirPromocao`: quando é seguro PEDIR produção à Focus.
//
// A função existe para não pedir à Focus o que `decidirCredencial` vai recusar
// no fim. Errar para o lado permissivo aqui não emite nota errada (a guarda de
// emissão continua depois), mas deixa o estado da Focus à frente do nosso — a
// empresa habilitada lá e em homologação aqui.
//
// Todas as asserções são POSITIVAS de propósito. A lição da sessão 33: uma
// asserção negativa (`expect(x).not.toBe(y)`) passa com o ramo vazio, e foi
// assim que a sonda do token aprovou o token errado por 35 dias.
import { describe, it, expect } from 'vitest';
import {
  decidirPromocao,
  mensagemPromocao,
  MENSAGEM_NAO_PROMOVIDA,
  type EstadoPromocao,
} from '@/lib/fiscal/promover-producao';

const AGORA = new Date('2026-08-27T12:00:00.000Z');
const CERT_VALIDO = '2027-03-20T20:50:54.000Z';   // o A1 real da AL PISCINAS
const CERT_VENCIDO = '2026-01-01T00:00:00.000Z';

/** O estado que PASSA. Cada teste estraga exatamente um campo. */
const APTO: EstadoPromocao = {
  origem: 'balu',
  ambiente: 'hom',
  focusEmpresaId: 216964,
  temTokenProducao: true,
  certNotAfter: CERT_VALIDO,
};

describe('decidirPromocao — o caminho que abre', () => {
  it('promove a empresa da conta da Balu, cadastrada, com token de produção e A1 válido', () => {
    expect(decidirPromocao(APTO, AGORA)).toEqual({ promover: true });
  });
});

describe('decidirPromocao — os cinco motivos de não tentar', () => {
  it('não tenta de novo quando a empresa já está em produção', () => {
    const r = decidirPromocao({ ...APTO, ambiente: 'prod' }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'ja_em_producao' });
  });

  it('não tenta quando a conta na Focus é do próprio cliente', () => {
    // O PUT /v2/empresas/:id é aberto pela credencial da PLATAFORMA; com origem
    // 'propria' o token que temos é o da empresa e leva 401.
    const r = decidirPromocao({ ...APTO, origem: 'propria' }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'origem_propria' });
  });

  it('não tenta quando a empresa nunca foi cadastrada na Focus', () => {
    const r = decidirPromocao({ ...APTO, focusEmpresaId: null }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'nao_cadastrada_na_focus' });
  });

  it('não tenta sem token de produção — o estado de TODA empresa hoje', () => {
    const r = decidirPromocao({ ...APTO, temTokenProducao: false }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'sem_token_producao' });
  });

  it('não tenta com o certificado vencido', () => {
    const r = decidirPromocao({ ...APTO, certNotAfter: CERT_VENCIDO }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'certificado_invalido' });
  });

  it('não tenta sem certificado nenhum', () => {
    const r = decidirPromocao({ ...APTO, certNotAfter: null }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'certificado_invalido' });
  });
});

describe('decidirPromocao — a ordem das checagens', () => {
  it('empresa já em produção responde "já em produção", mesmo com tudo mais faltando', () => {
    // Importa porque `ja_em_producao` é o único motivo que o chamador NÃO avisa
    // na tela. Se a ordem mudasse, o cliente veria "sem token de produção" numa
    // empresa que está emitindo em produção há meses.
    const r = decidirPromocao(
      { origem: 'propria', ambiente: 'prod', focusEmpresaId: null, temTokenProducao: false, certNotAfter: null },
      AGORA,
    );
    expect(r).toEqual({ promover: false, motivo: 'ja_em_producao' });
  });

  it('a conta do cliente vem antes do que falta no nosso lado', () => {
    const r = decidirPromocao(
      { ...APTO, origem: 'propria', focusEmpresaId: null, temTokenProducao: false },
      AGORA,
    );
    expect(r).toEqual({ promover: false, motivo: 'origem_propria' });
  });

  it('o cadastro na Focus vem antes do token — sem empresa lá, não há token a esperar', () => {
    const r = decidirPromocao({ ...APTO, focusEmpresaId: null, temTokenProducao: false }, AGORA);
    expect(r).toEqual({ promover: false, motivo: 'nao_cadastrada_na_focus' });
  });
});

describe('decidirPromocao — a data é injetada, não lida do relógio', () => {
  it('o mesmo certificado vale antes do vencimento e não vale depois', () => {
    const estado = { ...APTO, certNotAfter: '2026-09-01T00:00:00.000Z' };
    expect(decidirPromocao(estado, new Date('2026-08-31T23:59:00.000Z'))).toEqual({ promover: true });
    expect(decidirPromocao(estado, new Date('2026-09-01T00:01:00.000Z')))
      .toEqual({ promover: false, motivo: 'certificado_invalido' });
  });
});

describe('mensagemPromocao — o texto que chega na tela', () => {
  it('anuncia a liberação quando deu certo', () => {
    expect(mensagemPromocao({ liberada: true })).toBe('Emissão em produção liberada para esta empresa.');
  });

  it('repassa o motivo de não ter tentado', () => {
    expect(mensagemPromocao({ liberada: false, motivo: 'sem_token_producao' }))
      .toBe(MENSAGEM_NAO_PROMOVIDA.sem_token_producao);
  });

  it('mostra o erro da Focus, truncado', () => {
    const detalhe = 'x'.repeat(500);
    const msg = mensagemPromocao({ liberada: false, motivo: 'focus_recusou', detalhe });
    expect(msg.startsWith('A Focus recusou a habilitação de produção: ')).toBe(true);
    expect(msg.length).toBe('A Focus recusou a habilitação de produção: '.length + 200);
  });

  it('explica que a Focus aceitou mas ainda não confirmou', () => {
    expect(mensagemPromocao({ liberada: false, motivo: 'focus_nao_confirmou' }))
      .toContain('ainda não confirmou a habilitação de produção');
  });

  it('usa a mensagem da guarda de emissão quando é ela que recusa', () => {
    expect(mensagemPromocao({ liberada: false, motivo: 'guarda_recusou', detalhe: 'certificado_invalido' }))
      .toBe('Emissão em produção exige certificado A1 válido. O certificado está vencido ou não foi enviado.');
  });

  it('avisa que a habilitação veio mas o save não pegou', () => {
    expect(mensagemPromocao({ liberada: false, motivo: 'nao_gravou' }))
      .toContain('não foi possível salvar');
  });
});
