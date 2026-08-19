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
/** Espera antes de cada retentativa (ms), em ordem. */
const ESPERA_MS = [400, 1_200];

/** Falha que costuma passar sozinha: fila do provedor ou instabilidade dele. */
function transitorio(status: number): boolean {
  return status === 429 || status >= 500;
}

export type OpcoesGeracao = {
  /** Quantas tentativas no total (1 = comportamento antigo, sem retentativa). */
  tentativas?: number;
  /** Teto por tentativa. O padrão (60s) serve ao lote do 6A; o atendimento por
   *  WhatsApp usa um valor menor, porque tem gente esperando do outro lado. */
  timeoutMs?: number;
};

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
export async function gerarTexto(
  cfg: ConfigProvedor, prompt: string, opcoes?: OpcoesGeracao,
): Promise<string> {
  const url = urlDe(cfg);
  const anthropic = ehAnthropic(cfg.provedor);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (anthropic) {
    headers['x-api-key'] = cfg.chave;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${cfg.chave}`;
  }

  // O `if` que o comentário anterior dizia que "nasceria um dia" já nasceu — e
  // ele é por PROVEDOR, não por dialeto.
  //
  // Os modelos de raciocínio da OpenAI (o1/o3/gpt-5) RECUSAM `max_tokens` em
  // /chat/completions com HTTP 400 "Unsupported parameter: 'max_tokens' … use
  // 'max_completion_tokens'". Na tela do admin isso chega como um 400 que parece
  // credencial errada, e o admin troca a chave boa por outra atrás de um erro
  // que não é de chave.
  //
  // O corte é pelo provedor `openai` porque `max_completion_tokens` vale para
  // TODA a linha atual da OpenAI (não só os de raciocínio) — assim não existe
  // lista de modelos para manter atualizada. Os demais OpenAI-compatíveis (Groq,
  // DeepSeek, Mistral, OpenRouter, Gemini pelo endpoint de compatibilidade) NÃO
  // conhecem o nome novo: trocar para todos consertaria um e quebraria cinco.
  //
  // ⚠️ Ponto cego conhecido: 'personalizado' apontado para a própria OpenAI
  // recebe `max_tokens` e bate no mesmo 400. Fica registrado em vez de adivinhado
  // — não dá para saber, pela URL, quem fala qual dialeto.
  const limite = cfg.provedor === 'openai'
    ? { max_completion_tokens: MAX_TOKENS }
    : { max_tokens: MAX_TOKENS };

  const body = { model: cfg.modelo, ...limite, messages: [{ role: 'user', content: prompt }] };

  // ═══ RETENTATIVA EM FALHA TRANSITÓRIA (19/08/2026) ═══
  //
  // Um cliente perguntou "qual a alíquota de ICMS vigente?" pelo WhatsApp e
  // recebeu "não consegui responder agora". O log de produção mostrou o
  // motivo: HTTP 429 — `mistral-small-24b ... is temporarily rate-limited
  // upstream`, roteado pela OpenRouter para a DeepInfra. A pergunta estava
  // certa, o crédito estava lá, a rota estava certa; um blip de fila do
  // provedor virou um não-atendimento.
  //
  // Só 429 e 5xx retentam — 4xx de verdade (chave errada, modelo inexistente)
  // não melhora com insistência e a espera só atrasaria o erro real.
  const ultima = opcoes?.tentativas ?? 1;
  let erroFinal: unknown;

  for (let tentativa = 1; tentativa <= ultima; tentativa++) {
    const ultimaTentativa = tentativa === ultima;
    // Espera curta e crescente. Longa demais estouraria o orçamento da função
    // e o cliente ficaria olhando para o WhatsApp sem nada chegar.
    const esperar = () => new Promise((r) => setTimeout(r, ESPERA_MS[tentativa - 1] ?? 1_500));

    let res: Response;
    try {
      // SÓ a chamada de rede mora no try. Com o tratamento de status aqui
      // dentro, o `throw` de um erro FATAL (401, modelo inexistente) caía no
      // próprio catch, virava "transitório" e era retentado — insistir numa
      // chave errada só atrasa o erro real.
      res = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(opcoes?.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      // Rede caída ou timeout do AbortSignal: transitório por natureza.
      erroFinal = e;
      if (ultimaTentativa) throw e;
      await esperar();
      continue;
    }

    if (!res.ok) {
      const bruto = (await res.text()).slice(0, 300);
      const limpo = cfg.chave ? bruto.split(cfg.chave).join('***') : bruto;
      const erro = new Error(`Provedor respondeu ${res.status}: ${limpo}`);
      if (!transitorio(res.status) || ultimaTentativa) throw erro;
      erroFinal = erro;
      await esperar();
      continue;
    }

    const j = (await res.json()) as Record<string, unknown>;
    const texto = anthropic
      ? (j.content as Array<{ type: string; text?: string }> | undefined)
          ?.find((b) => b.type === 'text')?.text
      : (j.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;

    if (texto && texto.trim()) return texto.trim();

    const vazio = new Error('Provedor respondeu sem texto.');
    if (ultimaTentativa) throw vazio;
    erroFinal = vazio;
    await esperar();
  }

  throw erroFinal instanceof Error ? erroFinal : new Error('Falha ao gerar texto.');
}
