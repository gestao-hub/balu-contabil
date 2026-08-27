// A promoção para produção — o passo que quebra o impasse circular do Bloco 5.
//
// O IMPASSE (medido em 27/08/2026, sessão 35). Ligar produção exigia
// `focus_ambiente = 'prod'`, e o único escritor dessa coluna
// (`definirModoFiscalAction`) pré-valida com `decidirCredencial`, que para
// origem 'balu' exige `focus_habilita_nfsen_producao = true`. Essa coluna só é
// preenchida por `snapshotFocusEmpresa`, lendo a Focus — que só devolve `true`
// depois de receber um PUT com `habilita_nfsen_producao`. E `decidirFlagsNfse`
// só monta esse campo quando o ambiente JÁ é 'prod'. Ciclo fechado, sem porta
// de entrada:
//
//   focus_ambiente='prod' → habilita_nfsen_producao=true → PUT prod → focus_ambiente='prod'
//
// A consequência medida: NENHUMA empresa de origem 'balu' jamais chegou a
// produção. A AL PISCINAS — a única que percorreu o fluxo automático inteiro,
// em 09/06/2026 — emitiu em `producaorestrita.nfse.gov.br`, com o PDF no bucket
// `arquivos_development` da Focus. Nota autorizada, ambiente de teste.
//
// A SAÍDA: pedir a habilitação ANTES de exigir a confirmação. Primeiro o PUT
// que pede produção à Focus, depois a releitura do snapshot, e só então a
// coluna. NENHUMA guarda é afrouxada — `decidirCredencial` continua sendo o
// último portão, com o estado REAL do banco, e a gravação só acontece depois
// que ele passa.
//
// Por que existe como módulo próprio, e não dentro de `cert-upload.ts`: a
// decisão de quando é seguro tentar é regra fiscal, e regra fiscal neste
// projeto mora em função pura testável (mesmo molde de `resolver-credencial.ts`).
// O upload de certificado é só o primeiro gatilho; o botão "Sincronizar com
// Focus" é o próximo candidato natural.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { atualizarEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';
import {
  decidirCredencial,
  lerEstadoFiscal,
  MENSAGEM_RECUSA,
  type AmbienteFiscal,
  type MotivoRecusa,
  type OrigemFocus,
} from '@/lib/fiscal/resolver-credencial';

/**
 * O que a decisão de tentar a promoção precisa saber. Deliberadamente MENOR que
 * `EstadoFiscal`: aqui não se julga se a empresa pode emitir — isso é
 * `decidirCredencial`, e ele roda depois, com o estado completo.
 */
export type EstadoPromocao = {
  origem: OrigemFocus;
  ambiente: AmbienteFiscal;
  /** `empresas_fiscais.focus_empresa_id` — o id que o POST /v2/empresas devolveu. */
  focusEmpresaId: number | null;
  temTokenProducao: boolean;
  /** ISO do `arquivos_auxiliares.cert_not_after` vivo, ou null. */
  certNotAfter: string | null;
};

export type MotivoNaoPromover =
  | 'ja_em_producao'
  | 'origem_propria'
  | 'nao_cadastrada_na_focus'
  | 'sem_token_producao'
  | 'certificado_invalido';

export type DecisaoPromocao =
  | { promover: true }
  | { promover: false; motivo: MotivoNaoPromover };

export const MENSAGEM_NAO_PROMOVIDA: Record<MotivoNaoPromover, string> = {
  ja_em_producao:
    'Esta empresa já está configurada para emitir em produção.',
  origem_propria:
    'Esta empresa usa a própria conta na Focus. A habilitação de produção é feita no painel dela.',
  nao_cadastrada_na_focus:
    'Esta empresa ainda não foi cadastrada na Focus — sem isso não há o que habilitar.',
  sem_token_producao:
    'A Focus ainda não devolveu o token de produção desta empresa.',
  certificado_invalido:
    'O certificado A1 está vencido ou não pôde ser lido.',
};

/**
 * Vale a pena TENTAR a promoção? Pura, e por isso testável sem banco.
 *
 * A ordem das checagens é a ordem em que a mensagem fica útil: primeiro o que
 * não é problema nenhum (já está em produção), depois o que está fora do nosso
 * alcance (conta do cliente), depois o que falta.
 */
