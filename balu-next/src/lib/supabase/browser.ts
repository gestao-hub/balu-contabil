// @custom — Supabase browser wrapper.
import { createBrowserClient as create } from '@supabase/ssr';
export const createBrowserClient = () =>
  create(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
