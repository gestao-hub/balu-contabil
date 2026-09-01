import { test, expect } from '@playwright/test';
import { ambienteDestrutivo, MOTIVO_SKIP, URL_INERTE, CHAVE_INERTE, MARCA_SINTETICA } from './guarda-ambiente';
import { createClient } from '@supabase/supabase-js';

// Prova de RLS: provisiona um 2º tenant (B) via service_role, e confirma que B,
// autenticado com a anon key, NÃO enxerga nem grava dados do tenant A.
// Bate no Supabase de dev real (cria/apaga user+company descartáveis). Não hermético.
// Rodar: set -a; . ./.env.local; set +a; npx playwright test rls-isolation --reporter=line

// ─── TRAVA DE AMBIENTE ──────────────────────────────────────────────────────
// Este arquivo CRIA E APAGA dados via service_role. Desde 14/08/2026 o Supabase
// da aplicacao e producao e so producao, entao o alvo tem de vir de
// E2E_SUPABASE_URL e ser outro banco. Sem ele, a suite se declara skipped;
// apontando para producao, ela lanca. Ver tests/guarda-ambiente.ts.
const AMBIENTE = ambienteDestrutivo();
const URL = AMBIENTE?.url ?? URL_INERTE;
const ANON = AMBIENTE?.anon ?? CHAVE_INERTE;
const SERVICE = AMBIENTE?.service ?? CHAVE_INERTE;
// Sem ambiente configurado, o arquivo inteiro se declara skipped — a forma
// com callback e a unica que o Playwright aceita em escopo de arquivo.
test.skip(() => !AMBIENTE, MOTIVO_SKIP);


// TENANT A TAMBÉM É SINTÉTICO (01/09/2026).
//
// Até aqui, A era a conta real `allanvalle@outlook.com` com a senha 'teste123'.
// Isso trazia dois problemas, um chato e um sério.
//
// O chato: a senha não confere há meses, então o teste falhava no login de A e
// era anotado no CHECKPOINT como "falha pré-existente" — uma linha vermelha
// permanente, que é o mesmo que uma linha que ninguém lê.
//
// O sério: com o banco da aplicação sendo produção, "tenant A" passou a ser um
// CLIENTE DE VERDADE. O passo 6 tenta INSERIR uma linha na empresa de A; o
// passo 4 lê o que A tem. Enquanto a RLS funciona, nada acontece — mas o teste
// existe justamente para o dia em que ela não funcionar, e nesse dia o insere
// cai na empresa de alguém.
//
// Agora os dois lados nascem aqui e morrem no finally. O teste passou a provar
// mais, não menos: A tem um cliente semeado, então o passo 5 tem o que vazar.
const PASS_A = 'senha-teste-A-123';

// Tabelas escopadas por company_id (testadas no loop). empresas_fiscais (empresa_id)
// e arquivos_auxiliares (company_id, FK) são testadas à parte logo abaixo.
const COMPANY_TABLES = [
  'clientes', 'notas_fiscais', 'guias_fiscais', 'apuracoes_fiscais',
  'honorarios',
];

test('RLS isola tenants: B não acessa dados de A', async () => {
  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const stamp = Date.now();

  // 1) Provisiona os DOIS tenants. Ordem: A (a vítima) e B (o intruso).
  const criar = async (papel: 'a' | 'b') => {
    const email = `rls-${papel}-${stamp}-${MARCA_SINTETICA}@balu-test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASS_A, email_confirm: true,
    });
    expect(error, `createUser ${papel} falhou: ${error?.message}`).toBeNull();
    const userId = data.user!.id;
    const { data: emp, error: eErr } = await admin.from('companies')
      .insert({ user_id: userId, nome: `Tenant ${papel.toUpperCase()} ${MARCA_SINTETICA} ${stamp}` })
      .select('id').single();
    expect(eErr, `insert company ${papel} falhou: ${eErr?.message}`).toBeNull();
    return { email, userId, companyId: emp!.id as string };
  };

  const A = await criar('a');
  const B = await criar('b');

  // A ganha um cliente: sem uma linha filha, o passo 5 conferiria "B não vê
  // nada" num lugar onde não havia nada para ver — verde que não prova nada.
  const { data: cliA, error: cliErr } = await admin.from('clientes')
    .insert({ company_id: A.companyId, owner_user_id: A.userId,
              razao_social: `Cliente de A ${MARCA_SINTETICA}`, person_type: 'PJ' })
    .select('id').single();
  expect(cliErr, `insert cliente de A falhou: ${cliErr?.message}`).toBeNull();
  const clienteAId = cliA!.id as string;
  const bUserId = B.userId;

  try {
    // 2) Sessão A (anon + login)
    const aClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: aErr } = await aClient.auth.signInWithPassword({ email: A.email, password: PASS_A });
    expect(aErr, `login A falhou: ${aErr?.message}`).toBeNull();
    const { data: aCompanies } = await aClient.from('companies').select('id');
    expect(aCompanies?.length ?? 0, 'A precisa ter ao menos 1 empresa').toBeGreaterThan(0);
    const aCompanyId = A.companyId;
    expect(aCompanies!.map((c) => c.id), 'A não enxerga a própria empresa').toContain(aCompanyId);

    // 3) Sessão B (anon + login)
    const bClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: bErr } = await bClient.auth.signInWithPassword({ email: B.email, password: PASS_A });
    expect(bErr, `login B falhou: ${bErr?.message}`).toBeNull();

    // 4) B não enxerga a company de A
    const { data: bSeesA } = await bClient.from('companies').select('id').eq('id', aCompanyId);
    expect(bSeesA ?? [], 'B enxergou a company de A (RLS não isola)').toHaveLength(0);

    // 5) B não enxerga linhas de A nas tabelas company_id
    for (const t of COMPANY_TABLES) {
      const { data } = await bClient.from(t).select('id').eq('company_id', aCompanyId);
      expect(data ?? [], `B vazou linhas de A em ${t}`).toHaveLength(0);
    }
    // empresas_fiscais (empresa_id)
    {
      const { data } = await bClient.from('empresas_fiscais').select('id').eq('empresa_id', aCompanyId);
      expect(data ?? [], 'B vazou empresas_fiscais de A').toHaveLength(0);
    }
    // arquivos_auxiliares (agora company_id, FK -> companies.id)
    {
      const { data } = await bClient.from('arquivos_auxiliares').select('id').eq('company_id', aCompanyId);
      expect(data ?? [], 'B vazou arquivos_auxiliares de A').toHaveLength(0);
    }

    // 6) B não consegue INSERIR cliente na company de A
    const { error: insErr } = await bClient
      .from('clientes').insert({ company_id: aCompanyId, razao_social: 'intruso-rls' });
    expect(insErr, 'B conseguiu inserir cliente na company de A (WITH CHECK falhou)').not.toBeNull();

    // 7) Sanidade: A enxerga a própria company
    const { data: aSelf } = await aClient.from('companies').select('id').eq('id', aCompanyId);
    expect(aSelf ?? [], 'A não enxerga a própria company (policy quebrou o dono)').toHaveLength(1);
  } finally {
    // Teardown: filhas antes das mães, e cada ator apagado pelo id que ESTE
    // teste criou — nunca por predicado largo.
    await admin.from('clientes').delete().eq('id', clienteAId);
    await admin.from('companies').delete().eq('id', A.companyId);
    await admin.from('companies').delete().eq('id', B.companyId);
    await admin.auth.admin.deleteUser(A.userId);
    await admin.auth.admin.deleteUser(bUserId);
  }
});
