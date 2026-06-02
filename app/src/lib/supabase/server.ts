// @custom — Supabase server wrapper.
import { createServerClient as create, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createServerClient() {
  const store = await cookies();
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // setAll é no-op em Server Components que não permitem mutação de cookies.
          }
        },
      },
    }
  );
}
