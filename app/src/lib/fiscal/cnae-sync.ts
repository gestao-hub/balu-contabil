import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { consultarCnpjBrasilApi } from '@/lib/clients/brasilapi';
import { resolverAnexo, type AnexoResolvido, type CnaeAnexoRef } from '@/lib/fiscal/anexo-resolver';
import type { AnexoSimples } from '@/lib/fiscal/regime';

/**
 * Popula company_cnaes (principal + secundários) via BrasilAPI. Best-effort:
 * nunca lança. Se a BrasilAPI falhar e houver um cnaePrincipalFallback (ex.: o
 * cnae_principal já conhecido da Focus), grava só o principal (fonte 'focus').
 * Idempotente: upsert por (company_id, codigo).
 */
export async function sincronizarCnaesEmpresa(
  supabase: SupabaseClient,
  params: { companyId: string; ownerUserId: string; cnpj: string; cnaePrincipalFallback?: string | null },
): Promise<void> {
  const { companyId, ownerUserId, cnpj, cnaePrincipalFallback } = params;
  try {
    const data = await consultarCnpjBrasilApi(cnpj);
    const rows: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();

    if (data?.cnaePrincipal) {
      rows.push({ company_id: companyId, owner_user_id: ownerUserId, codigo: data.cnaePrincipal.codigo,
        descricao: data.cnaePrincipal.descricao, tipo: 'principal', fonte: 'brasilapi', updated_at: now, deleted_at: null });
      for (const s of data.cnaesSecundarios) {
        rows.push({ company_id: companyId, owner_user_id: ownerUserId, codigo: s.codigo,
          descricao: s.descricao, tipo: 'secundario', fonte: 'brasilapi', updated_at: now, deleted_at: null });
      }
    } else if (cnaePrincipalFallback) {
      const cod = String(cnaePrincipalFallback).replace(/\D+/g, '');
      if (cod) rows.push({ company_id: companyId, owner_user_id: ownerUserId, codigo: cod,
        descricao: null, tipo: 'principal', fonte: 'focus', updated_at: now, deleted_at: null });
    }

    if (rows.length === 0) return;
    // Full-replace: o índice único de company_cnaes é PARCIAL (WHERE deleted_at IS NULL),
    // e o Postgres não aceita ON CONFLICT contra índice parcial (42P10). Então apagamos os
    // CNAEs atuais da empresa e reinserimos a lista — também reflete remoções na Receita.
    await supabase.from('company_cnaes').delete().eq('company_id', companyId);
    const { error } = await supabase.from('company_cnaes').insert(rows);
    if (error) console.warn('[sincronizarCnaesEmpresa]', error.message);

    // Auto-stub: registra no catálogo cnae_anexo os CNAEs ainda não mapeados,
    // como "a curar" — vira a fila de curadoria a partir do uso real.
    await registrarStubsCnaeAnexo(rows.map((r) => ({ codigo: r.codigo as string, descricao: (r.descricao as string | null) ?? null })));
  } catch (e) {
    console.warn('[sincronizarCnaesEmpresa] falhou:', e instanceof Error ? e.message : String(e));
  }
}

export type CnaeAnexoStub = {
  codigo: string;
  descricao: string | null;
  anexo_base: null;
  fator_r: false;
  anexo_iv: false;
  observacao: string;
};

/**
 * Monta linhas-stub p/ `cnae_anexo`: os CNAEs `cnaes` que ainda NÃO estão em `existentes`,
 * deduplicados e normalizados (só dígitos), pra entrar como "a curar" (sem classificação).
 * Pura — testável sem rede.
 */
export function montarStubsCnaeAnexo(
  cnaes: Array<{ codigo: string; descricao?: string | null }>,
  existentes: Set<string>,
): CnaeAnexoStub[] {
  const vistos = new Set<string>();
  const out: CnaeAnexoStub[] = [];
  for (const c of cnaes) {
    const codigo = String(c.codigo ?? '').replace(/\D+/g, '');
    if (!codigo || existentes.has(codigo) || vistos.has(codigo)) continue;
    vistos.add(codigo);
    out.push({ codigo, descricao: c.descricao ?? null, anexo_base: null, fator_r: false, anexo_iv: false, observacao: 'auto-stub — curar' });
  }
  return out;
}

/**
 * Insere stubs em `cnae_anexo` p/ os CNAEs ainda não catalogados. Best-effort; nunca lança.
 * Usa admin client (cnae_anexo não tem policy de escrita p/ `authenticated`). `ignoreDuplicates`
 * garante que NUNCA sobrescreve uma classificação já curada.
 */
async function registrarStubsCnaeAnexo(cnaes: Array<{ codigo: string; descricao: string | null }>): Promise<void> {
  try {
    const codigos = [...new Set(cnaes.map((c) => String(c.codigo).replace(/\D+/g, '')).filter(Boolean))];
    if (codigos.length === 0) return;
    const admin = createAdminClient();
    const { data: existRows } = await admin.from('cnae_anexo').select('codigo').in('codigo', codigos);
    const existentes = new Set((existRows ?? []).map((r) => r.codigo as string));
    const stubs = montarStubsCnaeAnexo(cnaes, existentes);
    if (stubs.length === 0) return;
    const { error } = await admin.from('cnae_anexo').upsert(stubs, { onConflict: 'codigo', ignoreDuplicates: true });
    if (error) console.warn('[registrarStubsCnaeAnexo]', error.message);
  } catch (e) {
    console.warn('[registrarStubsCnaeAnexo] falhou:', e instanceof Error ? e.message : String(e));
  }
}

/** Resolve o anexo da empresa (CNAE principal → cnae_anexo → fallback manual). Degrada p/ manual se tabelas ausentes. */
export async function resolverAnexoEmpresa(
  supabase: SupabaseClient,
  companyId: string,
  anexoManual: AnexoSimples | null,
): Promise<AnexoResolvido> {
  try {
    const { data: cnae } = await supabase
      .from('company_cnaes')
      .select('codigo')
      .eq('company_id', companyId).eq('tipo', 'principal').is('deleted_at', null)
      .maybeSingle();
    const cnaePrincipal = (cnae?.codigo as string | null) ?? null;
    let ref: CnaeAnexoRef = null;
    if (cnaePrincipal) {
      const { data: a } = await supabase
        .from('cnae_anexo')
        .select('codigo, anexo_base, fator_r')
        .eq('codigo', cnaePrincipal).maybeSingle();
      ref = a ? { codigo: a.codigo as string, anexo_base: (a.anexo_base as AnexoSimples | null) ?? null, fator_r: a.fator_r === true } : null;
    }
    return resolverAnexo({ cnaePrincipal, cnaeAnexo: ref, anexoManual });
  } catch (e) {
    console.warn('[resolverAnexoEmpresa]', e instanceof Error ? e.message : String(e));
    return { anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' };
  }
}
