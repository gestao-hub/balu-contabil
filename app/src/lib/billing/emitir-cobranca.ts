// Bloco 4B — O CORACAO DO BLOCO: a cobranca do escritorio nascendo NA SUBCONTA
// dele.
//
// ┌─ O PRINCIPIO, QUE NAO SE NEGOCIA (spec §1) ────────────────────────────┐
// │ A Balu NAO intermedia dinheiro de terceiro. A cobranca tem de nascer   │
// │ na subconta do escritorio: o credor e ele, e o dinheiro liquida na     │
// │ conta dele. Se sair pela chave da conta-mae, ela nasce pertencendo a   │
// │ Balu — e o bloco inteiro perde o sentido. A prova disso e consultar a  │
// │ cobranca PELA CONTA-MAE e receber 404.                                 │
// └────────────────────────────────────────────────────────────────────────┘
//
// POR QUE UM MODULO SO, E NAO O CODIGO DENTRO DE CADA ACTION: ha dois caminhos
// de emissao (servico avulso e honorario) e havera mais. Cada copia e uma
// chance de alguem escrever `asaas` no lugar de `asaasSub`, de esquecer o gate,
// ou de deixar a chave escapar num log. Aqui existe UMA porta: quem emite passa
// por ela ou nao emite.
//
// Mora em lib/ e nao no arquivo 'use server' porque nao e Server Action: e
// chamada por duas, e arquivo 'use server' so pode exportar funcao async
// serializavel (tipo/constante exportado de la quebra no `next build` sem o
// `tsc --noEmit` reclamar).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asaasSub } from '@/lib/clients/asaas';
import { registrarAuditoria } from '@/lib/security/audit';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import { soDigitos } from '@/lib/billing/subconta';

export type ClienteCobravel = {
  id: string;
  nome: string;
  /** Documento COMO ESTA NO BANCO — a normalizacao acontece aqui dentro. */
  cpfCnpj: string;
  email: string | null;
};

export type PedidoEmissao = {
  contabilidadeId: string;
  userId: string;
  cliente: ClienteCobravel;
  descricao: string;
  valorCentavos: number;
  /** YYYY-MM-DD. */
  vencimento: string;
  /** Preenchido no caminho do catalogo; `null` no do honorario. */
  servicoAvulsoId: string | null;
  /** Preenchido no caminho do honorario; `null` no do avulso. Ver LIGACAO
   *  CANONICA no cabecalho de `cobrar-actions.ts` dos honorarios. */
  honorarioId: string | null;
};

export type ResultadoEmissao =
  | { ok: true; cobrancaId: string; chargeId: string; linkFatura: string | null }
  | { ok: false; error: string };

/** Mensagem unica para "o Asaas nao respondeu como devia". Nunca repassa o
 *  texto do Asaas: o corpo de erro dele carrega dado do cliente e, no caminho
 *  da subconta, a mensagem passa perto da chave. */
const ERRO_ASAAS = 'Não foi possível emitir a cobrança agora. Tente de novo em instantes.';

/**
 * Cliente do Asaas correspondente a empresa, reusando o cadastro anterior.
 *
 * `POST /v3/customers` nao deduplica: sem esta busca, cada emissao criaria um
 * cadastro novo e a agenda de clientes DO ESCRITORIO viraria lixo em poucos
 * meses. Best-effort de proposito — se a busca falhar por qualquer motivo,
 * cai-se no comportamento antigo (criar) em vez de recusar a emissao.
 *
 * A conferencia do documento no resultado nao e paranoia: e o que garante que,
 * se um dia o filtro do Asaas mudar de nome e a rota devolver "os 10 primeiros
 * clientes", nao se cobre a pessoa errada.
 */
async function clienteNaSubconta(
  sub: ReturnType<typeof asaasSub>, nome: string, doc: string, email: string | null,
): Promise<string> {
  try {
    const { data } = await sub.buscarClientesPorDocumento(doc);
    const achado = (data ?? []).find((c) => soDigitos(c.cpfCnpj ?? '') === doc);
    if (achado?.id) return achado.id;
  } catch (e) {
    console.error('[4b] busca de cliente na subconta falhou, criando novo:', mensagemCurta(e));
  }
  const criado = await sub.criarCliente({ name: nome, cpfCnpj: doc, email: email ?? undefined });
  return criado.id;
}

/**
 * Trechos que so podem ser credencial, redigidos ANTES do corte.
 *
 * TRUNCAR NAO E SANITIZAR: a chave costuma vir no COMECO da mensagem (`fetch
 * failed: access_token=...`), dentro dos 200 caracteres que sobrevivem ao
 * `.slice`. Cortar o fim so garante que a mensagem e curta, nao que ela e
 * segura.
 */
