// Bloco 4A — status efetivo da assinatura.
// Puro (sem server-only, sem I/O) para ser testavel sem banco.
//
// POR QUE DERIVAR NA LEITURA: uma coluna que so esta correta se um cron
// rodou e uma bomba — o cron falha e o app libera quem devia bloquear, ou
// pior, bloqueia quem pagou. Aqui o trial vence sozinho, na hora da
// pergunta, sem depender de job nenhum.

export type StatusAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'cancelada' | 'cortesia';

export type AssinaturaParaStatus = {
  status: StatusAssinatura;
  /** YYYY-MM-DD em BRT. Só relevante quando status === 'trial'. */
  trial_termina_em: string | null;
};

/**
 * @param hoje data corrente em BRT no formato YYYY-MM-DD (use `ymdBrt()`).
 *
 * Comparação de strings YYYY-MM-DD é ordenação lexicográfica correta para
 * datas — não converta para Date, que reintroduz fuso.
 */
export function statusEfetivo(a: AssinaturaParaStatus, hoje: string): 'liberado' | 'bloqueado' {
  switch (a.status) {
    case 'cortesia':
    case 'ativa':
      return 'liberado';
    case 'trial':
      // Sem data de fim o estado e incoerente. Bloquear e o lado seguro:
      // liberar por omissao daria trial eterno a quem tivesse a linha torta.
      if (!a.trial_termina_em) return 'bloqueado';
      return hoje <= a.trial_termina_em ? 'liberado' : 'bloqueado';
    case 'inadimplente':
    case 'cancelada':
      return 'bloqueado';
  }
}
