// Bloco 4A — faixa de aviso de cobranca. AVISA, nunca bloqueia: o bloqueio
// mora na action (lib/billing/gate.ts).
//
// NAO renderizar em telas de direito do titular (exportar dados, excluir
// conta, dados pessoais). Ali a faixa sugeriria que o exercicio do direito
// depende de pagamento — exatamente o condicionamento que a LGPD art. 18
// §5º proibe, ao obrigar atendimento sem custo.
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Telas onde a faixa NUNCA aparece — exercício de direito do titular
 * (LGPD art. 18: acesso, correção, portabilidade, eliminação) e o §5º, que
 * obriga atendimento sem custo. Mostrar cobrança acima do botão de exportar
 * ou excluir dados sugere que o direito depende de pagamento.
 *
 * É prefixo: `/conta` cobre `/conta/dados`, e a exceção logo abaixo devolve
 * a faixa para `/conta/assinatura`, que é justamente onde ela ajuda.
 */
const SEM_FAIXA = ['/conta', '/aceite'];

export function faixaPermitida(pathname: string): boolean {
  if (pathname.startsWith('/conta/assinatura')) return true;
  return !SEM_FAIXA.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Dia corrente em BRT (YYYY-MM-DD), a MESMA base que `statusEfetivo` usa.
 *  Comparar datas civis, e não instantes, evita a faixa dizer "terminou" às
 *  15h de um dia em que o gate ainda libera. */
function hojeBrt(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Dias civis inteiros entre hoje e a data, em BRT. */
function diasAte(ymd: string): number {
  const a = Date.parse(`${hojeBrt()}T00:00:00Z`);
  const b = Date.parse(`${ymd}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export default function AvisoCobranca({
  status, trialTerminaEm, href,
}: { status: string; trialTerminaEm: string | null; href: string }) {
  const pathname = usePathname();
  if (!faixaPermitida(pathname ?? '')) return null;

  if (status === 'inadimplente') {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900">
        Há uma cobrança em aberto.{' '}
        <Link href={href} className="underline font-medium">Ver assinatura</Link>
      </div>
    );
  }

  if (status === 'trial' && trialTerminaEm) {
    const dias = diasAte(trialTerminaEm);
    if (dias <= 3) {
      // `dias === 0` é o ÚLTIMO dia do teste e o gate ainda libera
      // (statusEfetivo usa `hoje <= trial_termina_em`). Dizer "terminou"
      // aqui contradiria o app, que continua funcionando.
      const texto =
        dias < 0 ? 'Seu período de teste terminou.'
        : dias === 0 ? 'Seu período de teste termina hoje.'
        : `Seu período de teste termina em ${dias} dia${dias > 1 ? 's' : ''}.`;
      return (
        <div className="bg-sky-50 border-b border-sky-200 px-4 py-2 text-sm text-sky-900">
          {texto} <Link href={href} className="underline font-medium">Assinar</Link>
        </div>
      );
    }
  }

  return null;
}
