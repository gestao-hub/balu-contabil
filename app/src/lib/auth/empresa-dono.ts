// Guarda anti-IDOR do lado do EMPRESÁRIO — o espelho de `companyDaCarteira`
// (`src/lib/contador/carteira.ts`), que faz o mesmo do lado do escritório.
//
// POR QUE EXISTE (revisão de segurança, 20/08/2026). Toda action fiscal resolve
// a empresa ativa por `profiles.current_company`. A policy `profiles_update`
// (0010) é `USING/CHECK user_id = auth.uid()` e NÃO valida vínculo nenhum: o
// usuário faz `PATCH /rest/v1/profiles?user_id=eq.<eu>` com
// `{"current_company": "<id de OUTRA empresa>"}` pelo PostgREST e passa a ter
// `companyId` apontando para empresa que não é dele.
//
// Isso sozinho não bastaria — a RLS de `notas_fiscais` derrubaria as leituras.
// O que transforma em incidente é o passo seguinte: `tokenParaAmbiente` e
// `resolverCredencialEmissao` rodam com SERVICE ROLE por default (a tabela
// `empresa_credenciais_focus` é fechada para `authenticated` desde a 0097) e
// devolvem o token DECIFRADO daquela empresa. Com ele, `focus.cancelarNfse(...)`
// cancela documento fiscal REAL de outro CNPJ na prefeitura. O `update` seguinte
// bate na RLS e falha, então banco e SEFAZ divergem e o usuário lê "Nota
// cancelada na SEFAZ, mas houve falha ao atualizar o sistema."
//
// Quem alcança: membro de escritório aprovado. Ele enxerga as notas dos clientes
// por `notas_fiscais_select_contador` (0033) e as empresas por
// `companies_select_contador`, então a leitura da nota pelo client de sessão
// PASSA para ele. Enxergar não é poder cancelar.
//
// A REGRA, e o precedente que ela segue: quem opera documento fiscal é o TITULAR
// da empresa. O painel do contador é somente visualização — está escrito para o
// cliente no aceite do convite (`(public)/convite/[token]/AceiteConvite.tsx`:
// "O acesso do escritório é somente visualização — ele não pode emitir nem
// alterar nada"), a 0033 se chama "SÓ SELECT em dados do cliente; zero escrita",
// e as duas exceções que existem (certificado e credencial da Focus, em
// `contador/clientes/[companyId]/`) são declaradas exceções deliberadas, com
// autorização do titular e trilha de auditoria. Cancelar nota não é uma delas.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Mensagem única: quem lê precisa entender que é papel, não bug. */
export const MENSAGEM_NAO_E_DONO =
  'Esta operação é do titular da empresa. O acesso do escritório contábil é somente visualização.';

/**
 * Prova que `companyId` pertence a `userId`. Devolve o id PROVADO (para o caller
 * usar daqui em diante, em vez do valor que veio de `current_company`) ou `null`.
 *
 * Recebe o client de SESSÃO de propósito, nunca o de service role: assim a RLS
 * (`companies_select`) já é a primeira barreira, e a comparação explícita de
 * `user_id` é a segunda — necessária porque `companies_select_contador` (0033)
 * TAMBÉM devolve a linha para o membro do escritório. Só a RLS não distinguiria
 * "é minha" de "é do meu cliente".
 */
export async function empresaDoDono(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  userId: string,
  companyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('companies')
    .select('id, user_id')
    .eq('id', companyId)
    .maybeSingle();
  const c = data as { id: string; user_id: string | null } | null;
  if (!c || c.user_id !== userId) return null;
  return c.id;
}

/**
 * A EMPRESA ATIVA, JÁ PROVADA. Leitura de `profiles.current_company` + prova de
 * posse num passo só.
 *
 * ─── POR QUE ISTO EXISTE, E NÃO SÓ `empresaDoDono` ──────────────────────────
 * O par "lê `current_company` → chama `empresaDoDono`" é fácil de aplicar pela
 * metade, e foi. Em 01/09/2026 um code review encontrou **12 actions** em
 * `impostos/actions.ts` e `configuracoes/actions.ts` fazendo só a primeira
 * metade — enquanto `notas_fiscais/actions.ts` fazia as duas em 14 pontos.
 *
 * A causa é uma invariante que envelheceu: quando essas actions foram escritas,
 * `current_company` só podia apontar para empresa do próprio usuário. A
 * migration 0100 (24/08/2026) passou a aceitar TAMBÉM empresa da carteira do
 * escritório — e o cabeçalho dela delega a separação explicitamente: "quem
 * separa 'vê a empresa' de 'opera documento fiscal dela' é `empresaDoDono`, na
 * aplicação". Só um dos três arquivos recebeu o recado.
 *
 * Uma função que faz as duas metades não tem como ser aplicada pela metade. É a
 * única diferença que importa aqui.
 *
 * Devolve o id PROVADO, ou `null` — que o caller traduz em
 * `MENSAGEM_NAO_E_DONO` quando havia empresa ativa, e em "nenhuma empresa
 * selecionada" quando não havia. `motivo` separa os dois casos sem obrigar o
 * caller a consultar de novo.
 */
export async function empresaAtivaDoDono(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  userId: string,
): Promise<{ ok: true; companyId: string } | { ok: false; motivo: 'sem_empresa' | 'nao_e_dono' }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', userId)
    .maybeSingle();

  const bruto = (profile?.current_company ?? null) as string | null;
  if (!bruto) return { ok: false, motivo: 'sem_empresa' };

  const provado = await empresaDoDono(supabase, userId, bruto);
  if (!provado) return { ok: false, motivo: 'nao_e_dono' };
  return { ok: true, companyId: provado };
}

/** A mensagem certa para cada motivo — para o caller não inventar duas versões. */
export function mensagemDeRecusaDeEmpresa(motivo: 'sem_empresa' | 'nao_e_dono'): string {
  return motivo === 'sem_empresa' ? 'Nenhuma empresa selecionada.' : MENSAGEM_NAO_E_DONO;
}
