'use server';
// Bloco 4B — criacao da subconta Asaas do escritorio.
//
// ORDEM DE OPERACOES NAO NEGOCIAVEL: o Asaas devolve a `apiKey` UMA UNICA VEZ,
// na resposta da criacao, e nao a expoe de novo. Gravar e a PRIMEIRA coisa
// depois da resposta. Se a gravacao falhar, existe uma subconta orfa cuja
// chave se perdeu — e o escritorio fica com uma conta no Asaas que a Balu nao
// consegue operar. Por isso o catch registra o accountId (nunca a chave) para
// recuperacao manual.
//
// TUDO QUE TOCA COLUNA `asaas*` PASSA PELO ADMIN CLIENT. A 0053 revogou o
// grant de tabela de `contabilidades` para anon/authenticated e reconcedeu
// coluna a coluna: pela sessao do usuario, `asaas_subconta_status` nem e
// escrivel (senao um membro autoaprovaria o proprio KYC) e
// `asaas_api_key_cifrada` nem e legivel. `permission denied` aqui seria a
// migration funcionando, nao bug.
//
// Nada de puro mora neste arquivo: 'use server' so pode exportar funcao async,
// e exportar tipo/constante/funcao pura daqui quebra no `next build` sem o
// `tsc --noEmit` reclamar. Por isso `traduzirErroAsaas` e
// `normalizarBirthDate` vivem em `@/lib/billing/`.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { asaasContaMae, asaasSub } from '@/lib/clients/asaas';
import { guardarCredencial, lerCredencial, mascarar } from '@/lib/billing/credencial-subconta';
import {
  validarDadosSubconta, montarPayloadSubconta, ehPessoaJuridica,
  normalizarBirthDate, soDigitos, type DadosSubconta,
} from '@/lib/billing/subconta';
import { traduzirErroAsaas, statusDoErroAsaas } from '@/lib/billing/subconta-erros';
import { mapearStatusSubconta } from '@/lib/billing/status-subconta';

type ActionResult = { ok: true } | { ok: false; error: string };

// A subconta pode ter nascido no Asaas sem que a resposta chegasse — e a
// `apiKey`, que so aparece nessa resposta, se perdeu junto. Repetir o pedido
// criaria uma SEGUNDA conta (ou bateria em documento duplicado) sem resolver a
// primeira: quem resolve e o suporte, procurando pelo documento no painel da
// conta-mae com o registro `subconta.possivel_orfa` em maos.
const ERRO_POSSIVEL_ORFA =
  'A Balu não conseguiu confirmar se a conta foi criada no Asaas. Fale com o suporte da Balu para conferir — não tente de novo.';

/** Sessão válida + escritório aprovado, ou o erro pronto pra devolver.
 *  Mesmo padrão de honorarios/actions.ts — local ao arquivo porque nada de
 *  síncrono pode ser exportado daqui. */
async function requireEscritorioAprovado(): Promise<
  { ok: true; id: string; userId: string } | { ok: false; error: string }
> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };
  if (g.contabilidade.status !== 'aprovada') return { ok: false, error: 'Escritório não aprovado.' };
  return { ok: true, id: g.contabilidade.id, userId: g.userId };
}

