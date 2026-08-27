'use server';
// Upload do certificado A1 do CLIENTE, feito pelo contador (card P11).
//
// POR QUE EXISTE: `uploadCertificadoAction` (/configuracoes) resolve a empresa
// por `profiles.current_company` do usuário logado — só o dono conseguia subir o
// próprio certificado. O Michel respondeu que consegue coletar o PFX e a senha
// de cada cliente do piloto (até 30 por regime), e não havia onde colocar. Sem
// esta tela, a esteira de certificados depende de até 60 clientes finais
// entrarem no Balu um a um, que é o caminho crítico mais lento do projeto.
//
// A RLS do contador em `arquivos_auxiliares` continua SELECT-only
// (`arquivos_aux_select_contador`, conferida no banco em 13/08/2026): a escrita
// é service role com a permissão PROVADA aqui, mesmo padrão de
// `contador/clientes/actions.ts` e `cobrar-actions.ts` — inclusive o erro
// genérico, que não revela se a empresa existe.
//
// CUSTÓDIA: quem sobe declara que o titular autorizou. A declaração não é
// enfeite de tela — a chave privada guardada aqui assina Termo de Autorização
// em nome do CNPJ do cliente na SERPRO. O rastro fica em três lugares: o
// `audit_log` (service role, o registro que vale), as colunas `cert_enviado_por`
// /`cert_enviado_em` da 0085, e a tela do próprio empresário, que passa a ver
// que o escritório enviou o certificado dele e quando.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { companyDaCarteira } from '@/lib/contador/carteira';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';
import { processarUploadCertificado } from '@/lib/fiscal/cert-upload';
import { registrarAuditoria } from '@/lib/security/audit';

export type UploadCertClienteResult =
  | { ok: true; warning?: string; info?: string }
  | { ok: false; error: string };

export async function uploadCertificadoClienteAction(
  formData: FormData,
): Promise<UploadCertClienteResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const companyId = String(formData.get('companyId') ?? '');
  const file = formData.get('file');
  const senha = String(formData.get('senha') ?? '');
  const declarou = String(formData.get('autorizacao') ?? '') === 'on';

  if (!companyId) return { ok: false, error: 'Cliente não informado.' };
  if (!(file instanceof File)) return { ok: false, error: 'Selecione o arquivo do certificado.' };
  if (!declarou) {
    return { ok: false, error: 'Confirme que o titular autorizou a guarda do certificado.' };
  }

  const v = validateCertificadoUpload({ name: file.name, size: file.size, senha });
  if (!v.ok) return v;

  const admin = createAdminClient();

  // ANTI-IDOR: o admin client ignora RLS — sem esta checagem um companyId
  // qualquer instalaria certificado numa empresa de outro escritório.
  const alvo = await companyDaCarteira(admin, ctx.id, companyId);
  if (!alvo) return { ok: false, error: 'Empresa fora da sua carteira.' };

  const buf = Buffer.from(await file.arrayBuffer());
  const r = await processarUploadCertificado(admin, alvo.companyId, { bytes: buf, senha }, ctx.userId);
  if (!r.ok) return r;

  // Depois do sucesso: o que não pode acontecer é registrar auditoria de um
  // upload que falhou. Best-effort por dentro — nunca derruba a ação.
  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'cert.upload_contador',
    alvoTipo: 'company',
    alvoId: alvo.companyId,
    contabilidadeId: ctx.id,
    meta: { validade: r.notAfter, declaracao_titular: true, producao_liberada: r.producao?.liberada === true },
  });

  revalidatePath(`/contador/clientes/${alvo.companyId}`);
  revalidatePath('/contador');
  if (r.warnings.length) return { ok: true, warning: r.warnings.join(' ') };
  return r.producao?.liberada
    ? { ok: true, info: 'Certificado enviado. Emissão em produção liberada para este cliente.' }
    : { ok: true };
}
