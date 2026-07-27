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
  /**
   * YYYY-MM-DD em BRT. É o campo **"liberado até"**, e não só a data do teste.
   *
   * Além do trial, `assinar.ts` o empurra para o primeiro vencimento quando o
   * titular contrata: quem assina com o teste já vencido paga um boleto que
   * leva dias a compensar, e sem isso seguiria barrado — clicando "Assinar",
   * vendo sucesso e continuando sem poder emitir nota.
   */
  trial_termina_em: string | null;
  /**
   * Liberação manual do admin da Balu (YYYY-MM-DD em BRT), para quem pagou
   * por boleto e mandou o comprovante antes da compensação. Libera até esta
   * data seja qual for o status — e expira sozinha.
   */
  liberado_ate?: string | null;
};

/**
 * @param hoje data corrente em BRT no formato YYYY-MM-DD (use `ymdBrt()`).
 *
 * Comparação de strings YYYY-MM-DD é ordenação lexicográfica correta para
 * datas — não converta para Date, que reintroduz fuso.
 */
export function statusEfetivo(a: AssinaturaParaStatus, hoje: string): 'liberado' | 'bloqueado' {
  const base = porStatus(a, hoje);
  if (base === 'liberado') return 'liberado';

  // LIBERACAO MANUAL — a ultima palavra, e so no sentido de LIBERAR.
  //
  // Nao esta la em cima de proposito: quem ja passa pelo status normal nao
  // precisa dela, e assim a liberacao nunca pode BLOQUEAR ninguem por
  // engano. Vale para qualquer status, inclusive 'cancelada': e decisao
  // explicita de uma pessoa, com motivo registrado e prazo — e o prazo e o
  // que impede que vire acesso eterno por esquecimento.
  if (a.liberado_ate && hoje <= a.liberado_ate) return 'liberado';

  return 'bloqueado';
}

function porStatus(a: AssinaturaParaStatus, hoje: string): 'liberado' | 'bloqueado' {
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
      // NAO honra `trial_termina_em`, de proposito: 'inadimplente' so e
      // escrito por quem VIU uma cobranca vencida (webhook PAYMENT_OVERDUE
      // ou o cron reconciliando). Liberar por causa de uma data gravada
      // antes desse sinal deixaria passar justamente quem nao pagou.
      // Quem acabou de contratar nao chega aqui: `assinar.ts` poe a
      // assinatura em 'trial' ate o primeiro vencimento.
      return 'bloqueado';
    case 'cancelada':
      // Cancelar e ato deliberado do titular; nenhuma data futura reabre.
      return 'bloqueado';
  }
}
