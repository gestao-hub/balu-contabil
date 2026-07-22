import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Bloco E — Task 16: matriz abrangente de isolamento por tenant.
// Prova, para cada tabela multi-tenant relevante, que o tenant B não enxerga
// nenhuma linha do tenant A (nem a company, nem as filhas), usando dois
// empresários independentes (sem contabilidade/contador envolvido — isso já
// é coberto por rls-contador.spec.ts). Bate no Supabase real: cria/apaga
// usuários, companies, profiles e uma linha filha em cada tabela testada via
// admin (service_role), e lê com a anon key + signInWithPassword como B.
// Não hermético. Rodar: set -a; . ./.env.local; set +a; npx playwright test tests/rls-all-tables.spec.ts --reporter=line

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STAMP = Date.now();
const PASS = 'senha-teste-rls-all-123';

function mkClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const c = mkClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  expect(error, `login ${email} falhou: ${error?.message}`).toBeNull();
  return c;
}

test.describe('RLS: matriz de isolamento por tenant (Bloco E — Task 16)', () => {
  test.describe.configure({ mode: 'serial' });

  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Tenant A e tenant B, cada um com: auth user, company, profile e uma linha
  // em cada tabela filha testada.
  let aId: string, bId: string; // auth users
  let companyAId: string, companyBId: string;
  let clienteAId: string, clienteBId: string;
  let notaAId: string, notaBId: string;
  let guiaAId: string, guiaBId: string;
  let empresaFiscalAId: string, empresaFiscalBId: string;

  const aEmail = `rls-all-a-${STAMP}@balu-test.local`;
  const bEmail = `rls-all-b-${STAMP}@balu-test.local`;
  const documentA = `${STAMP}`.slice(0, 14);
  const documentB = `${STAMP + 1}`.slice(0, 14);

  test.beforeAll(async () => {
    const mkUser = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PASS, email_confirm: true,
      });
      expect(error, `createUser ${email} falhou: ${error?.message}`).toBeNull();
      return data.user!.id;
    };
    aId = await mkUser(aEmail);
    bId = await mkUser(bEmail);

    const mkCompany = async (userId: string, nome: string) => {
      const { data, error } = await admin.from('companies')
        .insert({ user_id: userId, nome })
        .select('id').single();
      expect(error, `insert company ${nome} falhou: ${error?.message}`).toBeNull();
      return data!.id as string;
    };
    companyAId = await mkCompany(aId, `Empresa A RLS-ALL ${STAMP}`);
    companyBId = await mkCompany(bId, `Empresa B RLS-ALL ${STAMP}`);

    const mkProfile = async (userId: string, companyId: string) => {
      const { error } = await admin.from('profiles')
        .insert({ user_id: userId, company_id: companyId, current_company: companyId });
      expect(error, `insert profile de ${userId} falhou: ${error?.message}`).toBeNull();
    };
    await mkProfile(aId, companyAId);
    await mkProfile(bId, companyBId);

    const mkCliente = async (ownerUserId: string, companyId: string, document: string) => {
      const { data, error } = await admin.from('clientes')
        .insert({
          owner_user_id: ownerUserId,
          company_id: companyId,
          person_type: 'PJ',
          razao_social: `Cliente RLS-ALL ${STAMP}`,
          document,
          status: 'active',
        })
        .select('id').single();
      expect(error, `insert cliente (owner ${ownerUserId}) falhou: ${error?.message}`).toBeNull();
      return data!.id as string;
    };
    clienteAId = await mkCliente(aId, companyAId, documentA);
    clienteBId = await mkCliente(bId, companyBId, documentB);

    const mkNota = async (companyId: string, referencia: string) => {
      const { data, error } = await admin.from('notas_fiscais')
        .insert({
          company_id: companyId, tipo_documento: 'NFe', referencia,
          data_emissao: new Date().toISOString(), status: 'ativa',
          valor_total: 100, payload_focusnfe: {},
        })
        .select('id').single();
      expect(error, `insert nota_fiscal (company ${companyId}) falhou: ${error?.message}`).toBeNull();
      return data!.id as string;
    };
    notaAId = await mkNota(companyAId, `ref-a-${STAMP}`);
    notaBId = await mkNota(companyBId, `ref-b-${STAMP}`);

    const mkGuia = async (companyId: string) => {
      const { data, error } = await admin.from('guias_fiscais')
        .insert({ company_id: companyId, competencia_mes: 1, competencia_ano: 2026 })
        .select('id').single();
      expect(error, `insert guia_fiscal (company ${companyId}) falhou: ${error?.message}`).toBeNull();
      return data!.id as string;
    };
    guiaAId = await mkGuia(companyAId);
    guiaBId = await mkGuia(companyBId);

    const mkEmpresaFiscal = async (empresaId: string) => {
      const { data, error } = await admin.from('empresas_fiscais')
        .insert({ empresa_id: empresaId })
        .select('id').single();
      expect(error, `insert empresa_fiscal (empresa ${empresaId}) falhou: ${error?.message}`).toBeNull();
      return data!.id as string;
    };
    empresaFiscalAId = await mkEmpresaFiscal(companyAId);
    empresaFiscalBId = await mkEmpresaFiscal(companyBId);
  });

  test.afterAll(async () => {
    // Ordem: filhas -> profiles -> companies -> auth users. Robusto mesmo se
    // algum teste falhar no meio (cada delete é condicional ao id existir).
    if (clienteAId) await admin.from('clientes').delete().eq('id', clienteAId);
    if (clienteBId) await admin.from('clientes').delete().eq('id', clienteBId);
    if (notaAId) await admin.from('notas_fiscais').delete().eq('id', notaAId);
    if (notaBId) await admin.from('notas_fiscais').delete().eq('id', notaBId);
    if (guiaAId) await admin.from('guias_fiscais').delete().eq('id', guiaAId);
    if (guiaBId) await admin.from('guias_fiscais').delete().eq('id', guiaBId);
    if (empresaFiscalAId) await admin.from('empresas_fiscais').delete().eq('id', empresaFiscalAId);
    if (empresaFiscalBId) await admin.from('empresas_fiscais').delete().eq('id', empresaFiscalBId);
    if (aId) await admin.from('profiles').delete().eq('user_id', aId);
    if (bId) await admin.from('profiles').delete().eq('user_id', bId);
    if (companyAId) await admin.from('companies').delete().eq('id', companyAId);
    if (companyBId) await admin.from('companies').delete().eq('id', companyBId);
    for (const uid of [aId, bId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  test('B não lê a company de A', async () => {
    const b = await signIn(bEmail);
    const { data, error } = await b.from('companies').select('id').eq('id', companyAId);
    expect(error, `select companies (B) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'LEAK: B enxergou a company de A').toHaveLength(0);
  });

  test('B não lê o cliente de A', async () => {
    const b = await signIn(bEmail);
    const { data, error } = await b.from('clientes').select('id').eq('id', clienteAId);
    expect(error, `select clientes (B) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'LEAK: B enxergou o cliente de A').toHaveLength(0);

    // também por company_id, cobrindo consultas que filtram pela empresa em vez do id
    const { data: byCompany, error: byCompanyErr } = await b.from('clientes').select('id').eq('company_id', companyAId);
    expect(byCompanyErr, `select clientes por company_id (B) falhou: ${byCompanyErr?.message}`).toBeNull();
    expect(byCompany ?? [], 'LEAK: B enxergou clientes da company de A via company_id').toHaveLength(0);
  });

  test('B não lê a nota fiscal de A', async () => {
    const b = await signIn(bEmail);
    const { data, error } = await b.from('notas_fiscais').select('id').eq('id', notaAId);
    expect(error, `select notas_fiscais (B) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'LEAK: B enxergou a nota fiscal de A').toHaveLength(0);

    const { data: byCompany, error: byCompanyErr } = await b.from('notas_fiscais').select('id').eq('company_id', companyAId);
    expect(byCompanyErr, `select notas_fiscais por company_id (B) falhou: ${byCompanyErr?.message}`).toBeNull();
    expect(byCompany ?? [], 'LEAK: B enxergou notas fiscais da company de A via company_id').toHaveLength(0);
  });

  test('B não lê a guia fiscal de A', async () => {
    const b = await signIn(bEmail);
    const { data, error } = await b.from('guias_fiscais').select('id').eq('id', guiaAId);
    expect(error, `select guias_fiscais (B) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'LEAK: B enxergou a guia fiscal de A').toHaveLength(0);

    const { data: byCompany, error: byCompanyErr } = await b.from('guias_fiscais').select('id').eq('company_id', companyAId);
    expect(byCompanyErr, `select guias_fiscais por company_id (B) falhou: ${byCompanyErr?.message}`).toBeNull();
    expect(byCompany ?? [], 'LEAK: B enxergou guias fiscais da company de A via company_id').toHaveLength(0);
  });

  test('B não lê a empresa fiscal de A', async () => {
    const b = await signIn(bEmail);
    const { data, error } = await b.from('empresas_fiscais').select('id').eq('id', empresaFiscalAId);
    expect(error, `select empresas_fiscais (B) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'LEAK: B enxergou a empresa_fiscal de A').toHaveLength(0);

    const { data: byEmpresa, error: byEmpresaErr } = await b.from('empresas_fiscais').select('id').eq('empresa_id', companyAId);
    expect(byEmpresaErr, `select empresas_fiscais por empresa_id (B) falhou: ${byEmpresaErr?.message}`).toBeNull();
    expect(byEmpresa ?? [], 'LEAK: B enxergou empresas_fiscais da company de A via empresa_id').toHaveLength(0);
  });

  test('controle positivo: B lê os próprios dados em todas as tabelas', async () => {
    // Garante que os testes acima não passam "por acidente" (ex.: RLS bloqueando tudo,
    // inclusive os próprios dados de B, o que faria os asserts de isolamento passarem
    // sem provar nada). B precisa enxergar exatamente a própria linha em cada tabela.
    const b = await signIn(bEmail);

    const { data: ownCompany, error: ownCompanyErr } = await b.from('companies').select('id').eq('id', companyBId);
    expect(ownCompanyErr, `select companies (B, próprio) falhou: ${ownCompanyErr?.message}`).toBeNull();
    expect(ownCompany ?? [], 'B deveria enxergar a própria company').toHaveLength(1);

    const { data: ownCliente, error: ownClienteErr } = await b.from('clientes').select('id').eq('id', clienteBId);
    expect(ownClienteErr, `select clientes (B, próprio) falhou: ${ownClienteErr?.message}`).toBeNull();
    expect(ownCliente ?? [], 'B deveria enxergar o próprio cliente').toHaveLength(1);

    const { data: ownNota, error: ownNotaErr } = await b.from('notas_fiscais').select('id').eq('id', notaBId);
    expect(ownNotaErr, `select notas_fiscais (B, próprio) falhou: ${ownNotaErr?.message}`).toBeNull();
    expect(ownNota ?? [], 'B deveria enxergar a própria nota fiscal').toHaveLength(1);

    const { data: ownGuia, error: ownGuiaErr } = await b.from('guias_fiscais').select('id').eq('id', guiaBId);
    expect(ownGuiaErr, `select guias_fiscais (B, próprio) falhou: ${ownGuiaErr?.message}`).toBeNull();
    expect(ownGuia ?? [], 'B deveria enxergar a própria guia fiscal').toHaveLength(1);

    const { data: ownEmpresaFiscal, error: ownEmpresaFiscalErr } = await b.from('empresas_fiscais').select('id').eq('id', empresaFiscalBId);
    expect(ownEmpresaFiscalErr, `select empresas_fiscais (B, próprio) falhou: ${ownEmpresaFiscalErr?.message}`).toBeNull();
    expect(ownEmpresaFiscal ?? [], 'B deveria enxergar a própria empresa_fiscal').toHaveLength(1);
  });

  // Nota estrutural: uma verificação direta de pg_class/pg_policy (RLS habilitada +
  // políticas presentes por tabela) exigiria SQL bruto contra information_schema/
  // pg_catalog, que o PostgREST não expõe via client (sem RPC dedicada para isso).
  // Essa checagem estrutural é feita fora de banda pelo controller/DBA (migrations +
  // `docs/reference/rls-test-results-2026-05-29.md`); este arquivo cobre o
  // comportamento observável (queries reais como tenant B) para as tabelas acima.
});
