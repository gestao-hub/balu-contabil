import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Gate de segurança do Bloco A: matriz de isolamento RLS da fronteira do contador.
// Bate no Supabase real (mesmo projeto do rls-isolation.spec.ts) — cria/apaga
// contadores, empresários, contabilidades, companies e linhas filhas descartáveis
// via admin (service_role), e testa cada ator com a anon key + signInWithPassword.
// Não hermético. Rodar: set -a; . ./.env.local; set +a; npx playwright test rls-contador --reporter=line

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STAMP = Date.now();
const PASS = 'senha-teste-rls-123';

function mkClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const c = mkClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  expect(error, `login ${email} falhou: ${error?.message}`).toBeNull();
  return c;
}

test.describe('RLS: fronteira do contador (Bloco A)', () => {
  test.describe.configure({ mode: 'serial' });

  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // ids preenchidos no beforeAll
  let c1Id: string, c2Id: string, c3Id: string; // contadores (auth users)
  let e1Id: string, e2Id: string; // empresários (auth users)
  let ct1Id: string, ct2Id: string, ct3Id: string; // contabilidades
  let xId: string, yId: string; // companies
  let clienteId: string, notaId: string, guiaId: string, declaracaoId: string;
  let empresaFiscalId: string, arquivoAuxId: string, honorarioId: string;
  let conviteMembroTokenId: string; // id da linha de convite (caso 8)

  const c1Email = `rls-c1-${STAMP}@balu-test.local`;
  const c2Email = `rls-c2-${STAMP}@balu-test.local`;
  const c3Email = `rls-c3-${STAMP}@balu-test.local`;
  const e1Email = `rls-e1-${STAMP}@balu-test.local`;
  const e2Email = `rls-e2-${STAMP}@balu-test.local`;
  const c4Email = `rls-c4-convite-${STAMP}@balu-test.local`; // usuário do caso 8 (aceita convite)
  let c4Id: string;

  test.beforeAll(async () => {
    // --- usuários ---
    const mk = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PASS, email_confirm: true,
      });
      expect(error, `createUser ${email} falhou: ${error?.message}`).toBeNull();
      return data.user!.id;
    };
    c1Id = await mk(c1Email);
    c2Id = await mk(c2Email);
    c3Id = await mk(c3Email);
    e1Id = await mk(e1Email);
    e2Id = await mk(e2Email);
    c4Id = await mk(c4Email);

    // --- contabilidades ---
    const mkContabilidade = async (nome: string, crc: string, status: string) => {
      const { data, error } = await admin.from('contabilidades')
        .insert({ nome, crc, crc_uf: 'SP', status })
        .select('id').single();
      expect(error, `insert contabilidade ${nome} falhou: ${error?.message}`).toBeNull();
      return data!.id as string;
    };
    ct1Id = await mkContabilidade(`CT1 Teste ${STAMP}`, `CRC1${STAMP}`, 'aprovada');
    ct2Id = await mkContabilidade(`CT2 Teste ${STAMP}`, `CRC2${STAMP}`, 'aprovada');
    ct3Id = await mkContabilidade(`CT3 Teste ${STAMP}`, `CRC3${STAMP}`, 'pendente');

    // --- membros ---
    const mkMembro = async (contabilidade_id: string, user_id: string) => {
      const { error } = await admin.from('contabilidade_membros').insert({ contabilidade_id, user_id });
      expect(error, `insert membro falhou: ${error?.message}`).toBeNull();
    };
    await mkMembro(ct1Id, c1Id);
    await mkMembro(ct2Id, c2Id);
    await mkMembro(ct3Id, c3Id);

    // --- companies ---
    const { data: xData, error: xErr } = await admin.from('companies')
      .insert({ user_id: e1Id, nome: `Empresa X ${STAMP}`, contabilidade_id: ct1Id })
      .select('id').single();
    expect(xErr, `insert company X falhou: ${xErr?.message}`).toBeNull();
    xId = xData!.id;

    const { data: yData, error: yErr } = await admin.from('companies')
      .insert({ user_id: e2Id, nome: `Empresa Y ${STAMP}`, contabilidade_id: null })
      .select('id').single();
    expect(yErr, `insert company Y falhou: ${yErr?.message}`).toBeNull();
    yId = yData!.id;

    // --- filhas de X ---
    const { data: clienteData, error: clienteErr } = await admin.from('clientes')
      .insert({ company_id: xId, razao_social: 'Cliente de X' })
      .select('id').single();
    expect(clienteErr, `insert cliente falhou: ${clienteErr?.message}`).toBeNull();
    clienteId = clienteData!.id;

    const { data: notaData, error: notaErr } = await admin.from('notas_fiscais')
      .insert({
        company_id: xId, tipo_documento: 'NFe', referencia: `ref-${STAMP}`,
        data_emissao: new Date().toISOString(), status: 'ativa',
        valor_total: 100, payload_focusnfe: {},
      })
      .select('id').single();
    expect(notaErr, `insert nota_fiscal falhou: ${notaErr?.message}`).toBeNull();
    notaId = notaData!.id;

    const { data: guiaData, error: guiaErr } = await admin.from('guias_fiscais')
      .insert({ company_id: xId, competencia_mes: 1, competencia_ano: 2026 })
      .select('id').single();
    expect(guiaErr, `insert guia_fiscal falhou: ${guiaErr?.message}`).toBeNull();
    guiaId = guiaData!.id;

    const { data: declData, error: declErr } = await admin.from('declaracoes_fiscais')
      .insert({ company_id: xId, owner_user_id: e1Id, competencia_referencia: '2026-01' })
      .select('id').single();
    expect(declErr, `insert declaracao_fiscal falhou: ${declErr?.message}`).toBeNull();
    declaracaoId = declData!.id;

    const { data: efData, error: efErr } = await admin.from('empresas_fiscais')
      .insert({ empresa_id: xId })
      .select('id').single();
    expect(efErr, `insert empresa_fiscal falhou: ${efErr?.message}`).toBeNull();
    empresaFiscalId = efData!.id;

    const { data: aaData, error: aaErr } = await admin.from('arquivos_auxiliares')
      .insert({ company_id: xId })
      .select('id').single();
    expect(aaErr, `insert arquivo_auxiliar falhou: ${aaErr?.message}`).toBeNull();
    arquivoAuxId = aaData!.id;

    const { data: honData, error: honErr } = await admin.from('honorarios')
      .insert({
        contabilidade_id: ct1Id, empresa_cliente_id: xId, company_id: xId,
        mes_referencia: '2026-07-01', valor: 250, data_vencimento: '2026-08-10',
        status: 'pendente',
      })
      .select('id').single();
    expect(honErr, `insert honorario falhou: ${honErr?.message}`).toBeNull();
    honorarioId = honData!.id;
  });

  test.afterAll(async () => {
    // Ordem: filhas -> honorarios -> convites -> membros -> contabilidades -> companies -> auth users.
    if (clienteId) await admin.from('clientes').delete().eq('id', clienteId);
    if (notaId) await admin.from('notas_fiscais').delete().eq('id', notaId);
    if (guiaId) await admin.from('guias_fiscais').delete().eq('id', guiaId);
    if (declaracaoId) await admin.from('declaracoes_fiscais').delete().eq('id', declaracaoId);
    if (empresaFiscalId) await admin.from('empresas_fiscais').delete().eq('id', empresaFiscalId);
    if (arquivoAuxId) await admin.from('arquivos_auxiliares').delete().eq('id', arquivoAuxId);
    if (honorarioId) await admin.from('honorarios').delete().eq('id', honorarioId);
    if (ct1Id) await admin.from('convites').delete().eq('contabilidade_id', ct1Id);
    if (c1Id) await admin.from('contabilidade_membros').delete().eq('user_id', c1Id);
    if (c2Id) await admin.from('contabilidade_membros').delete().eq('user_id', c2Id);
    if (c3Id) await admin.from('contabilidade_membros').delete().eq('user_id', c3Id);
    if (c4Id) await admin.from('contabilidade_membros').delete().eq('user_id', c4Id);
    if (ct1Id) await admin.from('contabilidades').delete().eq('id', ct1Id);
    if (ct2Id) await admin.from('contabilidades').delete().eq('id', ct2Id);
    if (ct3Id) await admin.from('contabilidades').delete().eq('id', ct3Id);
    if (xId) await admin.from('companies').delete().eq('id', xId);
    if (yId) await admin.from('companies').delete().eq('id', yId);
    for (const uid of [c1Id, c2Id, c3Id, c4Id, e1Id, e2Id]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  test('contador lê cliente vinculado', async () => {
    const c1 = await signIn(c1Email);
    const { data: companies, error } = await c1.from('companies').select('id').eq('id', xId);
    expect(error, `select companies falhou: ${error?.message}`).toBeNull();
    expect(companies ?? [], 'C1 não enxergou a company X vinculada').toHaveLength(1);

    const { data: painel, error: painelErr } = await c1.rpc('painel_contador');
    expect(painelErr, `painel_contador falhou: ${painelErr?.message}`).toBeNull();
    expect(painel ?? [], 'painel_contador de C1 deveria ter exatamente 1 linha (X)').toHaveLength(1);
    expect((painel ?? [])[0]?.company_id).toBe(xId);
  });

  test('contador NÃO lê empresa solta', async () => {
    const c1 = await signIn(c1Email);
    const { data, error } = await c1.from('companies').select('id').eq('id', yId);
    expect(error, `select companies (Y) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'C1 enxergou a empresa solta Y (sem contabilidade_id)').toHaveLength(0);
  });

  test('contador NÃO lê cliente de outro escritório', async () => {
    const c2 = await signIn(c2Email);
    const { data, error } = await c2.from('companies').select('id').eq('id', xId);
    expect(error, `select companies (X via C2) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'C2 (CT2) enxergou a company X, que é de CT1').toHaveLength(0);

    const { data: painel, error: painelErr } = await c2.rpc('painel_contador');
    expect(painelErr, `painel_contador (C2) falhou: ${painelErr?.message}`).toBeNull();
    expect(painel ?? [], 'painel_contador de C2 deveria ser vazio').toHaveLength(0);
  });

  test('contador NÃO escreve nos dados do cliente', async () => {
    const c1 = await signIn(c1Email);

    // snapshot "antes" via admin, para comparar depois independentemente do
    // shape do erro retornado pelo PostgREST em violação de RLS.
    const { data: companyBefore } = await admin.from('companies').select('nome').eq('id', xId).single();
    const { data: guiaBefore } = await admin.from('guias_fiscais').select('status').eq('id', guiaId).single();
    const { count: clientesBefore } = await admin.from('clientes')
      .select('id', { count: 'exact', head: true }).eq('company_id', xId);

    // update companies X (nome)
    const { error: updCompanyErr } = await c1.from('companies')
      .update({ nome: 'HACKED-BY-CONTADOR' }).eq('id', xId);
    // insert notas_fiscais para X
    const { error: insNotaErr } = await c1.from('notas_fiscais').insert({
      company_id: xId, tipo_documento: 'NFe', referencia: `intruso-${STAMP}`,
      data_emissao: new Date().toISOString(), status: 'ativa',
      valor_total: 1, payload_focusnfe: {},
    });
    // update guias_fiscais de X
    const { error: updGuiaErr } = await c1.from('guias_fiscais')
      .update({ status: 'pago' }).eq('id', guiaId);
    // delete clientes de X
    const { error: delClienteErr } = await c1.from('clientes').delete().eq('company_id', xId);

    // Re-leitura via admin: nada pode ter mudado, com ou sem erro explícito do PostgREST.
    const { data: companyAfter } = await admin.from('companies').select('nome').eq('id', xId).single();
    const { data: guiaAfter } = await admin.from('guias_fiscais').select('status').eq('id', guiaId).single();
    const { count: clientesAfter } = await admin.from('clientes')
      .select('id', { count: 'exact', head: true }).eq('company_id', xId);
    const { data: notaLeaked } = await admin.from('notas_fiscais')
      .select('id').eq('company_id', xId).eq('referencia', `intruso-${STAMP}`);

    expect(
      companyAfter?.nome === companyBefore?.nome,
      `LEAK: contador conseguiu alterar companies.nome de X (era "${companyBefore?.nome}", virou "${companyAfter?.nome}"). Erro retornado: ${updCompanyErr?.message ?? '(nenhum)'}`,
    ).toBeTruthy();
    expect(
      guiaAfter?.status === guiaBefore?.status,
      `LEAK: contador conseguiu alterar guias_fiscais.status de X (era "${guiaBefore?.status}", virou "${guiaAfter?.status}"). Erro retornado: ${updGuiaErr?.message ?? '(nenhum)'}`,
    ).toBeTruthy();
    expect(
      clientesAfter,
      `LEAK: contador conseguiu deletar clientes de X (antes ${clientesBefore}, depois ${clientesAfter}). Erro retornado: ${delClienteErr?.message ?? '(nenhum)'}`,
    ).toBe(clientesBefore);
    expect(
      notaLeaked ?? [],
      `LEAK: contador conseguiu inserir nota_fiscal em X. Erro retornado: ${insNotaErr?.message ?? '(nenhum)'}`,
    ).toHaveLength(0);
  });

  test('membro de contabilidade pendente NÃO lê', async () => {
    const c3 = await signIn(c3Email);
    const { data, error } = await c3.from('companies').select('id');
    expect(error, `select companies (C3) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'C3 (contabilidade pendente) enxergou companies').toHaveLength(0);

    const { data: painel, error: painelErr } = await c3.rpc('painel_contador');
    expect(painelErr, `painel_contador (C3) falhou: ${painelErr?.message}`).toBeNull();
    expect(painel ?? [], 'painel_contador de C3 (pendente) deveria ser vazio').toHaveLength(0);
  });

  test('empresário NÃO lê contabilidades alheias', async () => {
    const e2 = await signIn(e2Email);
    const { data, error } = await e2.from('contabilidades').select('id');
    expect(error, `select contabilidades (E2) falhou: ${error?.message}`).toBeNull();
    expect(data ?? [], 'E2 (sem contabilidade) enxergou linhas em contabilidades').toHaveLength(0);
  });

  test('empresário lê honorários da própria empresa e NÃO os de outros', async () => {
    const e1 = await signIn(e1Email);
    const { data: e1Data, error: e1Err } = await e1.from('honorarios').select('id').eq('id', honorarioId);
    expect(e1Err, `select honorarios (E1) falhou: ${e1Err?.message}`).toBeNull();
    expect(e1Data ?? [], 'E1 deveria enxergar o honorário da própria empresa (X)').toHaveLength(1);

    const e2 = await signIn(e2Email);
    const { data: e2Data, error: e2Err } = await e2.from('honorarios').select('id').eq('id', honorarioId);
    expect(e2Err, `select honorarios (E2) falhou: ${e2Err?.message}`).toBeNull();
    expect(e2Data ?? [], 'E2 (dono de Y) vazou o honorário de X').toHaveLength(0);
  });

  test('aceitar_convite é idempotente e nega token inválido', async () => {
    const c4 = await signIn(c4Email);

    const { data: badData, error: badErr } = await c4.rpc('aceitar_convite', {
      p_token: 'token-fake-inexistente',
    });
    expect(badData ?? null, 'aceitar_convite com token inválido deveria falhar, não retornar dado').toBeNull();
    expect(badErr, 'aceitar_convite com token inválido deveria retornar erro').not.toBeNull();
    expect(badErr?.message ?? '').toContain('CONVITE_INVALIDO');

    // convite tipo 'membro' para CT1, criado via admin
    const token = `convite-membro-${STAMP}`;
    const { data: conviteData, error: conviteErr } = await admin.from('convites')
      .insert({ contabilidade_id: ct1Id, tipo: 'membro', token })
      .select('id').single();
    expect(conviteErr, `insert convite falhou: ${conviteErr?.message}`).toBeNull();
    conviteMembroTokenId = conviteData!.id;

    const { data: first, error: firstErr } = await c4.rpc('aceitar_convite', { p_token: token });
    expect(firstErr, `1ª aceitação falhou: ${firstErr?.message}`).toBeNull();
    expect(first).toBe(ct1Id);

    const { data: second, error: secondErr } = await c4.rpc('aceitar_convite', { p_token: token });
    expect(secondErr, `2ª aceitação (idempotente) falhou: ${secondErr?.message}`).toBeNull();
    expect(second).toBe(ct1Id);

    const { data: membros, error: membrosErr } = await admin.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', ct1Id).eq('user_id', c4Id);
    expect(membrosErr, `re-leitura de membros falhou: ${membrosErr?.message}`).toBeNull();
    expect(membros ?? [], 'C4 deveria ter exatamente 1 linha de membro em CT1 (idempotência)').toHaveLength(1);
  });
});
