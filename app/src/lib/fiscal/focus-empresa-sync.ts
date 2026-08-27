// @custom — Focus 1/3: sync helper reusável. Lê o estado atual da empresa no
// banco (companies + empresas_fiscais), monta o payload Focus, chama
// POST /v2/empresas e persiste o resultado em companies.focus_* (status) +
// empresa_credenciais_focus (os dois tokens, cifrados — Bloco 5/0097).
//
// Best-effort: nunca lança pra fora. Resultado expresso no return.
// Usado pelo cadastro inicial (createCompanyAction — Focus 1) e pelo botão
// "Cadastrar na Focus agora" do painel Saúde da empresa (Focus 3).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { focus, type FocusEnv } from '@/lib/clients/focus-nfe';
import { buildFocusEmpresaPayload } from './focus-empresa-payload';
import {
  buildFocusEmpresaUpdatePayload,
  withCertificado,
  withCredenciaisPrefeitura,
} from './focus-empresa-update-payload';
import type { RegimeCode } from './regime';
import { guardarTokenEmpresa } from './credencial-empresa';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Extras opcionais pro PUT — usados nos momentos em que os secrets estão em
 * memória natural (upload de cert, save da aba NFS-e). Por design, NÃO ficam
 * persistidos pra serem reusados depois.
 */
export type AtualizarFocusExtras = {
  /** Cert A1: PFX em base64 + senha (acoplado via withCertificado). */
  certificado?: { base64: string; senha: string };
  /** Credenciais prefeitura (município legado): acoplado via withCredenciaisPrefeitura. */
  credenciaisPrefeitura?: { login: string; senha: string };
};

export type SyncFocusResult =
  | { ok: true; token: string | null }
  | { ok: false; error: string };

/**
 * Lê empresa+empresas_fiscais por `companyId`, dispara POST /v2/empresas e
 * persiste os dois tokens (cifrados) em `empresa_credenciais_focus` +
 * `focus_status` / `focus_last_check` / `focus_last_error` em `companies`.
 * Sempre escreve `focus_last_check` (mesmo em erro).
 *
 * Não exige session do usuário — usa o supabase client passado (caller decide
 * service_role ou anon-with-RLS) para `companies`/`empresas_fiscais`. A escrita
 * em `empresa_credenciais_focus` usa SEMPRE `createAdminClient()` internamente
 * — ver o comentário no ponto de uso.
 */
