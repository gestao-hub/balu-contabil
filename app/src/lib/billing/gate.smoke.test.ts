// Smoke do gate contra o banco REAL. Pula inteiro quando faltam as env
// (mesmo padrao de registrar.smoke.test.ts do Bloco 3): sem isso, `npm
// test` em main quebraria para quem nao tem .env.local carregado.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const temEnv = Boolean(URL && KEY);

let sb: SupabaseClient;
let companyId = '';
let assinaturaId = '';
let statusOriginal: string | null = null;
let trialOriginal: string | null = null;

describe.skipIf(!temEnv)('gate de assinatura (banco real)', () => {
  beforeAll(async () => {
    sb = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const { data } = await sb.from('companies')
      .select('id').is('contabilidade_id', null).is('deleted_at', null).limit(1).maybeSingle();
    companyId = data?.id ?? '';
    if (companyId) {
      const { data: a } = await sb.from('assinaturas')
        .select('id, status, trial_termina_em').eq('company_id', companyId).maybeSingle();
      assinaturaId = a?.id ?? '';
      statusOriginal = a?.status ?? null;
      trialOriginal = a?.trial_termina_em ?? null;
    }
  });

  afterAll(async () => {
    // Devolve a assinatura ao estado ORIGINAL — o smoke nao pode deixar uma
    // empresa real bloqueada nem inventar um estado que nao existia.
    if (assinaturaId && statusOriginal) {
      await sb.from('assinaturas')
        .update({ status: statusOriginal, trial_termina_em: trialOriginal })
        .eq('id', assinaturaId);
    }
  });

  it('achou uma empresa autosservico com assinatura', () => {
    expect(companyId).not.toBe('');
    expect(assinaturaId).not.toBe('');
  });

  it('cortesia libera', async () => {
    await sb.from('assinaturas').update({ status: 'cortesia' }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    expect(await assertAssinaturaEmpresa(companyId)).toEqual({ ok: true });
  });

  it('inadimplente bloqueia', async () => {
    await sb.from('assinaturas').update({ status: 'inadimplente' }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    const r = await assertAssinaturaEmpresa(companyId);
    expect(r.ok).toBe(false);
  });

  // DISCRIMINANTE: sem este caso, um gate que barrasse TUDO passaria nos
  // dois testes acima.
  it('trial vigente libera', async () => {
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await sb.from('assinaturas')
      .update({ status: 'trial', trial_termina_em: amanha }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    expect(await assertAssinaturaEmpresa(companyId)).toEqual({ ok: true });
  });

  it('trial vencido ontem bloqueia, sem nenhum cron ter rodado', async () => {
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await sb.from('assinaturas')
      .update({ status: 'trial', trial_termina_em: ontem }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    const r = await assertAssinaturaEmpresa(companyId);
    expect(r.ok).toBe(false);
  });

  // DISCRIMINANTE da decisao 3.3: empresa de carteira nunca consulta
  // assinatura propria. Sem ele, um gate que ignorasse a carteira passaria.
  it('empresa de carteira libera mesmo com o escritorio inadimplente', async () => {
    const { data: comCarteira } = await sb.from('companies')
      .select('id, contabilidade_id').not('contabilidade_id', 'is', null)
      .is('deleted_at', null).limit(1).maybeSingle();
    if (!comCarteira) return;  // ambiente sem empresa de carteira

    const { data: aEsc } = await sb.from('assinaturas')
      .select('id, status').eq('contabilidade_id', comCarteira.contabilidade_id).maybeSingle();
    const original = aEsc?.status ?? null;
    if (aEsc) await sb.from('assinaturas').update({ status: 'inadimplente' }).eq('id', aEsc.id);

    const { assertAssinaturaEmpresa } = await import('./gate');
    expect(await assertAssinaturaEmpresa(comCarteira.id)).toEqual({ ok: true });

    if (aEsc && original) await sb.from('assinaturas').update({ status: original }).eq('id', aEsc.id);
  });

  // A trigger da 0050 tem de ter coberto todo mundo: se sobrou titular sem
  // assinatura, o gate cai no fail-open e o bloqueio nunca acontece.
  it('nenhum titular ficou sem assinatura', async () => {
    const { count: contabSemAssin } = await sb.from('contabilidades')
      .select('id', { count: 'exact', head: true });
    const { count: assinContab } = await sb.from('assinaturas')
      .select('id', { count: 'exact', head: true }).not('contabilidade_id', 'is', null);
    expect(assinContab).toBe(contabSemAssin);
  });
});
