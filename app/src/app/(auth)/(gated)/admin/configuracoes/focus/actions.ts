'use server';
// 0094/0095/0099 — tokens da Focus NFe para a conta da PLATAFORMA (AdminBalu).
//
// O QUE ESTA TELA DECIDE: com que token a plataforma fala com a Focus em nome
// da conta da plataforma — o catálogo de CNAEs, o de municípios e, o que mais
// importa, o **cadastro de empresa** (`POST /v2/empresas`), que usa o token de
// PRODUÇÃO gravado aqui (ver `lib/clients/focus-nfe.ts:criarEmpresa`).
//
// ⚠️ 27/08/2026 — ESTE CABEÇALHO AFIRMAVA O CONTRÁRIO, e a afirmação era falsa.
// Dizia que o cadastro de empresa "está bloqueado por permissão da CONTA no
// Gateway da Focus desde 23/07/2026, independente de qual token for gravado
// aqui". O suporte da Focus desmentiu por escrito: a conta está liberada para a
// API de Empresas, e ela exige "exclusivamente o token principal de produção".
// O token gravado aqui é EXATAMENTE o que decide se o cadastro funciona — a
// frase antiga tirava desta tela a responsabilidade que é dela.
//
// O QUE ELA **NÃO** DECIDE: a emissão. Nota fiscal sai com o token DA EMPRESA
// (`companies.focus_token`), que a Focus devolve no POST /v2/empresas.
//
// DOIS CAMPOS, DE VOLTA. A 0095 tinha reduzido isto a um token só
// ("de revenda"), com base numa sonda contra `/v2/empresas` lida errado — ver
// o cabeçalho da 0099, que desfaz isso e registra a medição que prova o par
// hom/prod. Os dois tokens são independentes: um é válido em
// `homologacao.focusnfe.com.br`, o outro em `api.focusnfe.com.br`, e um NÃO
// serve no lugar do outro.
//
// ⚠️ UPDATE, NUNCA UPSERT — a mesma armadilha registrada em
// `admin/configuracoes/ia/actions.ts`: o upsert do PostgREST manda NULL nas
// colunas ausentes do payload. Como aqui um campo vazio pode significar "não
// mexer nesse token", um upsert trocaria por engano o token que NÃO veio no
// formulário.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { guardarTokenFocus, invalidarCacheFocus, type AmbienteFocus } from '@/lib/fiscal/config-focus';
import { focus } from '@/lib/clients/focus-nfe';
import {
  classificarSondaTokenFocus,
  combinarSondaProducao,
  type ResultadoSondaTokenFocus,
} from '@/lib/fiscal/focus-token-sonda';
import { ConfigFocusSchema } from '@/types/zod';

// `aviso` existe só no caminho de sucesso: CONSERTO 1 grava mesmo quando a
// sonda não deu para confirmar (rede/5xx/timeout), e a tela precisa de como
// dizer "salvo, mas não confirmado" sem virar erro.
type ActionResult = { ok: true; aviso?: string } | { ok: false; error: string };

const ROTA = '/admin/configuracoes/focus';

function nomeAmbiente(ambiente: AmbienteFocus): string {
  return ambiente === 'hom' ? 'homologação' : 'produção';
}

/** Código de CNAE real e fixo, presente no catálogo dos dois ambientes.
 *
 *  Ele responde "este token vale NESTA base?" — e só isso. Aceita qualquer
 *  token válido da conta, inclusive um que a API de Empresas recusa. Era a
 *  sonda ÚNICA até 27/08/2026, e é por isso que um token errado ficou 35 dias
 *  aprovado na tela enquanto o cadastro de empresa respondia 401. Em produção
 *  ele agora é o PRIMEIRO passo, não o único — ver `sondarTokenFocus`. */
const CODIGO_CNAE_SONDA = '6201501';

/**
 * Sonda `GET /v2/codigos_cnae/6201501` **na base do ambiente informado** e
 * classifica o resultado com a MESMA regra para os dois chamadores deste
 * arquivo:
 *   - `testarConexaoFocusAction` — sem `token`, resolve o que já está gravado
 *     para aquele ambiente.
 *   - `salvarConfigFocusAction` — com `token`, sonda o candidato do
 *     formulário ANTES de gravar (conserto 1) — precisa sondar com o que
 *     está SENDO SALVO, não com o que já está no banco.
 * A classificação em si é pura e mora em `lib/fiscal/focus-token-sonda.ts`,
 * testável sem rede.
 */
