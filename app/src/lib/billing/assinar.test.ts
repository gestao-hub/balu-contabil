import { describe, it, expect } from 'vitest';
import { primeiroVencimento, DIAS_ATE_PRIMEIRO_VENCIMENTO, statusAoContratar } from './assinar';
import { statusEfetivo } from './status';

describe('primeiroVencimento', () => {
  it('soma os dias como data civil', () => {
    expect(primeiroVencimento('2026-07-27', 3)).toBe('2026-07-30');
  });

  it('atravessa a virada de mes', () => {
    expect(primeiroVencimento('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('atravessa a virada de ano', () => {
    expect(primeiroVencimento('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('atravessa 29 de fevereiro em ano bissexto', () => {
    expect(primeiroVencimento('2028-02-27', 3)).toBe('2028-03-01');
  });

  it('usa 3 dias por padrao', () => {
    expect(primeiroVencimento('2026-07-27')).toBe('2026-07-30');
    expect(DIAS_ATE_PRIMEIRO_VENCIMENTO).toBe(3);
  });
});

// DECISAO DE PRODUTO (27/07): CONTRATAR NAO LIBERA NADA. O acesso volta
// quando o PAGAMENTO e reconhecido — nunca no clique de assinar.
//
// `criarAssinaturaNoAsaas` nao toca em `status` nem em `trial_termina_em`
// por isso. Estes casos fixam a consequencia no gate: quem estava bloqueado
// continua bloqueado depois de contratar, e so 'ativa' (escrito pelo webhook
// ou pela reconciliacao) muda isso.
describe('acesso entre contratar e o primeiro pagamento', () => {
  it('quem estava bloqueado CONTINUA bloqueado depois de contratar', () => {
    const venc = primeiroVencimento('2026-07-27');           // 2026-07-30
    for (const anterior of ['inadimplente', 'cancelada'] as const) {
      // Mesmo com o vencimento gravado na linha e a data ainda por vir.
      expect(statusEfetivo({ status: anterior, trial_termina_em: venc }, '2026-07-28'))
        .toBe('bloqueado');
    }
  });

  it('so o pagamento reconhecido libera', () => {
    expect(statusEfetivo({ status: 'ativa', trial_termina_em: null }, '2026-07-28')).toBe('liberado');
  });

  // Contratar no meio de um teste vigente nao pode ENCURTAR o que ja foi
  // dado: o teste e prazo concedido, e independe de haver contrato.
  it('teste vigente continua valendo depois de contratar', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-08-03' }, '2026-07-28'))
      .toBe('liberado');
  });

  // ...e tambem nao pode ESTENDER. Uma versao anterior empurrava
  // `trial_termina_em` para o primeiro vencimento, o que dava ~3 dias de
  // acesso a quem so tinha clicado — credito, nao assinatura.
  it('teste vencido nao revive por causa da contratacao', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-07-26' }, '2026-07-28'))
      .toBe('bloqueado');
  });
});

// Achado no smoke: assinar -> cancelar -> re-assinar -> pagar, e o pagamento
// NUNCA era reconhecido. A linha ficava em 'cancelada', e todo caminho de
// reconciliacao exclui esse status de proposito (para que nenhuma cobranca
// atrasada do passado ressuscite conta encerrada). Re-contratar tem de tirar
// a linha de la.
describe('statusAoContratar', () => {
  it('cancelada vira inadimplente — bloqueia, mas e reconciliavel', () => {
    expect(statusAoContratar('cancelada')).toBe('inadimplente');
  });

  // DISCRIMINANTE: se devolvesse 'inadimplente' para todos, quem contratasse
  // no meio de um teste vigente seria BLOQUEADO pelo proprio ato de assinar.
  it('nao mexe em nenhum outro status', () => {
    for (const s of ['trial', 'ativa', 'inadimplente', 'cortesia']) {
      expect(statusAoContratar(s)).toBeNull();
    }
  });

  it('o estado resultante bloqueia ate o pagamento', () => {
    const depois = statusAoContratar('cancelada')!;
    expect(statusEfetivo({ status: depois, trial_termina_em: null }, '2026-07-28')).toBe('bloqueado');
  });
});
