// src/app/(auth)/(gated)/contador/dominio-actions.ts
// Bloco 7, Task 3 — cadastro, verificacao e remocao do dominio proprio do
// escritorio, mais o SLA de atendimento (a mesma tela configura os dois).
'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { normalizarHost } from '@/lib/dominios/host';
import { provedorDeEnv, provisionarDominio } from '@/lib/dominios/provedor';
import { verificarHost } from '@/lib/dominios/verificacao';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Salva o dominio e (re)gera o token de verificacao.
 *
 * Trocar de dominio derruba o status para `pendente`: um dominio novo nao
 * herda a verificacao do antigo, senao bastaria verificar um host qualquer
 * uma vez e depois apontar o campo pra onde quisesse.
 */
export async function salvarDominioAction(bruto: string): Promise<ActionResult<{ host: string; token: string }>> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };
  if (g.contabilidade.status !== 'aprovada') {
    return { ok: false, error: 'O escritório precisa estar aprovado para usar domínio próprio.' };
  }

  const host = normalizarHost(bruto);
  if (!host) {
    return { ok: false, error: 'Domínio inválido. Use um endereço como app.seuescritorio.com.br (sem http:// e sem barra).' };
  }

  const token = randomUUID();
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('contabilidades')
    .update({
      dominio_customizado: host,
      dominio_token: token,
      dominio_status: 'pendente',
      dominio_verificado_em: null,
      dominio_erro: null,
    })
    .eq('id', g.contabilidade.id);

  if (error) {
    // O indice unico parcial (0069) e a fronteira de verdade contra dois
    // escritorios reivindicarem o mesmo host — a mensagem so traduz.
    if (error.code === '23505') return { ok: false, error: 'Esse domínio já está em uso por outro escritório.' };
    return { ok: false, error: error.message };
  }

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'escritorio.dominio.salvar',
    contabilidadeId: g.contabilidade.id, alvoTipo: 'dominio', alvoId: host,
  });

  revalidatePath('/contador/configuracoes');
  return { ok: true, data: { host, token } };
}

/**
 * Verifica o apontamento. Com credencial da Vercel, registra o dominio no
 * projeto antes; sem ela (modo manual), vai direto pra prova por HTTP — que
 * e quem decide, nos dois casos.
 */
export async function verificarDominioAction(): Promise<ActionResult<{ status: 'ativo' | 'erro'; motivo?: string }>> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const supabase = await createServerClient();
  const { data: row, error: eLer } = await supabase
    .from('contabilidades')
    .select('dominio_customizado,dominio_token')
    .eq('id', g.contabilidade.id)
    .single();
  if (eLer) return { ok: false, error: eLer.message };

  const host = (row?.dominio_customizado ?? null) as string | null;
  const token = (row?.dominio_token ?? '') as string;
  if (!host) return { ok: false, error: 'Cadastre um domínio antes de verificar.' };

  const prov = await provisionarDominio(provedorDeEnv(), host);
  if (!prov.ok) {
    await marcarErro(g.contabilidade.id, prov.erro);
    return { ok: true, data: { status: 'erro', motivo: prov.erro } };
  }

  const r = await verificarHost(host, token);
  if (!r.ok) {
    await marcarErro(g.contabilidade.id, r.motivo);
    revalidatePath('/contador/configuracoes');
    return { ok: true, data: { status: 'erro', motivo: r.motivo } };
  }

  const { error } = await supabase
    .from('contabilidades')
    .update({ dominio_status: 'ativo', dominio_verificado_em: new Date().toISOString(), dominio_erro: null })
    .eq('id', g.contabilidade.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'escritorio.dominio.verificado',
    contabilidadeId: g.contabilidade.id, alvoTipo: 'dominio', alvoId: host,
  });

  revalidatePath('/contador/configuracoes');
  return { ok: true, data: { status: 'ativo' } };
}

async function marcarErro(contabilidadeId: string, motivo: string): Promise<void> {
  const supabase = await createServerClient();
  await supabase
    .from('contabilidades')
    .update({ dominio_status: 'erro', dominio_erro: motivo })
    .eq('id', contabilidadeId);
}

/** Remove o domínio: o escritório volta a ser atendido só pelo domínio da Balu. */
export async function removerDominioAction(): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('contabilidades')
    .update({
      dominio_customizado: null, dominio_token: null,
      dominio_status: 'pendente', dominio_verificado_em: null, dominio_erro: null,
    })
    .eq('id', g.contabilidade.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'escritorio.dominio.remover',
    contabilidadeId: g.contabilidade.id,
  });

  revalidatePath('/contador/configuracoes');
  return { ok: true };
}

/**
 * SLA de resposta, em horas CORRIDAS (decisao §2.4 da spec — hora util
 * exigiria calendario de feriados). `null` = o escritorio nao promete prazo:
 * nada e exibido ao cliente e nada e alertado.
 */
export async function salvarSlaAction(horas: number | null): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  if (horas !== null) {
    if (!Number.isInteger(horas) || horas < 1 || horas > 720) {
      return { ok: false, error: 'Informe um prazo entre 1 e 720 horas (30 dias), ou deixe em branco.' };
    }
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('contabilidades')
    .update({ sla_resposta_horas: horas })
    .eq('id', g.contabilidade.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'escritorio.sla',
    contabilidadeId: g.contabilidade.id,
  });

  revalidatePath('/contador/configuracoes');
  return { ok: true };
}
