'use server';
// Bloco 4A — o AdminBalu gerencia os planos. Mudar preco e ato
// administrativo com consequencia financeira: tudo vai pro audit_log.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { validarFaixas } from '@/lib/billing/validar-planos';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export type PlanoInput = {
  id: string;
  nome: string;
  publico: 'empresa' | 'escritorio';
  valor_centavos: number;
  ciclo: 'MONTHLY' | 'YEARLY';
  clientes_min: number | null;
  clientes_max: number | null;
  trial_dias: number;
  ativo: boolean;
};

/** Status que significam "assinatura viva" — os que impedem desativar um
 *  plano e os que contam como "em uso" na tela. */
const VIVOS = ['trial', 'ativa', 'inadimplente'];

export async function salvarPlanoAction(input: PlanoInput): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  if (!input.id || !input.nome) return { ok: false, error: 'Id e nome são obrigatórios.' };
  if (!Number.isInteger(input.valor_centavos) || input.valor_centavos < 0) {
    return { ok: false, error: 'Valor inválido.' };
  }
  if (!Number.isInteger(input.trial_dias) || input.trial_dias < 0) {
    return { ok: false, error: 'Dias de teste inválido.' };
  }

  const admin = createAdminClient();

  // Faixas so fazem sentido para escritorio; validar ANTES de salvar evita
  // que o admin crie o buraco que o cron de recalculo so descobriria no mes
  // seguinte, e em silencio.
  if (input.publico === 'escritorio') {
    const { data: outros } = await admin
      .from('planos').select('id, clientes_min, clientes_max')
      .eq('publico', 'escritorio').eq('ativo', true).neq('id', input.id);
    const conjunto = [
      ...(outros ?? []),
      ...(input.ativo
        ? [{ id: input.id, clientes_min: input.clientes_min, clientes_max: input.clientes_max }]
        : []),
    ];
    const v = validarFaixas(conjunto);
    if (!v.ok) return { ok: false, error: v.erro };
  }

  const { error } = await admin.from('planos').upsert({
    id: input.id,
    nome: input.nome,
    publico: input.publico,
    valor_centavos: input.valor_centavos,
    ciclo: input.ciclo,
    // Empresa nao tem faixa: gravar numero aqui viraria lixo que a
    // validacao de faixas leria depois.
    clientes_min: input.publico === 'escritorio' ? input.clientes_min : null,
    clientes_max: input.publico === 'escritorio' ? input.clientes_max : null,
    trial_dias: input.trial_dias,
    ativo: input.ativo,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'plano.salvar',
    alvoTipo: 'plano', alvoId: input.id,
    meta: { valor_centavos: input.valor_centavos, trial_dias: input.trial_dias, ativo: input.ativo },
  });

  revalidatePath('/admin/assinaturas');
  return { ok: true };
}

export async function desativarPlanoAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!id) return { ok: false, error: 'ID ausente.' };

  const admin = createAdminClient();

  // Desativar plano com assinatura viva deixaria orfaos que ninguem
  // conseguiria cobrar nem exibir. Recusar dizendo QUANTAS sao.
  const { count } = await admin
    .from('assinaturas').select('id', { count: 'exact', head: true })
    .eq('plano_id', id).in('status', VIVOS);
  if ((count ?? 0) > 0) {
    return { ok: false, error: `Não dá para desativar: ${count} assinatura(s) usam este plano.` };
  }

  // A contagem acima NAO basta: assinatura de escritorio nasce com
  // plano_id NULL e so ganha plano na primeira passada do cron, entao numa
  // base recem-instalada ela le 0 e deixaria desativar a faixa do meio,
  // abrindo um buraco. Validar o conjunto RESULTANTE fecha isso.
  const { data: alvo } = await admin
    .from('planos').select('publico').eq('id', id).maybeSingle();
  if (alvo?.publico === 'escritorio') {
    const { data: restantes } = await admin
      .from('planos').select('id, clientes_min, clientes_max')
      .eq('publico', 'escritorio').eq('ativo', true).neq('id', id);
    const v = validarFaixas(restantes ?? []);
    if (!v.ok) {
      return { ok: false, error: `Desativar deixaria as faixas inconsistentes. ${v.erro}` };
    }
  }

  const { error } = await admin.from('planos')
    .update({ ativo: false, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'plano.desativar', alvoTipo: 'plano', alvoId: id,
  });

  revalidatePath('/admin/assinaturas');
  return { ok: true };
}
