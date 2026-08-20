// Bloco 5 — a guarda de emissão. O ÚNICO lugar que decide ambiente e token.
//
// Puro (sem server-only, sem I/O) porque é a regra que mais precisa de teste:
// os 4 critérios de produção e o que acontece quando cada um falha.
//
// DECISÃO D5: falhar a guarda é ERRO NOMEADO, nunca `?? 'hom'`. Emitir em
// homologação achando que é produção é pior que não emitir — a nota não existe
// para a prefeitura e ninguém percebe até a fiscalização.
export type AmbienteFiscal = 'hom' | 'prod';
export type OrigemFocus = 'propria' | 'balu';

export type EstadoFiscal = {
  origem: OrigemFocus;
  ambiente: AmbienteFiscal;
  tokenHom: string | null;
  tokenProd: string | null;
  /** ISO do `arquivos_auxiliares.cert_not_after` vivo, ou null. */
  certNotAfter: string | null;
  /** Snapshot da Focus (`focus_habilita_nfsen_producao`). Só vale para 'balu'. */
  habilitaProducaoFocus: boolean;
  /** Declaração de quem cadastrou. Só vale para 'propria'. */
  producaoDeclarada: boolean;
};

export type MotivoRecusa =
  | 'sem_token_homologacao'
  | 'sem_token_producao'
  | 'certificado_invalido'
  | 'producao_nao_habilitada'
  | 'producao_nao_declarada'
  | 'credencial_corrompida'
  | 'estado_fiscal_ilegivel';

export type Credencial =
  | { ok: true; ambiente: AmbienteFiscal; token: string }
  | { ok: false; motivo: MotivoRecusa };

export const MENSAGEM_RECUSA: Record<MotivoRecusa, string> = {
  sem_token_homologacao:
    'Esta empresa não tem token de homologação da Focus cadastrado.',
  sem_token_producao:
    'Esta empresa está marcada para emitir em produção, mas não tem o token de produção da Focus cadastrado.',
  certificado_invalido:
    'Emissão em produção exige certificado A1 válido. O certificado está vencido ou não foi enviado.',
  producao_nao_habilitada:
    'A Focus ainda não confirmou a habilitação de NFS-e em produção para esta empresa.',
  producao_nao_declarada:
    'Falta confirmar que a Focus habilitou NFS-e em produção para esta empresa. Como a conta na Focus é do cliente, não temos como conferir isso — a confirmação é declarada por quem cadastrou a credencial.',
  credencial_corrompida:
    'A credencial da Focus desta empresa está gravada de forma corrompida e não pôde ser lida. Cadastre-a novamente.',
  estado_fiscal_ilegivel:
    'Não foi possível ler a configuração fiscal desta empresa. Tente de novo; se persistir, o motivo está no log do servidor.',
};

export function decidirCredencial(e: EstadoFiscal, agora: Date = new Date()): Credencial {
  // Desvio pela negativa (!== 'prod'), não pela positiva (=== 'hom'): um valor
  // de ambiente corrompido ou inesperado cai em homologação, a direção segura.
  // Hoje é inalcançável (CHECK da 0096 + o tipo já barram), mas o custo de
  // escrever assim é zero e a direção errada aqui é a que emite nota real.
  if (e.ambiente !== 'prod') {
    // Homologação não exige certificado nem habilitação: é o ambiente de teste,
    // e exigir os dois aqui travaria o fluxo que funciona hoje.
    if (!e.tokenHom) return { ok: false, motivo: 'sem_token_homologacao' };
    return { ok: true, ambiente: 'hom', token: e.tokenHom };
  }

  if (!e.tokenProd) return { ok: false, motivo: 'sem_token_producao' };

  const vence = e.certNotAfter ? new Date(e.certNotAfter).getTime() : 0;
  if (!vence || vence <= agora.getTime()) {
    return { ok: false, motivo: 'certificado_invalido' };
  }

  // 'balu' e 'propria' não podem cair no mesmo teste booleano — cada um tem seu
  // próprio motivo de recusa, e por isso seu próprio `if`. Um `||` genérico
  // deixaria a declaração valer como habilitação também para 'balu', que é
  // exatamente o cenário perigoso: cliente se autodeclara em produção sem a
  // Focus ter confirmado nada.
  if (e.origem === 'propria') {
    // GET /v2/empresas está bloqueado desde 23/07/2026: não existe snapshot da
    // Focus para conferir. O que vale é a declaração de quem cadastrou.
    if (!e.producaoDeclarada) return { ok: false, motivo: 'producao_nao_declarada' };
  } else {
    if (!e.habilitaProducaoFocus) return { ok: false, motivo: 'producao_nao_habilitada' };
  }

  return { ok: true, ambiente: 'prod', token: e.tokenProd };
}

