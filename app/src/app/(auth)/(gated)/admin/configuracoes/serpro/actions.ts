'use server';
// 0094 — credenciais do SERPRO Integra Contador (AdminBalu).
//
// DUAS COISAS DIFERENTES MORAM NESTA TELA, e é bom não confundi-las:
//
//   1. consumer key/secret — o par que identifica o CONTRATO da Balu com o
//      SERPRO. Vinha de `process.env`; passa a morar em `config_serpro` (0094).
//   2. certificado do CONTRATANTE — o A1 da empresa que assina o mTLS com a
//      Receita em nome de todos os clientes. Já morava em `serpro_contratante`
//      desde antes desta migration; o que faltava era TELA. Até hoje ele só
//      entrava por `scripts/upload-serpro-system-cert.mjs`, que tem caminho de
//      arquivo fixo de outra máquina (`/home/allan/Projetos/...`) e portanto
//      não roda para mais ninguém.
//
// O certificado do contratante NÃO é o certificado por empresa: aquele tem tela
// própria em `/configuracoes` e mora em `arquivos_auxiliares`.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { encryptBlob } from '@/lib/crypto/envelope';
import { parsePkcs12, type CertMaterial } from '@/lib/fiscal/pkcs12';
import { guardarSegredoSerpro, invalidarCacheSerpro } from '@/lib/fiscal/config-serpro';
import { getContratante } from '@/lib/fiscal/serpro-contratante';
import { autenticarContratante } from '@/lib/clients/serpro-auth';
import { ConfigSerproSchema } from '@/types/zod';

type ActionResult = { ok: true } | { ok: false; error: string };

const ROTA = '/admin/configuracoes/serpro';

/** .pfx de e-CNPJ tem alguns KB. O teto existe para que um arquivo trocado por
 *  engano (um PDF, um ZIP) morra antes de virar parse e antes de virar linha. */
const MAX_PFX_BYTES = 512 * 1024;

