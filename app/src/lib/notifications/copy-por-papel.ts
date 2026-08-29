// Copy da tela de notificações, por papel (BUG-007, auditoria 29/08/2026).
//
// A tela `/notificacoes` é a MESMA para os três papéis — e o subtítulo dizia
// "Avisos e lembretes de obrigações da sua empresa". Um AdminBalu não tem
// empresa; um contador tem carteira, não empresa. A frase estava escrita para
// um dos três leitores.
//
// Função pura e num arquivo próprio para poder ter teste: o defeito é
// exatamente do tipo que volta em silêncio quando alguém edita a página, e uma
// string dentro do JSX não tem como ser mordida por teste.
//
// PADRÃO NEUTRO, e não a frase da Empresa: papel desconhecido (sessão sem
// `role_types`, que a 0104 tornou raro mas não impossível) recebe um texto que
// é verdadeiro para qualquer leitor. Errar para o neutro é barato; errar
// dizendo "sua empresa" para quem não tem empresa foi o que gerou o achado.
const POR_PAPEL: Record<string, string> = {
  empresa: 'Avisos e lembretes de obrigações da sua empresa.',
  contador: 'Avisos e lembretes do seu escritório e dos clientes da carteira.',
  adminbalu: 'Avisos e lembretes da plataforma.',
};

const NEUTRO = 'Seus avisos e lembretes.';

/** `papel` é o `normalizedRole` de `getGateContext` (minúsculo), ou null. */
export function subtituloPorPapel(papel: string | null | undefined): string {
  if (!papel) return NEUTRO;
  return POR_PAPEL[papel.toLowerCase()] ?? NEUTRO;
}
