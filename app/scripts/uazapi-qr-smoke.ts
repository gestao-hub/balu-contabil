#!/usr/bin/env tsx
/**
 * Sonda o contrato do QR CODE da uazapi contra o servidor real, e provisiona a
 * instância do escritório de teste do mesmo jeito que a action faria.
 *
 * POR QUE EXISTE. `provisionamento.ts` diz, no cabeçalho, que tudo ali foi
 * "validado ao vivo, e o que está aqui é o que funcionou, não o que a
 * documentação diz" — a doc da uazapi é um SPA que não expõe contrato. O
 * pareamento por CÓDIGO foi validado assim em 19/08/2026. O QR nunca foi:
 * ninguém sabe o nome do campo, nem se vem com o prefixo `data:image/png`.
 * Este script descobre, sem inventar.
 *
 * As chamadas HTTP estão inline (e não importadas de `provisionamento.ts`)
 * porque aquele módulo é `server-only` e não resolve fora do Next. A cifra, ao
 * contrário, É importada: o formato do texto cifrado não pode divergir do que
 * a aplicação decifra depois.
 *
 * O QUE ELE ESCREVE. Cria UMA instância no servidor compartilhado e grava
 * `uazapi_instancia_id` / `uazapi_token_cifrado` / `uazapi_webhook_token` em
 * `contabilidades` — o que `garantirInstancia` faria no primeiro clique em
 * "Conectar". Sem essa gravação a instância viraria órfã no servidor de outra
 * pessoa, que é o defeito que aquele módulo existe para evitar. Se já existir,
 * REUSA — nunca cria a segunda.
 *
 * Uso (a partir de balu/app):
 *   npx tsx --env-file=.env.local scripts/uazapi-qr-smoke.ts
 */
import { createClient } from '@supabase/supabase-js';
import { cifrarCampo, decifrarCampo } from '../src/lib/crypto/envelope';
import { randomBytes } from 'node:crypto';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE = (process.env.UAZAPI_BASE_URL ?? '').replace(/\/+$/, '');
const ADMIN = process.env.UAZAPI_ADMIN_TOKEN;
if (!URL || !KEY || !BASE || !ADMIN) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UAZAPI_BASE_URL ou UAZAPI_ADMIN_TOKEN.');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function chamar(caminho: string, cabecalho: Record<string, string>, corpo?: unknown, metodo = 'POST') {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...cabecalho },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  let j: Record<string, unknown> = {};
  try { j = texto ? JSON.parse(texto) : {}; } catch { /* corpo não-JSON */ }
  return { status: res.status, ok: res.ok, j, texto };
}

/** Resume valor longo: base64 de QR inteiro no terminal não ajuda ninguém. */
function resumir(v: unknown): string {
  if (typeof v !== 'string') return JSON.stringify(v);
  if (v.length <= 90) return JSON.stringify(v);
  return `<${v.length} chars> começa com ${JSON.stringify(v.slice(0, 48))}…`;
}

function inspecionar(rot: string, j: Record<string, unknown>) {
  const inst = (j.instance ?? j) as Record<string, unknown>;
  console.log(`      ${rot} chaves topo:     ${Object.keys(j).join(', ') || '(vazio)'}`);
  if (inst !== j) console.log(`      ${rot} chaves instance: ${Object.keys(inst).join(', ') || '(vazio)'}`);
  for (const k of ['qrcode', 'qrCode', 'qr', 'base64', 'code', 'paircode', 'status', 'connected', 'owner']) {
    if (k in j) console.log(`      j.${k} = ${resumir(j[k])}`);
    if (inst !== j && k in inst) console.log(`      instance.${k} = ${resumir(inst[k])}`);
  }
}

async function main() {
  const { data: cont } = await sb.from('contabilidades')
    .select('id, nome, uazapi_instancia_id, uazapi_token_cifrado, uazapi_webhook_token')
    .eq('status', 'aprovada').limit(1).maybeSingle();
  if (!cont) throw new Error('nenhum escritório aprovado no banco.');
  console.log(`escritório: ${cont.nome} (${cont.id})`);

  let token = decifrarCampo(cont.uazapi_token_cifrado as string | null);
  let webhookToken = cont.uazapi_webhook_token as string | null;

  if (cont.uazapi_instancia_id && token) {
    console.log(`[1/4] instância JÁ existe (${cont.uazapi_instancia_id}) — reusando, não crio a segunda.`);
  } else {
    console.log('[1/4] criando instância…');
    const nome = `balu-${(cont.nome as string | null) ?? 'escritorio'}`.slice(0, 60);
    const r = await chamar('/instance/init', { admintoken: ADMIN! }, { name: nome });
    if (!r.ok) throw new Error(`init respondeu ${r.status}: ${r.texto.slice(0, 200)}`);
    const i = (r.j.instance ?? r.j) as Record<string, unknown>;
    const id = typeof i.id === 'string' ? i.id : '';
    token = typeof i.token === 'string' ? i.token : '';
    if (!id || !token) { inspecionar('init', r.j); throw new Error('init não devolveu id/token.'); }
    webhookToken = randomBytes(32).toString('hex');
    // GRAVAR PRIMEIRO: o token só aparece na resposta da criação.
    const { error } = await sb.from('contabilidades').update({
      uazapi_instancia_id: id,
      uazapi_token_cifrado: cifrarCampo(token),
      uazapi_webhook_token: webhookToken,
      uazapi_status: 'desconectado',
    }).eq('id', cont.id);
    if (error) throw new Error(`instância ${id} criada e NÃO gravada: ${error.message}`);
    console.log(`      criada e gravada: ${id}`);
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://balucontabil.com.br';
  const wh = await chamar('/webhook', { token: token! }, {
    enabled: true,
    url: `${site.replace(/\/+$/, '')}/api/webhooks/uazapi?t=${webhookToken}`,
    events: ['messages'],
    excludeMessages: ['wasSentByApi', 'fromMe', 'isGroup'],
  });
  console.log(`[2/4] webhook: ${wh.ok ? 'ok' : `FALHOU ${wh.status}: ${wh.texto.slice(0, 150)}`}`);

  const st = await chamar('/instance/status', { token: token! }, undefined, 'GET');
  console.log(`[3/4] status antes: HTTP ${st.status}`);
  inspecionar('status', st.j);

  // ── A PERGUNTA DESTE SCRIPT ────────────────────────────────────────────────
  // `/instance/connect` COM `phone` devolve `paircode` (provado em 19/08). SEM
  // `phone`, deve devolver QR. Qual campo? Com ou sem prefixo `data:image`?
  console.log('[4/4] POST /instance/connect SEM phone — procurando o QR…');
  const con = await chamar('/instance/connect', { token: token! }, {});
  console.log(`      HTTP ${con.status}`);
  if (!con.ok) console.log('      corpo:', con.texto.slice(0, 300));
  inspecionar('connect', con.j);
}

main().catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exit(1); });
