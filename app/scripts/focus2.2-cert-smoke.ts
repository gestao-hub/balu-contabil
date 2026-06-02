#!/usr/bin/env tsx
/**
 * Smoke E2E do Focus 2.2:
 *   1. Cria a empresa no banco (insert direto, simulando createCompanyAction)
 *   2. Dispara syncEmpresaNaFocus (POST /v2/empresas — Focus 1)
 *   3. Lê o PFX de docs/n8n + senha.json
 *   4. Dispara atualizarEmpresaNaFocus com extras.certificado (Focus 2.2)
 *   5. Verifica snapshot pós-PUT: habilita_nfsen_homologacao deve virar true
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/focus2.2-cert-smoke.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { syncEmpresaNaFocus, atualizarEmpresaNaFocus } from '../src/lib/fiscal/focus-empresa-sync';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_EMAIL = 'allanvalle@outlook.com';
const PFX_PATH = resolve(__dirname, '..', '..', 'docs', 'n8n', 'AL PISCINAS LTDA_2026 2027.pfx');
const SENHA_PATH = resolve(__dirname, '..', '..', 'docs', 'n8n', 'senha.json');

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log('[1/5] Localiza user + cria empresa AL Piscinas…');
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => x.email?.toLowerCase() === USER_EMAIL.toLowerCase());
  if (!u) throw new Error(`User ${USER_EMAIL} não encontrado — cadastre antes`);

  const cnpj = '10358425000120';
  // Reaproveita se já existe (idempotente)
  const { data: existing } = await sb.from('companies').select('id').eq('user_id', u.id).eq('cnpj', cnpj).maybeSingle();
  let companyId: string;
  if (existing) {
    companyId = existing.id as string;
    console.log(`     ✓ Empresa já existia (${companyId})`);
  } else {
    const { data: ins, error } = await sb.from('companies').insert({
      user_id: u.id,
      cnpj,
      razao_social: 'AL PISCINAS LTDA',
      nome: 'AL Piscinas',
      inscricao_estadual: null,
      inscricao_municipal: null,
      logradouro: 'RUA TUPACIGUARA',
      numero: '232',
      sem_numero: false,
      complemento: null,
      bairro: 'JARDIM IGUACU',
      municipio: 'LONDRINA',
      uf: 'PR',
      cep: '86015050',
      codigo_municipio: '4113700',
      telefone: '43999999999',
      email: 'contato@alpiscinas.com.br',
    }).select('id').single();
    if (error) throw new Error(`insert companies: ${error.message}`);
    companyId = ins!.id as string;
    console.log(`     ✓ Empresa criada (${companyId})`);
  }

  // Garante empresas_fiscais com regime (pré-req do Focus PUT)
  const { data: efExisting } = await sb.from('empresas_fiscais').select('id').eq('empresa_id', companyId).maybeSingle();
  if (!efExisting) {
    await sb.from('empresas_fiscais').insert({
      empresa_id: companyId,
      owner_user_id: u.id,
      cnpj,
      Code_regime_tributario: '1',
      regime_tributario: 'simples',
      empresa_fiscal_ativada: true,
    });
    console.log('     ✓ empresa_fiscal criada com regime=1, ativada');
  }

  // Atualiza profile.current_company pra browser ver
  await sb.from('profiles').update({ current_company: companyId }).eq('user_id', u.id);

  console.log('[2/5] POST /v2/empresas (Focus 1)…');
  const post = await syncEmpresaNaFocus(sb, companyId);
  console.log('     →', JSON.stringify(post, null, 2));
  if (!post.ok) throw new Error('Focus 1 falhou');

  console.log('[3/5] Lê PFX + senha de docs/n8n…');
  const pfxBytes = readFileSync(PFX_PATH);
  const senhaJson = JSON.parse(readFileSync(SENHA_PATH, 'utf8'));
  const senha = String(senhaJson.senha);
  console.log(`     ✓ PFX ${pfxBytes.length} bytes · senha ${'*'.repeat(senha.length)}`);

  console.log('[4/5] PUT /v2/empresas/:id com cert (Focus 2.2)…');
  const put = await atualizarEmpresaNaFocus(sb, companyId, 'hom', {
    certificado: { base64: pfxBytes.toString('base64'), senha },
  });
  console.log('     →', JSON.stringify(put, null, 2));

  console.log('[5/5] Snapshot pós-PUT…');
  const { data: c } = await sb.from('companies').select('focus_status, focus_last_check, focus_last_error').eq('id', companyId).single();
  const { data: ef } = await sb.from('empresas_fiscais').select('focus_empresa_id, focus_codigo_municipio, focus_habilita_nfse, focus_habilita_nfsen_producao, focus_habilita_nfsen_homologacao, focus_sync_em').eq('empresa_id', companyId).maybeSingle();
  console.log('     companies:', JSON.stringify(c, null, 2));
  console.log('     empresa_fiscal:', JSON.stringify(ef, null, 2));

  const habilitada =
    (ef?.focus_habilita_nfse as boolean | null) === true ||
    (ef?.focus_habilita_nfsen_homologacao as boolean | null) === true ||
    (ef?.focus_habilita_nfsen_producao as boolean | null) === true;
  console.log(`\n${habilitada ? '✅' : '❌'} habilitada para emissão = ${habilitada}`);
}

main().catch((e) => { console.error('\nERRO:', e); process.exit(1); });