export async function syncEmpresaNaFocus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
): Promise<SyncFocusResult> {
  const now = new Date().toISOString();

  // Bloco 5: empresa que usa a própria conta na Focus não é cadastrada por nós.
  // Sem esta guarda, o sync sobrescreveria com o token da conta da plataforma o
  // token que o contador cadastrou — e o cliente passaria a emitir com a
  // credencial errada, em silêncio.
  const { data: fiscalOrigem } = await supabase
    .from('empresas_fiscais').select('focus_origem').eq('empresa_id', companyId).maybeSingle();
  if ((fiscalOrigem?.focus_origem ?? 'balu') === 'propria') {
    return {
      ok: false,
      error: 'Esta empresa usa a própria conta na Focus. O cadastro é feito no painel dela, não por aqui.',
    };
  }

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
    const focusEmpresaId = typeof resp.id === 'number' ? resp.id : null;

    // Bloco 5: os DOIS tokens vao, cada um na sua coluna, para
    // `empresa_credenciais_focus` — cifrados e fora do alcance de
    // `authenticated` (0097). Antes daqui gravava-se
    // `token_homologacao ?? token_producao` em texto puro em
    // `companies.focus_token`: guardava um dos dois, esquecia qual, e repopulava
    // a coluna que a migracao de seguranca tinha esvaziado.
    //
    // `createAdminClient()` aqui, NUNCA o `supabase` recebido por parâmetro:
    // `empresa_credenciais_focus` é fechada para `authenticated` (0097), e
    // `syncFocusEmpresaAction` (configuracoes/actions.ts) chama esta função com
    // o client de SESSÃO do usuário. Com esse client a escrita voltaria erro
    // (RLS/grant) e a empresa ficaria cadastrada na Focus sem credencial
    // nenhuma salva — em silêncio, se ninguém checasse o retorno.
    const admin = createAdminClient();
    try {
      const patchCred: Record<string, unknown> = {
        empresa_id: companyId,
        atualizado_em: now,
      };
      if (resp.token_homologacao) patchCred.token_hom_cifrado = guardarTokenEmpresa(resp.token_homologacao);
      if (resp.token_producao)    patchCred.token_prod_cifrado = guardarTokenEmpresa(resp.token_producao);

      if (patchCred.token_hom_cifrado || patchCred.token_prod_cifrado) {
        const { error: credErr } = await admin
          .from('empresa_credenciais_focus')
          .upsert(patchCred, { onConflict: 'empresa_id' });
        if (credErr) throw new Error(credErr.message);
      }
    } catch (credErr) {
      // A empresa FOI cadastrada na Focus (o POST acima já aconteceu), mas a
      // credencial não foi guardada — sem ela ninguém emite nota nenhuma. Isto
      // é ERRO, não sucesso: `focus_status` NÃO pode virar 'ok' aqui, senão o
      // Diagnóstico mostraria "cadastrada" para uma empresa sem token utilizável.
      const msg = credErr instanceof Error ? credErr.message : String(credErr);
      const erroCompleto = `Empresa cadastrada na Focus, mas a credencial não pôde ser salva: ${msg}`;
      await persistError(supabase, companyId, erroCompleto, now);
      return { ok: false, error: erroCompleto };
    }

    await supabase
      .from('companies')
      .update({
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

    // O token em claro nunca sai desta função: quem precisa dele pra emitir lê
    // `empresa_credenciais_focus` via `resolver-credencial.ts` e decifra lá.
    return { ok: true, token: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await persistError(supabase, companyId, msg, now);
    return { ok: false, error: msg };
  }
}

/**
 * Lê GET /v2/empresas/:id da Focus e persiste o estado relevante em
 * `empresas_fiscais.focus_*`. Best-effort no GET; a ESCRITA, não.
 *
 * ⚠️ ESCREVE COM SERVICE ROLE, e o `supabase` do parâmetro é usado só para o
 * `persistError`. Motivo: esta função grava `focus_empresa_id` e
 * `focus_habilita_nfsen_producao` — colunas que a 0098/0099 protegem com
 * trigger contra escrita de `authenticated`. E TRÊS chamadores reais passam o
 * client de SESSÃO (`configuracoes/actions.ts`, o botão Sincronizar, e o
 * upload de certificado). Com o client de sessão o trigger derruba o UPDATE
 * INTEIRO, e como o resultado nunca era lido, o snapshot virava no-op
 * silencioso: `focus_empresa_id` nunca persistia, o Diagnóstico ficava
 * eternamente em "não cadastrada" e o sync tentava CADASTRAR DE NOVO para
 * sempre. Achado pela revisão de 20/08/2026.
 */
async function snapshotFocusEmpresa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
  focusEmpresaId: number,
  now: string,
): Promise<void> {
  try {
    const snap = await focus.consultarEmpresa(focusEmpresaId, 'hom');
    // ERRO LIDO, e não descartado: era exatamente o descarte que escondia a
    // rejeição do trigger.
    const { error } = await createAdminClient()
      .from('empresas_fiscais')
      .update({
        focus_empresa_id: focusEmpresaId,
        focus_codigo_municipio: snap.codigo_municipio ?? null,
        focus_habilita_nfse: snap.habilita_nfse ?? null,
        focus_habilita_nfsen_producao: snap.habilita_nfsen_producao ?? null,
        focus_habilita_nfsen_homologacao: snap.habilita_nfsen_homologacao ?? null,
        // NOT NULL default false → usa `?? false` (não null). Só vira true quando a
        // empresa está de fato registrada p/ NF-e/NFC-e na Focus (cert A1 + setup SEFAZ).
        focus_habilita_nfe: snap.habilita_nfe ?? false,
        focus_habilita_nfce: snap.habilita_nfce ?? false,
        focus_sync_em: now,
      })
      .eq('empresa_id', companyId)
      .is('deleted_at', null);
    if (error) {
      console.error('[syncEmpresaNaFocus] snapshot NAO gravado:', companyId, error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[syncEmpresaNaFocus] snapshot GET falhou:', msg);
  }
}

/**
 * Focus 2.1 — Sincroniza estado atual do Balu (companies + empresas_fiscais)
 * com a Focus via PUT /v2/empresas/:cnpj. Idempotente: pode chamar quantas
 * vezes quiser sem efeito colateral. Após o PUT, faz GET pra atualizar o
 * snapshot em empresas_fiscais.focus_*.
 *
 * Best-effort: NUNCA lança. Erros viram { ok: false, error } e persistem
 * em companies.focus_last_error.
 *
 * Pré-condições:
 *   - `empresas_fiscais.focus_empresa_id` deve existir (cadastro inicial já
 *     feito — é o id que o POST devolveu). Se não existir, sugerimos rodar
 *     `syncEmpresaNaFocus` (POST) primeiro.
 *
 * Trigger:
 *  - botão "Sincronizar com Focus" no Diagnóstico (sem extras → payload base puro)
 *  - upload de certificado A1 (extras.certificado)
 *  - save de credenciais prefeitura na aba NFS-e (extras.credenciaisPrefeitura)
 */
export async function atualizarEmpresaNaFocus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
  // OMITIR É O CAMINHO CERTO: sem valor, o ambiente sai de
  // `empresas_fiscais.focus_ambiente` — a mesma coluna que decide a emissão.
  //
  // Era `env: FocusEnv = 'hom'`, e os TRÊS chamadores de produto passavam
  // `'hom'` literal. O efeito: `decidirFlagsNfse` mandava sempre
  // `habilita_nfsen_homologacao` no PUT, e NENHUM caminho do produto jamais
  // pedia `habilita_nfsen_producao` à Focus. Uma empresa marcada para produção
  // no Balu continuava, do lado da Focus, habilitada só em homologação — e a
  // emissão real morria lá, depois de a tela daqui já ter dito que estava
  // tudo certo.
  //
  // Há DOIS usos legítimos do valor explícito, e nenhum outro:
  //  1. script de smoke, onde o ambiente é o objeto do teste;
  //  2. `promoverParaProducao` (sessão 35), que passa 'prod' de propósito
  //     porque está tentando MUDAR `focus_ambiente` — ler a coluna ali seria
  //     perguntar à resposta que ele quer produzir, e é exatamente esse laço
  //     que mantinha toda empresa de origem 'balu' presa em homologação.
  env?: FocusEnv,
  extras: AtualizarFocusExtras = {},
): Promise<SyncFocusResult> {
  const now = new Date().toISOString();

  // Bloco 5: mesma guarda de `syncEmpresaNaFocus` (cadastro), agora para
  // ATUALIZAÇÃO. O contexto do Bloco 5 é explícito: origem 'propria' → Balu
  // "não cadastra, não atualiza e não sobe certificado" na Focus. Sem isto,
  // uma empresa que já tinha `focus_empresa_id` (cadastrada como 'balu' antes
  // de trocar para 'propria') continuaria recebendo PUTs com o token de
  // REVENDA da Balu — criando um registro fantasma que não corresponde à conta
  // Focus que a empresa de fato usa para emitir.
  // `deleted_at is null` aqui e não só no select de baixo: `maybeSingle()` sobre
  // uma linha soft-deleted devolveria origem nula, e a queda para o default
  // `'balu'` liberaria justamente o PUT que a guarda existe para impedir.
  const { data: fiscalOrigemUpd } = await supabase
    .from('empresas_fiscais').select('focus_origem, focus_ambiente')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if ((fiscalOrigemUpd?.focus_origem ?? 'balu') === 'propria') {
    return {
      ok: false,
      error: 'Esta empresa usa a própria conta na Focus. A atualização é feita no painel dela, não por aqui.',
    };
  }

  // Desvio pela negativa, como em `decidirCredencial`: valor inesperado na
  // coluna cai em homologação, a direção que não emite documento real.
  const ambiente: FocusEnv =
    env ?? ((fiscalOrigemUpd?.focus_ambiente as string | null) === 'prod' ? 'prod' : 'hom');

  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();
  if (cErr || !company) {
    return { ok: false, error: cErr?.message ?? 'Empresa não encontrada.' };
  }

  // O sinal de "já cadastrada" é `empresas_fiscais.focus_empresa_id`, não
  // `companies.focus_token` (a coluna saiu de uso na Task 20 — 0097 já a
  // tinha fechado para `authenticated`, e o sync parou de escrever nela). A
  // checagem propriamente dita acontece abaixo, junto do fetch de `fiscal`,
  // porque é a mesma consulta.
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, empresa_fiscal_ativada, focus_empresa_id, focus_codigo_municipio')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!fiscal?.Code_regime_tributario) {
    const msg = 'Regime tributário não configurado em empresas_fiscais.';
    await persistError(supabase, companyId, msg, now);
    return { ok: false, error: msg };
  }

  const focusEmpresaId = fiscal.focus_empresa_id as number | null;
  if (focusEmpresaId == null) {
    const msg = 'focus_empresa_id ausente em empresas_fiscais — rode o cadastro inicial primeiro.';
    await persistError(supabase, companyId, msg, now);
    return { ok: false, error: msg };
  }

  // Snapshot Focus tem prioridade sobre companies.codigo_municipio (já validado lá).
  const codigoIbge =
    (fiscal.focus_codigo_municipio as string | null) ||
    (company.codigo_municipio as string | null) ||
    null;

  try {
    let payload = buildFocusEmpresaUpdatePayload(
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
      {
        Code_regime_tributario: fiscal.Code_regime_tributario as RegimeCode,
        empresa_fiscal_ativada: fiscal.empresa_fiscal_ativada as boolean | null,
      },
      codigoIbge,
      ambiente,
    );

    // Acopla extras quando o caller passou (upload de cert / save de credenciais).
    if (extras.certificado) {
      payload = withCertificado(payload, extras.certificado.base64, extras.certificado.senha);
    }
    if (extras.credenciaisPrefeitura) {
      payload = withCredenciaisPrefeitura(
        payload,
        extras.credenciaisPrefeitura.login,
        extras.credenciaisPrefeitura.senha,
      );
    }

    // PUT pela revenda — path usa o ID numérico interno (não o CNPJ).
    await focus.atualizarEmpresa(focusEmpresaId, payload as unknown as Record<string, unknown>, ambiente);

    await supabase
      .from('companies')
      .update({
        focus_status: 'ok',
        focus_last_check: now,
        focus_last_error: null,
      })
      .eq('id', companyId);

    // Snapshot pós-PUT.
    await snapshotFocusEmpresa(supabase, companyId, focusEmpresaId, now);

    // PUT não devolve token novo nenhum (o token da empresa não muda numa
    // atualização) — e mesmo que devolvesse, não sai em claro daqui (mesmo
    // motivo do `syncEmpresaNaFocus` acima).
    return { ok: true, token: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await persistError(supabase, companyId, msg, now);
    return { ok: false, error: msg };
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
