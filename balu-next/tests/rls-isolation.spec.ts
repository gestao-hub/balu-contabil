import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Prova de RLS: provisiona um 2º tenant (B) via service_role, e confirma que B,
// autenticado com a anon key, NÃO enxerga nem grava dados do tenant A.
// Bate no Supabase de dev real (cria/apaga user+company descartáveis). Não hermético.
// Rodar: set -a; . ./.env.local; set +a; npx playwright test rls-isolation --reporter=line

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const A_EMAIL = 'allanvalle@outlook.com';
const A_PASS = 'teste123';

// Tabelas escopadas por company_id (testadas no loop). empresas_fiscais (empresa_id)
// e arquivos_auxiliares (company_id, FK) são testadas à parte logo abaixo.
const COMPANY_TABLES = [
  'clientes', 'notas_fiscais', 'guias_fiscais', 'apuracoes_fiscais',
  'honorarios',
];

test('RLS isola tenants: B não acessa dados de A', async () => {
  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // 1) Provisiona tenant B (confirmado) + uma company de B
  const bEmail = `rls-b-${Date.now()}@balu-test.local`;
  const bPass = 'senha-teste-B-123';
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: bEmail, password: bPass, email_confirm: true,
  });
  expect(cErr, `createUser falhou: ${cErr?.message}`).toBeNull();
  const bUserId = created.user!.id;

  const { error: bcErr } = await admin
    .from('companies').insert({ user_id: bUserId, nome: 'B Teste LTDA' });
  expect(bcErr, `insert company B falhou: ${bcErr?.message}`).toBeNull();

  try {
    // 2) Sessão A (anon + login)
    const aClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: aErr } = await aClient.auth.signInWithPassword({ email: A_EMAIL, password: A_PASS });
    expect(aErr, `login A falhou: ${aErr?.message}`).toBeNull();
    const { data: aCompanies } = await aClient.from('companies').select('id');
    expect(aCompanies?.length ?? 0, 'A precisa ter ao menos 1 empresa').toBeGreaterThan(0);
    const aCompanyId = aCompanies![0].id as string;

    // 3) Sessão B (anon + login)
    const bClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: bErr } = await bClient.auth.signInWithPassword({ email: bEmail, password: bPass });
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
    // Teardown: apaga company e user de B
    await admin.from('companies').delete().eq('user_id', bUserId);
    await admin.auth.admin.deleteUser(bUserId);
  }
});
