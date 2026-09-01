#!/usr/bin/env tsx
/**
 * PRÉVIA (não escreve nada) do que `syncEmpresaNaFocus` faria hoje para as
 * empresas indicadas: qual o modo NFS-e do município, se a empresa já está na
 * Focus, e qual PUT seria enviado para ligar NFS-e.
 *
 * Usa as MESMAS funções do produto — uma prévia que recalcula a regra por conta
 * própria mente na primeira divergência.
 *
 *   npx tsx scripts/_previa-vinculo-focus.ts
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env: Record<string, string> = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
for (const k of Object.keys(env)) process.env[k] = env[k];

async function main() {
  const { modoNfseDoMunicipio } = await import('../src/lib/fiscal/municipio-nfse-modo');
  const { buildFocusEmpresaUpdatePayload } = await import('../src/lib/fiscal/focus-empresa-update-payload');
  const { focus } = await import('../src/lib/clients/focus-nfe');

  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const CNPJS = ['53015033000171', '10358425000120']; // MCB MARKETING, AL PISCINAS

  for (const cnpj of CNPJS) {
    const { data: company } = await sb.from('companies').select('*').eq('cnpj', cnpj).is('deleted_at', null).maybeSingle();
    if (!company) { console.log(`\n=== ${cnpj}: não existe no Balu ===`); continue; }

    const { data: fiscal } = await sb.from('empresas_fiscais')
      .select('Code_regime_tributario, empresa_fiscal_ativada, focus_empresa_id, focus_codigo_municipio, focus_origem, focus_ambiente')
      .eq('empresa_id', company.id).is('deleted_at', null).maybeSingle();

    const codigoIbge = fiscal?.focus_codigo_municipio || company.codigo_municipio || null;
    const modo = await modoNfseDoMunicipio(sb, codigoIbge);

    console.log(`\n=== ${company.nome} (${cnpj}) ===`);
    console.log(`  municipio        ${company.municipio}/${company.uf} · IBGE ${codigoIbge} · modo NFS-e: ${modo}`);
    console.log(`  origem/ambiente  ${fiscal?.focus_origem ?? '(null)'} / ${fiscal?.focus_ambiente ?? '(null)'}`);
    console.log(`  regime           ${fiscal?.Code_regime_tributario ?? '(AUSENTE — o sync recusa sem isto)'}`);
    console.log(`  focus_empresa_id no Balu: ${fiscal?.focus_empresa_id ?? '(null — nao vinculada)'}`);

    const naFocus = await focus.buscarEmpresaPorCnpj(cnpj);
    if (!naFocus) { console.log('  na Focus: NAO EXISTE -> seria CRIADA (POST)'); continue; }

    const r = naFocus as Record<string, unknown>;
    console.log(`  na Focus: id ${r.id} -> seria VINCULADA (sem POST)`);
    console.log(`    tokens que seriam guardados: hom=${r.token_homologacao ? 'sim' : 'NAO'} prod=${r.token_producao ? 'sim' : 'NAO'}`);
    console.log(`    nfse=${r.habilita_nfse} nfsen_hom=${r.habilita_nfsen_homologacao} nfsen_prod=${r.habilita_nfsen_producao}`);

    const jaLigada = r.habilita_nfsen_homologacao === true || r.habilita_nfsen_producao === true;
    if (modo !== 'nacional' || jaLigada) {
      console.log(`    PUT de NFS-e: NAO seria enviado (${jaLigada ? 'ja ligada' : 'municipio ' + modo})`);
      continue;
    }

    if (!fiscal?.Code_regime_tributario) { console.log('    PUT: bloqueado — regime tributario ausente'); continue; }
    const payload = buildFocusEmpresaUpdatePayload(
      company as never,
      { Code_regime_tributario: fiscal.Code_regime_tributario, empresa_fiscal_ativada: fiscal.empresa_fiscal_ativada } as never,
      codigoIbge,
      (fiscal.focus_ambiente === 'prod' ? 'prod' : 'hom'),
      modo,
    );
    console.log('    PUT /v2/empresas/' + r.id + ' — payload EXATO que seria enviado:');
    console.log('      ' + JSON.stringify(payload, null, 2).split('\n').join('\n      '));
  }

}

main().catch((e) => { console.error(e); process.exit(1); });
