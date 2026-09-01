// @custom — PÓS-PROCESSAMENTO DE EMPRESA NOVA, fora do alcance da rede.
//
// ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
// Estas duas funções moravam em `(auth)/onboarding/actions.ts`, que tem
// `'use server'` no topo. Em Next.js isso significa que TODA função exportada
// vira um endpoint HTTP endereçável — não só as que algum formulário chama.
// Conferido no manifest do build em 01/09/2026: `posProcessarNovaEmpresa` e
// `resolverCodigoMunicipio` estavam lá, com id próprio.
//
// Elas nunca foram feitas para receber chamada externa. São o miolo comum de
// `createCompanyAction` (o dono cadastrando a própria empresa) e de
// `criarEmpresaClienteAction` (o contador cadastrando um cliente) — as duas
// autenticam antes. Sozinha, `posProcessarNovaEmpresa` não verifica nada: ela
// recebe `companyId` e `ownerUserId` por parâmetro e trabalha inteira com
// `createAdminClient()`, porque quem a chama já provou o direito.
//
// Exportada de um módulo `'use server'`, essa premissa deixava de valer: bastava
// POSTar o id de uma empresa alheia para reescrever o cadastro dela na Focus e
// TROCAR OS CNAEs — que são o que `resolverAnexoEmpresa` e o Fator R leem para
// escolher o anexo do Simples. Imposto de terceiro decidido por quem não é dono,
// sem erro nenhum na tela.
//
// A correção não é adicionar guarda aqui. É este arquivo: sem `'use server'`,
// não há endpoint, e a premissa "quem chama já provou" volta a ser verdade por
// construção. Guarda dentro do helper seria a resposta errada — ele é
// legitimamente chamado com `ownerUserId: null` (empresa que o contador cadastra
// e ainda não tem dono), e não há sessão a conferir nesse caso.
//
// ⚠️ NÃO reexporte nada daqui de dentro de um módulo `'use server'`.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';
import { sincronizarCnaesEmpresa } from '@/lib/fiscal/cnae-sync';
import { ibgePorCep } from '@/lib/fiscal/ibge-por-cep';
import { normalizeRegimePatch } from '@/lib/fiscal/regime';
import type { CompanyInput } from '@/types/zod';

export async function resolverCodigoMunicipio(
  codigoMunicipioAtual: string | undefined,
  cep: string | undefined,
): Promise<string> {
  let codigoMunicipio = codigoMunicipioAtual?.trim() || '';
  if (!codigoMunicipio && cep) {
    codigoMunicipio = (await ibgePorCep(cep)) ?? '';
  }
  return codigoMunicipio;
}

// Pós-processamento comum a qualquer criação de empresa (dono cadastrando a própria
// empresa OU contador cadastrando um cliente): empresas_fiscais + Focus + CNAEs.
// Tudo aqui é best-effort — nunca lança, nunca derruba o cadastro da empresa.
// Usa SEMPRE o admin client: no fluxo do contador a empresa nasce sem dono
// (companies.user_id = null), então a RLS de empresas_fiscais/company_cnaes
// (`user_owns_company`) rejeitaria o insert com o client de sessão; no fluxo do
// dono isso não muda o resultado (ele já tem acesso via RLS de qualquer forma).
//
// `ownerUserId` é null no cadastro pelo contador (empresa ainda sem dono):
//  - empresas_fiscais.owner_user_id aceita NULL → grava normalmente.
//  - company_cnaes.owner_user_id é NOT NULL (FK p/ auth.users) → sem dono ainda
//    não dá pra popular; pulamos com log. Fica pendente até o cliente aceitar o
//    convite (aceitar_convite RPC) e a empresa ganhar um dono.
export async function posProcessarNovaEmpresa(
  companyId: string,
  dados: CompanyInput,
  ownerUserId: string | null,
): Promise<void> {
  const admin = createAdminClient();

  // empresas_fiscais: insere com regime + owner (pode ser null). Falha aqui não
  // rejeita a empresa (usuário pode reconfigurar depois na aba Regime tributário).
  const fiscalPatch = normalizeRegimePatch({ Code_regime_tributario: dados.Code_regime_tributario });
  const { error: fiscalErr } = await admin.from('empresas_fiscais').insert({
    empresa_id: companyId,
    owner_user_id: ownerUserId,
    cnpj: dados.cnpj,
    cnae_principal: dados.cnae_principal ?? null,
    ...fiscalPatch,
  });
  if (fiscalErr) {
    // Loga e segue — não bloqueia o cadastro.
    console.warn('[posProcessarNovaEmpresa] empresas_fiscais insert falhou:', fiscalErr.message);
  }

  // POST best-effort na Focus. Falha NÃO bloqueia o cadastro: resultado fica
  // em companies.focus_status + focus_last_error, exibido no painel "Saúde da
  // empresa" (Focus 3) com botão de retry.
  const sync = await syncEmpresaNaFocus(admin, companyId);
  if (!sync.ok) {
    console.warn('[posProcessarNovaEmpresa] Focus POST falhou:', sync.error);
  }

  // Popula company_cnaes (principal + secundários) — best-effort, não derruba o cadastro.
  // Exige um dono (FK NOT NULL); sem ele, fica pendente até o convite ser aceito.
  if (ownerUserId) {
    await sincronizarCnaesEmpresa(admin, {
      companyId,
      ownerUserId,
      cnpj: dados.cnpj ?? '',
      cnaePrincipalFallback: dados.cnae_principal ?? null,
    });
  } else {
    console.warn('[posProcessarNovaEmpresa] sem owner_user_id — CNAEs não sincronizados (empresa ainda sem dono).');
  }
}