async function sondarTokenFocus(
  ambiente: AmbienteFocus,
  token?: string,
): Promise<ResultadoSondaTokenFocus> {
  const catalogo = await sondarCatalogo(ambiente, token);

  // Homologação para por aqui: `/v2/empresas` não existe em
  // `homologacao.focusnfe.com.br` (404 `nao_encontrado`, medido em 27/08/2026),
  // então não há segunda pergunta a fazer nessa base.
  if (ambiente === 'hom') return catalogo;

  // Produção tem a segunda pergunta — e ela é a que importa para o cadastro de
  // empresa. Só é feita se o catálogo passou: ver `combinarSondaProducao`.
  if (catalogo.status !== 'aceito') return catalogo;
  return combinarSondaProducao(catalogo, await sondarEmpresas(token));
}

/** "Este token vale nesta base?" */
async function sondarCatalogo(
  ambiente: AmbienteFocus,
  token?: string,
): Promise<ResultadoSondaTokenFocus> {
  try {
    await focus.consultarCnae(CODIGO_CNAE_SONDA, ambiente, token);
    return { status: 'aceito' };
  } catch (e) {
    return classificarSondaTokenFocus(e);
  }
}

/** "E ele é o token PRINCIPAL de produção?" — a única pergunta que separa o
 *  token que cadastra empresa do que só lê catálogo. */
async function sondarEmpresas(token?: string): Promise<ResultadoSondaTokenFocus> {
  try {
    await focus.listarEmpresas(token);
    return { status: 'aceito' };
  } catch (e) {
    return classificarSondaTokenFocus(e);
  }
}

