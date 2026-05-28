#!/usr/bin/env tsx
/**
 * Apaga TODOS os dados de um usuário (por email) pra testes do zero.
 *
 * Ordem (respeita FKs):
 *   1. notas_fiscais     (FK companies)
 *   2. arquivos_auxiliares (FK companies; também tem blob em Storage)
 *   3. empresas_fiscais  (FK companies)
 *   4. companies         (FK auth.users)
 *   5. profiles          (FK auth.users)
 *   6. auth.users        (via Supabase Admin API)
 *
 * Uso:
 *   npx tsx --env-file=../.env.local --import=tsx scripts/wipe-user.ts <email> [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const email = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!email) {
  console.error('Uso: wipe-user.ts <email> [--dry-run]');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`[1/8] Localizando usuário ${email} em auth.users…`);
  // listUsers paginado; busca direta por email.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) { console.log('     ✗ Usuário não encontrado.'); process.exit(0); }
  console.log(`     ✓ user_id=${user.id} · created_at=${user.created_at}`);

  console.log('[2/8] Buscando companies do usuário…');
  const { data: companies } = await supabase.from('companies').select('id, nome, cnpj').eq('user_id', user.id);
  const companyIds = (companies ?? []).map((c) => c.id as string);
  console.log(`     ✓ ${companyIds.length} empresa(s)`);
  for (const c of companies ?? []) console.log(`       - ${c.nome ?? '(s/nome)'} · CNPJ ${c.cnpj} · ${c.id}`);

  console.log('[3/8] Buscando notas_fiscais…');
  const notasCount = companyIds.length
    ? (await supabase.from('notas_fiscais').select('id', { count: 'exact', head: true }).in('company_id', companyIds)).count ?? 0
    : 0;
  console.log(`     ✓ ${notasCount} nota(s)`);

  console.log('[4/8] Buscando arquivos_auxiliares (storage_keys)…');
  const { data: arqs } = companyIds.length
    ? await supabase.from('arquivos_auxiliares').select('id, storage_key').in('unique_id_empresa', companyIds)
    : { data: [] };
  console.log(`     ✓ ${(arqs ?? []).length} arquivo(s) auxiliar(es)`);

  console.log('[5/8] Buscando empresas_fiscais…');
  const efCount = companyIds.length
    ? (await supabase.from('empresas_fiscais').select('id', { count: 'exact', head: true }).in('empresa_id', companyIds)).count ?? 0
    : 0;
  console.log(`     ✓ ${efCount} empresa_fiscal(is)`);

  console.log('[6/8] Buscando profile…');
  const { data: profile } = await supabase.from('profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  console.log(`     ✓ ${profile ? '1 profile' : 'sem profile'}`);

  if (dryRun) {
    console.log('\n— DRY RUN — nada foi apagado. Rode sem --dry-run pra apagar de fato.');
    return;
  }

  console.log('\n[7/8] APAGANDO em ordem reversa de FK…');
  if (companyIds.length) {
    const del = async (table: string, col: string) => {
      const { error, count } = await supabase.from(table).delete({ count: 'exact' }).in(col, companyIds);
      if (error) throw new Error(`${table}: ${error.message}`);
      console.log(`     ✓ ${table}: ${count ?? 0} linha(s)`);
    };
    await del('notas_fiscais', 'company_id');
    // Apaga blobs no Storage primeiro (bucket pelos paths).
    for (const a of arqs ?? []) {
      const key = (a as { storage_key: string | null }).storage_key;
      if (!key) continue;
      const { error: sErr } = await supabase.storage.from('certificados').remove([key]);
      if (sErr) console.warn(`     ⚠ storage.remove(${key}): ${sErr.message}`);
    }
    await del('arquivos_auxiliares', 'unique_id_empresa');
    await del('empresas_fiscais', 'empresa_id');
    const { error: cErr, count: cCount } = await supabase.from('companies').delete({ count: 'exact' }).in('id', companyIds);
    if (cErr) throw new Error(`companies: ${cErr.message}`);
    console.log(`     ✓ companies: ${cCount ?? 0} linha(s)`);
  }
  if (profile) {
    const { error } = await supabase.from('profiles').delete().eq('user_id', user.id);
    if (error) throw new Error(`profiles: ${error.message}`);
    console.log('     ✓ profiles: 1 linha');
  }

  console.log('[8/8] Apagando auth.users via admin API…');
  const { error: aErr } = await supabase.auth.admin.deleteUser(user.id);
  if (aErr) throw new Error(`auth.admin.deleteUser: ${aErr.message}`);
  console.log('     ✓ auth.users: 1 linha');

  console.log('\nDone — usuário totalmente apagado. Pode cadastrar de novo com o mesmo email.');
}

main().catch((e) => { console.error('\nERRO:', e); process.exit(1); });
