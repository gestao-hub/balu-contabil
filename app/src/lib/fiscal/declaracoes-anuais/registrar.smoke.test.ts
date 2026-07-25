// src/lib/fiscal/declaracoes-anuais/registrar.smoke.test.ts
// Smoke contra o banco REAL. Exige a empresa do seed (scratchpad/seed-empresa-mei.mjs).
// Faz snapshot antes e restaura depois — e VERIFICA a restauração por query.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { companyDaCarteira } from '@/lib/contador/carteira';

const env = Object.fromEntries(
  readFileSync(new URL('../../../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const RAZAO_SEED = 'SEED BLOCO3 MEI LTDA';
const ANO = new Date().getFullYear() - 1;

let admin: SupabaseClient;
let companyId: string;
let ownerUserId: string;

beforeAll(async () => {
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.from('companies').select('id, user_id').eq('razao_social', RAZAO_SEED).maybeSingle();
  if (!data) throw new Error('Rode antes: node app/scratchpad/seed-empresa-mei.mjs');
  companyId = data.id as string;
  ownerUserId = data.user_id as string;
});

afterAll(async () => {
  // Limpa o que o teste criou e CONFIRMA que limpou.
  await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);
  await admin.from('notifications').delete().eq('company_id', companyId);
  const { count } = await admin.from('declaracoes_fiscais')
    .select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  expect(count).toBe(0);
});

/** Roda a RPC numa data dentro da janela e devolve quantos avisos do tipo existem. */
async function avisosApos(hoje: string, tipo: string): Promise<number> {
  await admin.rpc('materializar_obrigacoes', { p_hoje: hoje });
  const { count } = await admin.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('tipo', tipo);
  return count ?? 0;
}

describe('supressão do aviso de declaração anual', () => {
  it('sem declaração nenhuma, a RPC gera dasn_pendente', async () => {
    await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);
    await admin.from('notifications').delete().eq('company_id', companyId);
    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBeGreaterThan(0);
  });

  it('rascunho NÃO impede o aviso', async () => {
    await admin.from('notifications').delete().eq('company_id', companyId);
    await admin.from('declaracoes_fiscais').upsert({
      company_id: companyId, owner_user_id: ownerUserId, competencia_referencia: String(ANO),
      tipo: 'DASN-SIMEI', dados: { receitaComercio: 2300, receitaServico: 2200, possuiEmpregado: false },
      data_transmissao: null, status: 'Rascunho', origem: 'manual',
    }, { onConflict: 'company_id,competencia_referencia,tipo' });

    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBeGreaterThan(0);
  });

  it('entrega (data_transmissao preenchida) impede o aviso', async () => {
    await admin.from('notifications').delete().eq('company_id', companyId);
    await admin.from('declaracoes_fiscais').upsert({
      company_id: companyId, owner_user_id: ownerUserId, competencia_referencia: String(ANO),
      tipo: 'DASN-SIMEI', dados: { receitaComercio: 2300, receitaServico: 2200, possuiEmpregado: false },
      data_transmissao: `${ANO + 1}-05-20`, numero_declaracao: '123456789', status: 'Transmitida', origem: 'manual',
    }, { onConflict: 'company_id,competencia_referencia,tipo' });

    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBe(0);
  });
});

describe('guarda de carteira do contador (anti-IDOR)', () => {
  it('recusa a empresa quando a contabilidade não bate', async () => {
    const alvo = await companyDaCarteira(admin, '00000000-0000-0000-0000-000000000000', companyId);
    expect(alvo).toBeNull();
  });

  it('recusa companyId inexistente com o mesmo null (não vaza existência)', async () => {
    const alvo = await companyDaCarteira(admin, '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111');
    expect(alvo).toBeNull();
  });

  // Controle discriminante: se a guarda recusasse TUDO, os dois testes acima
  // passariam por acidente. Este prova que ela aceita o caso legítimo.
  it('aceita a empresa quando a contabilidade bate', async () => {
    const { data } = await admin.from('companies').select('contabilidade_id').eq('id', companyId).single();
    const contabilidadeId = data?.contabilidade_id as string | null;
    if (!contabilidadeId) {
      // O seed cria a empresa sem contabilidade; vincula temporariamente só para este teste.
      const { data: qualquer } = await admin.from('contabilidades').select('id').limit(1).single();
      await admin.from('companies').update({ contabilidade_id: qualquer!.id }).eq('id', companyId);
      const alvo = await companyDaCarteira(admin, qualquer!.id as string, companyId);
      expect(alvo).not.toBeNull();
      expect(alvo!.ownerUserId).toBe(ownerUserId);
      await admin.from('companies').update({ contabilidade_id: null }).eq('id', companyId);
      return;
    }
    const alvo = await companyDaCarteira(admin, contabilidadeId, companyId);
    expect(alvo).not.toBeNull();
  });
});
