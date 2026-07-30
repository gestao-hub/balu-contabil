import { createClient } from 'npm:@supabase/supabase-js@2';

// Base juridica/contabil — ingestao diaria de DOU (Diario Oficial da Uniao)
// e do portal RFB/Simples Nacional para a tabela documentos_juridicos
// (migration 0062_base_juridica.sql). So le/escreve via service_role — nunca
// e chamada pelo caminho do cliente.
//
// Os dois contratos abaixo (DOU e portal) foram confirmados por sondagem
// real contra as URLs de producao, NAO adivinhados:
//   - app/scratchpad/_sondar-dou.mjs
//   - app/scratchpad/_sondar-portal-simples.mjs
// Este arquivo transcreve a logica provada nesses scripts (stripTags,
// extracao via <script ...BuscaDouPortlet_params>, extracao por
// marcador-de-container + janela de texto), adaptada para rodar diariamente
// com volume baixo (janela de 1-2 dias no DOU, lista curada de 2 URLs no
// portal) em vez do escopo largo (30 dias) usado nas sondagens avulsas.

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type Documento = {
  fonte: 'dou' | 'receita_federal' | 'simples_nacional';
  url_origem: string;
  titulo: string;
  texto: string;
  publicado_em: string | null;
};

type DouItem = {
  title: string;
  pubDate: string;
  pubName?: string;
  artType?: string;
  content: string;
  urlTitle: string;
  classPK?: string | number;
  hierarchyStr?: string;
};

// ---------------------------------------------------------------------------
// Utilitarios compartilhados
// ---------------------------------------------------------------------------

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Hash simples (SHA-256, Web Crypto nativo do Deno) — usado so para uma
// futura iteracao poder pular reprocessamento de conteudo inalterado, nunca
// como chave do upsert (a chave e (fonte, url_origem), ver migration).
async function hashTexto(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Transcricao fiel de stripTags() de app/scratchpad/_sondar-portal-simples.mjs
// (mesmas substituicoes de entidade HTML em portugues, mesma ordem) —
// tunado contra respostas reais do gov.br/Plone e do portal SN, nao
// reinventado aqui.
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&atilde;/g, 'ã')
    .replace(/&otilde;/g, 'õ').replace(/&ccedil;/g, 'ç').replace(/&ecirc;/g, 'ê')
    .replace(/&ocirc;/g, 'ô').replace(/&Ccedil;/g, 'Ç').replace(/&Eacute;/g, 'É')
    .replace(/&ordm;/g, 'º').replace(/&Ecirc;/g, 'Ê').replace(/&atilde;/gi, 'ã')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// "dd/mm/yyyy" (formato de pubDate do DOU, confirmado na sondagem) → "yyyy-mm-dd".
function parseDataBR(d: string | undefined): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// "Date" → "dd-mm-yyyy" (formato de publishFrom/publishTo do DOU, confirmado
// na sondagem).
function formatDateBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// ---------------------------------------------------------------------------
// Fonte 1: DOU (www.in.gov.br) — contrato confirmado em _sondar-dou.mjs
// ---------------------------------------------------------------------------

// Escopo desta feature (ver spec) — lista curta e curada, nao busca livre.
const TERMOS_DOU = ['Simples Nacional', 'MEI', 'CGSN'];

const DOU_USER_AGENT = 'Mozilla/5.0 (compatible; balu-sync-base-juridica/1.0)';

async function buscarDouParaTermo(
  termo: string,
  publishFrom: string,
  publishTo: string,
): Promise<Documento[]> {
  const params = new URLSearchParams({
    q: termo,
    exactDate: 'personalizado',
    publishFrom,
    publishTo,
    sortType: '0',
  });
  const url = `https://www.in.gov.br/consulta/-/buscar/dou?${params.toString()}`;

  const res = await fetch(url, { headers: { 'User-Agent': DOU_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`DOU respondeu HTTP ${res.status} para termo "${termo}"`);
  }
  const html = await res.text();

  // Tag confirmada na sondagem: <script id="...BuscaDouPortlet_params" ...>{"jsonArray":[...]}</script>
  const scriptMatch = html.match(
    /<script id="[^"]*BuscaDouPortlet_params"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!scriptMatch) {
    throw new Error(
      `Tag <script ...BuscaDouPortlet_params> não encontrada para termo "${termo}" — estrutura do DOU pode ter mudado`,
    );
  }

  let data: { jsonArray?: DouItem[] };
  try {
    data = JSON.parse(scriptMatch[1]);
  } catch (e) {
    throw new Error(`JSON.parse do DOU falhou para termo "${termo}": ${(e as Error).message}`);
  }

  const itens = data.jsonArray ?? [];
  return itens.map((item) => ({
    fonte: 'dou' as const,
    url_origem: `https://www.in.gov.br/web/dou/-/${item.urlTitle}`,
    titulo: item.title,
    texto: stripTags(item.content ?? ''),
    publicado_em: parseDataBR(item.pubDate),
  }));
}

