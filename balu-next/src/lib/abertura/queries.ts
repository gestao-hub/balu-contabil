// src/lib/abertura/queries.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getAberturaByCompany(supabase: SupabaseClient, companyId: string) {
  const { data } = await supabase.from('abertura_empresas').select('*').eq('company_id', companyId).maybeSingle();
  return data ?? null;
}
