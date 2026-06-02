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

// Lista raiz do bucket
const { data: root, error: re } = await admin.storage.from('company-certificates').list();
console.log('Raiz do bucket:', JSON.stringify(root?.map(f => f.name), null, 2), re?.message ?? '');

// Lista dentro da pasta da AL Piscinas
const { data: folder, error: fe } = await admin.storage
  .from('company-certificates')
  .list('41a9c2a4-241f-40b0-a1c5-da3fced49359');
console.log('AL Piscinas pasta:', JSON.stringify(folder?.map(f => f.name), null, 2), fe?.message ?? '');
