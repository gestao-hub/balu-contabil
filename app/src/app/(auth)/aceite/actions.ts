// src/app/(auth)/aceite/actions.ts
'use server';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ipDe } from '@/lib/security/rate-limit';
import { documentosPendentes } from '@/lib/lgpd/pendencia-aceite';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Grava o aceite (tabela `aceites`, RLS `aceites_insert_own`) de cada documento
 *  LGPD ainda pendente para o usuário autenticado, na versão publicada vigente. */
export async function aceitarDocumentosAction(): Promise<ActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const pendentes = await documentosPendentes(user.id);
  if (pendentes.length === 0) return { ok: true };

  // Versão vigente de cada tipo pendente — admin client só pra leitura de
  // `documento_versoes` (já é público via RLS, mas evita 2ª instância de client).
  const admin = createAdminClient();
  const { data: docs } = await admin
    .from('documento_versoes')
    .select('tipo, versao, publicado_em')
    .not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });

  const vigentes = new Map<string, string>();
  for (const d of docs ?? []) if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, d.versao);

  const ip = ipDe(await headers());
  const rows = pendentes
    .filter((tipo) => vigentes.has(tipo))
    .map((tipo) => ({ user_id: user.id, tipo, versao: vigentes.get(tipo)!, ip }));
  if (rows.length === 0) return { ok: true };

  // Cliente autenticado (não admin) pra respeitar a RLS `aceites_insert_own`.
  const { error } = await supabase.from('aceites').insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
