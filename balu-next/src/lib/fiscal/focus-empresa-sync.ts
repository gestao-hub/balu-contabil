// @custom — Focus 1/3: sync helper reusável. Lê o estado atual da empresa no
// banco (companies + empresas_fiscais), monta o payload Focus, chama
// POST /v2/empresas e persiste o resultado em companies.focus_*.
//
// Best-effort: nunca lança pra fora. Resultado expresso no return.
// Usado pelo cadastro inicial (createCompanyAction — Focus 1) e pelo botão
// "Cadastrar na Focus agora" do painel Saúde da empresa (Focus 3).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { focus } from '@/lib/clients/focus-nfe';
import { buildFocusEmpresaPayload } from './focus-empresa-payload';
import type { RegimeCode } from './regime';

export type SyncFocusResult =
  | { ok: true; token: string | null }
  | { ok: false; error: string };

/**
 * Lê empresa+empresas_fiscais por `companyId`, dispara POST /v2/empresas e
 * persiste `focus_token` + `focus_status` + `focus_last_check` + `focus_last_error`.
 * Sempre escreve `focus_last_check` (mesmo em erro).
 *
 * Não exige session do usuário — usa o supabase client passado (caller decide
 * service_role ou anon-with-RLS).
 */
export async function syncEmpresaNaFocus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
): Promise<SyncFocusResult> {
  const now = new Date().toISOString();

  // 1) Lê empresa
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();
  if (cErr || !company) {
    return { ok: false, error: cErr?.message ?? 'Empresa não encontrada.' };
  }

  // 2) Lê regime tributário
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario')
    .eq('empresa_id', companyId)
    .maybeSingle();
  const regimeCode = (fiscal?.Code_regime_tributario ?? null) as RegimeCode | null;
  if (!regimeCode) {
    const msg = 'Regime tributário não configurado em empresas_fiscais.';
    await persistError(supabase, companyId, msg, now);
    return { ok: false, error: msg };
  }

  // 3) Monta payload + POST
  try {
    const payload = buildFocusEmpresaPayload(
      {
        cnpj: company.cnpj,
        razao_social: company.razao_social,
        nome: company.nome,
        logradouro: company.logradouro,
        numero: company.numero,
        sem_numero: company.sem_numero,
        complemento: company.complemento,
        bairro: company.bairro,
        municipio: company.municipio,
        uf: company.uf,
        cep: company.cep,
        email: company.email,
        telefone: company.telefone,
        inscricao_estadual: company.inscricao_estadual,
        inscricao_municipal: company.inscricao_municipal,
      },
      regimeCode,
    );

    const resp = await focus.criarEmpresa(payload, 'hom');
    const token = resp.token_homologacao ?? resp.token_producao ?? null;
    const focusEmpresaId = typeof resp.id === 'number' ? resp.id : null;

    await supabase
      .from('companies')
      .update({
        focus_token: token,
        focus_status: 'ok',
        focus_last_check: now,
        focus_last_error: null,
      })
      .eq('id', companyId);

    // Snapshot best-effort (Focus 2.0): popula empresas_fiscais.focus_* via GET.
    // Falha aqui NÃO desfaz o POST — log e seguimos.
    if (focusEmpresaId != null) {
      await snapshotFocusEmpresa(supabase, companyId, focusEmpresaId, now);
    }

    return { ok: true, token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await persistError(supabase, companyId, msg, now);
    return { ok: false, error: msg };
  }
}

/**
 * Lê GET /v2/empresas/:id da Focus e persiste o estado relevante em
 * `empresas_fiscais.focus_*`. Best-effort: nunca lança, apenas loga em erro.
 */
async function snapshotFocusEmpresa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
  focusEmpresaId: number,
  now: string,
): Promise<void> {
  try {
    const snap = await focus.consultarEmpresa(focusEmpresaId, 'hom');
    await supabase
      .from('empresas_fiscais')
      .update({
        focus_empresa_id: focusEmpresaId,
        focus_codigo_municipio: snap.codigo_municipio ?? null,
        focus_habilita_nfse: snap.habilita_nfse ?? null,
        focus_habilita_nfsen_producao: snap.habilita_nfsen_producao ?? null,
        focus_habilita_nfsen_homologacao: snap.habilita_nfsen_homologacao ?? null,
        focus_sync_em: now,
      })
      .eq('empresa_id', companyId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[syncEmpresaNaFocus] snapshot GET falhou:', msg);
  }
}

async function persistError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
  msg: string,
  now: string,
): Promise<void> {
  await supabase
    .from('companies')
    .update({
      focus_status: 'erro',
      focus_last_check: now,
      focus_last_error: msg.slice(0, 500),
    })
    .eq('id', companyId);
}
