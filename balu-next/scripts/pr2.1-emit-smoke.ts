#!/usr/bin/env tsx
/**
 * Smoke E2E PR 2.1: emite uma NFS-e Nacional contra hom Focus pra empresa
 * AL Piscinas (Londrina = aderente NFSe Nacional). Cria um cliente PJ
 * "fantasia" pra usar como tomador caso não exista.
 *
 * Pré-condição: empresa cadastrada no Balu + Focus 1/2.2 já rodaram (cert OK).
 *
 * Uso: npx tsx --env-file=.env.local scripts/pr2.1-emit-smoke.ts
 */
import { createClient } from '@supabase/supabase-js';
import { focus, generateRef } from '../src/lib/clients/focus-nfe';
import { buildNfsePayload } from '../src/lib/fiscal/nfse-payload';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EMAIL = 'allanvalle@outlook.com';
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log('[1/5] Localiza user + empresa…');
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => x.email?.toLowerCase() === EMAIL.toLowerCase());
  if (!u) throw new Error('user não encontrado');
  const { data: company } = await sb.from('companies')
    .select('id, cnpj, razao_social, codigo_municipio, focus_token')
    .eq('user_id', u.id).eq('cnpj', '10358425000120').maybeSingle();
  if (!company) throw new Error('AL Piscinas não cadastrada — rode focus2.2-cert-smoke antes');
  if (!company.focus_token) throw new Error('Empresa sem focus_token — rode focus2.2-cert-smoke antes');
  console.log(`     ✓ ${company.razao_social} · IBGE ${company.codigo_municipio}`);

  const { data: fiscal } = await sb.from('empresas_fiscais')
    .select('Code_regime_tributario, empresa_fiscal_ativada, focus_habilita_nfsen_homologacao')
    .eq('empresa_id', company.id).maybeSingle();
  if (!fiscal) throw new Error('empresas_fiscais não existe');
  if (!fiscal.focus_habilita_nfsen_homologacao) {
    console.warn('     ⚠ Focus não tem habilita_nfsen_homologacao=true — pode dar erro de pre-validação');
  }

  console.log('[2/5] Garante cliente de teste…');
  const docCliente = '11222333000181';
  let { data: cliente } = await sb.from('clientes')
    .select('id, razao_social, document, person_type')
    .eq('company_id', company.id).eq('document', docCliente).maybeSingle();
  if (!cliente) {
    const { data: ins } = await sb.from('clientes').insert({
      owner_user_id: u.id,
      company_id: company.id,
      person_type: 'PJ',
      razao_social: 'CLIENTE TESTE SMOKE LTDA',
      document: docCliente,
      email: 'cliente@teste.local',
      municipio: 'LONDRINA',
      uf: 'PR',
      codigo_municipio: '4113700',
      status: 'active',
    }).select('id, razao_social, document, person_type').single();
    cliente = ins!;
  }
  console.log(`     ✓ ${cliente.razao_social} · ${cliente.document}`);

  console.log('[3/5] Monta payload…');
  const payload = buildNfsePayload(
    { cnpj: company.cnpj as string, codigo_municipio: company.codigo_municipio as string | null },
    { Code_regime_tributario: fiscal.Code_regime_tributario as '1' },
    { cnpj: cliente.document as string, cpf: null, razaoSocial: cliente.razao_social as string },
    {
      codigoTributacao: '010701',
      descricao: 'Smoke test PR 2.1 — emissão NFS-e Nacional contra hom Focus.',
      valor: 100,
      aliquotaIssPercentual: 5,
    },
  );
  console.log('     payload:', JSON.stringify(payload, null, 2));

  console.log('[4/5] POST Focus /v2/nfsen…');
  const ref = generateRef(company.id);
  let resp: unknown;
  try {
    resp = await focus.emitirNfse(ref, payload, company.focus_token as string, 'hom');
    console.log('     ✅', JSON.stringify(resp, null, 2));
  } catch (e) {
    console.error('     ❌', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  console.log('[5/5] Insere nota local…');
  const { data: nota, error } = await sb.from('notas_fiscais').insert({
    company_id: company.id,
    tipo_documento: 'NFSe',
    referencia: ref,
    data_emissao: new Date().toISOString(),
    status: 'pendente',
    valor_total: 100,
    payload_focusnfe: { request: payload, response: resp },
    cliente_id: cliente.id,
  }).select('id').single();
  if (error) {
    console.error('     ❌ insert:', error.message);
    process.exit(1);
  }
  console.log(`     ✓ nota=${nota!.id} status=pendente (webhook completa)`);
  console.log('\n✅ smoke E2E PR 2.1 passou.');
}

main().catch((e) => { console.error(e); process.exit(1); });
