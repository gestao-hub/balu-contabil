// One-time: padroniza o cert no Storage, varre o bucket e remove as linhas órfãs.
// Dry-run por padrão; passe --apply para executar de fato.
// Rodar: set -a; . ./.env.local; set +a; node scripts/saneamento-arquivos-auxiliares.mjs [--apply]
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'company-certificates';
const VALID_COMPANY = '41a9c2a4-241f-40b0-a1c5-da3fced49359';
const VALID_ROW_ID = '0b44bdec-f9b5-43b2-b65c-9e9ea3dd12e4';
const OLD_OBJECT = `${VALID_COMPANY}/9783c30f-3238-45c4-8e7e-96dec4ad86d0.enc`;
const NEW_OBJECT = `${VALID_COMPANY}/certificado.enc`;
const ORPHAN_ROW_IDS = ['5d8325bc-b125-4f4b-a307-4337bfdb55ca', '5e29855c-bfb0-4ede-b964-40f4458335fe'];
const KEEP = new Set([NEW_OBJECT, '.emptyFolderPlaceholder']);

const log = (...a) => console.log(APPLY ? '[APPLY]' : '[DRY] ', ...a);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Lista o bucket recursivamente (1 nível de pasta — o esquema do projeto).
async function listAll() {
  const out = [];
  const { data: top, error } = await admin.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw new Error(`list raiz: ${error.message}`);
  for (const f of top) {
    const isFolder = f.id === null || f.metadata == null;
    if (isFolder) {
      const { data: sub, error: subErr } = await admin.storage.from(BUCKET).list(f.name, { limit: 1000 });
      if (subErr) throw new Error(`list ${f.name}: ${subErr.message}`);
      for (const s of (sub || [])) out.push(`${f.name}/${s.name}`);
    } else {
      out.push(f.name);
    }
  }
  return out;
}

async function main() {
  // 1) Move o cert válido (se ainda não movido).
  const before = await listAll();
  if (before.includes(OLD_OBJECT) && !before.includes(NEW_OBJECT)) {
    log('move', OLD_OBJECT, '->', NEW_OBJECT);
    if (APPLY) {
      const { error } = await admin.storage.from(BUCKET).move(OLD_OBJECT, NEW_OBJECT);
      if (error) throw new Error(`move: ${error.message}`);
    }
  } else if (before.includes(NEW_OBJECT)) {
    log('move pulado (destino já existe):', NEW_OBJECT);
    if (before.includes(OLD_OBJECT)) log('AVISO: objeto antigo também existe e será removido na varredura:', OLD_OBJECT);
  } else {
    log('AVISO: objeto de origem não encontrado:', OLD_OBJECT);
  }

  // 2) Atualiza storage_key/supabase_file_path da linha válida.
  log('update linha válida', VALID_ROW_ID, 'storage_key/supabase_file_path ->', NEW_OBJECT);
  if (APPLY) {
    const { error } = await admin.from('arquivos_auxiliares')
      .update({ storage_key: NEW_OBJECT, supabase_file_path: NEW_OBJECT }).eq('id', VALID_ROW_ID);
    if (error) throw new Error(`update válida: ${error.message}`);
  }

  // 3) Apaga as linhas órfãs.
  log('delete linhas órfãs', ORPHAN_ROW_IDS.join(', '));
  if (APPLY) {
    const { error } = await admin.from('arquivos_auxiliares').delete().in('id', ORPHAN_ROW_IDS);
    if (error) throw new Error(`delete órfãs: ${error.message}`);
  }

  // 4) Varre o bucket: remove tudo fora do keep-set.
  const after = await listAll();
  const toDelete = after.filter((p) => !KEEP.has(p) && !p.endsWith('.emptyFolderPlaceholder'));
  log('objetos a remover do bucket:', JSON.stringify(toDelete));
  if (APPLY && toDelete.length) {
    const { error } = await admin.storage.from(BUCKET).remove(toDelete);
    if (error) throw new Error(`remove objetos: ${error.message}`);
  }

  // 5) Confere estado final.
  const final = await listAll();
  log('bucket final:', JSON.stringify(final));
  const { count, error: countErr } = await admin.from('arquivos_auxiliares').select('*', { count: 'exact', head: true });
  if (countErr) throw new Error(`count: ${countErr.message}`);
  log('linhas em arquivos_auxiliares:', count);
}

main().then(() => log('ok')).catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
