// src/lib/fiscal/declaracoes-anuais/registrar.smoke.test.ts
// Smoke contra o banco REAL. Usa a empresa do seed (scratchpad/seed-empresa-mei.mjs);
// sem ela a suíte inteira é pulada. Limpa o que criou — e VERIFICA por query.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { companyDaCarteira } from '@/lib/contador/carteira';
import { registrarDeclaracaoAnual } from './registrar';

const env = Object.fromEntries(
  readFileSync(new URL('../../../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const RAZAO_SEED = 'SEED BLOCO3 MEI LTDA';
const ANO = new Date().getFullYear() - 1;

const admin: SupabaseClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } },
);

// Este smoke escreve na empresa do seed do Bloco 3. Sem ela, PULA em vez de
// quebrar: o seed é removido no fechamento do bloco (`seed-empresa-mei.mjs
// restore`), e a suíte numa árvore limpa não pode falhar por causa disso.
// Antes o beforeAll lançava — `npm test` passava só enquanto o seed vivesse.
const { data: seed } = await admin
  .from('companies').select('id, user_id').eq('razao_social', RAZAO_SEED).maybeSingle();
const semSeed = !seed;
const companyId = (seed?.id ?? '') as string;
const ownerUserId = (seed?.user_id ?? '') as string;

if (semSeed) {
  console.warn(`[smoke] "${RAZAO_SEED}" ausente — pulando. Para rodar: node app/scratchpad/seed-empresa-mei.mjs`);
}

afterAll(async () => {
  if (semSeed) return;
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

describe.skipIf(semSeed)('supressão do aviso de declaração anual', () => {
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

// Os três abaixo cobrem o que passava por registrarDeclaracaoAnual() sem teste
// nenhum — e cada um deles nasceu de um bug encontrado no smoke manual.
describe.skipIf(semSeed)('registrarDeclaracaoAnual', () => {
  const base = { companyId: '', ownerUserId: '', tipo: 'DASN-SIMEI' as const, ano: ANO, origem: 'manual' as const, registradoPor: '' };
  const dados = { receitaComercio: 2300, receitaServico: 2200, possuiEmpregado: false };
  const entrada = () => ({ ...base, companyId, ownerUserId, registradoPor: ownerUserId, dados });

  const linha = async () => (await admin.from('declaracoes_fiscais')
    .select('status, data_transmissao, numero_declaracao, comprovante_path')
    .eq('company_id', companyId).eq('competencia_referencia', String(ANO)).eq('tipo', 'DASN-SIMEI').single()).data;

  it('salvar rascunho DEPOIS da entrega não apaga a entrega', async () => {
    await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);

    const entrega = await registrarDeclaracaoAnual(admin, {
      ...entrada(), dataTransmissao: `${ANO + 1}-05-20`, numeroDeclaracao: '123456789',
    });
    expect(entrega.ok).toBe(true);
    expect((await linha())?.status).toBe('Transmitida');

    // Editar os valores de uma declaração já entregue é retificação: os dados
    // mudam, a entrega permanece. O upsert reescrevia data e número com null.
    const rascunho = await registrarDeclaracaoAnual(admin, {
      ...entrada(), dados: { ...dados, receitaComercio: 2500 }, dataTransmissao: null, numeroDeclaracao: null,
    });
    expect(rascunho.ok).toBe(true);

    const depois = await linha();
    expect(depois?.data_transmissao).not.toBeNull();
    expect(depois?.numero_declaracao).toBe('123456789');
    expect(depois?.status).toBe('Transmitida');
  });

  it('a entrega marca como lida a notificação já criada', async () => {
    await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);
    await admin.from('notifications').delete().eq('company_id', companyId);
    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBeGreaterThan(0);

    const r = await registrarDeclaracaoAnual(admin, { ...entrada(), dataTransmissao: `${ANO + 1}-05-20` });
    expect(r.ok).toBe(true);

    const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('tipo', 'dasn_pendente').is('lida_em', null);
    expect(count).toBe(0);
  });

  // Controle discriminante do teste acima: se o update de lida_em pegasse tudo,
  // ele passaria mesmo com o filtro de chave errado. Aqui prova que não pega.
  it('a entrega da DASN não cala o aviso mensal do PGDAS-D', async () => {
    await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);
    await admin.from('notifications').delete().eq('company_id', companyId);
    await admin.from('notifications').insert({
      owner_user_id: ownerUserId, company_id: companyId, tipo: 'pgdas_pendente', severidade: 'warning',
      titulo: 'Declaração mensal (PGDAS-D) pendente', corpo: 'controle',
      chave: `pgdas_pendente:${companyId}:${ANO}01:PRE`,
    });

    await registrarDeclaracaoAnual(admin, { ...entrada(), dataTransmissao: `${ANO + 1}-05-20` });

    const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('tipo', 'pgdas_pendente').is('lida_em', null);
    expect(count).toBe(1);
  });
});

describe.skipIf(semSeed)('guarda de carteira do contador (anti-IDOR)', () => {
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
