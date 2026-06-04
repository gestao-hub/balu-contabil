import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { consultarCnpjBrasilApi } from '@/lib/clients/brasilapi';

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
    const { error } = await supabase
      .from('company_cnaes')
      .upsert(rows, { onConflict: 'company_id,codigo' });
    if (error) console.warn('[sincronizarCnaesEmpresa]', error.message);
  } catch (e) {
    console.warn('[sincronizarCnaesEmpresa] falhou:', e instanceof Error ? e.message : String(e));
  }
}
