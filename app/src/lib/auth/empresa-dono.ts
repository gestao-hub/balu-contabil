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
