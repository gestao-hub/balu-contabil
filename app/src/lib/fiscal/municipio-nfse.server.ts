import 'server-only';
// @custom — PR 1.5: resolver de município NFS-e (server-only, Supabase).
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeNome } from './municipio-nfse';

export type MunicipioNfse = {
  id: string;
  codigo_ibge: string;
  nome_municipio: string;
  uf: string;
  nfse_habilitada: boolean;
  status_nfse: string | null;
  provedor_nfse: string | null;
  requer_certificado_nfse: boolean | null;
  possui_ambiente_homologacao_nfse: boolean | null;
  possui_cancelamento_nfse: boolean | null;
};

// Resolve a linha de municipios_nfse pelo município + UF do endereço da empresa.
// Match por nome normalizado; homônimos desambiguados pela UF.
// Retorna null para cidades não habilitadas (nfse_habilitada=false) ou não encontradas.
export async function resolveMunicipioNfse(
  supabase: SupabaseClient,
  municipio: string | null | undefined,
  uf: string | null | undefined,
): Promise<MunicipioNfse | null> {
  if (!municipio || !uf) return null;
  const { data } = await supabase
    .from('municipios_nfse')
    .select(
      'id, codigo_ibge, nome_municipio, uf, nfse_habilitada, status_nfse, provedor_nfse, requer_certificado_nfse, possui_ambiente_homologacao_nfse, possui_cancelamento_nfse',
    )
    .eq('uf', uf.trim().toUpperCase())
    .eq('nfse_habilitada', true);  // cidades não habilitadas retornam null → cidadeNfseCheck mostra "não atendida"
  const alvo = normalizeNome(municipio);
  const rows = (data ?? []) as MunicipioNfse[];
  return rows.find((m) => normalizeNome(m.nome_municipio) === alvo) ?? null;
}