const PADROES_CREDENCIAL: RegExp[] = [
  // `access_token=...`, `apiKey: ...`, `authorization=...` — o nome do header
  // JUNTO com o valor: sem isto sobraria `access_token=` seguido do segredo.
  /\b(access[_-]?token|api[_-]?key|authorization|token)\b\s*[:=]\s*\S+/gi,
  // A chave do Asaas tem prefixo proprio e nao aparece em texto legitimo. Pega
  // tambem a chave SOLTA, sem nome de header na frente — que e como ela sai de
  // um erro que so ecoa o valor.
  /\$aact[\w-]*/gi,
  // Esquemas de Authorization que chegam a aparecer em erro de proxy.
  /\b(bearer|basic)\s+[\w.\-+/=]+/gi,
];

/** Texto de erro seguro para log: REDIGIDO primeiro, truncado depois, e nunca
 *  o objeto inteiro. */
function mensagemCurta(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  const limpo = PADROES_CREDENCIAL.reduce((t, re) => t.replace(re, '[REDIGIDO]'), bruto);
  return limpo.slice(0, 200);
}

/**
 * Emite a cobrança e grava a linha em `cobrancas_escritorio`.
 *
 * Pressupõe que quem chama JÁ provou duas coisas, porque só quem chama sabe
 * como prová-las: que a sessão é de um escritório aprovado, e que o cliente
 * está na carteira DELE. Tudo o mais — gate, KYC da subconta, credencial,
 * Asaas, persistência e auditoria — é responsabilidade daqui.
 */
export async function emitirCobrancaEscritorio(
  sb: SupabaseClient, p: PedidoEmissao,
): Promise<ResultadoEmissao> {
  // ─── GATE DE INADIMPLENCIA ────────────────────────────────────────────────
  // Decisao do usuario (27/07), na mesma forma das duas fronteiras do 4A:
  // BLOQUEIA CRIAR COBRANCA NOVA, e NUNCA alcanca ver, sincronizar ou receber
  // as ja emitidas. Dinheiro que o cliente ja deve ao escritorio precisa
  // continuar entrando — inclusive porque e com ele que o escritorio paga a
  // Balu. Por isso o gate mora AQUI, na unica porta de criacao, e nao no
  // webhook, no cron nem nas telas de consulta.
  const gate = await assertAssinaturaEscritorio(p.contabilidadeId);
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!(p.valorCentavos > 0)) return { ok: false, error: 'Informe o valor da cobrança.' };
  if (!p.descricao.trim()) return { ok: false, error: 'Descreva o que está sendo cobrado.' };

  const doc = soDigitos(p.cliente.cpfCnpj);
  if (doc.length !== 11 && doc.length !== 14) {
    return { ok: false, error: 'Este cliente está sem CNPJ/CPF válido no cadastro — corrija antes de cobrar.' };
  }

  // ─── CREDENCIAL ───────────────────────────────────────────────────────────
  // `.eq('id', ...)` com o id DO CONTEXTO e a unica coisa que impede um
  // escritorio de emitir com a chave de outro: o admin client ignora RLS.
  const { data: cont, error: erroCont } = await sb
    .from('contabilidades')
    .select('id, asaas_subconta_status, asaas_api_key_cifrada')
    .eq('id', p.contabilidadeId).maybeSingle();
  if (erroCont) {
    console.error('[4b] leitura da subconta falhou:', p.contabilidadeId, erroCont.message);
    return { ok: false, error: 'Não foi possível ler a conta de recebimento do escritório. Tente de novo.' };
  }
  if (cont?.asaas_subconta_status !== 'aprovada') {
    return { ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' };
  }

  // LEITURA DENTRO DO `try`. `lerCredencial` LANCA quando o valor gravado nao
  // tem o prefixo `enc:v1:` — para a apiKey da subconta nao ha legado, entao
  // valor sem cifra so pode ser gravacao corrompida. Fora do try, a excecao
  // escaparia da Server Action como erro generico do Next e este ramo, com a
  // mensagem que manda falar com o suporte, ficaria inalcancavel.
  let token: string | null;
  try {
    token = lerCredencial(cont.asaas_api_key_cifrada);
  } catch {
    // Sem a chave no log, nem mascarada: um banco com o segredo em claro nao
    // vira uma segunda copia dele no arquivo de log.
    console.error('[4b] credencial da subconta ilegivel', p.contabilidadeId);
    return { ok: false, error: 'A credencial da conta de recebimento está ilegível. Fale com o suporte da Balu.' };
  }
  if (!token) {
    return { ok: false, error: 'A credencial da conta de recebimento não está guardada. Fale com o suporte da Balu.' };
  }

  // ─── A COBRANCA NASCE NA SUBCONTA ─────────────────────────────────────────
  // `asaasSub(token)`, JAMAIS `asaas`. Com o cliente da conta-mae a cobranca
  // nasceria pertencendo a Balu, e a Balu estaria intermediando dinheiro de
  // terceiro. O token e usado e descartado aqui dentro: nunca vai para variavel
  // de modulo, log, auditoria ou retorno.
  const sub = asaasSub(token);
  let cobranca;
  try {
    const customerId = await clienteNaSubconta(sub, p.cliente.nome, doc, p.cliente.email);
    cobranca = await sub.criarCobranca({
      customer: customerId,
      billingType: 'UNDEFINED',        // o cliente escolhe boleto/Pix/cartao na fatura
      value: p.valorCentavos / 100,
      dueDate: p.vencimento,
      description: p.descricao.trim(),
      externalReference: `${p.contabilidadeId}:${p.cliente.id}`,
    });
  } catch (e) {
    // A chave pode aparecer numa mensagem de erro de rede; nunca repassar.
    console.error('[4b] emitir cobranca falhou:', mensagemCurta(e));
    return { ok: false, error: ERRO_ASAAS };
  }
  if (!cobranca?.id) {
    console.error('[4b] Asaas respondeu sem id de cobranca', p.contabilidadeId);
    return { ok: false, error: ERRO_ASAAS };
  }

  // ─── PERSISTENCIA ─────────────────────────────────────────────────────────
  // A cobranca JA EXISTE no Asaas neste ponto. Falhar aqui nao a desfaz — por
  // isso o erro diz para conferir antes de repetir, e nao "tente de novo".
  // `asaas_charge_id` e UNIQUE (0053): 23505 significa que esta cobranca ja
  // esta gravada, e nao ha nada a corrigir.
  const { data: linha, error } = await sb.from('cobrancas_escritorio').insert({
    contabilidade_id: p.contabilidadeId,
    empresa_cliente_id: p.cliente.id,
    honorario_id: p.honorarioId,
    servico_avulso_id: p.servicoAvulsoId,
    asaas_charge_id: cobranca.id,
    descricao: p.descricao.trim(),
    status: 'pendente',
    valor_centavos: p.valorCentavos,
    vencimento: p.vencimento,
    link_fatura: cobranca.invoiceUrl ?? null,
  }).select('id').maybeSingle();

  if (error || !linha) {
    console.error('[4b] COBRANCA EMITIDA E NAO GRAVADA', cobranca.id, error?.message ?? 'sem linha');
    // Sem este registro, existe no Asaas uma cobranca que o app nao conhece: o
    // webhook a descartaria como 'cobranca_desconhecida' e o cliente receberia
    // um boleto que o painel do escritorio nunca mostra.
    await registrarAuditoria({
      actorUserId: p.userId, acao: 'cobranca_escritorio.nao_gravada',
      alvoTipo: 'company', alvoId: p.cliente.id, contabilidadeId: p.contabilidadeId,
      meta: {
        charge_id: cobranca.id, valor_centavos: p.valorCentavos,
        honorario_id: p.honorarioId, servico_avulso_id: p.servicoAvulsoId,
        erro: error?.message ?? 'insert sem linha',
      },
    });
    return {
      ok: false,
      error: 'A cobrança foi emitida no Asaas mas não pôde ser registrada aqui. Confira no Asaas antes de emitir de novo e avise o suporte da Balu.',
    };
  }

  await registrarAuditoria({
    actorUserId: p.userId, acao: 'cobranca_escritorio.emitida',
    alvoTipo: 'company', alvoId: p.cliente.id, contabilidadeId: p.contabilidadeId,
    // Sem a chave, sem o token, sem o corpo do Asaas.
    meta: {
      cobranca_id: linha.id, charge_id: cobranca.id,
      valor_centavos: p.valorCentavos, vencimento: p.vencimento,
      descricao: p.descricao.trim(),
      honorario_id: p.honorarioId, servico_avulso_id: p.servicoAvulsoId,
    },
  });

  return {
    ok: true, cobrancaId: linha.id, chargeId: cobranca.id,
    linkFatura: cobranca.invoiceUrl ?? null,
  };
}

