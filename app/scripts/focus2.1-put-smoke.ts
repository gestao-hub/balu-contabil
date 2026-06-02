#!/usr/bin/env tsx
/**
 * Smoke test do Focus 2.1: dispara atualizarEmpresaNaFocus (PUT) contra uma
 * empresa já cadastrada na Focus (default AL Piscinas — assume que Focus 2.0
 * smoke já rodou). Mostra payload mandado, status do PUT e snapshot pós-PUT.
 *
 * Pré-condição: a empresa já precisa ter focus_token em `companies`.
 *
 * Uso: node --env-file=.env.local --import tsx scripts/focus2.1-put-smoke.ts [cnpj]
 */
import { createClient } from '@supabase/supabase-js';
import { atualizarEmpresaNaFocus } from '../src/lib/fiscal/focus-empresa-sync';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  const targetArg = process.argv[2];

  console.log('[1/4] Localizando empresa…');
  let q = supabase
    .from('companies')
    .select('id, nome, cnpj, focus_token, focus_status, focus_last_check, updated_at')
    .is('deleted_at', null);
  q = targetArg
    ? q.eq('cnpj', targetArg.replace(/\D+/g, ''))
    : q.ilike('nome', '%AL Piscinas%');
  const { data: rows, error } = await q.limit(1);
  if (error) throw new Error(`select: ${error.message}`);
  const company = rows?.[0];
  if (!company) { console.error('Empresa não encontrada.'); process.exit(1); }
  console.log(`     ✓ ${company.nome} · CNPJ ${company.cnpj} · id=${company.id}`);
  console.log(`     antes: focus_status=${company.focus_status}, focus_last_check=${company.focus_last_check}`);
  if (!company.focus_token) {
    console.error('     ✗ Empresa SEM focus_token — rode focus2-snapshot-smoke (POST) primeiro.');
    process.exit(1);
  }

  console.log('[2/4] Lendo empresas_fiscais (estado atual)…');
  const { data: ef } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, nfse_usuario_login, nfse_senha_login, empresa_fiscal_ativada, focus_empresa_id, focus_codigo_municipio, focus_habilita_nfse, focus_habilita_nfsen_homologacao, focus_habilita_nfsen_producao, focus_sync_em, updated_at')
    .eq('empresa_id', company.id)
    .is('deleted_at', null)
    .maybeSingle();
  console.log('     antes:', JSON.stringify(ef, null, 2));

  console.log('[3/4] Disparando atualizarEmpresaNaFocus (PUT + GET snapshot)…');
  const result = await atualizarEmpresaNaFocus(supabase, company.id, 'hom');
  console.log('     resultado:', JSON.stringify(result, null, 2));

  console.log('[4/4] Releitura empresas_fiscais.focus_* + companies.focus_*…');
  const { data: c2 } = await supabase
    .from('companies')
    .select('focus_status, focus_last_check, focus_last_error')
    .eq('id', company.id)
    .single();
  const { data: ef2 } = await supabase
    .from('empresas_fiscais')
    .select('focus_codigo_municipio, focus_habilita_nfse, focus_habilita_nfsen_homologacao, focus_habilita_nfsen_producao, focus_sync_em')
    .eq('empresa_id', company.id)
    .is('deleted_at', null)
    .maybeSingle();
  console.log('     companies:', JSON.stringify(c2, null, 2));
  console.log('     empresas_fiscais:', JSON.stringify(ef2, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
