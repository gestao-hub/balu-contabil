import 'server-only';
// @custom — PR 1.5: resolver de município NFS-e (server-only, Supabase).
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeNome } from './municipio-nfse';

export type MunicipioNfse = {
  id: string;
  municipio: string | null;
  estado: string | null;
  provedor: string | null;
  autenticacao: string | null;
  cancelamento: string | null;
  cancelamento_so_portal: boolean | null;
  requer_liberacao_rps: boolean | null;
  requer_token_portal: boolean | null;
  serie_rps_so_numeros: boolean | null;
  im_zeros_esquerda: boolean | null;
  instrucoes_configuracao: string | null;
};

// Resolve a linha de municipios_nfse pelo município + UF do endereço da empresa.
// Match por nome normalizado (a base não tem código IBGE; homônimos via UF).
export async function resolveMunicipioNfse(
  supabase: SupabaseClient,
  municipio: string | null | undefined,
  uf: string | null | undefined,
): Promise<MunicipioNfse | null> {
  if (!municipio || !uf) return null;
  const { data } = await supabase
    .from('municipios_nfse')
    .select(
      'id, municipio, estado, provedor, autenticacao, cancelamento, cancelamento_so_portal, requer_liberacao_rps, requer_token_portal, serie_rps_so_numeros, im_zeros_esquerda, instrucoes_configuracao',
    )
    .eq('estado', uf.trim().toUpperCase())
    .is('deleted_at', null);
  const alvo = normalizeNome(municipio);
  const rows = (data ?? []) as MunicipioNfse[];
  return rows.find((m) => normalizeNome(m.municipio) === alvo) ?? null;
}
