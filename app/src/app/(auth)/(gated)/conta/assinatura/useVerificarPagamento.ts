'use client';
// Bloco 4A — a tela se atualiza sozinha quando o pagamento cai.
//
// POR QUE NAO BASTA O WEBHOOK: ele avisa o SERVIDOR, e o navegador que ja
// renderizou a pagina nao fica sabendo de nada. O titular pagava em outra
// aba, voltava e continuava vendo "aguardando pagamento" ate recarregar na
// mao — parecia que o pagamento nao tinha valido.
//
// POR QUE NAO REALTIME DO SUPABASE: exigiria publicar a tabela `assinaturas`
// no realtime e uma policy so para isso, para uma janela de segundos. Uma
// consulta de conveniencia enquanto a aba esta aberta resolve com menos
// superficie.
//
// CUSTO CONTROLADO — a consulta bate no Asaas, entao:
//   · so roda quando ha o que esperar (contratada e ainda nao 'ativa');
//   · so roda com a aba VISIVEL: quem esta pagando na aba do Asaas nao
//     precisa ser consultado, e voltar para ca dispara uma checagem na hora;
//   · desiste depois de JANELA_MS — pagamento que demora mais que isso e
//     assunto do webhook e do cron, nao de um laco no navegador.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { verificarPagamentoAction } from './actions';

const INTERVALO_MS = 5_000;
const JANELA_MS = 3 * 60 * 1_000;

export function useVerificarPagamento(assinaturaId: string, ativo: boolean) {
  const router = useRouter();
  const desde = useRef(0);

  useEffect(() => {
    if (!ativo || !assinaturaId) return;
    let cancelado = false;
    desde.current = Date.now();

    async function checar() {
      if (cancelado || document.hidden) return;
      if (Date.now() - desde.current > JANELA_MS) return;
      const r = await verificarPagamentoAction(assinaturaId);
      // `mudou` cobre status E cobrancas novas: a lista de cobrancas tambem
      // tem de aparecer sozinha, nao so o selo de ativo.
      if (!cancelado && r.ok && r.mudou) router.refresh();
    }

    const id = setInterval(checar, INTERVALO_MS);
    // Voltar para a aba e o momento mais provavel de o pagamento ja ter
    // caido: checa na hora e reabre a janela de espera.
    const aoVoltar = () => {
      if (!document.hidden) { desde.current = Date.now(); void checar(); }
    };
    document.addEventListener('visibilitychange', aoVoltar);

    return () => {
      cancelado = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [assinaturaId, ativo, router]);
}

/** Ha pagamento a esperar? Contratou, mas o Asaas ainda nao confirmou. */
export function aguardandoPagamento(status: string, contratada: boolean): boolean {
  return contratada && !['ativa', 'cortesia', 'cancelada'].includes(status);
}
