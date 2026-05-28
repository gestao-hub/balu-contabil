#!/usr/bin/env tsx
/**
 * Smoke test do Focus 2.0: dispara syncEmpresaNaFocus contra uma empresa
 * existente (default AL Piscinas) e mostra o snapshot persistido em
 * empresas_fiscais.focus_*.
 *
 * Uso: node --env-file=.env.local --import tsx scripts/focus2-snapshot-smoke.ts [cnpj]
 */
import { createClient } from '@supabase/supabase-js';
import { syncEmpresaNaFocus } from '../src/lib/fiscal/focus-empresa-sync';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  const targetArg = process.argv[2];
  console.log('[1/3] Localizando empresa…');
  let query = supabase.from('companies').select('id, nome, cnpj, focus_token, focus_status').is('deleted_at', null);
  query = targetArg
    ? query.eq('cnpj', targetArg.replace(/\D+/g, ''))
    : query.ilike('nome', '%AL Piscinas%');
  const { data: rows, error } = await query.limit(1);
  if (error) throw new Error(`select: ${error.message}`);
  const company = rows?.[0];
  if (!company) { console.error('Empresa não encontrada.'); process.exit(1); }
  console.log(`     ✓ ${company.nome} · CNPJ ${company.cnpj} · id=${company.id}`);
  console.log(`     antes: focus_status=${company.focus_status} focus_token=${company.focus_token ? company.focus_token.slice(0,8)+'…' : 'NULL'}`);

  console.log('[2/3] Disparando syncEmpresaNaFocus (POST + GET snapshot)…');
  const result = await syncEmpresaNaFocus(supabase, company.id);
  console.log('     resultado:', JSON.stringify(result, null, 2));

  console.log('[3/3] Releitura empresas_fiscais.focus_* + companies.focus_*…');
  const { data: c2 } = await supabase
    .from('companies')
    .select('focus_token, focus_status, focus_last_check, focus_last_error')
    .eq('id', company.id)
    .single();
  const { data: ef } = await supabase
    .from('empresas_fiscais')
    .select('focus_empresa_id, focus_codigo_municipio, focus_habilita_nfse, focus_habilita_nfsen_producao, focus_habilita_nfsen_homologacao, focus_sync_em')
    .eq('empresa_id', company.id)
    .maybeSingle();

  console.log('\nESTADO FINAL companies:', JSON.stringify(c2, null, 2));
  console.log('ESTADO FINAL empresas_fiscais (snapshot):', JSON.stringify(ef, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