export async function salvarConfigFocusAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = ConfigFocusSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }

  const tokenHom = (parsed.data.token_hom ?? '').trim();
  const tokenProd = (parsed.data.token_prod ?? '').trim();
  if (!tokenHom && !tokenProd) {
    // Sem isto o "salvar" com os dois campos em branco atualizaria só o
    // carimbo de data e diria "salvo" — o admin sairia achando que trocou
    // algum dos tokens. O caminho comum é trocar só UM dos dois — por isso
    // isto exige pelo menos um, não os dois.
    return { ok: false, error: 'Cole ao menos um token (homologação ou produção) para salvar.' };
  }

  // CONSERTO 1 (Bloco 5 produção fiscal, 20/08/2026), agora por ambiente: cada
  // token preenchido é sondado NO SEU AMBIENTE antes de ir para o UPDATE —
  // com o candidato do formulário, não com o que já está no banco. Se
  // QUALQUER um dos dois for recusado, NADA é gravado — nem o outro campo,
  // mesmo que ele tenha passado: gravar metade de uma troca deixaria o admin
  // sem saber qual dos dois está valendo.
  const candidatos: Array<{ ambiente: AmbienteFocus; token: string }> = [];
  if (tokenHom) candidatos.push({ ambiente: 'hom', token: tokenHom });
  if (tokenProd) candidatos.push({ ambiente: 'prod', token: tokenProd });

  type SondaItem = { ambiente: AmbienteFocus; token: string; sonda: ResultadoSondaTokenFocus };
  const sondas: SondaItem[] = await Promise.all(
    candidatos.map(async (c) => ({ ...c, sonda: await sondarTokenFocus(c.ambiente, c.token) })),
  );

  const recusada = sondas.find((s) => s.sonda.status === 'recusado');
  if (recusada) {
    // NADA é gravado quando um dos dois é recusado — nem o outro campo, ainda
    // que ele tenha passado na sonda: gravar metade de uma troca deixaria o
    // admin sem saber qual dos dois está valendo (ver o laço de escrita
    // abaixo, que só roda depois deste `return`).
    return {
      ok: false,
      error:
        `A Focus recusou o token de ${nomeAmbiente(recusada.ambiente)} (401/403) — nada foi ` +
        'salvo. Confira se você não trocou os campos: o token de homologação não funciona em ' +
        'produção, e o de produção não funciona em homologação — cada um só vale na base do ' +
        'seu próprio ambiente.',
    };
  }

  // Nenhuma recusa: os que sobraram são 'aceito' ou 'indeterminado'. Rede
  // fora do ar, 5xx ou timeout não podem travar quem está configurando uma
  // credencial nova — a Focus pode estar instável e o token, correto.
  const ehIndeterminado = (
    s: SondaItem,
  ): s is SondaItem & { sonda: Extract<ResultadoSondaTokenFocus, { status: 'indeterminado' }> } =>
    s.sonda.status === 'indeterminado';
  const indeterminados = sondas.filter(ehIndeterminado);
  const avisos: string[] = [];
  if (indeterminados.length > 0) {
    const partes = indeterminados.map(
      (s) => `${nomeAmbiente(s.ambiente)} (${s.sonda.motivo.slice(0, 100)})`,
    );
    avisos.push(
      `Não foi possível confirmar: ${partes.join('; ')} — teste a conexão quando puder.`,
    );
  }

  // 'nao_principal' AVISA MAS NÃO BLOQUEIA, e as duas metades são decisões.
  //
  // Não bloqueia porque o token é válido: ele serve ao catálogo de CNAEs e ao
  // de municípios, e recusar a gravação deixaria a plataforma sem NENHUM token
  // — pior que o estado que se quer corrigir.
  //
  // Avisa porque o silêncio aqui foi o defeito: entre 23/07 e 27/08/2026 esta
  // tela disse "aceito" para um token que a API de Empresas recusava, e o
  // cadastro de empresa ficou 35 dias quebrado sem que nada na interface
  // apontasse para a causa. O aviso nomeia o endpoint e diz onde pegar o token
  // certo — quem lê tem o que fazer sem abrir o código.
  if (sondas.some((s) => s.sonda.status === 'nao_principal')) {
    avisos.push(
      'O token de produção é válido, mas NÃO é o token principal: a Focus o recusa em ' +
      'GET /v2/empresas, que é o que cadastra empresa e habilita a emissão. Pegue o token ' +
      'principal de produção no painel da Focus, em Serviços > Painel API > Tokens.',
    );
  }

  // Cada aviso é uma frase inteira, e o prefixo é neutro de propósito: com
  // "Salvo, mas …" o texto virava "Salvo, mas o token é válido, mas NÃO é o
  // principal". Este toast é o que a pessoa lê no momento exato de decidir se
  // precisa voltar ao painel da Focus — não é lugar de tropeço de leitura.
  const aviso = avisos.length > 0 ? `Salvo. ${avisos.join(' ')}` : undefined;

  const patch: Record<string, unknown> = {
    atualizado_por: ctx.userId,
    atualizado_em: new Date().toISOString(),
  };
  const trocou = { hom: false, prod: false };
  try {
    for (const s of sondas) {
      const cifrado = guardarTokenFocus(s.token);
      if (s.ambiente === 'hom') {
        patch.token_hom_cifrado = cifrado;
        trocou.hom = true;
      } else {
        patch.token_prod_cifrado = cifrado;
        trocou.prod = true;
      }
    }
  } catch {
    // `guardarTokenFocus` recusa devolver valor não cifrado. Gravar em claro
    // um token desta conta seria pior que falhar.
    return { ok: false, error: 'Não foi possível proteger o token. Nada foi salvo.' };
  }

  const sb = createAdminClient();
  const { data: atual, error: eLer } = await sb
    .from('config_focus').select('id').eq('id', 1).maybeSingle();
  if (eLer) {
    console.error('[0099] config_focus leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler a configuração. Tente de novo.' };
  }

  if (atual) {
    // `.select('id')` para distinguir "gravou" de "não pegou linha nenhuma":
    // sem ele o PostgREST devolve sucesso para um UPDATE que não achou nada.
    const { data, error } = await sb
      .from('config_focus').update(patch).eq('id', 1).select('id');
    if (error) {
      console.error('[0099] config_focus update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, error: 'A configuração não foi encontrada. Recarregue a página.' };
    }
  } else {
    const { error } = await sb.from('config_focus').insert({ id: 1, ...patch });
    if (error) {
      console.error('[0099] config_focus insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
  }

  // O cache de 60s de `obterTokenFocus` valeria contra o token velho até
  // expirar. Invalidar aqui faz a troca valer na chamada seguinte — inclusive
  // no "testar conexão" que o admin costuma clicar logo depois.
  invalidarCacheFocus();

  // A AUDITORIA NÃO MENCIONA O TOKEN — nem mascarado. Máscara em log é segredo
  // pela metade, e o que interessa auditar é QUEM trocou, QUANDO e QUAL DOS
  // DOIS.
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
    meta: {
      config_id: 1,
      trocou_hom: trocou.hom,
      trocou_prod: trocou.prod,
      sonda_hom: sondas.find((s) => s.ambiente === 'hom')?.sonda.status ?? null,
      sonda_prod: sondas.find((s) => s.ambiente === 'prod')?.sonda.status ?? null,
    },
  });

  revalidatePath(ROTA);
  return aviso ? { ok: true, aviso } : { ok: true };
}