// A leitura mora aqui, junto da regra, porque separar produziria um módulo com
// uma função só e um import a mais em cada chamador. O que importa é que
// `decidirCredencial` continue puro e testável sem banco.
import type { SupabaseClient } from '@supabase/supabase-js';
import { lerTokenEmpresa } from './credencial-empresa';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Monta o `EstadoFiscal` da empresa a partir do banco e aplica a guarda
 * (`decidirCredencial`).
 *
 * O certificado é lido de `arquivos_auxiliares` pela chave `company_id` (não
 * `unique_id_empresa` — armadilha já registrada no projeto).
 *
 * ⚠️ SERVICE ROLE POR DEFAULT — LEIA ANTES DE CHAMAR. `empresa_credenciais_focus`
 * é fechada para `authenticated` (migration 0097): com o client de SESSÃO
 * (`createServerClient()`) a leitura dessa tabela volta sempre vazia e a
 * emissão morre com "sem token" mesmo para empresa com token cadastrado. Por
 * isso o parâmetro `supabase` é opcional e o default é `createAdminClient()`
 * — comentário não impede ninguém de passar o client errado, assinatura
 * impede. Só passe um client explícito para teste.
 *
 * ⚠️ COM SERVICE ROLE, `empresas_fiscais` E `arquivos_auxiliares` TAMBÉM
 * IGNORAM RLS — não há mais rede de segurança embaixo desta função. QUEM
 * CHAMA É RESPONSÁVEL POR TER PROVADO QUE `companyId` PERTENCE A QUEM ESTÁ
 * PEDINDO (ex.: `profiles.current_company` do usuário autenticado, ou o
 * anti-IDOR do contador — ver `companyDaCarteira` em
 * `contador/clientes/[companyId]/cert-actions.ts`). Passar um `companyId`
 * vindo de input do usuário sem checar o dono aqui é IDOR.
 */