export function decidirPromocao(e: EstadoPromocao, agora: Date = new Date()): DecisaoPromocao {
  // Não é erro, é ausência de trabalho — o chamador não deve avisar nada.
  if (e.ambiente === 'prod') return { promover: false, motivo: 'ja_em_producao' };

  // O PUT /v2/empresas/:id é aberto pela credencial da PLATAFORMA. Com origem
  // 'propria' o token que temos é o da empresa, e ele leva 401 (provado
  // 20/08/2026). Mesma guarda de `syncEmpresaNaFocus`/`atualizarEmpresaNaFocus`.
  if (e.origem === 'propria') return { promover: false, motivo: 'origem_propria' };

  if (e.focusEmpresaId == null) return { promover: false, motivo: 'nao_cadastrada_na_focus' };

  // Checado ANTES do PUT de propósito: sem token de produção, `decidirCredencial`
  // recusaria no fim de qualquer jeito, e teríamos pedido produção à Focus para
  // uma empresa que não tem como emitir. Falhar cedo evita deixar o estado da
  // Focus à frente do nosso.
  if (!e.temTokenProducao) return { promover: false, motivo: 'sem_token_producao' };

  // Mesmo critério de `decidirCredencial` — repetido aqui pelo mesmo motivo do
  // token: não pedir à Focus o que a guarda vai recusar depois.
  const vence = e.certNotAfter ? new Date(e.certNotAfter).getTime() : 0;
  if (!vence || vence <= agora.getTime()) return { promover: false, motivo: 'certificado_invalido' };

  return { promover: true };
}

export type ResultadoPromocao =
  | { liberada: true }
  /** Nem chegou a tentar — `decidirPromocao` disse não. */
  | { liberada: false; motivo: MotivoNaoPromover }
  /** O PUT na Focus falhou (rede, 4xx, payload). */
  | { liberada: false; motivo: 'focus_recusou'; detalhe: string }
  /** PUT aceito, mas o snapshot seguinte NÃO trouxe `habilita_nfsen_producao`. */
  | { liberada: false; motivo: 'focus_nao_confirmou' }
  /** A guarda de emissão recusou o estado final — a coluna NÃO foi gravada. */
  | { liberada: false; motivo: 'guarda_recusou'; detalhe: MotivoRecusa }
  /** Tudo passou e o UPDATE não pegou nenhuma linha. */
  | { liberada: false; motivo: 'nao_gravou' };

/** Texto para tela. Nunca expõe token nem detalhe de credencial. */
export function mensagemPromocao(r: ResultadoPromocao): string {
  if (r.liberada) return 'Emissão em produção liberada para esta empresa.';
  switch (r.motivo) {
    case 'focus_recusou':
      return `A Focus recusou a habilitação de produção: ${r.detalhe.slice(0, 200)}`;
    case 'focus_nao_confirmou':
      return 'A Focus aceitou o pedido mas ainda não confirmou a habilitação de produção. Tente de novo em alguns minutos.';
    case 'guarda_recusou':
      return MENSAGEM_RECUSA[r.detalhe];
    case 'nao_gravou':
      return 'A habilitação foi confirmada pela Focus, mas não foi possível salvar. Tente de novo.';
    default:
      return MENSAGEM_NAO_PROMOVIDA[r.motivo];
  }
}

/**
 * Tenta levar a empresa de homologação para produção, na ordem que quebra o
 * ciclo: PEDE → RELÊ → JULGA → GRAVA.
 *
 * ⚠️ SERVICE ROLE por dentro, sempre. `focus_ambiente` e
 * `focus_habilita_nfsen_producao` são duas das quatro colunas que a 0098
 * protege com trigger contra escrita de `authenticated` — e o upload de
 * certificado do DONO chega aqui com o client de sessão dele. Com esse client o
 * trigger derrubaria o UPDATE inteiro e a promoção viraria no-op silencioso,
 * exatamente o defeito que a 0099 achou no snapshot.
 *
 * ⚠️ QUEM CHAMA É RESPONSÁVEL POR TER PROVADO QUE `companyId` PERTENCE A QUEM
 * ESTÁ PEDINDO — mesma responsabilidade de `lerEstadoFiscal`.
 *
 * Best-effort: NUNCA lança. O chamador é um caminho que não pode quebrar por
 * causa disto (o certificado do cliente já está salvo quando chegamos aqui).
 */
