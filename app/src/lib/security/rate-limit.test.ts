import { describe, it, expect, vi } from 'vitest';
import { limitar } from './rate-limit';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: false, error: null }) }),
}));

describe('limitar', () => {
  it('retorna o data da RPC (false = estourou)', async () => {
    expect(await limitar('login:1.2.3.4', 10, 300)).toBe(false);
  });
  it('fail-open: contrato retorna boolean', async () => {
    expect(typeof (await limitar('x', 1, 1))).toBe('boolean');
  });
});