export async function criarSubcontaAction(dados: DadosSubconta): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const v = validarDadosSubconta(dados);
  if (!v.ok) return { ok: false, error: v.error };

  // O Asaas so aceita `birthDate` em YYYY-MM-DD, e so exige para CPF.
  // `validarDadosSubconta` checa presenca, nao formato — o formato e aqui.
  let aEnviar = dados;
  if (!ehPessoaJuridica(dados.cpfCnpj)) {
    const nasc = normalizarBirthDate(dados.birthDate);
    if (!nasc.ok) return { ok: false, error: nasc.error };
    aEnviar = { ...dados, birthDate: nasc.valor };
  }

  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades')
    .select('id, asaas_subconta_id, asaas_subconta_status')
    .eq('id', ctx.id).maybeSingle();
  if (!cont) return { ok: false, error: 'Escritório não encontrado.' };
  // Barra o clique SEQUENCIAL antes de gastar uma criacao no Asaas. Nao barra
  // o clique SIMULTANEO: duas requisicoes podem passar as duas por esta
  // leitura. Quem barra a corrida e o compare-and-swap la embaixo — esta
  // leitura existe para nao criar subconta a toa, nao para garantir unicidade.
  if (cont.asaas_subconta_id) {
    return { ok: false, error: 'Este escritório já tem subconta criada.' };
  }

  let criada;
  try {
    criada = await asaasContaMae.criarSubconta(montarPayloadSubconta(aEnviar));
  } catch (e) {
    // A mensagem do Asaas pode trazer dado do titular; o `call` ja trunca em
    // 500 chars, mas truncar nao e sanitizar. `traduzirErroAsaas` decide por
    // casamento e devolve constante propria — o texto cru NUNCA vai para a
    // tela, e nem para o `console.error` daqui.
    console.error('[4b] criar subconta falhou:', traduzirErroAsaas(e));

    // "NAO SEI SE NASCEU" vs "COMPROVADAMENTE NAO NASCEU".
    //
    // 4xx e recusa DETERMINISTICA: o Asaas leu o pedido, respondeu que nao, e
    // nenhuma conta foi criada — corrigir o dado e tentar de novo e o caminho
    // certo, e registrar orfandade aqui seria alarme falso em todo erro de
    // digitacao. Ja 5xx e a AUSENCIA de resposta (timeout, conexao cortada,
    // corpo ilegivel) deixam a duvida em pe: a subconta pode ter nascido do
    // outro lado carregando a `apiKey` que so aparece uma vez.
    //
    // Como `criarSubconta` nao tem retry (ver clients/asaas.ts), existe no
    // maximo UMA candidata — e a unica forma de acha-la depois e procurar o
    // documento no painel da conta-mae. Sem este registro, ninguem sabe
    // sequer que ha o que procurar.
    const status = statusDoErroAsaas(e);
    if (status === null || status >= 500) {
      await registrarAuditoria({
        actorUserId: ctx.userId, acao: 'subconta.possivel_orfa',
        alvoTipo: 'contabilidade', alvoId: ctx.id, contabilidadeId: ctx.id,
        // O documento e a CHAVE DE BUSCA no painel do Asaas. Credencial nao
        // entra aqui — e nem existiria: quando esta falha acontece, a resposta
        // que traria a `apiKey` nao chegou.
        meta: {
          cpf_cnpj: soDigitos(aEnviar.cpfCnpj),
          status_http: status,
          motivo: traduzirErroAsaas(e),
        },
      });
      return { ok: false, error: ERRO_POSSIVEL_ORFA };
    }
    return { ok: false, error: traduzirErroAsaas(e) };
  }

  // A cifra entra no MESMO caminho de falha da gravacao. `guardarCredencial`
  // LANCA quando a cifra nao se aplica (CERT_ENC_KEY ausente/torta) — e se
  // isso escapasse, a subconta ficaria orfa exatamente como numa falha de
  // UPDATE, mas sem a auditoria que permite recuperar. Um `throw` de dentro do
  // objeto passado ao `.update()` nao e um caso mais raro: e o mesmo caso.
  let falha: string | null = null;
  let venceu = false;
  try {
    // COMPARE-AND-SWAP. O `.is('asaas_subconta_id', null)` e o que transforma
    // "ja tem subconta?" de uma leitura antiga numa decisao ATOMICA do banco:
    // de dois cliques simultaneos, so um encontra a coluna nula e grava.
    //
    // O `.select('id')` nao e enfeite — sem ele o supabase-js devolve
    // `data: null` e `count: null`, e o perdedor da corrida seria
    // indistinguivel do vencedor (provado contra o banco: com `.select()`,
    // 1a chamada devolve `[{id}]`, a 2a devolve `[]`).
    const { data: gravadas, error } = await sb.from('contabilidades').update({
      asaas_subconta_id: criada.id,
      asaas_wallet_id: criada.walletId,
      asaas_api_key_cifrada: guardarCredencial(criada.apiKey),
      asaas_subconta_status: 'pendente',
      asaas_subconta_criada_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', ctx.id).is('asaas_subconta_id', null).select('id');
    falha = error?.message ?? null;
    venceu = (gravadas?.length ?? 0) === 1;
  } catch (e) {
    falha = e instanceof Error ? e.message : 'falha ao cifrar a credencial';
  }

  // DOIS CAMINHOS, UM DESTINO. Gravacao que ERROU e gravacao que nao pegou
  // linha nenhuma produzem exatamente o mesmo estrago: existe uma subconta no
  // Asaas cuja chave acabou de se perder. O perdedor da corrida nao pode sair
  // em silencio — sem o registro `subconta.orfa` ninguem sabe que a subconta
  // existe, e nao ha como recupera-la a mao.
  if (falha || !venceu) {
    const motivo = falha
      ?? 'corrida perdida: outro pedido simultaneo ja havia vinculado uma subconta a este escritorio';
    // Registrar o id para recuperacao manual; a chave, NUNCA — nem mascarada.
    console.error('[4b] SUBCONTA ORFA — gravar falhou', criada.id, motivo);
    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'subconta.orfa',
      alvoTipo: 'contabilidade', alvoId: ctx.id, contabilidadeId: ctx.id,
      meta: {
        asaas_account_id: criada.id, wallet_id: criada.walletId,
        causa: falha ? 'gravacao' : 'corrida', erro: motivo,
      },
    });
    return {
      ok: false,
      error: 'A subconta foi criada no Asaas mas não pôde ser vinculada. Fale com o suporte da Balu — não tente de novo.',
    };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'subconta.criada',
    alvoTipo: 'contabilidade', alvoId: ctx.id, contabilidadeId: ctx.id,
    meta: { asaas_account_id: criada.id, wallet_id: criada.walletId, chave: mascarar(criada.apiKey) },
  });

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}