export async function promoverParaProducao(companyId: string): Promise<ResultadoPromocao> {
  try {
    const admin = createAdminClient();

    const leitura = await lerEstadoFiscal(companyId, admin);
    if (!leitura.ok) return { liberada: false, motivo: 'guarda_recusou', detalhe: leitura.motivo };

    // `focus_empresa_id` não faz parte de `EstadoFiscal` (a guarda de emissão
    // não precisa dele), mas a promoção precisa: sem cadastro na Focus não há
    // recurso para o PUT endereçar.
    const { data: fiscal } = await admin
      .from('empresas_fiscais')
      .select('focus_empresa_id')
      .eq('empresa_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();

    const decisao = decidirPromocao({
      origem: leitura.estado.origem,
      ambiente: leitura.estado.ambiente,
      focusEmpresaId: (fiscal?.focus_empresa_id as number | null) ?? null,
      temTokenProducao: Boolean(leitura.estado.tokenProd),
      certNotAfter: leitura.estado.certNotAfter,
    });
    if (!decisao.promover) return { liberada: false, motivo: decisao.motivo };

    // 1) PEDE. Ambiente explícito 'prod' — este é o segundo uso legítimo do
    //    parâmetro (o primeiro são os scripts de smoke). É justamente por ser
    //    explícito que o ciclo abre: o valor NÃO sai de `focus_ambiente`, que é
    //    o que ele está tentando mudar.
    //    Se o passo 3 recusar depois disto, a Focus fica com produção habilitada
    //    e o Balu continua em 'hom'. Isso é seguro — a emissão lê `focus_ambiente`,
    //    não a Focus — e se conserta sozinho na próxima tentativa.
    const put = await atualizarEmpresaNaFocus(admin, companyId, 'prod');
    if (!put.ok) return { liberada: false, motivo: 'focus_recusou', detalhe: put.error };

    // 2) RELÊ. `atualizarEmpresaNaFocus` já refez o snapshot depois do PUT, então
    //    `habilitaProducaoFocus` aqui é o que a Focus respondeu agora — não o que
    //    estava gravado antes.
    const depois = await lerEstadoFiscal(companyId, admin);
    if (!depois.ok) return { liberada: false, motivo: 'guarda_recusou', detalhe: depois.motivo };
    if (!depois.estado.habilitaProducaoFocus) return { liberada: false, motivo: 'focus_nao_confirmou' };

    // 3) JULGA, com o estado real e só o ambiente trocado pelo pretendido —
    //    mesma técnica da pré-validação de `definirModoFiscalAction`. Nada de
    //    simular certificado ou token que não existem.
    const veredito = decidirCredencial({ ...depois.estado, ambiente: 'prod' });
    if (!veredito.ok) return { liberada: false, motivo: 'guarda_recusou', detalhe: veredito.motivo };

    // 4) GRAVA. `.select()` obrigatório: sem ele, zero linhas afetadas voltaria
    //    como sucesso — o mesmo defeito silencioso da 0099.
    const { data: gravado, error } = await admin
      .from('empresas_fiscais')
      .update({ focus_ambiente: 'prod', updated_at: new Date().toISOString() })
      .eq('empresa_id', companyId)
      .is('deleted_at', null)
      .select('empresa_id');
    if (error) {
      console.error('[promocao] focus_ambiente nao gravado:', companyId, error.message);
      return { liberada: false, motivo: 'nao_gravou' };
    }
    if ((gravado?.length ?? 0) === 0) return { liberada: false, motivo: 'nao_gravou' };

    return { liberada: true };
  } catch (err) {
    console.error('[promocao] falha inesperada em', companyId, err instanceof Error ? err.message : err);
    return { liberada: false, motivo: 'focus_recusou', detalhe: 'erro inesperado ao habilitar produção' };
  }
}
