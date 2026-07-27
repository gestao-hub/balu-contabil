// Bloco 4A — regras puras do comprovante que lastreia a liberação manual.
//
// Puro de propósito: a action valida ANTES de tocar no storage, e o teste
// cobre a regra sem subir banco nem bucket. Mesmo desenho de
// `lib/fiscal/declaracoes-anuais/comprovante.ts`.
//
// LISTA DE PERMISSÃO (decisão do usuário, 27/07): só carrega o que está
// listado. A alternativa — barrar apenas executável e deixar passar o resto —
// aceitava formato desconhecido, e na tela isso é indistinguível de "deu
// certo" para um arquivo que ninguém consegue abrir depois.
//
// A lista é DELIBERADAMENTE larga, e essa largura é a mitigação do risco de
// travar quem já pagou: entram HEIC do iPhone, .msg do Outlook, .eml, print
// em webp e scan em tiff, porque é o que chega na prática. Apareceu um
// formato legítimo fora dela, o conserto é acrescentar aqui — uma linha —, e
// não afrouxar a regra.

/** 10 MB. O limite real é o `serverActions.bodySizeLimit` de 20 MB do
 *  next.config.ts, e o base64 do payload infla o arquivo em ~33% (10 MB viram
 *  ~13,4 MB). Subir daqui sem mexer lá devolve erro de corpo grande demais,
 *  que na tela vira um "falhou" sem explicação. */
export const MAX_COMPROVANTE_LIBERACAO_BYTES = 10 * 1024 * 1024;

export const BUCKET_COMPROVANTES_LIBERACAO = 'liberacoes-comprovantes';

/** O que serve como comprovante. A checagem olha a extensão FINAL, então
 *  `comprovante.pdf.exe` é `exe` e não entra. */
export const EXTENSOES_PERMITIDAS = [
  // Documento
  'pdf',
  // Foto e print — heic/heif são o padrão do iPhone; webp, o de print no Chrome
  'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif',
  // Texto e editor
  'txt', 'rtf', 'doc', 'docx', 'odt',
  // Planilha e extrato
  'csv', 'xls', 'xlsx', 'ods',
  // E-mail salvo: como muita gente encaminha o comprovante do banco
  'eml', 'msg',
] as const;

const PERMITIDAS = new Set<string>(EXTENSOES_PERMITIDAS);

/** Valor do `accept` do `<input type="file">`. É só uma sugestão ao seletor do
 *  sistema — dá para escolher "todos os arquivos" e furar —, por isso a
 *  validação de verdade acontece na escolha (cliente) e de novo no servidor. */
export const ACCEPT_COMPROVANTE = EXTENSOES_PERMITIDAS.map((e) => `.${e}`).join(',');

/** Para a mensagem de erro: dizer o que serve é mais útil que dizer o que não
 *  serve, e é o que evita a segunda tentativa errada. */
export const FORMATOS_ACEITOS_TEXTO =
  'PDF, foto (JPG, PNG, HEIC, WEBP), Word, texto, planilha ou e-mail salvo';

/** Extensão a partir do MIME, para arquivo que chega sem nenhuma no nome
 *  (câmera de alguns Androids manda `image` cru). Sem isto, uma foto legítima
 *  cairia como "sem extensão" e seria recusada. */
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
  if (!ext) {
    return { ok: false, error: `Arquivo sem extensão reconhecida. Envie ${FORMATOS_ACEITOS_TEXTO}.` };
  }
  if (!PERMITIDAS.has(ext)) {
    return { ok: false, error: `Arquivo .${ext} não serve como comprovante. Envie ${FORMATOS_ACEITOS_TEXTO}.` };
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
