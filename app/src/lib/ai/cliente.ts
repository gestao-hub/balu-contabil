// Bloco 6A — a única porta de saída para um provedor de IA.
//
// UM TEXTO ENTRA, UM TEXTO SAI. Sem streaming, sem ferramentas, sem imagem —
// e é essa simplicidade que permite dois adaptadores cobrirem oito provedores.
//
// ⚠️ ESTA FUNÇÃO NUNCA RECEBE DADO DE CONTRIBUINTE. Quem monta o prompt é
// `lib/explicacoes/prompt.ts`, que aceita `SituacaoFiscal` — tipo que não tem
// como carregar valor, nome ou documento. A garantia é do TIPO, não da
// disciplina de quem chama.
import 'server-only';
import { ehAnthropic, URL_PADRAO } from './provedores';
import type { ConfigProvedor } from './tipos';

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;

function urlDe(cfg: ConfigProvedor): string {
  const base = cfg.provedor === 'personalizado' ? cfg.base_url : URL_PADRAO[cfg.provedor];
  if (!base) {
    // Falha ANTES da rede: 'personalizado' sem URL é configuração incompleta, e
    // deixar seguir daria um erro de rede confuso em vez do motivo real.
    throw new Error('Provedor personalizado sem URL base configurada.');
  }
  return `${base.replace(/\/+$/, '')}${ehAnthropic(cfg.provedor) ? '/messages' : '/chat/completions'}`;
}

/**
 * Gera texto. Lança em qualquer falha — quem chama decide o que mostrar.
 *
 * A CHAVE NÃO ENTRA NA MENSAGEM DE ERRO, nem quando o provedor a devolve no
 * corpo (alguns devolvem). Mesma regra que a varredura do 4B teve de aprender:
 * a mensagem é montada longe daqui e não dá para confiar nela.
 */
export async function gerarTexto(cfg: ConfigProvedor, prompt: string): Promise<string> {
  const url = urlDe(cfg);
  const anthropic = ehAnthropic(cfg.provedor);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (anthropic) {
    headers['x-api-key'] = cfg.chave;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${cfg.chave}`;
  }

  // O CORPO É O MESMO NOS DOIS DIALETOS — os dois aceitam
  // `{ model, max_tokens, messages:[{role,content}] }` para uma pergunta simples.
  // A diferença entre Anthropic e OpenAI-compatível está no CAMINHO e no
  // CABEÇALHO, não aqui. (Se um dia divergir, é aqui que o `if` nasce; um
  // ternário com os dois lados iguais só faria o leitor procurar diferença que
  // não existe.)
  const body = { model: cfg.modelo, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] };

  const res = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const bruto = (await res.text()).slice(0, 300);
    const limpo = cfg.chave ? bruto.split(cfg.chave).join('***') : bruto;
    throw new Error(`Provedor respondeu ${res.status}: ${limpo}`);
  }

  const j = (await res.json()) as Record<string, unknown>;
  const texto = anthropic
    ? (j.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((b) => b.type === 'text')?.text
    : (j.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;

  if (!texto || !texto.trim()) throw new Error('Provedor respondeu sem texto.');
  return texto.trim();
}