/**
 * Limpa os dois tokens gravados — volta a plataforma a usar as variáveis de
 * ambiente (0099).
 *
 * CONSERTO 2 (Bloco 5 produção fiscal): antes disto não existia caminho pela
 * interface para desfazer uma gravação ruim. Campo vazio no formulário
 * sempre significou "não trocar" — nunca "apagar".
 */
export async function limparConfigFocusAction(): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const sb = createAdminClient();
  // `.select('id')` pela mesma razão do salvar: distinguir "limpou" de "não
  // achou linha nenhuma" — sem ele o PostgREST devolve sucesso do mesmo jeito.
  const { data, error } = await sb
    .from('config_focus')
    .update({
      token_hom_cifrado: null,
      token_prod_cifrado: null,
      atualizado_por: ctx.userId,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', 1)
    .select('id');
  if (error) {
    console.error('[0099] config_focus limpar falhou:', error.message);
    return { ok: false, error: 'Não foi possível limpar. Tente de novo.' };
  }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, error: 'A configuração não foi encontrada. Recarregue a página.' };
  }

  invalidarCacheFocus();

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'focus.config_limpar',
    alvoTipo: 'config_focus',
    alvoId: null,
    meta: { config_id: 1 },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * Testa o token JÁ GRAVADO de um ambiente contra a Focus, de verdade — a
 * pedido do admin, depois de salvar.
 *
 * Nenhum dado de contribuinte atravessa: o código de CNAE da sonda é uma
 * constante deste arquivo. A classificação (401/403 recusa, resto é
 * indeterminado) é a mesma que `salvarConfigFocusAction` usa para testar o
 * token NOVO antes de gravar — ver `sondarTokenFocus` e
 * `classificarSondaTokenFocus`.
 */
export async function testarConexaoFocusAction(ambiente: AmbienteFocus): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const sonda = await sondarTokenFocus(ambiente);
  if (sonda.status === 'aceito') return { ok: true };
  if (sonda.status === 'nao_principal') {
    // Falha, e não sucesso com ressalva: quem clica em "testar" quer saber se
    // a plataforma consegue trabalhar com este token. Para cadastrar empresa —
    // o que essa credencial existe para fazer — ela não consegue.
    return {
      ok: false,
      error:
        'O token de produção é válido, mas NÃO é o token principal: a Focus o recusa em ' +
        'GET /v2/empresas, o endpoint que cadastra empresa e habilita a emissão. Pegue o ' +
        'token principal de produção no painel da Focus, em Serviços > Painel API > Tokens.',
    };
  }
  if (sonda.status === 'recusado') {
    return {
      ok: false,
      error: `A Focus recusou o token de ${nomeAmbiente(ambiente)}: ele não vale nesse ambiente (401/403).`,
    };
  }
  if (/não configurado/i.test(sonda.motivo)) {
    return { ok: false, error: `Não há token de ${nomeAmbiente(ambiente)} guardado.` };
  }
  // Curto de propósito: a resposta da Focus pode trazer corpo longo, e o
  // toast não é lugar de despejar HTML de gateway.
  return {
    ok: false,
    error:
      `A Focus não recusou o token de ${nomeAmbiente(ambiente)}, mas a chamada falhou: ` +
      `${sonda.motivo.slice(0, 160)}`,
  };
}
