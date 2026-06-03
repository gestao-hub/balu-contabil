// Seed de dados de teste: 130 clientes + 130 notas (sem Focus) para a empresa
// ativa do usuário allanvalle@outlook.com. Usa service_role (bypassa RLS).
// Uso: node scripts/seed-test-data.mjs   (rodar de app/)
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const EMAIL = 'allanvalle@outlook.com';
const N = 130;

// --- lê .env.local (só as 2 chaves que importam) ---
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env.local');

const sb = createClient(url, key, { auth: { persistSession: false } });

// --- acha o usuário por email (pagina o admin listUsers) ---
let user = null;
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  user = data.users.find((u) => (u.email ?? '').toLowerCase() === EMAIL);
  if (data.users.length < 200) break;
}
if (!user) throw new Error(`Usuário ${EMAIL} não encontrado em auth.users`);
console.log('user', user.id, user.email);

// --- empresa ativa ---
const { data: profile, error: pErr } = await sb
  .from('profiles').select('current_company').eq('user_id', user.id).single();
if (pErr) throw pErr;
const companyId = profile?.current_company;
if (!companyId) throw new Error('Usuário sem current_company — selecione uma empresa no app antes.');
console.log('company', companyId);

// --- gera 130 clientes ---
const now = new Date();
const ts = now.getTime();
const MUN = [['São Paulo', 'SP'], ['Rio de Janeiro', 'RJ'], ['Curitiba', 'PR'], ['Belo Horizonte', 'MG'], ['Porto Alegre', 'RS']];
const pad = (n, w) => String(n).padStart(w, '0');

const clientes = Array.from({ length: N }, (_, i) => {
  const [mun, uf] = MUN[i % MUN.length];
  return {
    owner_user_id: user.id,
    company_id: companyId,
    person_type: 'PJ',
    razao_social: `Cliente Teste ${pad(i + 1, 3)} Ltda`,
    document: `${pad((ts + i) % 100000000, 8)}0001${pad(i % 100, 2)}`.slice(0, 14),
    email: `cliente${pad(i + 1, 3)}@teste.com`,
    telefone: `1199${pad(i, 7)}`.slice(0, 11),
    municipio: mun,
    uf,
    pais: 'Brasil',
    status: 'active',
    deleted_at: null,
  };
});

const { data: cliRows, error: cErr } = await sb.from('clientes').insert(clientes).select('id');
if (cErr) throw cErr;
console.log('clientes inseridos:', cliRows.length);

// --- gera 130 notas no MÊS VIGENTE (varia o dia) p/ aparecerem no filtro default ---
const ano = now.getFullYear();
const mes = now.getMonth(); // 0-based
const ultimoDia = new Date(ano, mes + 1, 0).getDate();
const TIPOS = ['NFe', 'NFCe', 'NFSe'];

const notas = Array.from({ length: N }, (_, i) => {
  const dia = Math.min((i % ultimoDia) + 1, ultimoDia);
  const dataEmissao = new Date(ano, mes, dia, 9 + (i % 8), (i * 7) % 60).toISOString();
  const cli = cliRows[i % cliRows.length];
  return {
    company_id: companyId,
    tipo_documento: TIPOS[i % TIPOS.length],
    referencia: `SEED-${ts}-${pad(i + 1, 3)}`,
    data_emissao: dataEmissao,
    status: 'ativa',
    valor_total: Number((150 + (i * 37.5) % 5000).toFixed(2)),
    cliente_id: cli.id,
    payload_focusnfe: {},
  };
});

const { data: notaRows, error: nErr } = await sb.from('notas_fiscais').insert(notas).select('id');
if (nErr) throw nErr;
console.log('notas inseridas:', notaRows.length);

const somaAno = notas.reduce((a, n) => a + n.valor_total, 0);
console.log(`OK — ${cliRows.length} clientes + ${notaRows.length} notas no mês ${pad(mes + 1, 2)}/${ano}. Soma emitida: R$ ${somaAno.toFixed(2)}`);
