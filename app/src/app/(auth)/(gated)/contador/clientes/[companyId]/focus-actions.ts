'use server';
// Bloco 5 — a credencial da Focus do CLIENTE, cadastrada pelo contador.
//
// EXCEÇÃO DELIBERADA ao "painel do contador é somente visualização". Ela NÃO
// derruba a garantia: a RLS do contador em `companies` segue SELECT-only; a
// escrita é service role com a permissão PROVADA aqui — mesmo padrão de
// `cert-actions.ts`, no mesmo diretório.
//
// CUSTÓDIA: com este token se emite nota fiscal em nome do CNPJ do cliente.
// Quem cadastra declara que o titular autorizou, e o rastro fica em três
// lugares: `audit_log`, as colunas `focus_token_por`/`focus_token_em`, e a tela
// do próprio empresário.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { companyDaCarteira } from '@/lib/contador/carteira';
import { registrarAuditoria } from '@/lib/security/audit';
import { guardarTokenEmpresa } from '@/lib/fiscal/credencial-empresa';
import {
  lerEstadoFiscal,
  decidirCredencial,
  MENSAGEM_RECUSA,
  type OrigemFocus,
  type AmbienteFiscal,
} from '@/lib/fiscal/resolver-credencial';

export type SalvarCredencialInput = {
  companyId: string;
  token_hom?: string;
  token_prod?: string;
  autorizacao: boolean;
  producao_declarada?: boolean;
};

type Resultado = { ok: true } | { ok: false; error: string };

