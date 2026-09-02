import { redirect } from 'next/navigation';

/**
 * A tela de assinatura virou UMA só em 02/09/2026 (ver
 * `conta/assinatura/page.tsx`): o menu listava duas entradas com o mesmo
 * rótulo, e o contador com empresa própria via as duas sem saber de quem era
 * cada uma.
 *
 * Esta rota FICA, e só redireciona. Ela é destino de link em cinco lugares que
 * não passam por menu nenhum — os avisos do cron (`lib/billing/cron.ts`),
 * `lib/billing/resumo.ts`, `contador/clientes/novo`,
 * `contador/clientes/[companyId]` e `HonorariosV2List` — além de estar em
 * e-mails já enviados e em favoritos de quem usa. Apagar a rota para arrumar um
 * item de menu quebraria tudo isso sem ganhar nada.
 */
export default function Page() {
  redirect('/conta/assinatura');
}
