// Backfill de company_cnaes p/ empresas existentes, via BrasilAPI. Best-effort, idempotente.
// Rodar de app/ (após a migration 0020 aplicada): node scripts/backfill-cnaes.mjs
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };
const url = get('NEXT_PUBLIC_SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const codigoStr = (v) => { if (v == null) return null; const s = String(v).replace(/\D+/g, ''); return s.length >= 6 && !/^0+$/.test(s) ? s : null; };
const descStr = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s.length ? s : null; };

const companies = await (await fetch(`${url}/rest/v1/companies?select=id,user_id,cnpj&deleted_at=is.null`, { headers: H })).json();
let ok = 0, skip = 0;
for (const c of companies) {
  const cnpj = String(c.cnpj ?? '').replace(/\D+/g, '');
  if (cnpj.length !== 14) { skip++; continue; }
  let data;
  try { const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`); if (!r.ok) { skip++; continue; } data = await r.json(); }
  catch { skip++; continue; }
  const rows = [];
  const pCod = codigoStr(data.cnae_fiscal);
  if (pCod) rows.push({ company_id: c.id, owner_user_id: c.user_id, codigo: pCod, descricao: descStr(data.cnae_fiscal_descricao), tipo: 'principal', fonte: 'brasilapi', deleted_at: null });
  for (const s of (Array.isArray(data.cnaes_secundarios) ? data.cnaes_secundarios : [])) {
    const cod = codigoStr(s.codigo);
    if (cod) rows.push({ company_id: c.id, owner_user_id: c.user_id, codigo: cod, descricao: descStr(s.descricao), tipo: 'secundario', fonte: 'brasilapi', deleted_at: null });
  }
  if (rows.length === 0) { skip++; continue; }
  // Full-replace (índice único parcial não serve p/ ON CONFLICT): apaga + reinsere.
  await fetch(`${url}/rest/v1/company_cnaes?company_id=eq.${c.id}`, { method: 'DELETE', headers: H });
  const up = await fetch(`${url}/rest/v1/company_cnaes`, { method: 'POST', headers: H, body: JSON.stringify(rows) });
  if (up.ok) ok++; else { console.warn('falhou', c.id, await up.text()); skip++; }
  await new Promise((r) => setTimeout(r, 300)); // rate-limit gentil com a BrasilAPI
}
console.log(`backfill: ${ok} empresas populadas, ${skip} puladas`);
