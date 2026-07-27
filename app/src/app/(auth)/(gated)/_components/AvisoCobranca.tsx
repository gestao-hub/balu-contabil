// Bloco 4A — faixa de aviso de cobranca. AVISA, nunca bloqueia: o bloqueio
// mora na action (lib/billing/gate.ts).
//
// NAO renderizar em telas de direito do titular (exportar dados, excluir
// conta, dados pessoais). Ali a faixa sugeriria que o exercicio do direito
// depende de pagamento — exatamente o condicionamento que a LGPD art. 18
// §5º proibe, ao obrigar atendimento sem custo.
import Link from 'next/link';

/** Dias inteiros de hoje ate a data, em BRT. Meio-dia com offset fixo evita
 *  que o horario de execucao mude a contagem. */
function diasAte(ymd: string): number {
  const alvo = new Date(`${ymd}T12:00:00-03:00`).getTime();
  const agora = new Date().getTime();
  return Math.ceil((alvo - agora) / 86400000);
}

export default function AvisoCobranca({
  status, trialTerminaEm, href,
}: { status: string; trialTerminaEm: string | null; href: string }) {
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
      return (
        <div className="bg-sky-50 border-b border-sky-200 px-4 py-2 text-sm text-sky-900">
          {dias <= 0
            ? 'Seu período de teste terminou.'
            : `Seu período de teste termina em ${dias} dia${dias > 1 ? 's' : ''}.`}{' '}
          <Link href={href} className="underline font-medium">Assinar</Link>
        </div>
      );
    }
  }

  return null;
}
