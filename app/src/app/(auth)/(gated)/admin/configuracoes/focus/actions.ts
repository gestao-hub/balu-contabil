'use server';
// 0094/0095 — token de revenda da Focus NFe (AdminBalu).
//
// O QUE ESTA TELA DECIDE: com que token a plataforma fala com a API de REVENDA
// da Focus — cadastrar empresa, atualizar cadastro, enviar certificado, ler o
// catálogo de CNAEs e de municípios. É o token que age em nome de todos os
// clientes; não há credencial mais sensível no produto.
//
// O QUE ELA **NÃO** DECIDE: a emissão. Nota fiscal sai com o token DA EMPRESA
// (`companies.focus_token`), que a Focus devolve no POST /v2/empresas. É por
// isso que aqui há UM campo e não um par hom/prod — ver o cabeçalho da 0095,
// que registra a sondagem em que essa confusão foi desfeita.
//
// POR QUE ELA EXISTE: até 20/08/2026 o token vinha de `process.env
// .FOCUS_NFE_TOKEN`, que existe na Vercel e NÃO existia no `.env.local` — lá
// havia `FOCUS_NFE_TOKEN_PRODUÇÃO` e `FOCUS_NFE_HOMOLOGAÇÃO`, nomes que o
// código nunca leu. O desenvolvimento local ficou com a Focus morta sem que
// nada denunciasse.
//
// ⚠️ UPDATE, NUNCA UPSERT — a mesma armadilha registrada em
// `admin/configuracoes/ia/actions.ts`: o upsert do PostgREST manda NULL nas
// colunas ausentes do payload.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { guardarTokenFocus, invalidarCacheFocus } from '@/lib/fiscal/config-focus';
import { focus } from '@/lib/clients/focus-nfe';
import {
  classificarSondaRevendaFocus,
  type ResultadoSondaRevendaFocus,
} from '@/lib/fiscal/focus-revenda-sonda';
import { ConfigFocusSchema } from '@/types/zod';

// `aviso` existe só no caminho de sucesso: CONSERTO 1 grava mesmo quando a
// sonda não deu para confirmar (rede/5xx/timeout), e a tela precisa de como
// dizer "salvo, mas não confirmado" sem virar erro.
type ActionResult = { ok: true; aviso?: string } | { ok: false; error: string };

const ROTA = '/admin/configuracoes/focus';

/** Empresa inexistente na revenda. A sonda tem de bater num endpoint de
 *  REVENDA, e não no catálogo: em 20/08/2026 os tokens do `.env.local` deram
 *  200 em `/v2/codigos_cnae` e 401 em `/v2/empresas` — testar pelo catálogo
 *  teria aprovado um token que não serve para nada que esta tela promete. */
const ID_SONDA = 1;

/**
 * Sonda `GET /v2/empresas/:id` contra a revenda e classifica o resultado com
 * a MESMA regra para os dois chamadores deste arquivo:
 *   - `testarConexaoFocusAction` — sem `token`, resolve o que já está gravado.
 *   - `salvarConfigFocusAction` — com `token`, sonda o candidato do formulário
 *     ANTES de gravar (conserto 1: ver o comentário lá).
 * A classificação em si é pura e mora em `lib/fiscal/focus-revenda-sonda.ts`,
 * testável sem rede.
 */
async function sondarRevendaFocus(token?: string): Promise<ResultadoSondaRevendaFocus> {
  try {
    await focus.consultarEmpresa(ID_SONDA, undefined, token);
    return { status: 'aceito' };
  } catch (e) {
    return classificarSondaRevendaFocus(e);
  }
}