/**
 * O cliente, se ele estiver na carteira DESTE escritório.
 *
 * `null` tanto para "não existe" quanto para "existe mas é de outro escritório"
 * — mesma forma de `companyDaCarteira` (lib/contador/carteira.ts), que não serve
 * aqui porque a emissão precisa também de nome, documento e e-mail. O caller
 * responde a mesma frase nos dois casos, sem revelar a diferença.
 */
export async function clienteDaCarteira(
  sb: SupabaseClient, contabilidadeId: string, companyId: string,
): Promise<ClienteCobravel | null> {
  const { data } = await sb
    .from('companies')
    .select('id, nome, razao_social, cnpj, email, contabilidade_id, deleted_at')
    .eq('id', companyId).maybeSingle();
  const c = data as {
    id: string; nome: string | null; razao_social: string | null; cnpj: string | null;
    email: string | null; contabilidade_id: string | null; deleted_at: string | null;
  } | null;
  if (!c || c.contabilidade_id !== contabilidadeId || c.deleted_at) return null;
  return {
    id: c.id,
    // `nome` e o apelido que a carteira usa; `razao_social` e o nome de
    // documento. Cair para o segundo evita mandar string vazia ao Asaas.
    nome: (c.nome?.trim() || c.razao_social?.trim()) ?? '',
    cpfCnpj: c.cnpj ?? '',
    email: c.email,
  };
}
