// Bloco 4B — o webhook da subconta: a metade com I/O.
//
// Separado de `webhook-subconta.ts` (puro) pelo motivo de sempre neste bloco:
// modulo com `server-only` importado de Client Component passa no `tsc --noEmit`
// e so quebra no runtime. Aqui mora o que fala com o Asaas; la, o que decide.
//
// A CHAVE DA SUBCONTA ENTRA E NAO SAI. Nenhuma funcao daqui devolve, loga ou
// guarda a `apiKey` — ela e recebida por parametro, passada direto ao `asaasSub`
// e esquecida. O mesmo vale para o `ASAAS_WEBHOOK_SECRET`: ele viaja no corpo do
// POST/PUT e nunca aparece em retorno nem em log. O corpo de SUCESSO do Asaas
// traz o `authToken` em claro (achado do sandbox) — por isso so o `.id` do
// retorno e lido.
import 'server-only';
import { asaasSub } from '@/lib/clients/asaas';
import { createAdminClient } from '@/lib/supabase/admin';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { getSiteUrl } from '@/lib/site-url';
import {
  diagnosticarWebhook, montarPayloadWebhook, precisaReparo, segredoUtilizavel,
  ehUrlEntregavel, urlWebhookSubconta,
  type DiagnosticoWebhook, type MotivoImpedido,
} from './webhook-subconta';

/** Impedimentos que a precondicao consegue detectar SEM falar com o Asaas. */
type MotivoDeAmbiente = Exclude<MotivoImpedido, 'asaas_falhou'>;

export type ResultadoWebhook =
  | { ok: true; acao: 'criado' | 'reparado' | 'ja_estava'; id: string }
  | { ok: false; impedido: MotivoDeAmbiente }
  | { ok: false; impedido: 'asaas_falhou'; detalhe: string };

/** O diagnostico, mais os estados que so a camada de I/O conhece. */
export type EstadoWebhook =
  | DiagnosticoWebhook
  | { estado: 'impedido'; motivo: MotivoDeAmbiente }
  | { estado: 'indeterminado' };

type Pre =
  | { ok: true; url: string; segredo: string; email: string }
  | { ok: false; impedido: MotivoDeAmbiente };

/**
 * As tres condicoes de ambiente, conferidas ANTES de gastar chamada no Asaas.
 *
 * O e-mail vai para o Asaas e e para onde ELE avisa que a fila de entregas
 * parou. O dono certo desse aviso e a Balu, nao o escritorio: o endpoint, o
 * segredo e o conserto sao todos nossos. Dai `ASAAS_WEBHOOK_EMAIL` ser uma
 * caixa de operacao da Balu, com `EMAIL_FROM` como queda para o ambiente que
 * ainda nao a definiu.
 */
function precondicoes(): Pre {
  const segredo = process.env.ASAAS_WEBHOOK_SECRET ?? '';
  // Mesmo segredo que `api/webhooks/asaas/route.ts` confere no header
  // `asaas-access-token`. Cadastrar com outro valor — ou curto demais para o
  // Asaas aceitar — e deixar a entrega morrer em `unauthorized` para sempre.
  if (!segredoUtilizavel(segredo)) return { ok: false, impedido: 'sem_segredo' };

  const email = process.env.ASAAS_WEBHOOK_EMAIL || process.env.EMAIL_FROM || '';
  if (!email) return { ok: false, impedido: 'sem_email' };

  let url: string;
  try {
    url = urlWebhookSubconta(getSiteUrl());
  } catch {
    // `getSiteUrl` LANCA em producao sem NEXT_PUBLIC_SITE_URL.
    return { ok: false, impedido: 'url_nao_entregavel' };
  }
  // Em dev/local a base e `http://localhost:3000` e o Asaas nao alcanca isso.
  // Nao e falha: e o ambiente errado para cadastrar. Ver `ehUrlEntregavel`.
  if (!ehUrlEntregavel(url)) return { ok: false, impedido: 'url_nao_entregavel' };

  return { ok: true, url, segredo, email };
}

/**
 * SO LEITURA — para a tela poder mostrar o estado sem escrever nada.
 *
 * Nunca lanca: a pagina da subconta tem de renderizar mesmo com o Asaas fora do
 * ar, e 'indeterminado' e uma resposta honesta.
 */
export async function estadoWebhookDaSubconta(chave: string): Promise<EstadoWebhook> {
  const pre = precondicoes();
  if (!pre.ok) return { estado: 'impedido', motivo: pre.impedido };

  try {
    const { data } = await asaasSub(chave).listarWebhooks();
    return diagnosticarWebhook(data, pre.url);
  } catch (e) {
    console.error('[4b] leitura dos webhooks da subconta falhou:', e instanceof Error ? e.message : e);
    return { estado: 'indeterminado' };
  }
}