export async function salvarConfigFocusAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = ConfigFocusSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }

  const token = (parsed.data.token_revenda ?? '').trim();
  if (!token) {
    // Sem isto o "salvar" com o campo vazio gravaria só o carimbo de data e
    // diria "salvo" — o admin sairia achando que trocou o token.
    return { ok: false, error: 'Cole o token de revenda para salvar.' };
  }

  // CONSERTO 1 (Bloco 5 produção fiscal, 20/08/2026): antes disto a tela
  // gravava o token e só testava DEPOIS, se o admin lembrasse de clicar em
  // "Testar conexão". Foi assim que o token de EMISSÃO de uma empresa — que
  // FUNCIONA nas consultas de catálogo — foi colado neste campo, gravado sem
  // reclamar, e passou a derrubar cadastro de empresa, upload de certificado
  // A1 e o botão Sincronizar com 401 em produção. E como campo vazio significa
  // "não trocar", não havia caminho pela interface para desfazer. Agora a
  // sonda roda ANTES do UPDATE/INSERT, com o token que está SENDO SALVO — não
  // o que já está no banco.
  let aviso: string | undefined;
  const sonda = await sondarRevendaFocus(token);
  if (sonda.status === 'recusado') {
    return {
      ok: false,
      error:
        'A Focus recusou este token na API de revenda (401/403) — nada foi salvo. Confira se ' +
        'você não colou o token de EMISSÃO de uma empresa por engano: ele é diferente do token ' +
        'da conta de revenda, e costuma funcionar em consultas de catálogo mesmo sem acesso à ' +
        'revenda — foi exatamente essa confusão que derrubou a Focus em produção em 20/08/2026.',
    };
  }
  if (sonda.status === 'indeterminado') {
    // Rede fora do ar, 5xx ou timeout não pode travar quem está configurando
    // uma credencial nova: a Focus pode estar instável e o token, correto.
    aviso =
      `Salvo, mas não foi possível confirmar o acesso à revenda agora ` +
      `(${sonda.motivo.slice(0, 140)}). Teste a conexão quando puder.`;
  }

  const patch: Record<string, unknown> = {
    atualizado_por: ctx.userId,
    atualizado_em: new Date().toISOString(),
  };
  try {
    patch.token_revenda_cifrado = guardarTokenFocus(token);
  } catch {
    // `guardarTokenFocus` recusa devolver valor não cifrado. Gravar em claro o
    // token que age em nome de todos os clientes seria pior que falhar.
    return { ok: false, error: 'Não foi possível proteger o token. Nada foi salvo.' };
  }

  const sb = createAdminClient();
  const { data: atual, error: eLer } = await sb
    .from('config_focus').select('id').eq('id', 1).maybeSingle();
  if (eLer) {
    console.error('[0095] config_focus leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler a configuração. Tente de novo.' };
  }

  if (atual) {
    // `.select('id')` para distinguir "gravou" de "não pegou linha nenhuma":
    // sem ele o PostgREST devolve sucesso para um UPDATE que não achou nada.
    const { data, error } = await sb
      .from('config_focus').update(patch).eq('id', 1).select('id');
    if (error) {
      console.error('[0095] config_focus update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, error: 'A configuração não foi encontrada. Recarregue a página.' };
    }
  } else {
    const { error } = await sb.from('config_focus').insert({ id: 1, ...patch });
    if (error) {
      console.error('[0095] config_focus insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
  }

  // O cache de 60s de `obterTokenRevendaFocus` valeria contra o token velho até
  // expirar. Invalidar aqui faz a troca valer na chamada seguinte — inclusive
  // no "testar conexão" que o admin costuma clicar logo depois.
  invalidarCacheFocus();

  // A AUDITORIA NÃO MENCIONA O TOKEN — nem mascarado. Máscara em log é segredo
  // pela metade, e o que interessa auditar é QUEM trocou e QUANDO.
  //
  // CONSERTO 3: `audit_log.alvo_id` é uuid, e a string `'1'` não é — o insert
  // falhava com erro de sintaxe, calado, porque `registrarAuditoria` não
  // conferia o `error` do insert. O identificador do singleton (id=1 em
  // `config_focus`) vai para o `meta`.
  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'focus.config_salvar',
    alvoTipo: 'config_focus',
    alvoId: null,
    meta: { config_id: 1, trocou_token: true, sonda: sonda.status },
  });

  revalidatePath(ROTA);
  return aviso ? { ok: true, aviso } : { ok: true };
}

/**
 * Testa o token JÁ GRAVADO contra a API de REVENDA da Focus, de verdade — a
 * pedido do admin, depois de salvar.
 *
 * Nenhum dado de contribuinte atravessa: o id da sonda é uma constante deste
 * arquivo, de uma empresa que não é nossa. A classificação (401/403 recusa,
 * 404 aprova, resto é indeterminado) é a mesma que `salvarConfigFocusAction`
 * usa para testar o token NOVO antes de gravar — ver `sondarRevendaFocus` e
 * `classificarSondaRevendaFocus`.
 */
export async function testarConexaoFocusAction(): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const sonda = await sondarRevendaFocus();
  if (sonda.status === 'aceito') return { ok: true };
  if (sonda.status === 'recusado') {
    return {
      ok: false,
      error: 'A Focus recusou o token: ele não tem acesso à API de revenda (401/403).',
    };
  }
  if (/não configurado/i.test(sonda.motivo)) {
    return { ok: false, error: 'Não há token de revenda guardado.' };
  }
  // Curto de propósito: a resposta da Focus pode trazer corpo longo, e o
  // toast não é lugar de despejar HTML de gateway.
  return {
    ok: false,
    error: `A Focus não recusou o token, mas a chamada falhou: ${sonda.motivo.slice(0, 160)}`,
  };
}
