// Bloco 4A — textos do gate, num módulo NEUTRO.
//
// Mora fora de `gate.ts` porque aquele é `server-only` e a tela precisa dizer
// a mesma frase ANTES do envio (avisar na entrada, não depois de preencher o
// formulário). Duplicar o texto seria pior: um dos dois seria reescrito um
// dia e o usuário leria duas explicações diferentes para o mesmo bloqueio.
//
// Sem imports de propósito: qualquer lado pode importar daqui.

export const MSG_ASSINATURA_PENDENTE =
  'Sua assinatura está com pendência. Regularize em Assinatura para voltar a usar esta função.';
