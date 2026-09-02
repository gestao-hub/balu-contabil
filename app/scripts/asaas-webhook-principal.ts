/**
 * O WEBHOOK DE PAGAMENTO DA CONTA PRINCIPAL DO ASAAS.
 *
 * ─── POR QUE ESTE SCRIPT EXISTE ─────────────────────────────────────────────
 * Em 02/09/2026 o `ASAAS_ENV=prod` entrou na Vercel: a cobrança das assinaturas
 * da própria Balu passou a valer dinheiro real. Mas o webhook da conta
 * PRINCIPAL nunca foi cadastrado — então o cliente paga, o dinheiro entra, e a
 * Balu não fica sabendo. A assinatura continua marcada como pendente, o gate de
 * inadimplência continua fechando, e ninguém entende por quê.
 *
 * O 4B já resolveu isto para as SUBCONTAS (o escritório cobrando o cliente
 * dele): `contador/configuracoes/subconta/actions.ts` cadastra na hora em que a
 * subconta nasce. A conta principal — a Balu cobrando o escritório — ficou de
 * fora porque não tem tela: ela é cadastrada uma vez, por quem opera.
 *
 * ─── O QUE ELE REUSA, DE PROPÓSITO ──────────────────────────────────────────
 * Toda a decisão vem de `@/lib/billing/webhook-subconta`, o mesmo módulo puro
 * que a tela do escritório usa: os eventos, o caminho, a forma canônica do
 * payload, o que conta como url entregável, o que conta como segredo utilizável
 * e o diagnóstico. Nenhuma regra é reescrita aqui — uma cópia divergiria no
 * primeiro ajuste, e a que ficasse para trás seria justamente a que cuida do
 * dinheiro da plataforma.
 *
 * O HTTP também é o de produção: `asaasSub(chave)` não é "cliente de subconta",
 * é "cliente COM ESTE token" — a própria doc da função diz que a rota é "os
 * webhooks da conta do token". Passando a chave principal, ele opera a conta
 * principal, com o mesmo retry e o mesmo tratamento de erro que o app usa.
 *
 * ─── PRÉVIA POR PADRÃO ──────────────────────────────────────────────────────
 * Sem `--aplicar` nada é escrito no Asaas. E, antes de qualquer escrita, o
 * script SONDA a URL — porque o Asaas aceita qualquer endereço sem conferir se
 * ele responde (levantado no 4B: `https://exemplo.invalido/...` foi aceito sem
 * piscar). Um cadastro com a URL errada é uma configuração permanente que nunca
 * entrega e que, pela deduplicação por url, nem atrapalha a url boa — ela só
 * mente no painel.
 *
 * A sonda distingue três coisas que, de fora, pareceriam a mesma:
 *   200 {reason:'invalid_json'}  → a URL chega na rota E o segredo do DEPLOY é
 *                                  igual ao que vai ser cadastrado. É o alvo.
 *   200 {reason:'unauthorized'}  → a URL chega na rota, mas o segredo do deploy
 *                                  é OUTRO. Cadastrar assim entrega 100% dos
 *                                  eventos no lixo, com HTTP 200 nos dois lados.
 *   qualquer outra coisa         → a URL não é a rota (domínio errado, deploy
 *                                  velho, 404 do Vercel).
 *
 * NUNCA imprime a chave do Asaas nem o segredo. Só comprimentos.
 *
 * ─── USO ────────────────────────────────────────────────────────────────────
 *   cd app
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json --env-file=.env.local \
 *     scripts/asaas-webhook-principal.ts [--ambiente=prod|sandbox] [--base=https://...] [--aplicar]
 *
 * `--ambiente` (padrão `prod`) MANDA em tudo: ele não lê `ASAAS_ENV`, ele a
 * ESCREVE antes da primeira chamada. `ASAAS_ENV` existe só na Vercel, e no
 * `.env.local` a ausência dela significa sandbox — então quem escolhesse só a
 * chave mandaria credencial de produção para `api-sandbox.asaas.com` e levaria
 * 401. Foi o que aconteceu na primeira execução; ver o comentário longo em
 * `process.env.ASAAS_ENV = AMBIENTE`.
 */
