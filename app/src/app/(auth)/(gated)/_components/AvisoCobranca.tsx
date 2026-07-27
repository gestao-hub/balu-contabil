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
  status, trialTerminaEm, href, contratada = false,
}: {
  status: string; trialTerminaEm: string | null; href: string;
  /** true quando já existe assinatura no Asaas. Muda o tom da tarja: quem
   *  contratou vê a fatura, não um convite a contratar. */
  contratada?: boolean;
}) {
  const pathname = usePathname();
  if (!faixaPermitida(pathname ?? '')) return null;

  if (status === 'inadimplente') {
    return (
      <div className="border-b border-alert/40 bg-alert/10 px-4 py-2 text-sm text-alert">
        Há uma cobrança em aberto.{' '}
        <Link href={href} className="font-medium underline">Ver assinatura</Link>
      </div>
    );
  }

  // JÁ CONTRATOU: está em 'trial' só até o primeiro boleto compensar. Mandar
  // "assine" quem acabou de assinar é o que fazia a tarja parecer que o
  // clique não tinha surtido efeito (smoke de 27/07).
  if (status === 'trial' && contratada && trialTerminaEm) {
    const dias = diasAte(trialTerminaEm);
    return (
      <div className="border-b border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary">
        {dias < 0 ? 'Sua fatura está vencida.'
          : dias === 0 ? 'Sua fatura vence hoje.'
          : `Sua fatura vence em ${dias} dia${dias > 1 ? 's' : ''}.`}{' '}
        <Link href={href} className="font-medium underline">Ver fatura</Link>
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
        <div className="border-b border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary">
          {texto} <Link href={href} className="font-medium underline">Assinar</Link>
        </div>
      );
    }
  }

  return null;
}
