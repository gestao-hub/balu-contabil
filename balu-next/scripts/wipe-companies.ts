#!/usr/bin/env tsx
/**
 * Apaga TODAS as empresas (e dados ligados) de um usuário, MAS preserva o
 * auth.users / profile. Útil pra testar criação de empresa sem refazer login.
 *
 * Uso: node --env-file=.env.local --import=tsx scripts/wipe-companies.ts <email> [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) { console.error('faltam envs'); process.exit(1); }

const email = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!email) { console.error('Uso: wipe-companies.ts <email> [--dry-run]'); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`[1/6] Localizando ${email}…`);
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) { console.error('não achei'); process.exit(0); }
  console.log(`     ✓ user_id=${u.id}`);

  console.log('[2/6] companies…');
  const { data: companies } = await sb.from('companies').select('id, nome, cnpj').eq('user_id', u.id);
  const ids = (companies ?? []).map((c) => c.id as string);
  for (const c of companies ?? []) console.log(`       - ${c.nome ?? '?'} · ${c.cnpj} · ${c.id}`);
  if (!ids.length) { console.log('     ✗ nenhuma empresa; nada a fazer'); process.exit(0); }

  console.log('[3/6] arquivos_auxiliares (Storage incluso)…');
  const { data: arqs } = await sb.from('arquivos_auxiliares').select('id, storage_key').in('unique_id_empresa', ids);
  console.log(`     ${(arqs ?? []).length} arquivo(s)`);

  console.log('[4/6] empresas_fiscais…');
  const { count: efCount } = await sb.from('empresas_fiscais').select('id', { count: 'exact', head: true }).in('empresa_id', ids);
  console.log(`     ${efCount ?? 0} fiscal(is)`);

  if (dryRun) { console.log('\n— DRY RUN — sem apagar'); return; }

  console.log('\n[5/6] APAGANDO…');
  await sb.from('notas_fiscais').delete().in('company_id', ids);
  for (const a of arqs ?? []) {
    const key = (a as { storage_key: string | null }).storage_key;
    if (!key) continue;
    const { error } = await sb.storage.from('certificados').remove([key]);
    if (error) console.warn(`     ⚠ storage ${key}: ${error.message}`);
  }
  await sb.from('arquivos_auxiliares').delete().in('unique_id_empresa', ids);
  await sb.from('empresas_fiscais').delete().in('empresa_id', ids);
  await sb.from('companies').delete().in('id', ids);
  console.log('     ✓ empresas + dependentes apagados');

  console.log('[6/6] Zerando profile.current_company…');
  await sb.from('profiles').update({ current_company: null }).eq('user_id', u.id);
  console.log('     ✓ pode cadastrar empresa de novo no /onboarding');
}

main().catch((e) => { console.error(e); process.exit(1); });
