// E2E do ciclo de assinatura contra o SANDBOX do Asaas + o banco real.
//
// E o unico teste que exercita `criarAssinaturaNoAsaas` de ponta a ponta:
// ate aqui esse caminho nunca tinha falado com o Asaas.
//
// Pula sem as env (banco E sandbox). Rodar com:
//   export NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//          TOKEN_ASAAS_SANDBOX=...
//   npx vitest run src/lib/billing/asaas.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = process.env.TOKEN_ASAAS_SANDBOX;
const temTudo = Boolean(URL && KEY && TOKEN);

let sb: SupabaseClient;
let assinaturaId = '';
let subscriptionId = '';
/** Estado completo da linha antes do teste, para devolver no afterAll. */
let original: Record<string, unknown> | null = null;

describe.skipIf(!temTudo)('ciclo de assinatura (sandbox Asaas + banco real)', () => {
  beforeAll(async () => {
    // O cliente Asaas lê ASAAS_ENV; garantir sandbox mesmo que o ambiente
    // do shell traga outra coisa. NUNCA deixar este teste tocar produção.
    process.env.ASAAS_ENV = 'sandbox';
    sb = createClient(URL!, KEY!, { auth: { persistSession: false } });

    const { data } = await sb.from('assinaturas')
      .select('id, status, plano_id, trial_termina_em, proxima_cobranca_em, asaas_customer_id, asaas_subscription_id')
      .not('company_id', 'is', null).limit(1).maybeSingle();
    if (!data) return;
    assinaturaId = data.id;
    original = { ...data };
    delete (original as { id?: unknown }).id;
  });

  afterAll(async () => {
    // 1) Cancela a assinatura criada no sandbox — nao deixar objeto vivo la.
    if (subscriptionId) {
      try {
        const { asaas } = await import('@/lib/clients/asaas');
        await asaas.cancelarAssinatura(subscriptionId);
      } catch (e) {
        console.warn('[e2e] falha ao cancelar no sandbox:', e);
      }
    }

    // 2) Remove tambem o CLIENTE criado no sandbox. Cancelar a assinatura
    //    nao apaga o customer, e cada rodada do teste criava um novo (em
    //    producao isso nao acontece: `criarAssinaturaNoAsaas` reusa o
    //    asaas_customer_id ja gravado). Fetch cru de proposito — remover
    //    cliente e necessidade de teste, nao do produto, e nao merece
    //    superficie no cliente de producao.
    const { data: linha } = await sb.from('assinaturas')
      .select('asaas_customer_id').eq('id', assinaturaId).maybeSingle();
    const customerId = linha?.asaas_customer_id as string | null;
    if (customerId && TOKEN) {
      try {
        await fetch(`https://api-sandbox.asaas.com/v3/customers/${customerId}`, {
          method: 'DELETE', headers: { access_token: TOKEN },
        });
      } catch (e) {
        console.warn('[e2e] falha ao remover cliente do sandbox:', e);
      }
    }

    // 3) Devolve a linha do banco EXATAMENTE como estava.
    if (assinaturaId && original) {
      await sb.from('assinaturas').update(original).eq('id', assinaturaId);
    }
  });

  it('achou uma assinatura de empresa para usar', () => {
    expect(assinaturaId).not.toBe('');
  });

  it('cria cliente e assinatura no Asaas e grava os ids', async () => {
    const { criarAssinaturaNoAsaas, primeiroVencimento } = await import('./assinar');

    const r = await criarAssinaturaNoAsaas(
      {
        assinaturaId,
        nome: 'BALU E2E LTDA',
        cpfCnpj: '61061690000183',       // CNPJ real da PIPER, formato válido
        email: 'e2e@balu.test',
        asaasCustomerId: null,
        trialTerminaEm: null,            // simula teste JÁ vencido
      },
      { id: 'empresario_mensal', nome: 'E2E', valor_centavos: 4990, ciclo: 'MONTHLY' },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    subscriptionId = r.subscriptionId;
    expect(subscriptionId).toMatch(/^sub_/);

    const { data } = await sb.from('assinaturas')
      .select('plano_id, asaas_subscription_id, asaas_customer_id, trial_termina_em, proxima_cobranca_em')
      .eq('id', assinaturaId).maybeSingle();

    expect(data?.plano_id).toBe('empresario_mensal');
    expect(data?.asaas_subscription_id).toBe(subscriptionId);
    expect(data?.asaas_customer_id).toMatch(/^cus_/);
    // O bug do systematic-debugging: contratar com o teste vencido tem de
    // liberar o acesso ate o primeiro vencimento, senao o titular clica
    // "Assinar" e continua barrado.
    expect(data?.trial_termina_em).toBe(primeiroVencimento());
    expect(data?.proxima_cobranca_em).toBe(primeiroVencimento());
  }, 30_000);

  it('a assinatura existe no Asaas com o valor certo', async () => {
    expect(subscriptionId).not.toBe('');
    const { asaas } = await import('@/lib/clients/asaas');
    const remota = await asaas.consultarAssinatura(subscriptionId);
    expect(remota.id).toBe(subscriptionId);
    expect(remota.value).toBe(49.9);
    expect(remota.cycle).toBe('MONTHLY');
  }, 30_000);

  it('o Asaas ja gerou a primeira cobranca, e ela alimenta a reconciliacao', async () => {
    const { asaas } = await import('@/lib/clients/asaas');
    const { data: cobrancas } = await asaas.listarCobrancas(subscriptionId);
    expect(Array.isArray(cobrancas)).toBe(true);
    expect(cobrancas.length).toBeGreaterThan(0);
    // E o formato que `rodarBilling` consome para decidir ativa/inadimplente.
    expect(cobrancas[0]).toHaveProperty('status');
    expect(cobrancas[0]).toHaveProperty('dueDate');
  }, 30_000);

  it('o payload real do Asaas atravessa traduzirEvento e persiste', async () => {
    const { asaas } = await import('@/lib/clients/asaas');
    const { traduzirEvento } = await import('./eventos');
    const { persistirCobranca } = await import('./cobranca');

    const { data: cobrancas } = await asaas.listarCobrancas(subscriptionId);
    const c = cobrancas[0];

    // Monta o webhook como o Asaas manda, a partir do objeto REAL dele.
    const efeito = traduzirEvento({ event: 'PAYMENT_CREATED', payment: c });
    expect(efeito.tipo).toBe('cobranca_criada');
    if (efeito.tipo === 'ignorado') return;

    expect(efeito.chargeId).toBe(c.id);
    expect(efeito.subscriptionId).toBe(subscriptionId);

    const r = await persistirCobranca(sb, assinaturaId, efeito, c);
    expect(r).toEqual({ ok: true, acao: 'inserida' });

    const { data: linha } = await sb.from('cobrancas')
      .select('valor_centavos, vencimento, status').eq('asaas_charge_id', c.id).maybeSingle();
    expect(linha?.valor_centavos).toBe(4990);
    expect(linha?.vencimento).toBe(c.dueDate);

    await sb.from('cobrancas').delete().eq('asaas_charge_id', c.id);
  }, 30_000);

  it('cancelar no Asaas funciona (e o cancelamento da tela depende disso)', async () => {
    const { asaas } = await import('@/lib/clients/asaas');
    const r = await asaas.cancelarAssinatura(subscriptionId);
    expect(r.deleted).toBe(true);
    subscriptionId = '';   // ja cancelada; afterAll nao repete
  }, 30_000);
});