/**
 * O estado do webhook de UM escritorio, a partir do id da contabilidade.
 *
 * Existe para a PAGINA poder mostrar o estado sem nunca tocar na credencial: a
 * coluna `asaas_api_key_cifrada` so e legivel por service role (0053), e a
 * pagina da subconta le pela sessao do usuario. O admin client fica preso aqui
 * dentro, com o `.eq('id', ...)` do contexto — service role ignora RLS.
 *
 * Nunca lanca. Uma tela que nao carrega por causa do diagnostico do webhook
 * seria pior do que o problema que ele diagnostica.
 */
export async function estadoWebhookDaContabilidade(contabilidadeId: string): Promise<EstadoWebhook> {
  try {
    const sb = createAdminClient();
    const { data } = await sb
      .from('contabilidades').select('asaas_subconta_id, asaas_api_key_cifrada')
      .eq('id', contabilidadeId).maybeSingle();
    if (!data?.asaas_subconta_id) return { estado: 'indeterminado' };

    // `lerCredencial` LANCA quando o gravado nao tem a cifra — dentro do try.
    const chave = lerCredencial(data.asaas_api_key_cifrada);
    if (!chave) return { estado: 'indeterminado' };

    return await estadoWebhookDaSubconta(chave);
  } catch (e) {
    console.error('[4b] estado do webhook indisponivel:', e instanceof Error ? e.message : e);
    return { estado: 'indeterminado' };
  }
}

/**
 * CRIA OU CONSERTA o webhook da Balu na subconta. Idempotente.
 *
 * `forcar` existe por causa do buraco que a leitura nao enxerga: um webhook na
 * nossa url cadastrado a mao (ou por uma versao anterior com outro segredo) e
 * indistinguivel de um saudavel — `hasAuthToken` volta `true` nos dois casos,
 * porque o Asaas GERA um token quando o POST vai sem um. Reescrever e o unico
 * conserto, e por isso o botao da tela chama isto com `forcar: true` mesmo
 * quando o diagnostico diz 'ok'.
 */
export async function garantirWebhookDaSubconta(
  chave: string,
  opts?: { forcar?: boolean },
): Promise<ResultadoWebhook> {
  const pre = precondicoes();
  if (!pre.ok) return { ok: false, impedido: pre.impedido };

  const cliente = asaasSub(chave);
  const payload = montarPayloadWebhook(pre.url, pre.segredo, pre.email);
  const falhou = (e: unknown): ResultadoWebhook => ({
    ok: false,
    impedido: 'asaas_falhou',
    // `call` ja trunca o corpo de erro em 500 chars. O corpo de ERRO nao carrega
    // o authToken (so o de sucesso carrega), entao isto e seguro de propagar.
    detalhe: e instanceof Error ? e.message : 'falha desconhecida no Asaas',
  });

  let diag: DiagnosticoWebhook;
  try {
    const { data } = await cliente.listarWebhooks();
    diag = diagnosticarWebhook(data, pre.url);
  } catch (e) {
    return falhou(e);
  }

  if (diag.estado !== 'ausente' && (opts?.forcar || precisaReparo(diag))) {
    try {
      const w = await cliente.atualizarWebhook(diag.id, payload);
      return { ok: true, acao: 'reparado', id: w.id };
    } catch (e) {
      return falhou(e);
    }
  }
  if (diag.estado !== 'ausente') return { ok: true, acao: 'ja_estava', id: diag.id };

  try {
    const w = await cliente.criarWebhook(payload);
    return { ok: true, acao: 'criado', id: w.id };
  } catch (e) {
    // A CORRIDA. Entre o `listarWebhooks` acima e este POST, outro pedido pode
    // ter cadastrado o mesmo webhook — e o Asaas deduplica POR URL, respondendo
    // 400 "Já existe uma configuração…". Tratar isso como falha faria dois
    // cliques simultaneos deixarem um erro na tela com o webhook JA no lugar.
    // Relistar e a forma de saber quem ganhou; achando, reescreve para a forma
    // canonica (o vencedor pode ter sido uma versao com outro segredo).
    try {
      const { data } = await cliente.listarWebhooks();
      const dnovo = diagnosticarWebhook(data, pre.url);
      if (dnovo.estado !== 'ausente') {
        const w = await cliente.atualizarWebhook(dnovo.id, payload);
        return { ok: true, acao: 'reparado', id: w.id };
      }
    } catch { /* cai no erro original, que e o mais informativo */ }
    return falhou(e);
  }
}
