import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMPANY_ID = '41a9c2a4-241f-40b0-a1c5-da3fced49359';

const { data, error } = await admin
  .from('empresas_fiscais')
  .select('empresa_id, certificado_access_token, certificado_jwt, certificado_token_expiration, updated_at')
  .eq('empresa_id', COMPANY_ID)
  .is('deleted_at', null)
  .maybeSingle();

if (error) { console.error('Erro:', error.message); process.exit(1); }
if (!data)  { console.log('Nenhum registro encontrado para esta empresa.'); process.exit(0); }

const exp = data.certificado_token_expiration;
const expDate = exp ? new Date(exp) : null;
const isValid = expDate && expDate.getTime() > Date.now();

console.log('empresa_id              :', data.empresa_id);
console.log('certificado_access_token:', data.certificado_access_token ? data.certificado_access_token.slice(0, 40) + '…' : 'NULL');
console.log('certificado_jwt         :', data.certificado_jwt         ? data.certificado_jwt.slice(0, 40) + '…'         : 'NULL');
console.log('certificado_token_exp   :', exp ?? 'NULL');
console.log('token válido?           :', isValid ? '✅ SIM (expira ' + expDate.toLocaleString('pt-BR') + ')' : '❌ NÃO (expirado ou ausente)');
console.log('updated_at              :', data.updated_at);

// Verifica bucket
const { data: bucket } = await admin.storage.from('company-certificates').list(COMPANY_ID);
console.log('\nStorage bucket          :', bucket?.map(f => f.name).join(', ') || '(vazio)');
