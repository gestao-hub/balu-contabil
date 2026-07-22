// src/lib/fiscal/semaforo.ts
// Única fonte da regra "cliente irregular" (spec Bloco A). Textos em pt simples + norma (didático).
import { mesBrt } from './tempo-brt';

export type RegimeCode = '1' | '2' | '3' | '4';
export type FatosCliente = {
  regimeCode: RegimeCode | null;
  dasVencidos: number;
  pgdasMesAnteriorTransmitida: boolean;
  dasnAnoAnteriorTransmitida: boolean;
  faturamentoAno: number;
  certNotAfter: string | null;
};
export type Motivo = { texto: string; norma: string };
export type Semaforo = { cor: 'vermelho' | 'amarelo' | 'verde'; motivos: Motivo[] };

const DIA_MS = 86_400_000;

export function classificarSemaforo(
  f: FatosCliente,
  limites: { mei: number; simples: number },
  hoje: Date = new Date(),
): Semaforo {
  const vermelhos: Motivo[] = [];
  const amarelos: Motivo[] = [];
  const isMei = f.regimeCode === '4';
  const isSimples = f.regimeCode === '1' || f.regimeCode === '2';

  if (f.dasVencidos > 0) vermelhos.push({
    texto: `${f.dasVencidos} guia(s) DAS vencida(s) sem pagamento registrado.`,
    norma: 'LC 123/2006, art. 21',
  });
  if (isSimples && !f.pgdasMesAnteriorTransmitida) vermelhos.push({
    texto: 'A declaração mensal (PGDAS-D) do mês passado ainda não foi transmitida — o prazo é o dia 20.',
    norma: 'Res. CGSN 140/2018, art. 38',
  });
  const aposPrazoDasn = mesBrt(hoje) > 5; // após 31/05 (mês em BRT, não UTC/local do server)
  if (isMei && aposPrazoDasn && !f.dasnAnoAnteriorTransmitida) vermelhos.push({
    texto: 'A declaração anual do MEI (DASN-SIMEI) do ano passado não foi entregue — o prazo era 31/05.',
    norma: 'Res. CGSN 140/2018, art. 109',
  });

  const limite = isMei ? limites.mei : isSimples ? limites.simples : null;
  if (limite && f.faturamentoAno >= limite * 0.8) amarelos.push({
    texto: `Faturamento do ano já usou ${Math.round((f.faturamentoAno / limite) * 100)}% do limite do regime.`,
    norma: isMei ? 'LC 123/2006, art. 18-A, §1º' : 'LC 123/2006, art. 3º, II',
  });
  if (f.certNotAfter) {
    const dias = Math.floor((new Date(f.certNotAfter).getTime() - hoje.getTime()) / DIA_MS);
    if (dias < 30) amarelos.push({
      texto: dias < 0 ? 'Certificado digital A1 vencido — a emissão de notas para.'
        : `Certificado digital A1 vence em ${dias} dia(s).`,
      norma: 'exigência de emissão (ICP-Brasil, MP 2.200-2/2001)',
    });
  }

  if (vermelhos.length) return { cor: 'vermelho', motivos: [...vermelhos, ...amarelos] };
  if (amarelos.length) return { cor: 'amarelo', motivos: amarelos };
  return { cor: 'verde', motivos: [] };
}
