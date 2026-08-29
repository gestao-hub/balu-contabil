// Desliga o webhook das instâncias uazapi (plataforma + escritórios).
//
// POR QUE EXISTE. Enquanto o webhook aponta para `/api/webhooks/uazapi`, TODA
// mensagem que chega naquela instância vira linha em `whatsapp_atendimentos` —
// foi assim que conversas alheias entraram lá durante os testes com número
// pessoal. Esvaziar a tabela (feito em 29/08) é metade; sem desligar a entrada,
// ela volta a encher.
//
// POR QUE UM SCRIPT E NÃO UMA TELA. `desconectarPlataformaAction` existe, mas
// desconectar NÃO desliga o webhook — o teste daquela action registra isso por
// extenso: "A instancia NAO e apagada: token e webhook continuam valendo".
// E `configurarWebhookUrl` sempre manda `enabled: true`; não há caminho no
// produto que mande `false`.
//
// SEGURO PARA RODAR DE NOVO: desligar um webhook já desligado é no-op.
// NÃO desconecta o número nem apaga a instância — só fecha a entrada. Para
// reconectar depois, a tela de admin reconfigura o webhook sozinha ao parear.
//
//   node scripts/desligar-webhooks-uazapi.mjs          → só MOSTRA o que faria
//   node scripts/desligar-webhooks-uazapi.mjs --aplicar → desliga de verdade
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Client } from 'pg';

const APLICAR = process.argv.includes('--aplicar');
const ENV_PATH = new URL('../.env.local', import.meta.url);
const REF = 'llykzqnugdpojwnlontj';

function env(key) {
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim().replace(/^"|"$/g, '') : null;
}

/** Mesmo envelope de `src/lib/crypto/envelope.ts` (AES-256-GCM, `enc:v1:`). */
function decifrarCampo(v) {
  if (!v) return null;
  if (!v.startsWith('enc:v1:')) return v; // legado em texto puro
  const chave = Buffer.from(env('CERT_ENC_KEY') ?? '', 'base64');
  if (chave.length !== 32) throw new Error('CERT_ENC_KEY ausente ou não são 32 bytes.');
  const bruto = Buffer.from(v.slice('enc:v1:'.length), 'base64');
  const iv = bruto.subarray(0, 12);
  const tag = bruto.subarray(12, 28);
  const cifrado = bruto.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cifrado), d.final()]).toString('utf8');
}

async function desligarWebhook(baseUrl, tokenInstancia) {
  const r = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: tokenInstancia },
    // `enabled: false` é o ponto. `url: ''` junto para não deixar o endereço
    // guardado do lado deles — se alguém reativar pelo painel da uazapi, não
    // volta apontando para a nossa rota sozinho.
    body: JSON.stringify({ enabled: false, url: '' }),
  });
  const corpo = await r.text();
  return { ok: r.ok, status: r.status, corpo: corpo.slice(0, 200) };
}

const candidates = [
  { host: `db.${REF}.supabase.co`, port: 5432, user: 'postgres' },
  { host: 'aws-0-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}` },
  { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${REF}` },
];

async function connect(password) {
  let lastErr;
  for (const c of candidates) {
    const client = new Client({
      host: c.host, port: c.port, user: c.user, password,
      database: 'postgres', ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try { await client.connect(); return client; } catch (e) { lastErr = e; try { await client.end(); } catch {} }
  }
  throw lastErr;
}

(async () => {
  const baseUrl = env('UAZAPI_BASE_URL')?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('UAZAPI_BASE_URL não está no .env.local.');
  console.log(`[uazapi] ${baseUrl}`);
  console.log(APLICAR ? '[modo] APLICAR — vai desligar de verdade' : '[modo] PRÉVIA — nada será alterado');

  const client = await connect(env('SUPABASE_PASSWORD'));
  try {
    const alvos = [];

    const { rows: plat } = await client.query(
      'SELECT instancia_id, token_cifrado, status, numero FROM public.config_whatsapp',
    );
    for (const p of plat) {
      if (p.instancia_id) {
        alvos.push({
          nome: 'PLATAFORMA',
          instancia: p.instancia_id,
          numero: p.numero ? '…' + p.numero.slice(-4) : '(sem numero)',
          status: p.status,
          token: decifrarCampo(p.token_cifrado),
        });
      }
    }

    const { rows: escr } = await client.query(
      `SELECT nome, uazapi_instancia_id, uazapi_token_cifrado, uazapi_status, uazapi_numero
         FROM public.contabilidades WHERE uazapi_instancia_id IS NOT NULL`,
    );
    for (const e of escr) {
      alvos.push({
        nome: `ESCRITORIO: ${e.nome}`,
        instancia: e.uazapi_instancia_id,
        numero: e.uazapi_numero ? '…' + e.uazapi_numero.slice(-4) : '(sem numero)',
        status: e.uazapi_status,
        token: decifrarCampo(e.uazapi_token_cifrado),
      });
    }

    if (alvos.length === 0) { console.log('[nada] nenhuma instância cadastrada.'); return; }

    console.log(`\n[alvos] ${alvos.length}:`);
    for (const a of alvos) {
      console.log(`  - ${a.nome} | instancia=${a.instancia} | numero=${a.numero} | status=${a.status} | token=${a.token ? 'ok' : 'AUSENTE'}`);
    }

    if (!APLICAR) { console.log('\n[prévia] rode de novo com --aplicar para desligar.'); return; }

    console.log('');
    for (const a of alvos) {
      if (!a.token) { console.log(`  [pulado] ${a.nome}: sem token decifrável.`); continue; }
      const r = await desligarWebhook(baseUrl, a.token);
      console.log(`  [${r.ok ? 'OK' : 'FALHOU'}] ${a.nome} — HTTP ${r.status} ${r.ok ? '' : r.corpo}`);
    }
    console.log('\n[fim] webhooks desligados. O número NÃO foi desconectado e a instância NÃO foi apagada.');
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
