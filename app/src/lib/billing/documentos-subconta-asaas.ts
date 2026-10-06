// Leitura AO VIVO dos documentos que o KYC da subconta ainda pede.
//
// Ao vivo, e não espelhado numa coluna, pelo mesmo motivo do webhook
// (`webhook-subconta-asaas.ts`): o estado muda do lado do Asaas sem avisar, e
// uma cópia envelhecida diria "falta enviar" de documento já aprovado.
//
// NUNCA LANÇA: Asaas fora do ar ou chave ilegível vira `{ ok: false }`, e a
// tela mostra o aviso em vez de quebrar.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asaasSub } from '@/lib/clients/asaas';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { documentosParaVm, type GrupoDocumentoVm } from '@/lib/billing/documentos-subconta';

export type LeituraDocumentos =
  | { ok: true; grupos: GrupoDocumentoVm[]; motivoRecusa: string | null }
  | { ok: false };

/** A apiKey da subconta deste escritório, ou `null`. Nunca sai daqui logada. */
export async function chaveDaSubconta(contabilidadeId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('contabilidades')
    .select('asaas_subconta_id, asaas_api_key_cifrada')
    .eq('id', contabilidadeId).maybeSingle();
  if (!data?.asaas_subconta_id) return null;
  try {
    return lerCredencial(data.asaas_api_key_cifrada as string | null);
  } catch {
    console.error('[4b] credencial da subconta ilegivel (documentos)', contabilidadeId);
    return null;
  }
}

export async function documentosDaSubconta(contabilidadeId: string): Promise<LeituraDocumentos> {
  try {
    const chave = await chaveDaSubconta(contabilidadeId);
    if (!chave) return { ok: false };
    const r = await asaasSub(chave).listarDocumentosConta();
    return { ok: true, ...documentosParaVm(r) };
  } catch (e) {
    console.error('[4b] leitura dos documentos da subconta falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return { ok: false };
  }
}
