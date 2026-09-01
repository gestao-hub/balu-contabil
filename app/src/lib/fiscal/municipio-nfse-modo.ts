// @custom — COMO O MUNICÍPIO DECIDE SE O BALU CONSEGUE LIGAR NFS-e SOZINHO.
//
// ─── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────
// A pergunta "posso habilitar NFS-e desta empresa sem pedir nada ao dono?" era
// respondida por `ADERENTES_NFSEN_NACIONAL`, um Map escrito à mão com UM
// município (Londrina/PR). O banco, enquanto isso, tem `municipios_nfse` com
// 5.571 linhas sincronizadas da PRÓPRIA FOCUS pelo cron `sync-municipios`, e
// nela Florianópolis, Apucarana e mais 2.400 municípios aparecem como
// `provedor_nfse = 'Nacional'`.
//
// As duas fontes discordavam, e a errada era a que decidia: a MCB MARKETING
// (Florianópolis) seria tratada como município legado e o Balu tentaria ligar
// NFS-e por um caminho que exige login e senha da prefeitura — credencial que
// ele não tem e não pode inventar.
//
// Agora o banco decide. A lista escrita à mão continua existindo, mas só pode
// dizer SIM (município que aderiu DEPOIS da última sincronização), nunca NÃO —
// que é o papel que ela sempre deveria ter tido.
//
// ─── OS TRÊS MUNDOS ─────────────────────────────────────────────────────────
// Medido no banco em 01/09/2026, sobre os 5.571 municípios:
//
//   nacional      2.402  Nacional, NacionalBetha101, NacionalPronim101
//                        → o Balu liga sozinho, no cadastro. Sem credencial.
//   legado          ~965  Fiorilli, AtendeNetC, WebISS2, Elotech203, Elv2, ...
//                        → a Focus exige login/senha DA PREFEITURA. Só o dono
//                          da empresa tem. O app pede; não inventa.
//   indisponivel  2.202  sem provedor — a Focus não atende NFS-e ali.
//
// A distinção importa porque as três levam a telas diferentes: a primeira não
// pede nada, a segunda pede credencial, e a terceira precisa dizer a verdade em
// vez de fingir que vai funcionar.
import { isAderenteNfsenNacional } from './municipios-nfsen-nacional';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = import('@supabase/supabase-js').SupabaseClient<any, 'public', any>;

export type ModoNfse = 'nacional' | 'legado' | 'indisponivel';

/** A linha de `municipios_nfse` que interessa aqui. */
export type MunicipioNfseInfo = {
  provedor_nfse: string | null;
  nfse_habilitada: boolean | null;
};

/**
 * Classifica o município pelo provedor que a Focus reportou. PURO — recebe a
 * linha já lida, para continuar testável sem banco.
 *
 * O casamento é por PREFIXO (`Nacional`, `NacionalBetha101`,
 * `NacionalPronim101`): os três são o padrão nacional com implementações
 * diferentes do lado do município, e todos são atendidos pelo `/v2/nfsen` sem
 * credencial de prefeitura. Comparar por igualdade exata deixaria 117
 * municípios de fora à toa.
 */
export function classificarModoNfse(info: MunicipioNfseInfo | null | undefined): ModoNfse {
  const provedor = (info?.provedor_nfse ?? '').trim();
  // `nfse_habilitada = false` com provedor nulo é como a Focus marca "não
  // atendo NFS-e aqui" — 2.202 municípios estão assim.
  if (!provedor || info?.nfse_habilitada === false) return 'indisponivel';
  if (/^nacional/i.test(provedor)) return 'nacional';
  return 'legado';
}

/**
 * O modo do município, lendo `municipios_nfse` (sincronizada da Focus).
 *
 * A lista escrita à mão entra só como SIM adicional: um município que aderiu ao
 * padrão nacional depois da última sincronização do cron aparece nela antes de
 * aparecer no banco. Ela NUNCA rebaixa o que o banco disse — foi a capacidade
 * de dizer "não" que a fez decidir errado por Florianópolis.
 */
export async function modoNfseDoMunicipio(
  supabase: Supabase,
  codigoIbge: string | null | undefined,
  now: Date = new Date(),
): Promise<ModoNfse> {
  if (!codigoIbge) return 'indisponivel';

  const { data, error } = await supabase
    .from('municipios_nfse')
    .select('provedor_nfse, nfse_habilitada')
    .eq('codigo_ibge', codigoIbge.trim())
    .maybeSingle();

  // Falha de leitura NÃO pode virar 'nacional': ligar NFS-e nacional num
  // município que não adere faz a Focus aceitar o cadastro e a emissão falhar
  // depois, na frente do cliente. Cair para a lista escrita à mão é a direção
  // segura — ela só conhece municípios comprovadamente nacionais.
  if (error) {
    console.error('[municipio-nfse-modo] leitura de municipios_nfse falhou:', error.message);
    return isAderenteNfsenNacional(codigoIbge, now) ? 'nacional' : 'indisponivel';
  }

  const doBanco = classificarModoNfse(data as MunicipioNfseInfo | null);
  if (doBanco === 'nacional') return doBanco;
  return isAderenteNfsenNacional(codigoIbge, now) ? 'nacional' : doBanco;
}
