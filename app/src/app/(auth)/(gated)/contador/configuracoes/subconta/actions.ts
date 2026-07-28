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
import { asaasContaMae } from '@/lib/clients/asaas';
import { guardarCredencial, mascarar } from '@/lib/billing/credencial-subconta';
import {
  validarDadosSubconta, montarPayloadSubconta, ehPessoaJuridica,
  normalizarBirthDate, type DadosSubconta,
} from '@/lib/billing/subconta';
import { traduzirErroAsaas } from '@/lib/billing/subconta-erros';

type ActionResult = { ok: true } | { ok: false; error: string };

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
  // Sem isto, um duplo clique cria DUAS subcontas no Asaas para o mesmo
  // escritorio — e a primeira fica orfa, com a chave perdida.
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
    return { ok: false, error: traduzirErroAsaas(e) };
  }

  // A cifra entra no MESMO caminho de falha da gravacao. `guardarCredencial`
  // LANCA quando a cifra nao se aplica (CERT_ENC_KEY ausente/torta) — e se
  // isso escapasse, a subconta ficaria orfa exatamente como numa falha de
  // UPDATE, mas sem a auditoria que permite recuperar. Um `throw` de dentro do
  // objeto passado ao `.update()` nao e um caso mais raro: e o mesmo caso.
  let falha: string | null = null;
  try {
    const { error } = await sb.from('contabilidades').update({
      asaas_subconta_id: criada.id,
      asaas_wallet_id: criada.walletId,
      asaas_api_key_cifrada: guardarCredencial(criada.apiKey),
      asaas_subconta_status: 'pendente',
      asaas_subconta_criada_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', ctx.id);
    falha = error?.message ?? null;
  } catch (e) {
    falha = e instanceof Error ? e.message : 'falha ao cifrar a credencial';
  }

  if (falha) {
    // A subconta EXISTE no Asaas e a chave acabou de se perder. Registrar o
    // id para recuperacao manual; a chave, nunca — nem mascarada em meta.
    console.error('[4b] SUBCONTA ORFA — gravar falhou', criada.id, falha);
    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'subconta.orfa',
      alvoTipo: 'contabilidade', alvoId: ctx.id, contabilidadeId: ctx.id,
      meta: { asaas_account_id: criada.id, wallet_id: criada.walletId, erro: falha },
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

/** Reconsulta o Asaas e confere o vínculo da subconta. O escritório aperta
 *  isso enquanto espera a aprovação — sem webhook próprio para o evento.
 *
 *  LIMITE CONHECIDO: `listarSubcontas` devolve `{ id, name }` e nenhum campo
 *  de KYC, então esta ação confirma que a subconta continua na conta da Balu
 *  mas NÃO consegue mover `asaas_subconta_status` de 'pendente' para
 *  'aprovada'. Quem tem o status do KYC é `GET /v3/myAccount/status`, que se
 *  consulta com o token da PRÓPRIA subconta (`asaasSub`) e ainda não existe
 *  no cliente. Reportado ao dono do plano. */
export async function sincronizarStatusSubcontaAction(): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades').select('id, asaas_subconta_id')
    .eq('id', ctx.id).maybeSingle();
  if (!cont?.asaas_subconta_id) return { ok: false, error: 'Nenhuma subconta para consultar.' };

  let lista;
  try {
    lista = await asaasContaMae.listarSubcontas();
  } catch (e) {
    return { ok: false, error: traduzirErroAsaas(e) };
  }
  const achou = (lista.data ?? []).some((s) => s.id === cont.asaas_subconta_id);
  if (!achou) return { ok: false, error: 'A subconta não aparece mais na conta da Balu.' };

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}
