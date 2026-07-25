'use server';
// Escrita do contador sobre a carteira. A RLS do contador em declaracoes_fiscais
// é SELECT-only (0033:26): a escrita é service role com a permissão provada aqui,
// mesmo padrão de contador/aberturas/actions.ts — inclusive o 403 genérico, que
// não revela se a empresa existe.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { companyDaCarteira } from '@/lib/contador/carteira';
import { registrarDeclaracaoAnual } from '@/lib/fiscal/declaracoes-anuais/registrar';
import { calcularDivergencia } from '@/lib/fiscal/declaracoes-anuais/divergencia';
import { lerNotasAnoCalendario } from '@/lib/fiscal/receitas-source';
import { resumirReceitasAno } from '@/lib/fiscal/dasn/resumo';
import { DasnCamposSchema } from '@/lib/fiscal/dasn/campos';
import { DefisCamposSchema } from '@/lib/fiscal/defis/campos';
import type { DeclaracaoAnualTipo } from '@/lib/fiscal/declaracoes-anuais/tipos';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// Anotação explícita do retorno: sem ela o TS infere cada ramo com as chaves do
// outro como `?: undefined` e `'error' in e` deixa de estreitar o tipo.
async function requireEscritorio(): Promise<{ error: string } | { userId: string; contabilidadeId: string }> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { error: g.error };
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada') return { error: 'Escritório não aprovado.' };
  return { userId: g.userId, contabilidadeId: g.contabilidade.id };
}

export async function registrarDeclaracaoAnualContadorAction(input: {
  companyId: string;
  tipo: DeclaracaoAnualTipo;
  ano: number;
  dados: Record<string, unknown>;
  numeroDeclaracao?: string | null;
  dataTransmissao?: string | null;
  comprovante?: { nome: string; mime: string; base64: string } | null;
}): Promise<ActionResult<{ id: string }>> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };

  const admin = createAdminClient();
  const alvo = await companyDaCarteira(admin, e.contabilidadeId, input.companyId);
  if (!alvo) return { ok: false, error: 'Empresa fora da sua carteira.' };

  const parsed = input.tipo === 'DASN-SIMEI'
    ? DasnCamposSchema.safeParse(input.dados)
    : DefisCamposSchema.safeParse(input.dados);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const notas = await lerNotasAnoCalendario(admin, alvo.companyId, input.ano);
  const resumo = resumirReceitasAno(notas, input.ano);
  const d = parsed.data as { receitaComercio?: number; receitaServico?: number; receitaBrutaTotal?: number };
  const declarado = input.tipo === 'DASN-SIMEI'
    ? (d.receitaComercio ?? 0) + (d.receitaServico ?? 0)
    : (d.receitaBrutaTotal ?? 0);
  const divergencia = calcularDivergencia(declarado, resumo.total);

  const r = await registrarDeclaracaoAnual(admin, {
    companyId: alvo.companyId,
    ownerUserId: alvo.ownerUserId,
    tipo: input.tipo,
    ano: input.ano,
    dados: parsed.data as Record<string, unknown>,
    numeroDeclaracao: input.numeroDeclaracao ?? null,
    dataTransmissao: input.dataTransmissao ?? null,
    divergenciaReceita: divergencia.diferenca,
    origem: 'manual',
    registradoPor: e.userId,
    comprovante: input.comprovante
      ? { nome: input.comprovante.nome, mime: input.comprovante.mime, bytes: Buffer.from(input.comprovante.base64, 'base64') }
      : null,
  }, e.contabilidadeId);

  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/contador/clientes/${alvo.companyId}`);
  return { ok: true, data: { id: r.id } };
}
