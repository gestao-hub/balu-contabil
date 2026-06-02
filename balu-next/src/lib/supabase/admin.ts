import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Cliente Supabase com service_role — bypassa RLS.
 *  Usar APENAS em server actions / route handlers para operações privilegiadas. */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
