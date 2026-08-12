// Bloco 7 — normalizacao de host para o dominio proprio do escritorio.
//
// Duas armadilhas motivam este arquivo existir separado (landmine 6.1 da
// spec): (a) `headers().get('host')` traz porta em dev e NAO atravessa o
// proxy da Vercel — la o valor certo esta em `x-forwarded-host`; (b) host e
// case-insensitive no DNS, mas `=` no Postgres nao e: sem normalizar,
// `APP.Escritorio.com.br:443` nunca casa com a linha gravada.
//
// Funcoes puras, sem dependencia de Next, pra poderem ser testadas sozinhas.

/** Host reservado: nunca pode virar dominio de escritorio. */
const RESERVADOS = new Set(['localhost', 'vercel.app', 'balu.app.br']);

/**
 * Normaliza um host para a forma canonica gravada no banco: minusculo, sem
 * esquema, sem porta, sem barra final, sem credenciais, sem espaco.
 *
 * `www.x.com.br` e `x.com.br` NAO sao unificados de proposito: sao hosts
 * distintos no DNS, cada um precisa do seu proprio apontamento, e fingir que
 * sao o mesmo faria o app prometer que um dominio funciona quando so o outro
 * foi verificado.
 *
 * Devolve null quando o valor nao e um host utilizavel.
 */
export function normalizarHost(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  let h = bruto.trim().toLowerCase();
  if (!h) return null;

  // Tolera o usuario colando a URL inteira.
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.split('/')[0];            // caminho
  h = h.split('?')[0].split('#')[0];
  h = h.split('@').pop() as string; // credenciais (user:pass@host)

  // Porta. IPv6 literal (`[::1]:443`) cai fora na validacao de formato
  // adiante — dominio de escritorio e nome, nunca IP.
  const ultimoDoisPontos = h.lastIndexOf(':');
  if (ultimoDoisPontos > -1 && /^\d+$/.test(h.slice(ultimoDoisPontos + 1))) {
    h = h.slice(0, ultimoDoisPontos);
  }
  h = h.replace(/\.+$/, ''); // raiz DNS explicita ("x.com.br.")

  if (!ehHostValido(h)) return null;
  return h;
}

/**
 * Formato de nome de dominio com pelo menos um ponto. Recusa IP (v4 e o
 * literal v6), host de rotulo unico e os reservados.
 *
 * O ponto obrigatorio nao e purismo: dominio de escritorio e sempre um nome
 * publico registrado, e aceitar rotulo unico abriria espaco pra alguem
 * reivindicar `localhost` ou o nome interno de um servico.
 */
export function ehHostValido(h: string): boolean {
  if (!h || h.length > 253) return false;
  if (RESERVADOS.has(h)) return false;
  if (h.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false; // IPv4
  if (h.includes('[') || h.includes(']')) return false; // IPv6 literal
  const rotulos = h.split('.');
  if (rotulos.length < 2) return false;
  return rotulos.every((r) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(r));
}

/**
 * O host da requisicao atual. `x-forwarded-host` PRIMEIRO: na Vercel o
 * `host` chega como o dominio interno do deployment, e usar ele significaria
 * nunca reconhecer o dominio do escritorio.
 *
 * Aceita `Headers` do Next ou um objeto simples, pra ser testavel sem
 * levantar o framework.
 */
export function hostDaRequisicao(
  h: Headers | Record<string, string | null | undefined>,
): string | null {
  const get = (k: string): string | null | undefined =>
    typeof (h as Headers).get === 'function' ? (h as Headers).get(k) : (h as Record<string, string | null | undefined>)[k];

  // Pode vir com varios valores em cadeia de proxy: o primeiro e o original.
  const encaminhado = (get('x-forwarded-host') ?? '').split(',')[0];
  return normalizarHost(encaminhado) ?? normalizarHost(get('host'));
}
