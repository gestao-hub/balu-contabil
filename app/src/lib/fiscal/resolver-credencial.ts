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
  | 'producao_nao_declarada';

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