export async function resolverCredencialEmissao(
  companyId: string,
  agora: Date = new Date(),
  // Injetável só para teste — ver o aviso de service role acima.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any> = createAdminClient(),
): Promise<Credencial> {
  const [fiscal, cred, cert] = await Promise.all([
    supabase.from('empresas_fiscais')
      .select('focus_origem, focus_ambiente, focus_habilita_nfsen_producao, focus_producao_declarada')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    // `empresa_credenciais_focus` e fechada para anon/authenticated (0097).
    // Quem chama esta funcao tem de estar com client de service role, ou a
    // leitura volta vazia e a emissao morre com "sem token" sem dizer por que.
    supabase.from('empresa_credenciais_focus')
      .select('token_hom_cifrado, token_prod_cifrado')
      .eq('empresa_id', companyId).maybeSingle(),
    supabase.from('arquivos_auxiliares')
      .select('cert_not_after')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('cert_not_after', { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Bloqueio 2 da revisão final: se a LEITURA de `empresas_fiscais` falhar
  // (erro de rede, RLS, PGRST116 por duas linhas vivas — a 0098 fecha esse
  // caso específico com índice único, mas não os outros), `fiscal.data` vem
  // `null` igual ao caso "empresa sem configuração". Sem este `if`, os dois
  // caminhos se confundiam: uma FALHA DE LEITURA caía no mesmo `?? 'hom'` da
  // AUSÊNCIA DE DADO logo abaixo, devolvendo `ok: true, ambiente: 'hom'` para
  // uma empresa que pode estar configurada para produção — a queda silenciosa
  // que a decisão D5 proíbe por escrito. Motivo nomeado, sem passar pela
  // guarda, e log com o companyId pra investigar depois.
  if (fiscal.error) {
    console.error('[bloco5] leitura de empresas_fiscais falhou para', companyId, fiscal.error.message);
    return { ok: false, motivo: 'estado_fiscal_ilegivel' };
  }

  // Decifra dentro do try: se a gravação estiver corrompida (valor sem o
  // prefixo `enc:v1:`), `lerTokenEmpresa` lança. REQUISITO B da revisão das
  // tasks 3-4: não deixar cair para `decidirCredencial` com os dois tokens
  // nulos — isso viraria `sem_token_producao`, uma mensagem que MENTE (diz
  // "não tem o token cadastrado" quando na verdade tem, corrompido, e manda o
  // usuário procurar um cadastro que já existe). Motivo próprio, devolvido
  // direto, sem passar pela guarda.
  let tokenHom: string | null;
  let tokenProd: string | null;
  try {
    tokenHom = lerTokenEmpresa((cred.data?.token_hom_cifrado ?? null) as string | null);
    tokenProd = lerTokenEmpresa((cred.data?.token_prod_cifrado ?? null) as string | null);
  } catch (e) {
    console.error('[bloco5] credencial corrompida em', companyId, e instanceof Error ? e.message : e);
    return { ok: false, motivo: 'credencial_corrompida' };
  }

  // REQUISITO A da revisão das tasks 3-4 (reconfirmado no bloqueio 2 da
  // revisão final): os dois `??` abaixo só disparam quando a linha de
  // `empresas_fiscais` NÃO EXISTE (empresa sem configuração fiscal nenhuma) —
  // ERRO de leitura já retornou mais acima, com motivo próprio, e nunca chega
  // aqui. `?? 'hom'` é literalmente a expressão que a spec (§4) proíbe para a
  // GUARDA — mas aqui ela decide o que fazer na AUSÊNCIA de dado, e cair em
  // homologação é o desfecho seguro: uma empresa sem linha em
  // `empresas_fiscais` não tem como ter sido habilitada para produção (o
  // default da própria coluna, na 0096, também é 'hom'). Um `?? 'prod'`
  // arriscaria emitir nota real para uma empresa nunca configurada. Preso
  // pelo teste "empresas_fiscais ausente → decide hom, nunca prod".
  const origem = (fiscal.data?.focus_origem ?? 'balu') as OrigemFocus;
  const ambiente = (fiscal.data?.focus_ambiente ?? 'hom') as AmbienteFiscal;

  const estado: EstadoFiscal = {
    origem,
    ambiente,
    tokenHom,
    tokenProd,
    certNotAfter: (cert.data?.cert_not_after ?? null) as string | null,
    habilitaProducaoFocus: Boolean(fiscal.data?.focus_habilita_nfsen_producao),
    producaoDeclarada: Boolean(fiscal.data?.focus_producao_declarada),
  };

  return decidirCredencial(estado, agora);
}

/**
 * O token de UM ambiente específico, sem passar pela guarda.
 *
 * Existe para as leituras de nota já emitida (status, download, cancelamento):
 * ali o ambiente não se decide, ele já foi decidido na emissão e está carimbado
 * na linha. Aplicar a guarda de produção aqui impediria de baixar o PDF de uma
 * nota antiga só porque o certificado venceu depois.
 *
 * ⚠️ SERVICE ROLE POR DEFAULT — mesmo motivo e mesmo aviso de
 * `resolverCredencialEmissao` acima: `empresa_credenciais_focus` é fechada
 * para `authenticated`, e QUEM CHAMA É RESPONSÁVEL POR TER PROVADO QUE
 * `companyId` PERTENCE A QUEM ESTÁ PEDINDO antes de chegar aqui.
 */
export async function tokenParaAmbiente(
  companyId: string,
  ambiente: AmbienteFiscal,
  // Injetável só para teste — ver o aviso de service role acima.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any> = createAdminClient(),
): Promise<string | null> {
  const { data } = await supabase.from('empresa_credenciais_focus')
    .select('token_hom_cifrado, token_prod_cifrado')
    .eq('empresa_id', companyId).maybeSingle();
  if (!data) return null;
  const col = ambiente === 'prod' ? data.token_prod_cifrado : data.token_hom_cifrado;
  try {
    return lerTokenEmpresa((col ?? null) as string | null);
  } catch (e) {
    console.error('[bloco5] token corrompido em', companyId, e instanceof Error ? e.message : e);
    return null;
  }
}