// Import NOMEADO de proposito: sob `tsx` este arquivo vira CJS, e o default
// de um modulo CommonJS chega `undefined` (medido: TypeError em 02/09).
import { loadEnvConfig } from '@next/env';
import type { AsaasWebhook } from '@/lib/clients/asaas';
import { asaasSub } from '@/lib/clients/asaas';
import {
  urlWebhookSubconta, ehUrlEntregavel, segredoUtilizavel, montarPayloadWebhook,
  diagnosticarWebhook, precisaReparo, avisoDoDiagnostico, EVENTOS_WEBHOOK, MIN_SEGREDO,
} from '@/lib/billing/webhook-subconta';

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const arg = (nome: string) => args.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');

const AMBIENTE_BRUTO = arg('ambiente') ?? 'prod';
if (AMBIENTE_BRUTO !== 'prod' && AMBIENTE_BRUTO !== 'sandbox') {
  // Um typo (`--ambiente=producao`) cairia em sandbox calado, que e o modo de
  // falhar deste arquivo inteiro: agir contra a conta errada sem avisar.
  console.error(`
--ambiente so aceita "prod" ou "sandbox" — recebi "${AMBIENTE_BRUTO}".
`);
  process.exit(1);
}
const AMBIENTE: 'prod' | 'sandbox' = AMBIENTE_BRUTO;

/**
 * ⚠️ ISTO NAO E OPCIONAL, E CUSTOU UM 401 NA PRIMEIRA EXECUCAO (02/09/2026).
 *
 * `clients/asaas.ts` decide a URL BASE e a chave pela MESMA variavel,
 * `ASAAS_ENV` — `base()` e `apiKey()`, as duas lendo dela. E `ASAAS_ENV` so
 * existe na Vercel: no `.env.local` ela esta ausente, e ausente significa
 * sandbox de proposito ("o default nunca pode ser o que cobra de verdade").
 *
 * A primeira versao deste script escolhia a CHAVE por `--ambiente` e deixava a
 * URL por conta do `ASAAS_ENV` ausente. Resultado: chave de producao enviada
 * para `api-sandbox.asaas.com` → 401 `invalid_access_token`. O proprio
 * `apiKey()` documenta essa armadilha ("token de sandbox na URL de producao, ou
 * o contrario, da 401") e eu separei justamente as duas coisas que ele diz que
 * andam juntas.
 *
 * Entao o `--ambiente` passa a mandar nas DUAS, escrevendo a variavel antes de
 * qualquer chamada. `ehProd()` le em tempo de request, nao no import, entao
 * isto alcanca todas as chamadas seguintes.
 */
process.env.ASAAS_ENV = AMBIENTE;

/**
 * ⚠️ SEGUNDA ARMADILHA DA MESMA EXECUCAO (02/09/2026): `--env-file` NAO
 * DESESCAPA.
 *
 * A chave do Asaas comeca com `$aact_`, e o Next expande `$VAR` dentro de
 * arquivos `.env` -- entao no `.env.local` ela PRECISA estar escrita
 * `\$aact_...`, senao o `$aact_` vira nome de variavel e some. O `@next/env`
 * desescapa e entrega 166 chars; o `--env-file` do Node entrega os 167, com a
 * barra invertida junto. Resultado medido: 401 `invalid_access_token` contra
 * `api.asaas.com` com uma chave que, limpa, autentica normalmente.
 *
 * Nao da para "so tirar a barra": ela e correta no arquivo. O conserto e ler
 * como o APP le. `loadEnvConfig` nao sobrescreve o que ja esta em
 * `process.env`, entao o `--env-file` tem de ser apagado primeiro -- so das
 * chaves que este script usa, para nao mexer no resto do ambiente.
 */
for (const n of ['TOKEN_ASAAS_PRODUCAO', 'TOKEN_ASAAS_SANDBOX', 'ASAAS_WEBHOOK_SECRET', 'ASAAS_WEBHOOK_EMAIL']) {
  delete process.env[n];
}
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });
/** Domínio de produção verificado no projeto `balu-contabil` da Vercel.
 *  Trocável por `--base=` — a sonda abaixo é quem diz se está certo. */
const BASE = (arg('base') ?? 'https://balucontabil.com.br').replace(/\/+$/, '');

const linha = (t = '') => console.log(t);
const titulo = (t: string) => {
  linha();
  linha('─'.repeat(72));
  linha(t);
  linha('─'.repeat(72));
};

function ok(b: boolean) { return b ? '✅' : '❌'; }

