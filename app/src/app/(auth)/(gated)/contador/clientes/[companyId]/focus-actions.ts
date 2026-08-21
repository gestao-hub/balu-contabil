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