// Roda diariamente via pg_cron — so precisa cobrir o que e NOVO desde ontem,
// entao a janela e curta (ontem→hoje), diferente dos 30 dias usados na
// sondagem avulsa (que buscava volume pra confirmar o contrato, nao pra rodar
// em producao). Mantem o volume baixo, conforme recomendacao da propria
// sondagem.
async function buscarDou(): Promise<Documento[]> {
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  const publishFrom = formatDateBR(ontem);
  const publishTo = formatDateBR(hoje);

  const porTermo = await Promise.allSettled(
    TERMOS_DOU.map((termo) => buscarDouParaTermo(termo, publishFrom, publishTo)),
  );

  // Um termo falhando (site fora do ar, estrutura mudou) nao pode derrubar os
  // outros termos — resiliencia por item, nao so por fonte.
  const vistos = new Map<string, Documento>();
  porTermo.forEach((resultado, i) => {
    if (resultado.status === 'fulfilled') {
      for (const doc of resultado.value) {
        // O mesmo item do DOU pode bater com mais de um termo — dedup por
        // url_origem (chave natural do documento, ver migration).
        if (!vistos.has(doc.url_origem)) vistos.set(doc.url_origem, doc);
      }
    } else {
      console.error(
        `[sync-base-juridica] DOU termo "${TERMOS_DOU[i]}" falhou:`,
        resultado.reason instanceof Error ? resultado.reason.message : resultado.reason,
      );
    }
  });

  return Array.from(vistos.values());
}

// ---------------------------------------------------------------------------
// Fonte 2: Portal RFB/Simples Nacional — contrato confirmado em
// _sondar-portal-simples.mjs (as 2 URLs curadas E os 2 marcadores de
// container que a sondagem provou funcionar, verbatim)
// ---------------------------------------------------------------------------

type PaginaPortal = {
  fonte: 'receita_federal' | 'simples_nacional';
  url: string;
  marker: string;
};

const PAGINAS_PORTAL: PaginaPortal[] = [
  {
    // gov.br/Plone FAQ — confirmado HTML estatico, container id="parent-fieldname-text".
    fonte: 'receita_federal',
    url: 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/pagamentos-e-parcelamentos/parcelamento-simples-nacional/perguntas-e-respostas',
    marker: 'id="parent-fieldname-text"',
  },
  {
    // Portal SN noticia — confirmado HTML estatico, container class="htmlEditor".
    fonte: 'simples_nacional',
    url: 'https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=7a8aa9dc-6490-431c-9822-32ac9101d319',
    marker: 'class="htmlEditor"',
  },
];

// Mesmo valor usado na sondagem — janela generosa o bastante para cobrir o
// conteudo real das duas paginas confirmadas.
const WINDOW_SIZE = 20000;

const PORTAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function buscarPaginaPortal(pagina: PaginaPortal): Promise<Documento> {
  const res = await fetch(pagina.url, { headers: { 'User-Agent': PORTAL_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Portal respondeu HTTP ${res.status} para ${pagina.url}`);
  }
  const html = await res.text();

  const markerIdx = html.indexOf(pagina.marker);
  if (markerIdx === -1) {
    throw new Error(
      `Marcador "${pagina.marker}" não encontrado em ${pagina.url} — estrutura da pagina pode ter mudado`,
    );
  }

  // Mesma abordagem pragmatica da sondagem: regex nao fecha divs aninhadas de
  // forma confiavel, entao pula-se o resto da tag de abertura por indexOf e
  // pega-se uma janela generosa de texto depois dela; quando ha um indice em
  // <table> antes do conteudo real (caso do FAQ), pula-se ate depois do
  // </table> para o trecho extraido ser conteudo de verdade.
  const tagEnd = html.indexOf('>', markerIdx);
  const idx = tagEnd === -1 ? markerIdx : tagEnd + 1;
  const janela = html.slice(idx, idx + WINDOW_SIZE);
  const tableEnd = janela.indexOf('</table>');
  const contentHtml = tableEnd === -1 ? janela : janela.slice(tableEnd + '</table>'.length);
  const texto = stripTags(contentHtml);

  const tituloMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const titulo = tituloMatch ? stripTags(tituloMatch[1]) : pagina.url;

  return {
    fonte: pagina.fonte,
    url_origem: pagina.url,
    titulo,
    texto,
    // Nenhuma das duas paginas confirmadas na sondagem expõe uma data de
    // publicacao estruturada e confiavel de extrair por scraping simples —
    // nao inventar uma.
    publicado_em: null,
  };
}

async function buscarPortalSimples(): Promise<Documento[]> {
  const resultados = await Promise.allSettled(PAGINAS_PORTAL.map((p) => buscarPaginaPortal(p)));

  // Uma URL falhando (estrutura mudou, site fora do ar) nao pode impedir a
  // outra de ser ingerida.
  const documentos: Documento[] = [];
  resultados.forEach((resultado, i) => {
    if (resultado.status === 'fulfilled') {
      documentos.push(resultado.value);
    } else {
      console.error(
        `[sync-base-juridica] Portal "${PAGINAS_PORTAL[i].url}" falhou:`,
        resultado.reason instanceof Error ? resultado.reason.message : resultado.reason,
      );
    }
  });
  return documentos;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (_req) => {
  // Auth delegada ao Supabase: a função é deployada COM verificação de JWT
  // (padrão, mesma convencao de sync-municipios). O agendador (pg_cron via
  // net.http_post) passa Authorization: Bearer <service_role_key>.

  const start = Date.now();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Promise.allSettled (não Promise.all): uma FONTE inteira falhando (DOU
  // fora do ar, portal reestruturado) não pode impedir a outra de ainda ser
  // ingerida no mesmo dia — mesmo principio de "best-effort por fonte" do
  // plano/spec.
  const [dou, portalSimples] = await Promise.allSettled([buscarDou(), buscarPortalSimples()]);

  const documentos: Documento[] = [
    ...(dou.status === 'fulfilled' ? dou.value : []),
    ...(portalSimples.status === 'fulfilled' ? portalSimples.value : []),
  ];

  const fontesFalhas: string[] = [];
  if (dou.status === 'rejected') {
    console.error(
      '[sync-base-juridica] fonte DOU falhou inteiramente:',
      dou.reason instanceof Error ? dou.reason.message : dou.reason,
    );
    fontesFalhas.push('dou');
  }
  if (portalSimples.status === 'rejected') {
    console.error(
      '[sync-base-juridica] fonte portal-simples falhou inteiramente:',
      portalSimples.reason instanceof Error ? portalSimples.reason.message : portalSimples.reason,
    );
    fontesFalhas.push('portal-simples');
  }

  let upserted = 0;
  let failed = 0;

  for (const chunk of chunkArray(documentos, 200)) {
    const linhas = await Promise.all(
      chunk.map(async (d) => ({
        fonte: d.fonte,
        url_origem: d.url_origem,
        titulo: d.titulo,
        texto: d.texto,
        publicado_em: d.publicado_em,
        hash_conteudo: await hashTexto(d.texto),
      })),
    );

    // onConflict tem que ser (fonte, url_origem) — o UNIQUE index real da
    // migration (documentos_juridicos_fonte_url_uidx), NAO hash_conteudo:
    // um documento que mudou de conteudo teria hash novo, e upsert por hash
    // inseriria uma segunda linha em vez de atualizar a existente.
    const { error } = await supabase
      .from('documentos_juridicos')
      .upsert(linhas, { onConflict: 'fonte,url_origem' });
    if (error) {
      console.error('[sync-base-juridica] chunk error:', error.message);
      failed += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }

  const duration_ms = Date.now() - start;
  const ok = failed === 0 && fontesFalhas.length === 0;

  return new Response(
    JSON.stringify({ ok, total: documentos.length, upserted, failed, fontesFalhas, duration_ms }),
    { status: ok ? 200 : 207, headers: { 'Content-Type': 'application/json' } },
  );
});
