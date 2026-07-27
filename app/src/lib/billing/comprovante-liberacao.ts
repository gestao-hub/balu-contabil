// Bloco 4A — regras puras do comprovante que lastreia a liberação manual.
//
// Puro de propósito: a action valida ANTES de tocar no storage, e o teste
// cobre a regra sem subir banco nem bucket. Mesmo desenho de
// `lib/fiscal/declaracoes-anuais/comprovante.ts`.
//
// POR QUE LISTA DE BLOQUEIO E NÃO LISTA DE PERMISSÃO: aqui o comprovante é
// OBRIGATÓRIO. Uma lista de permissão estreita não "aperta a segurança", ela
// **impede a liberação** — o admin recebe um HEIC do iPhone, um .msg do
// Outlook ou um print .webp e fica sem poder destravar quem já pagou. Como o
// arquivo nunca é executado, nunca é servido inline (a signed URL força
// download) e vive em bucket privado, o risco real está nos formatos
// executáveis. São esses que a lista barra.

/** 10 MB. O limite real é o `serverActions.bodySizeLimit` de 20 MB do
 *  next.config.ts, e o base64 do payload infla o arquivo em ~33% (10 MB viram
 *  ~13,4 MB). Subir daqui sem mexer lá devolve erro de corpo grande demais,
 *  que na tela vira um "falhou" sem explicação. */
export const MAX_COMPROVANTE_LIBERACAO_BYTES = 10 * 1024 * 1024;

export const BUCKET_COMPROVANTES_LIBERACAO = 'liberacoes-comprovantes';

/** Executável, script ou atalho — nada disso é comprovante de pagamento, e é
 *  o único grupo cujo dano não depende de como o arquivo é servido. A checagem
 *  olha a extensão FINAL, então `comprovante.pdf.exe` cai aqui. */
const EXTENSOES_BLOQUEADAS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'cpl', 'hta', 'reg', 'lnk',
  'jar', 'apk', 'app', 'dmg', 'deb', 'rpm', 'dll', 'so', 'bin',
  'js', 'mjs', 'cjs', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'bash',
  'php', 'py', 'rb', 'pl', 'jsp', 'asp', 'aspx',
  // Marcação que um navegador renderiza: não é comprovante de nada e abre a
  // porta para phishing hospedado no domínio do storage.
  'html', 'htm', 'xhtml', 'svg', 'swf',
]);

/** Só para dar extensão a arquivo que chega sem nenhuma (câmera de alguns
 *  Androids manda `image` cru). Não é lista de permissão: MIME fora daqui
 *  passa, apenas sem extensão inferida. */
const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'message/rfc822': 'eml',
};

export type ComprovanteEntrada = { nome: string; mime: string; tamanho: number };

/** O arquivo trafega em base64 na Server Action — é o que o resto do app já
 *  faz (ver RegistrarComprovanteDialog). Infla ~33%, e o teto de 10 MB acima
 *  foi escolhido contra o `bodySizeLimit` de 20 MB do next.config.ts. */
export type ComprovanteUpload = { nome: string; mime: string; base64: string };
export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

/** Extensão final do nome, em minúsculas e sem ponto. `''` quando não há. */
export function extensaoDe(nome: string, mime = ''): string {
  const base = nome.trim().toLowerCase();
  const i = base.lastIndexOf('.');
  // `i > 0` e não `i >= 0`: em `.gitignore` o ponto inicial não é extensão.
  const daNome = i > 0 ? base.slice(i + 1) : '';
  if (daNome && /^[a-z0-9]{1,8}$/.test(daNome)) return daNome;
  return EXT_POR_MIME[mime.toLowerCase()] ?? '';
}

export function validarComprovanteLiberacao(c: ComprovanteEntrada): ResultadoValidacao {
  const nome = c.nome.trim();
  if (!nome) return { ok: false, error: 'O arquivo do comprovante está sem nome.' };
  if (c.tamanho <= 0) return { ok: false, error: 'O arquivo do comprovante está vazio.' };
  if (c.tamanho > MAX_COMPROVANTE_LIBERACAO_BYTES) {
    return { ok: false, error: 'O comprovante passa de 10 MB. Reduza o arquivo e tente de novo.' };
  }
  const ext = extensaoDe(nome, c.mime);
  if (EXTENSOES_BLOQUEADAS.has(ext)) {
    return { ok: false, error: `Arquivo .${ext} não é aceito como comprovante. Envie o documento, a foto ou o PDF.` };
  }
  return { ok: true };
}

/** Nome de arquivo seguro: sem diretório, sem acento, sem espaço. Preserva a
 *  extensão para o sistema operacional do admin abrir o arquivo certo. */
export function nomeSeguro(nome: string, mime = ''): string {
  const ext = extensaoDe(nome, mime);
  const semDir = nome.trim().split(/[\\/]/).pop() ?? '';
  const semExt = ext && semDir.toLowerCase().endsWith(`.${ext}`)
    ? semDir.slice(0, -(ext.length + 1))
    : semDir;
  const slug = semExt
    .normalize('NFD').replace(/\p{M}/gu, '')  // tira acento
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  const corpo = slug || 'comprovante';
  return ext ? `${corpo}.${ext}` : corpo;
}

/**
 * Path ÚNICO por upload: `${assinaturaId}/${carimbo}-${nome}`.
 *
 * Sem `upsert`, de propósito. Renovar uma liberação não pode apagar o
 * comprovante da anterior: o `audit_log` guarda o path de cada liberação, e um
 * path sobrescrito transformaria o histórico em ponteiro para o arquivo errado
 * — pior que não ter histórico, porque parece certo.
 */
export function caminhoComprovanteLiberacao(
  assinaturaId: string, nome: string, mime: string, carimbo: string,
): string {
  if (!/^[\w-]+$/.test(assinaturaId)) throw new Error('assinaturaId inválido');
  if (!/^[\w-]+$/.test(carimbo)) throw new Error('carimbo inválido');
  return `${assinaturaId}/${carimbo}-${nomeSeguro(nome, mime)}`;
}

/** `20260727-193045` a partir de um ISO. Só para compor o path — a data que
 *  vale para o negócio é `liberacao_em`, gravada na coluna. */
export function carimboDe(iso: string): string {
  return iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}