export async function salvarCredencialFocusClienteAction(
  input: SalvarCredencialInput,
): Promise<Resultado> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const companyId = String(input.companyId ?? '');
  if (!companyId) return { ok: false, error: 'Cliente não informado.' };
  if (!input.autorizacao) {
    return { ok: false, error: 'Confirme que o titular autorizou o uso da credencial fiscal dele.' };
  }

  const hom = (input.token_hom ?? '').trim();
  const prod = (input.token_prod ?? '').trim();
  if (!hom && !prod) return { ok: false, error: 'Cole ao menos um dos dois tokens.' };

  const admin = createAdminClient();

  // ANTI-IDOR: o admin client ignora RLS — sem esta checagem um companyId
  // qualquer instalaria credencial numa empresa de outro escritório.
  const alvo = await companyDaCarteira(admin, ctx.id, companyId);
  if (!alvo) return { ok: false, error: 'Empresa fora da sua carteira.' };

  // A partir daqui, TODA operação usa `alvo.companyId` — o valor PROVADO pela
  // carteira — e nunca mais o `companyId` que veio do input. É o mesmo cuidado
  // de `cert-actions.ts`: repassar o campo do formulário adiante reabriria o
  // buraco que a checagem acima acabou de fechar.

  // O SEGREDO vai para `empresa_credenciais_focus`, fechada para as roles do
  // cliente (0097). O RASTRO fica em `companies`, onde o titular consegue ler —
  // é o que faz a declaração de custódia valer alguma coisa.
  const credencial: Record<string, unknown> = {
    empresa_id: alvo.companyId,
    atualizado_por: ctx.userId,
    atualizado_em: new Date().toISOString(),
  };
  try {
    // CAMPO VAZIO = NÃO TROCAR — é o caminho comum (trocar só um dos dois).
    if (hom) credencial.token_hom_cifrado = guardarTokenEmpresa(hom);
    if (prod) credencial.token_prod_cifrado = guardarTokenEmpresa(prod);
  } catch {
    return { ok: false, error: 'Não foi possível proteger a credencial. Nada foi salvo.' };
  }

  // UPSERT com `onConflict` explícito, e NÃO `.update()`: a linha pode não
  // existir (primeira credencial da empresa). Aqui o upsert é seguro porque o
  // payload NUNCA carrega a coluna que não se quer trocar — ela simplesmente
  // não entra no objeto acima.
  const { data, error } = await admin
    .from('empresa_credenciais_focus')
    .upsert(credencial, { onConflict: 'empresa_id' })
    .select('empresa_id');
  if (error) {
    console.error('[bloco5] credencial do cliente nao gravada:', error.message);
    return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
  }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, error: 'Empresa não encontrada. Recarregue a página.' };
  }

  await admin.from('companies')
    .update({ focus_token_por: ctx.userId, focus_token_em: new Date().toISOString() })
    .eq('id', alvo.companyId);

  if (typeof input.producao_declarada === 'boolean') {
    await admin.from('empresas_fiscais')
      .update({ focus_producao_declarada: input.producao_declarada })
      .eq('empresa_id', alvo.companyId);
  }

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'focus.credencial_cliente_salvar',
    alvoTipo: 'company',
    alvoId: alvo.companyId,
    contabilidadeId: ctx.id,
    // NUNCA o token, nem mascarado.
    meta: { trocou_hom: Boolean(hom), trocou_prod: Boolean(prod) },
  });

  revalidatePath(`/contador/clientes/${alvo.companyId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessão 32 — o interruptor que faltava.
//
// A 0096 criou `focus_origem` e `focus_ambiente`, a 0098 trancou as duas contra
// escrita do inquilino, e aí o Bloco 5 parou: NENHUM caminho do produto
// escrevia nem uma nem outra. Produção fiscal só era alcançável por `UPDATE`
// manual no banco, e este card ficava inerte para as cinco empresas existentes
// — todas `'balu'`, e o card antigo devolvia cedo para qualquer origem que não
// fosse `'propria'`.
//
// A escrita é service role porque a 0098 SÓ deixa passar o backend: com o
// client de sessão o trigger derruba o UPDATE inteiro (`DECISAO_FISCAL_RESTRITA`).
// ─────────────────────────────────────────────────────────────────────────────

export type ModoFiscalInput = {
  companyId: string;
  origem: OrigemFocus;
  ambiente: AmbienteFiscal;
  /** Exigido só ao trocar `balu → propria` numa empresa que JÁ tem cadastro na
   *  conta Focus da plataforma — ver a checagem lá embaixo. */
  ciente_do_cadastro?: boolean;
};

export async function definirModoFiscalAction(input: ModoFiscalInput): Promise<Resultado> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const companyId = String(input.companyId ?? '');
  if (!companyId) return { ok: false, error: 'Cliente não informado.' };

  // Valores fechados, conferidos aqui e não só no `<select>`: input de action é
  // input de rede. As duas colunas têm CHECK no banco (0096), então um valor
  // fora da lista viraria erro de constraint — mensagem de banco na cara do
  // contador em vez de recusa explicada.
  const origem: OrigemFocus = input.origem === 'propria' ? 'propria' : 'balu';
  const ambiente: AmbienteFiscal = input.ambiente === 'prod' ? 'prod' : 'hom';

  const admin = createAdminClient();

  // ANTI-IDOR, idêntico ao de `salvarCredencialFocusClienteAction`: o admin
  // client ignora RLS, então a carteira é a única barreira.
  const alvo = await companyDaCarteira(admin, ctx.id, companyId);
  if (!alvo) return { ok: false, error: 'Empresa fora da sua carteira.' };

  const { data: fiscal, error: fiscalErr } = await admin
    .from('empresas_fiscais')
    .select('focus_origem, focus_ambiente, focus_empresa_id')
    .eq('empresa_id', alvo.companyId)
    .is('deleted_at', null)
    .maybeSingle();
  // FALHA FECHADA: erro de leitura não pode virar "empresa sem configuração" e
  // seguir gravando — é a mesma confusão que a revisão final do Bloco 5 achou
  // em `resolverCredencialEmissao` (`estado_fiscal_ilegivel`).
  if (fiscalErr) {
    console.error('[bloco5] modo fiscal: leitura falhou para', alvo.companyId, fiscalErr.message);
    return { ok: false, error: 'Não foi possível ler a configuração fiscal desta empresa. Tente de novo.' };
  }
  if (!fiscal) {
    return { ok: false, error: 'Esta empresa ainda não tem configuração fiscal. Abra a aba Fiscal do cliente primeiro.' };
  }

  const origemAtual = (fiscal.focus_origem as OrigemFocus | null) ?? 'balu';
  const focusEmpresaId = fiscal.focus_empresa_id as number | null;

  // Sair de 'balu' com cadastro feito na conta da plataforma ABANDONA aquele
  // registro: `syncEmpresaNaFocus` e `atualizarEmpresaNaFocus` passam a recusar
  // a empresa, então o cadastro na Focus da Balu para de receber qualquer
  // atualização e vira registro fantasma. Não é reversível por aqui — voltar
  // para 'balu' recupera o vínculo no Balu, mas o que ficou desatualizado no
  // meio do caminho ninguém repõe. Por isso é confirmação explícita, não aviso.
  if (origemAtual === 'balu' && origem === 'propria' && focusEmpresaId != null) {
    if (!input.ciente_do_cadastro) {
      return {
        ok: false,
        error: 'Esta empresa já está cadastrada na conta Focus da Balu. Confirme que está ciente de que o Balu deixa de manter esse cadastro antes de trocar a origem.',
      };
    }
  }

  // A PRÉ-VALIDAÇÃO, e a razão de a guarda ter sido aberta em `lerEstadoFiscal`.
  // Sem ela, ligar produção gravava sem conferir nada e o "não" aparecia lá na
  // frente, na primeira emissão — na frente do cliente, não na tela de quem
  // configurou. Aqui o estado é o REAL do banco, só com origem e ambiente
  // trocados pelos valores pedidos: nada de simular declaração ou certificado
  // que ainda não existem.
  if (ambiente === 'prod') {
    const leitura = await lerEstadoFiscal(alvo.companyId, admin);
    if (!leitura.ok) return { ok: false, error: MENSAGEM_RECUSA[leitura.motivo] };
    const veredito = decidirCredencial({ ...leitura.estado, origem, ambiente });
    if (!veredito.ok) return { ok: false, error: MENSAGEM_RECUSA[veredito.motivo] };
  }

  // `.select()` no update: sem ele, zero linhas afetadas voltaria como sucesso
  // — o mesmo defeito silencioso que o snapshot da Focus carregava até a 0099.
  const { data: gravado, error } = await admin
    .from('empresas_fiscais')
    .update({ focus_origem: origem, focus_ambiente: ambiente, updated_at: new Date().toISOString() })
    .eq('empresa_id', alvo.companyId)
    .is('deleted_at', null)
    .select('empresa_id');
  if (error) {
    console.error('[bloco5] modo fiscal nao gravado:', error.message);
    return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
  }
  if ((gravado?.length ?? 0) === 0) {
    return { ok: false, error: 'Configuração fiscal não encontrada. Recarregue a página.' };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'focus.modo_fiscal_definir',
    alvoTipo: 'company',
    alvoId: alvo.companyId,
    contabilidadeId: ctx.id,
    meta: {
      de: { origem: origemAtual, ambiente: (fiscal.focus_ambiente as string | null) ?? 'hom' },
      para: { origem, ambiente },
    },
  });

  revalidatePath(`/contador/clientes/${alvo.companyId}`);
  return { ok: true };
}