export async function salvarConfigSerproAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = ConfigSerproSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }

  const key = (parsed.data.consumer_key ?? '').trim();
  const secret = (parsed.data.consumer_secret ?? '').trim();
  if (!key && !secret) {
    return { ok: false, error: 'Preencha ao menos um dos dois campos para salvar.' };
  }

  const sb = createAdminClient();
  const { data: atual, error: eLer } = await sb
    .from('config_serpro')
    .select('id, consumer_key_cifrado, consumer_secret_cifrado')
    .eq('id', 1)
    .maybeSingle();
  if (eLer) {
    console.error('[0094] config_serpro leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler a configuração. Tente de novo.' };
  }

  // MEIA CREDENCIAL É PIOR QUE NENHUMA: com só um dos dois gravados,
  // `obterCredenciaisSerpro` cai no fallback de ambiente e a chamada sai com a
  // credencial ANTIGA — o admin trocaria a chave, veria "salvo", e a Receita
  // continuaria respondendo com a de antes. Barrado na entrada.
  const teraKey = key || atual?.consumer_key_cifrado;
  const teraSecret = secret || atual?.consumer_secret_cifrado;
  if (!teraKey || !teraSecret) {
    return {
      ok: false,
      error: 'Consumer key e secret têm de existir juntos. Preencha os dois nesta primeira gravação.',
    };
  }

  const patch: Record<string, unknown> = {
    atualizado_por: ctx.userId,
    atualizado_em: new Date().toISOString(),
  };
  try {
    // CAMPO VAZIO = NÃO TROCAR.
    if (key) patch.consumer_key_cifrado = guardarSegredoSerpro(key);
    if (secret) patch.consumer_secret_cifrado = guardarSegredoSerpro(secret);
  } catch {
    return { ok: false, error: 'Não foi possível proteger a credencial. Nada foi salvo.' };
  }

  if (atual) {
    // UPDATE, NUNCA UPSERT — o upsert do PostgREST manda NULL nas colunas
    // ausentes, e salvar só a key apagaria o secret.
    const { data, error } = await sb
      .from('config_serpro').update(patch).eq('id', 1).select('id');
    if (error) {
      console.error('[0094] config_serpro update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, error: 'A configuração não foi encontrada. Recarregue a página.' };
    }
  } else {
    const { error } = await sb.from('config_serpro').insert({ id: 1, ...patch });
    if (error) {
      console.error('[0094] config_serpro insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
  }

  invalidarCacheSerpro();

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'serpro.config_salvar',
    alvoTipo: 'config_serpro',
    alvoId: '1',
    meta: { trocou_key: Boolean(key), trocou_secret: Boolean(secret) },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * Sobe o certificado A1 do CONTRATANTE (mTLS com a Receita).
 *
 * O PFX e a senha são guardados como estão, cifrados — diferente do
 * certificado por empresa, que é convertido para PEM e tem a senha descartada.
 * O motivo é técnico: `https.request({ pfx, passphrase })` precisa do PKCS#12
 * original para o handshake.
 */
export async function enviarCertContratanteAction(form: FormData): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const arquivo = form.get('arquivo');
  const senha = String(form.get('senha') ?? '');
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, error: 'Escolha o arquivo .pfx do certificado.' };
  }
  if (arquivo.size > MAX_PFX_BYTES) {
    return { ok: false, error: 'Arquivo grande demais para ser um certificado A1.' };
  }
  if (!senha) {
    return { ok: false, error: 'Informe a senha do certificado.' };
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());

  // A SENHA É VALIDADA DE VERDADE AQUI: `parsePkcs12` só abre o PKCS#12 com a
  // senha certa. Guardar sem abrir deixaria o erro para o primeiro mTLS, de
  // madrugada, dentro do cron — longe de quem digitou.
  let material: CertMaterial;
  try {
    material = parsePkcs12(bytes, senha);
  } catch {
    return { ok: false, error: 'Não foi possível abrir o certificado. Verifique o arquivo e a senha.' };
  }

  if (new Date(material.notAfter).getTime() < Date.now()) {
    return {
      ok: false,
      error: `Certificado expirado em ${new Date(material.notAfter).toLocaleDateString('pt-BR')}.`,
    };
  }
  if (!material.cnpj) {
    // `serpro_contratante.cnpj` é NOT NULL, e o CNPJ é o que identifica o
    // contratante no envelope da Receita. Sem ele não há linha honesta a gravar.
    return {
      ok: false,
      error: 'O certificado não traz CNPJ no titular. O contratante do SERPRO precisa ser um e-CNPJ.',
    };
  }

  let pfxEnc: string;
  let senhaEnc: string;
  try {
    pfxEnc = encryptBlob(bytes).toString('base64');
    senhaEnc = encryptBlob(Buffer.from(senha, 'utf8')).toString('base64');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro interno ao cifrar o certificado.' };
  }

  const sb = createAdminClient();
  const { data: atual } = await sb
    .from('serpro_contratante').select('id').limit(1).maybeSingle();

  const linha = {
    cnpj: material.cnpj,
    nome: material.subjectCN,
    cert_pfx_enc: pfxEnc,
    cert_password_enc: senhaEnc,
    cert_not_after: material.notAfter,
    cert_subject_cn: material.subjectCN,
    // OS TOKENS DE SESSÃO SÃO ZERADOS: eles foram emitidos para o certificado
    // ANTIGO. Mantê-los faria a próxima chamada reusar um token que a Receita
    // já não reconhece, e o erro apareceria como falha da Receita.
    auth_access_token: null,
    auth_jwt_token: null,
    auth_token_expiration: null,
    updated_at: new Date().toISOString(),
  };

  if (atual) {
    const { data, error } = await sb
      .from('serpro_contratante').update(linha).eq('id', atual.id).select('id');
    if (error) {
      console.error('[0094] serpro_contratante update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar o certificado. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, error: 'O contratante não foi encontrado. Recarregue a página.' };
    }
  } else {
    const { error } = await sb.from('serpro_contratante').insert(linha);
    if (error) {
      console.error('[0094] serpro_contratante insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar o certificado. Tente de novo.' };
    }
  }

  // Nem o arquivo nem a senha entram na auditoria. O que interessa registrar é
  // qual certificado passou a valer — e isso o CNPJ e a validade já contam.
  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'serpro.cert_contratante_enviar',
    alvoTipo: 'serpro_contratante',
    alvoId: atual?.id ?? null,
    meta: { cnpj: material.cnpj, subject_cn: material.subjectCN, not_after: material.notAfter },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * Testa credencial + certificado juntos, contra o SERPRO de verdade.
 *
 * É o único teste honesto possível: o `/authenticate` do SERPRO exige mTLS com
 * o certificado do contratante E o Basic com consumer key/secret. Falhar em um
 * dos dois derruba a chamada, então o sucesso prova os dois de uma vez.
 */
export async function testarConexaoSerproAction(): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const contratante = await getContratante();
  if (!contratante) {
    return { ok: false, error: 'Nenhum certificado de contratante guardado — envie o .pfx primeiro.' };
  }

  try {
    await autenticarContratante(contratante.pfx, contratante.senha);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/→ 401|→ 403/.test(msg)) {
      return { ok: false, error: 'O SERPRO recusou a credencial ou o certificado (401/403).' };
    }
    if (/não configuradas/i.test(msg)) {
      return { ok: false, error: 'Consumer key/secret não estão guardados.' };
    }
    return {
      ok: false,
      error: `O SERPRO não recusou a credencial, mas a chamada falhou: ${msg.slice(0, 160)}`,
    };
  }
}