async function main() {
  titulo(`WEBHOOK DA CONTA PRINCIPAL · ambiente=${AMBIENTE} · ${APLICAR ? 'APLICAR' : 'PRÉVIA'}`);

  // ── 1. as três coisas do ambiente da Balu, sem as quais nem vale tentar ──
  const nomeChave = AMBIENTE === 'prod' ? 'TOKEN_ASAAS_PRODUCAO' : 'TOKEN_ASAAS_SANDBOX';
  const chave = process.env[nomeChave] ?? '';
  const segredo = process.env.ASAAS_WEBHOOK_SECRET ?? '';
  const email = process.env.ASAAS_WEBHOOK_EMAIL ?? '';
  const url = urlWebhookSubconta(BASE);

  // A URL base aparece porque a ausencia dela na tela foi o que deixou o 401
  // sem explicacao: era impossivel ver que chave e host discordavam.
  // (Espelha as constantes de `clients/asaas.ts`; e so exibicao.)
  const hostApi = AMBIENTE === 'prod' ? 'api.asaas.com' : 'api-sandbox.asaas.com';
  linha(`  ${ok(Boolean(chave))} ${nomeChave.padEnd(22)} ${chave ? `${chave.length} chars` : 'AUSENTE'}`);
  linha(`     conta Asaas          https://${hostApi}  (ASAAS_ENV=${AMBIENTE}, imposto por --ambiente)`);
  linha(`  ${ok(segredoUtilizavel(segredo))} ASAAS_WEBHOOK_SECRET   ${segredo ? `${segredo.length} chars (mín. ${MIN_SEGREDO})` : 'AUSENTE'}`);
  linha(`  ${ok(Boolean(email))} ASAAS_WEBHOOK_EMAIL    ${email || 'AUSENTE'}`);
  linha(`  ${ok(ehUrlEntregavel(url))} url                    ${url}`);
  linha(`     eventos              ${EVENTOS_WEBHOOK.join(', ')}`);

  if (!chave) { linha(`\n❌ sem ${nomeChave} no .env.local — nada a fazer.\n`); process.exit(1); }
  if (!segredoUtilizavel(segredo)) { linha('\n❌ segredo ausente ou curto demais — o Asaas recusaria o cadastro.\n'); process.exit(1); }
  if (!email) { linha('\n❌ sem ASAAS_WEBHOOK_EMAIL — campo obrigatório do Asaas.\n'); process.exit(1); }
  if (!ehUrlEntregavel(url)) { linha('\n❌ url não entregável (precisa ser https, host público). Use --base=\n'); process.exit(1); }

  // ── 2. a sonda: a url chega na rota? o segredo do deploy é este? ─────────
  titulo('SONDA — a URL responde, e com QUAL segredo?');
  let sondaOk = false;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'asaas-access-token': segredo, 'Content-Type': 'application/json' },
      // Corpo deliberadamente inválido: a rota valida o segredo ANTES de ler o
      // corpo, então isto separa os dois casos sem gravar nada em lugar nenhum.
      body: 'nao-e-json',
    });
    const texto = await r.text();
    let motivo: string | null = null;
    try { motivo = (JSON.parse(texto) as { reason?: string }).reason ?? null; } catch { /* HTML/404 */ }

    linha(`  HTTP ${r.status} · reason=${motivo ?? '(resposta não-JSON)'}`);
    if (motivo === 'invalid_json') {
      linha('  ✅ a URL é a rota E o segredo do deploy bate com o que será cadastrado.');
      sondaOk = true;
    } else if (motivo === 'unauthorized') {
      linha('  ❌ a URL é a rota, mas o segredo do DEPLOY é OUTRO.');
      linha('     Cadastrar assim entrega 100% dos eventos no lixo, com HTTP 200 dos dois lados.');
      linha('     Conserto: alinhar ASAAS_WEBHOOK_SECRET entre .env.local e a Vercel, e REDEPLOYAR');
      linha('     (variável de ambiente só vale no deploy seguinte).');
    } else if (motivo === 'rate_limited') {
      linha('  ⚠️  rate limit da própria rota. Espere um minuto e rode de novo.');
    } else {
      linha('  ❌ isto não é a rota do webhook (domínio errado, deploy velho ou 404).');
    }
  } catch (e) {
    linha(`  ❌ a URL não respondeu: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 3. o que já existe na conta ─────────────────────────────────────────
  // `asaasSub(chave)` = "o cliente COM ESTE token". Com a chave principal, ele
  // lê e escreve os webhooks da CONTA PRINCIPAL. Ver a doc de `listarWebhooks`.
  const cliente = asaasSub(chave);
  titulo('WEBHOOKS JÁ CADASTRADOS NESTA CONTA');
  let existentes: AsaasWebhook[] = [];
  try {
    existentes = (await cliente.listarWebhooks()).data ?? [];
  } catch (e) {
    linha(`  ❌ leitura falhou: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  if (existentes.length === 0) {
    linha('  (nenhum)');
  } else {
    for (const w of existentes) {
      linha(`  · ${w.name}`);
      linha(`    ${w.url}`);
      linha(`    enabled=${w.enabled} interrupted=${w.interrupted} hasAuthToken=${w.hasAuthToken}`
        + ` penalizadas=${w.penalizedRequestsCount ?? 0}`);
      linha(`    eventos: ${(w.events ?? []).join(', ') || '(nenhum)'}`);
    }
  }

  const diag = diagnosticarWebhook(existentes, url);
  titulo('DIAGNÓSTICO');
  linha(`  estado: ${diag.estado}`);
  const aviso = avisoDoDiagnostico(diag);
  if (aviso) linha(`  ↳ ${aviso}`);

  // ⚠️ 'ok' é o melhor que a LEITURA consegue afirmar — ele NÃO prova que o
  // segredo confere, porque o Asaas nunca devolve o segredo. Quem prova isso é
  // a sonda acima, e é por isso que ela existe.
  if (diag.estado === 'ok') {
    linha('  ⚠️  "ok" é o que a leitura alcança: o Asaas nunca devolve o segredo.');
    linha('      Quem prova o segredo é a SONDA acima.');
  }

  // ── 4. o plano ───────────────────────────────────────────────────────────
  const acao = diag.estado === 'ausente' ? 'CRIAR'
    : precisaReparo(diag) ? 'REPARAR (PUT — reescreve segredo, religa e retoma a fila)'
    : 'NADA';

  titulo(`PLANO: ${acao}`);
  if (acao === 'NADA') {
    linha('  O webhook já está cadastrado e sadio nesta conta.');
    linha('  Para reescrever o segredo mesmo assim, apague-o no painel e rode de novo,');
    linha('  ou force um PUT com --forcar.\n');
    if (!args.includes('--forcar')) return;
  }

  if (!APLICAR) {
    linha('  PRÉVIA — nada foi escrito no Asaas.');
    linha('  Rode de novo com --aplicar para executar.\n');
    if (!sondaOk) {
      linha('  ⛔ E resolva a sonda ANTES: cadastrar com a URL ou o segredo errados cria uma');
      linha('     configuração permanente que nunca entrega e não acusa erro nenhum.\n');
    }
    return;
  }

  // Trava: `--aplicar` não vence uma sonda vermelha. É exatamente o erro que
  // este script existe para evitar.
  if (!sondaOk && !args.includes('--mesmo-com-sonda-vermelha')) {
    linha('  ⛔ RECUSADO: a sonda não confirmou URL + segredo.');
    linha('     Cadastrar agora criaria um webhook que nunca entrega, indistinguível');
    linha('     de um sadio na leitura. Conserte a sonda, ou passe');
    linha('     --mesmo-com-sonda-vermelha se souber o que está fazendo.\n');
    process.exit(3);
  }

  const payload = montarPayloadWebhook(url, segredo, email);
  try {
    if (diag.estado === 'ausente') {
      const criado = await cliente.criarWebhook(payload);
      // ⚠️ O corpo da resposta traz o authToken EM CLARO. Lê-se só o id.
      linha(`  ✔ criado · id ${criado.id}`);
    } else {
      const id = 'id' in diag ? diag.id : '';
      await cliente.atualizarWebhook(id, payload);
      linha(`  ✔ reescrito · id ${id}`);
    }
  } catch (e) {
    linha(`  ❌ o Asaas recusou: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(4);
  }

  // ── 5. confere LENDO DE VOLTA, não pelo código de retorno ────────────────
  titulo('CONFERÊNCIA (lendo de volta do Asaas)');
  const depois = (await cliente.listarWebhooks()).data ?? [];
  const diag2 = diagnosticarWebhook(depois, url);
  linha(`  estado: ${diag2.estado}`);
  if (diag2.estado === 'ok') {
    linha('\n✅ webhook no ar. Os pagamentos das assinaturas da Balu passam a chegar sozinhos.');
    linha('   Lembrete: "ok" é leitura. A prova de ponta a ponta é um pagamento real chegando');
    linha('   — ou a sonda acima, que já confirmou url + segredo.\n');
  } else {
    linha(`\n❌ ficou em "${diag2.estado}". NÃO considere feito.\n`);
    process.exit(5);
  }
}

main().catch((e) => { console.error(`\nfalhou: ${e instanceof Error ? e.message : e}\n`); process.exit(1); });
