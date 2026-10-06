/**
 * KYC de uma subconta no Asaas — SÓ LEITURA.
 *
 * Mostra os quatro eixos de `GET /v3/myAccount/status` e o que
 * `GET /v3/myAccount/documents` diz que ainda falta enviar. Usa a apiKey DA
 * SUBCONTA (decifrada aqui, nunca impressa). Não escreve nada em lugar nenhum.
 *
 *   cd app
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json --env-file=.env.local \
 *     scripts/_status-subconta-kyc.ts <contabilidade_id>
 */
import { createClient } from '@supabase/supabase-js';
import { lerCredencial } from '@/lib/billing/credencial-subconta';

// A subconta nasceu em produção (ASAAS_ENV=prod na Vercel); o .env.local não
// tem a variável e cairia no sandbox, onde a chave dá 401.
const BASE = 'https://api.asaas.com';

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('uso: _status-subconta-kyc.ts <contabilidade_id>');

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.from('contabilidades')
    .select('nome, asaas_subconta_status, asaas_api_key_cifrada').eq('id', id).single();
  if (error || !data) throw new Error(`contabilidade não lida: ${error?.message}`);
  console.log(`Escritório: ${data.nome} · status no banco: ${data.asaas_subconta_status}`);

  const token = lerCredencial(data.asaas_api_key_cifrada as string | null);
  if (!token) throw new Error('subconta sem credencial guardada');

  const get = async (rota: string) => {
    const r = await fetch(`${BASE}${rota}`, { headers: { access_token: token, 'User-Agent': 'balu-kyc-leitura' } });
    const corpo = await r.json().catch(() => null);
    return { http: r.status, corpo };
  };

  const st = await get('/v3/myAccount/status');
  console.log(`\n/v3/myAccount/status → HTTP ${st.http}`);
  console.log(JSON.stringify(st.corpo, null, 1));

  const docs = await get('/v3/myAccount/documents');
  console.log(`\n/v3/myAccount/documents → HTTP ${docs.http}`);
  // Só o que importa para saber o que falta: tipo, status e motivo. O link de
  // envio (onboardingUrl) é do próprio titular — mostrado só se existe.
  const lista = (docs.corpo?.data ?? []) as Array<Record<string, unknown>>;
  for (const d of lista) {
    console.log(JSON.stringify({
      tipo: d.type, titulo: d.title, status: d.status,
      responsavel: (d.responsible as Record<string, unknown> | undefined)?.name ?? null,
      temLinkDeEnvio: Boolean(d.onboardingUrl),
      motivos: d.rejectReasons ?? null,
    }));
  }
  if (docs.corpo?.rejectReasons) console.log('rejectReasons gerais:', JSON.stringify(docs.corpo.rejectReasons));
}

main().catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : String(e)); process.exit(1); });
