// Base juridica — as palavras-chave de busca textual para uma situacao
// fiscal. Puro: sem I/O, sem `server-only`. Reaproveita `SituacaoFiscal` do
// 6A/6B sem alargar o tipo — a mesma garantia estrutural: nao ha como este
// modulo carregar dado de contribuinte, porque o tipo que ele recebe nao tem
// onde guardar um.
import type { SituacaoFiscal } from '@/lib/fiscal/situacao-fiscal';
import { rotuloDoAnexo } from '@/lib/fiscal/situacao-fiscal';

const NOME_COMPONENTE_BUSCA: Record<string, string> = {
  inss: 'INSS',
  icms: 'ICMS',
  iss: 'ISS',
};

export function palavrasChaveDaSituacao(s: SituacaoFiscal): string[] {
  if (s.tributo === 'das-mei') {
    const componentes = [...s.componentes].map((c) => NOME_COMPONENTE_BUSCA[c] ?? c.toUpperCase());
    return ['MEI', 'DAS-MEI', 'Simples Nacional', ...componentes];
  }

  // `s.anexo` é o slug canônico ('anexo-iii'), não o rótulo legível — a busca
  // textual precisa do rótulo ('Anexo III'), então passa por `rotuloDoAnexo`
  // em vez de usar o campo cru.
  const base = ['Simples Nacional', 'PGDAS-D', rotuloDoAnexo(s.anexo)];
  return s.fatorR ? [...base, 'Fator R'] : base;
}
