// Validação e endereçamento do comprovante de pagamento de uma guia (0084).
// Puro: a action chama isto ANTES de tocar no storage, como
// `declaracoes-anuais/comprovante.ts` faz para as declarações anuais.
//
// Módulo próprio, e não um parâmetro no de lá, porque as duas coisas só se
// parecem: o recibo da declaração anual é endereçado por (empresa, tipo, ano)
// e o de pagamento por guia. Unificar exigiria um endereçador genérico que não
// diria nada sobre nenhum dos dois casos.

export const BUCKET_COMPROVANTES_GUIA = 'guias-comprovantes';

/**
 * 5 MB, o mesmo teto das declarações anuais.
 *
 * Comprovante de banco é uma página — PDF de recibo raramente passa de algumas
 * centenas de KB, e foto de tela em celular moderno fica perto de 2 MB. O teto
 * existe para barrar o upload que trava a action, não para julgar o arquivo.
 */
export const MAX_COMPROVANTE_GUIA_BYTES = 5 * 1024 * 1024;

const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

export function validarComprovanteGuia(c: { mime: string; tamanho: number }): ResultadoValidacao {
  // Lista de permitidos, nunca de proibidos: o cliente sobe o que o banco dele
  // gerou, e o que não estiver aqui é recusado com nome em vez de aceito por
  // omissão.
  if (!EXTENSAO[c.mime]) return { ok: false, error: 'O comprovante precisa ser PDF, PNG ou JPEG.' };
  if (c.tamanho <= 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (c.tamanho > MAX_COMPROVANTE_GUIA_BYTES) return { ok: false, error: 'O comprovante passa de 5 MB.' };
  return { ok: true };
}

/**
 * Path determinístico `${companyId}/${guiaId}.${ext}`.
 *
 * A empresa na frente PRENDE o arquivo ao dono: mesmo que um id de guia vaze,
 * o caminho só é montável por quem já provou a posse da empresa. E o id da
 * guia como nome faz reanexar SUBSTITUIR o anterior em vez de acumular lixo
 * órfão no bucket — comprovante trocado é correção, não versão nova.
 */
export function caminhoComprovanteGuia(companyId: string, guiaId: string, mime: string): string {
  if (!/^[\w-]+$/.test(companyId)) throw new Error('companyId inválido');
  if (!/^[\w-]+$/.test(guiaId)) throw new Error('guiaId inválido');
  const ext = EXTENSAO[mime];
  if (!ext) throw new Error('MIME não suportado');
  return `${companyId}/${guiaId}.${ext}`;
}

/**
 * Nome de arquivo seguro para exibir. Não endereça nada — o path é quem
 * endereça —, então aqui basta impedir que um nome vindo de fora carregue
 * caminho (`../`) ou quebre a tela.
 */
export function nomeExibivel(nome: string | null | undefined): string {
  const limpo = String(nome ?? '').replace(/[/\\]/g, '').trim().slice(0, 120);
  return limpo || 'comprovante';
}
