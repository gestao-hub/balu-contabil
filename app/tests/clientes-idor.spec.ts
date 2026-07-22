import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Bloco E — Task 8: gate anti-IDOR em clientes.
// Prova que updateClienteAction/softDeleteClienteAction (escopadas por
// owner_user_id) não deixam um usuário alterar clientes de outro dono, e que
// a RLS (user_owns_company) barra o mesmo ataque mesmo sem o filtro extra.
// As actions em si não são chamáveis fora do Next — este teste bate direto
// nas mutações Supabase que elas executam, como os atores reais (anon key +
// signInWithPassword), igual ao rls-contador.spec.ts.
// Não hermético. Rodar: set -a; . ./.env.local; set +a; npx playwright test tests/clientes-idor.spec.ts --reporter=line

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STAMP = Date.now();
const PASS = 'senha-teste-idor-123';

function mkClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const c = mkClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  expect(error, `login ${email} falhou: ${error?.message}`).toBeNull();
  return c;
}

test.describe('Anti-IDOR: clientes (Bloco E — Task 8)', () => {
  test.describe.configure({ mode: 'serial' });

  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  let aId: string, bId: string; // auth users
  let companyAId: string, companyBId: string;
  let clienteId: string; // cliente de A

  const aEmail = `idor-a-${STAMP}@balu-test.local`;
  const bEmail = `idor-b-${STAMP}@balu-test.local`;
  const document = `${STAMP}`.slice(0, 14);

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
    companyAId = await mkCompany(aId, `Empresa A IDOR ${STAMP}`);
    companyBId = await mkCompany(bId, `Empresa B IDOR ${STAMP}`);

    const mkProfile = async (userId: string, companyId: string) => {
      const { error } = await admin.from('profiles')
        .insert({ user_id: userId, company_id: companyId, current_company: companyId });
      expect(error, `insert profile de ${userId} falhou: ${error?.message}`).toBeNull();
    };
    await mkProfile(aId, companyAId);
    await mkProfile(bId, companyBId);

    const { data: clienteData, error: clienteErr } = await admin.from('clientes')
      .insert({
        owner_user_id: aId,
        company_id: companyAId,
        person_type: 'PJ',
        razao_social: `Cliente original de A ${STAMP}`,
        document,
        status: 'active',
      })
      .select('id').single();
    expect(clienteErr, `insert cliente de A falhou: ${clienteErr?.message}`).toBeNull();
    clienteId = clienteData!.id;
  });

  test.afterAll(async () => {
    // Ordem: cliente -> profiles -> companies -> auth users.
    if (clienteId) await admin.from('clientes').delete().eq('id', clienteId);
    if (aId) await admin.from('profiles').delete().eq('user_id', aId);
    if (bId) await admin.from('profiles').delete().eq('user_id', bId);
    if (companyAId) await admin.from('companies').delete().eq('id', companyAId);
    if (companyBId) await admin.from('companies').delete().eq('id', companyBId);
    for (const uid of [aId, bId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  test('outro dono NÃO edita', async () => {
    const b = await signIn(bEmail);

    // Escopado por owner_user_id (o que a action faz agora) — 0 linhas afetadas.
    const { data: scopedData, error: scopedErr } = await b
      .from('clientes')
      .update({ razao_social: 'HACKED' })
      .eq('id', clienteId)
      .eq('owner_user_id', bId)
      .select('id');
    expect(scopedErr, `update escopado (B) falhou com erro inesperado: ${scopedErr?.message}`).toBeNull();
    expect(scopedData ?? [], 'update escopado por owner_user_id de B afetou linha do cliente de A').toHaveLength(0);

    const { data: afterScoped } = await admin.from('clientes').select('razao_social').eq('id', clienteId).single();
    expect(
      afterScoped?.razao_social,
      'LEAK: razao_social do cliente de A mudou após update escopado (por owner_user_id) de B',
    ).not.toBe('HACKED');

    // Sem o filtro de owner (o que a RLS sozinha precisa barrar).
    const { data: unscopedData, error: unscopedErr } = await b
      .from('clientes')
      .update({ razao_social: 'HACKED' })
      .eq('id', clienteId)
      .select('id');
    expect(unscopedData ?? [], 'RLS deixou update SEM escopo de B afetar cliente de A').toHaveLength(0);

    const { data: afterUnscoped } = await admin.from('clientes').select('razao_social').eq('id', clienteId).single();
    expect(
      afterUnscoped?.razao_social,
      `LEAK: RLS deixou B alterar razao_social do cliente de A. Erro retornado: ${unscopedErr?.message ?? '(nenhum)'}`,
    ).not.toBe('HACKED');
  });

  test('outro dono NÃO soft-deleta', async () => {
    const b = await signIn(bEmail);

    const { data: scopedData, error: scopedErr } = await b
      .from('clientes')
      .update({ status: 'inactive', deleted_at: new Date().toISOString() })
      .eq('id', clienteId)
      .eq('owner_user_id', bId)
      .select('id');
    expect(scopedErr, `soft-delete escopado (B) falhou com erro inesperado: ${scopedErr?.message}`).toBeNull();
    expect(scopedData ?? [], 'soft-delete escopado por owner_user_id de B afetou linha do cliente de A').toHaveLength(0);

    const { data: afterScoped } = await admin.from('clientes').select('deleted_at').eq('id', clienteId).single();
    expect(
      afterScoped?.deleted_at,
      'LEAK: deleted_at do cliente de A foi setado após soft-delete escopado (por owner_user_id) de B',
    ).toBeNull();

    // Sem o filtro de owner (o que a RLS sozinha precisa barrar).
    const { data: unscopedData, error: unscopedErr } = await b
      .from('clientes')
      .update({ status: 'inactive', deleted_at: new Date().toISOString() })
      .eq('id', clienteId)
      .select('id');
    expect(unscopedData ?? [], 'RLS deixou soft-delete SEM escopo de B afetar cliente de A').toHaveLength(0);

    const { data: afterUnscoped } = await admin.from('clientes').select('deleted_at').eq('id', clienteId).single();
    expect(
      afterUnscoped?.deleted_at,
      `LEAK: RLS deixou B soft-deletar o cliente de A. Erro retornado: ${unscopedErr?.message ?? '(nenhum)'}`,
    ).toBeNull();
  });

  test('o dono edita o próprio', async () => {
    const a = await signIn(aEmail);

    const { data, error } = await a
      .from('clientes')
      .update({ razao_social: 'Editado pelo dono A' })
      .eq('id', clienteId)
      .eq('owner_user_id', aId)
      .select('id');
    expect(error, `update escopado (A, dono) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'update escopado do próprio dono deveria afetar exatamente 1 linha').toHaveLength(1);

    const { data: after } = await admin.from('clientes').select('razao_social').eq('id', clienteId).single();
    expect(after?.razao_social, 'razao_social não refletiu a edição do próprio dono').toBe('Editado pelo dono A');
  });
});
