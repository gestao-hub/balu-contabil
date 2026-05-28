#!/usr/bin/env tsx
/**
 * Smoke test E2E do Focus 1: roda o fluxo completo (read DB → build payload →
 * POST /v2/empresas hom → persist focus_token/status) contra uma empresa real.
 *
 * Uso: npx tsx scripts/focus1-smoke.ts [cnpj-da-empresa]
 *      (default: pega a primeira empresa do user logado na sessão? não —
 *       usa cnpj passado como arg ou busca por nome "AL Piscinas").
 *
 * Não modifica o cadastro Focus se já existir (apenas reporta o erro 4xx
 * que a Focus retornar). Persiste resultado em companies.focus_*.
 */
// Env é carregado via `node --env-file=.env.local` (Node 22+) na invocação.
import { createClient } from '@supabase/supabase-js';
import { focus } from '../src/lib/clients/focus-nfe';
import { buildFocusEmpresaPayload } from '../src/lib/fiscal/focus-empresa-payload';
import type { RegimeCode } from '../src/lib/fiscal/regime';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  const targetArg = process.argv[2];
  const targetName = 'AL Piscinas';

  console.log('[1/5] Localizando empresa…');
  let query = supabase.from('companies').select('*').is('deleted_at', null);
  query = targetArg ? query.eq('cnpj', targetArg.replace(/\D+/g, '')) : query.ilike('nome', `%${targetName}%`);
  const { data: companies, error: cErr } = await query.limit(1);
  if (cErr) throw new Error(`companies select: ${cErr.message}`);
  const company = companies?.[0];
  if (!company) {
    console.error(`Empresa não encontrada (arg=${targetArg ?? targetName}).`);
    process.exit(1);
  }
  console.log(`     ✓ ${company.nome ?? company.razao_social} · CNPJ ${company.cnpj} · id=${company.id}`);
  console.log(`     focus_status atual: ${company.focus_status ?? 'NULL'} · focus_token: ${company.focus_token ? company.focus_token.slice(0,8)+'…' : 'NULL'}`);

  console.log('[2/5] Buscando regime tributário em empresas_fiscais…');
  const { data: fiscal, error: fErr } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, regime_tributario')
    .eq('empresa_id', company.id)
    .maybeSingle();
  if (fErr) throw new Error(`empresas_fiscais select: ${fErr.message}`);
  const regimeCode = (fiscal?.Code_regime_tributario ?? '1') as RegimeCode;
  if (!fiscal?.Code_regime_tributario) {
    console.log(`     ⚠ sem Code_regime_tributario em empresas_fiscais — usando '1' (Simples) como default`);
  } else {
    console.log(`     ✓ regime = '${regimeCode}'`);
  }

  console.log('[3/5] Montando payload Focus…');
  const payload = buildFocusEmpresaPayload(
    {
      cnpj: company.cnpj,
      razao_social: company.razao_social,
      nome: company.nome,
      logradouro: company.logradouro,
      numero: company.numero,
      sem_numero: company.sem_numero,
      complemento: company.complemento,
      bairro: company.bairro,
      municipio: company.municipio,
      uf: company.uf,
      cep: company.cep,
      email: company.email,
      telefone: company.telefone,
      inscricao_estadual: company.inscricao_estadual,
      inscricao_municipal: company.inscricao_municipal,
    },
    regimeCode,
  );
  console.log('     ✓ payload:', JSON.stringify(payload, null, 2));

  console.log('[4/5] POST /v2/empresas em homologação…');
  const now = new Date().toISOString();
  try {
    const resp = await focus.criarEmpresa(payload, 'hom');
    const token = resp.token_homologacao ?? resp.token_producao ?? null;
    console.log(`     ✓ sucesso · token_homologacao=${token ? token.slice(0,8)+'…' : 'NULL'}`);
    console.log('     resp completa:', JSON.stringify(resp, null, 2).slice(0, 800));

    console.log('[5/5] Persistindo em companies.focus_* …');
    const { error: uErr } = await supabase
      .from('companies')
      .update({ focus_token: token, focus_status: 'ok', focus_last_check: now, focus_last_error: null })
      .eq('id', company.id);
    if (uErr) throw new Error(`update companies: ${uErr.message}`);
    console.log('     ✓ focus_token persistido. RESULTADO: SUCESSO.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`     ✗ falha: ${msg.slice(0, 600)}`);

    console.log('[5/5] Persistindo focus_status="erro" …');
    const { error: uErr } = await supabase
      .from('companies')
      .update({ focus_status: 'erro', focus_last_check: now, focus_last_error: msg.slice(0, 500) })
      .eq('id', company.id);
    if (uErr) throw new Error(`update companies: ${uErr.message}`);
    console.log('     ✓ erro persistido. RESULTADO: ERRO (esperado se CNPJ já existia na Focus).');
  }

  // Releitura pra confirmar estado final do banco.
  const { data: after } = await supabase
    .from('companies')
    .select('focus_token, focus_status, focus_last_check, focus_last_error')
    .eq('id', company.id)
    .single();
  console.log('\nESTADO FINAL companies:', JSON.stringify(after, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