/**
 * Reconsulta o KYC no Asaas e grava `asaas_subconta_status`. O escritório
 * aperta isso enquanto espera a aprovação — não há webhook próprio pro evento,
 * e sem esta ação NADA move a coluna de 'pendente' para 'aprovada'; o gate de
 * emissão de cobrança do 4B ficaria fechado para sempre.
 *
 * POR QUE PELA CHAVE DA SUBCONTA, E NÃO PELA CONTA-MÃE: a conta-mãe não tem
 * rota de KYC por subconta. `GET /v3/accounts` devolve `{ id, name }` e nada
 * mais, e foi por isso que a versão anterior desta ação não conseguia decidir
 * nada. Quem responde o KYC é `GET /v3/myAccount/status` — "minha conta" é a
 * conta DO TOKEN, então é preciso usar a apiKey da própria subconta.
 *
 * A chave é decifrada, passada direto ao `asaasSub` e nunca guardada em
 * variável de escopo largo, log ou retorno (regra do credencial-subconta.ts).
 *
 * A checagem antiga de "a subconta ainda aparece na lista da Balu" saiu: além
 * de não decidir status, ela lia só as 100 primeiras subcontas e passaria a
 * acusar sumiço falso a partir da 101ª. A consulta com a chave da subconta é
 * uma prova de vínculo melhor — se a chave deixou de valer, a chamada falha.
 */
export async function sincronizarStatusSubcontaAction(): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades').select('id, asaas_subconta_id, asaas_api_key_cifrada, asaas_subconta_status')
    .eq('id', ctx.id).maybeSingle();
  if (!cont?.asaas_subconta_id) return { ok: false, error: 'Nenhuma subconta para consultar.' };

  let chave: string | null;
  try {
    // `lerCredencial` LANCA quando o valor gravado nao tem a cifra — e um
    // banco com a chave em claro nao pode ser tratado como detalhe.
    chave = lerCredencial(cont.asaas_api_key_cifrada);
  } catch {
    console.error('[4b] credencial da subconta ilegivel', cont.asaas_subconta_id);
    return { ok: false, error: 'A credencial da subconta está ilegível. Fale com o suporte da Balu.' };
  }
  if (!chave) {
    return { ok: false, error: 'A credencial da subconta não está guardada. Fale com o suporte da Balu.' };
  }

  let bruto;
  try {
    bruto = await asaasSub(chave).consultarStatusConta();
  } catch (e) {
    return { ok: false, error: traduzirErroAsaas(e) };
  }

  const status = mapearStatusSubconta(bruto);
  if (status !== cont.asaas_subconta_status) {
    const { error } = await sb.from('contabilidades')
      .update({ asaas_subconta_status: status, updated_at: new Date().toISOString() })
      .eq('id', ctx.id);
    if (error) return { ok: false, error: 'Não foi possível gravar o status da subconta. Tente de novo.' };

    // Mudanca de status e evento de dinheiro: 'aprovada' e o que destrava
    // emitir cobranca em nome do escritorio. Sem a chave, nem mascarada.
    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'subconta.status',
      alvoTipo: 'contabilidade', alvoId: ctx.id, contabilidadeId: ctx.id,
      meta: {
        asaas_account_id: cont.asaas_subconta_id,
        de: cont.asaas_subconta_status, para: status,
      },
    });
  }

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}
