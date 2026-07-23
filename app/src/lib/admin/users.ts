// @custom — Lista usuários da plataforma para as telas de oversight do admin.
// auth.users NÃO é acessível via PostgREST (schema auth não exposto), então
// usamos a GoTrue admin API (service role). Junta o papel de role_types (fonte
// canônica) para exibição. Base pequena hoje; o loop de páginas cobre o resto.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type AdminUser = {
  id: string;
  email: string | null;
  criadoEm: string | null;
  emailConfirmado: boolean;
  papel: string | null; // role_types.type; null = sem papel definido
};

export async function listarUsuariosPlataforma(): Promise<AdminUser[]> {
  const admin = createAdminClient();

  // Papéis (role_types) → mapa user_id → type.
  const { data: roles } = await admin.from('role_types').select('user_id, type');
  const papelPorUser = new Map<string, string>((roles ?? []).map((r) => [r.user_id, r.type]));

  const out: AdminUser[] = [];
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    const users = data?.users ?? [];
    if (error || users.length === 0) break;
    for (const u of users) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        criadoEm: u.created_at ?? null,
        emailConfirmado: !!u.email_confirmed_at,
        papel: papelPorUser.get(u.id) ?? (u.user_metadata?.type as string | undefined) ?? null,
      });
    }
    if (users.length < perPage) break;
  }
  // Mais recentes primeiro.
  return out.sort((a, b) => (b.criadoEm ?? '').localeCompare(a.criadoEm ?? ''));
}
