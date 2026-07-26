// src/lib/fiscal/declaracoes-anuais/registrar.ts
// Núcleo compartilhado do registro de declaração anual. Os dois callers
// (empresário e contador) provam a permissão ANTES de chegar aqui — ver spec §5.1.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { registrarAuditoria } from '@/lib/security/audit';
import { uploadToBucket } from '@/lib/clients/supabase-storage';
import { BUCKET_COMPROVANTES, caminhoComprovante, validarComprovante } from './comprovante';
import { TIPO_AVISO, type RegistroInput, type ResultadoRegistro } from './tipos';

export async function registrarDeclaracaoAnual(
  client: SupabaseClient,
  input: RegistroInput,
  contabilidadeId: string | null = null,
): Promise<ResultadoRegistro> {
  let comprovantePath: string | null = null;

  if (input.comprovante) {
    const v = validarComprovante({ mime: input.comprovante.mime, tamanho: input.comprovante.bytes.byteLength });
    if (!v.ok) return { ok: false, error: v.error };

    comprovantePath = caminhoComprovante(input.companyId, input.tipo, input.ano, input.comprovante.mime);
    // O bucket é privado e NÃO tem policy em storage.objects (0048): quem escreve
    // é a service role, como em abertura-documentos. Subir com o client da sessão
    // do empresário batia em "new row violates row-level security policy". A
    // permissão já foi provada pelos dois callers, e `caminhoComprovante` prende o
    // path ao companyId — o service role aqui não amplia o alcance de ninguém.
    try {
      await uploadToBucket(BUCKET_COMPROVANTES, comprovantePath, input.comprovante.bytes, input.comprovante.mime);
    } catch (e) {
      return { ok: false, error: `Falha ao subir o comprovante: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Estado anterior, para a auditoria da retificadora (spec §5.5).
  const { data: anterior } = await client
    .from('declaracoes_fiscais')
    .select('id, dados, numero_declaracao, data_transmissao')
    .eq('company_id', input.companyId)
    .eq('competencia_referencia', String(input.ano))
    .eq('tipo', input.tipo)
    .maybeSingle();

  // Entrega não regride para rascunho. O upsert reescreve toda coluna do payload,
  // então mandar `data_transmissao: null` num "salvar rascunho" feito DEPOIS da
  // entrega apagava a data, o número e o status de quem já tinha declarado —
  // perda de dado silenciosa. Editar os valores de uma declaração entregue é
  // retificação: os dados mudam, a entrega anterior permanece até que um novo
  // comprovante seja registrado por cima.
  const dataTransmissao = input.dataTransmissao ?? anterior?.data_transmissao ?? null;
  const numeroDeclaracao = input.numeroDeclaracao ?? anterior?.numero_declaracao ?? null;

  const linha: Record<string, unknown> = {
    company_id: input.companyId,
    owner_user_id: input.ownerUserId,
    competencia_referencia: String(input.ano),
    tipo: input.tipo,
    dados: input.dados,
    numero_declaracao: numeroDeclaracao,
    data_transmissao: dataTransmissao,
    status: dataTransmissao ? 'Transmitida' : 'Rascunho',
    divergencia_receita: input.divergenciaReceita ?? null,
    origem: input.origem,
    registrado_por: input.registradoPor,
  };
  if (comprovantePath) linha.comprovante_path = comprovantePath;

  const { data, error } = await client
    .from('declaracoes_fiscais')
    .upsert(linha, { onConflict: 'company_id,competencia_referencia,tipo' })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  const id = (data as { id: string }).id;

  // Só a entrega cala o alarme. Rascunho não silencia nada (spec §5.3).
  if (input.dataTransmissao) {
    const prefixo = `${TIPO_AVISO[input.tipo]}:${input.companyId}:${input.ano}:`;
    await client
      .from('notifications')
      .update({ lida_em: new Date().toISOString() })
      .eq('owner_user_id', input.ownerUserId)
      .like('chave', `${prefixo}%`)
      .is('lida_em', null);
  }

  await registrarAuditoria({
    actorUserId: input.registradoPor,
    acao: anterior ? 'declaracao.retificar' : 'declaracao.registrar',
    alvoTipo: 'declaracao_fiscal',
    alvoId: id,
    contabilidadeId,
    meta: {
      tipo: input.tipo,
      ano: input.ano,
      entregue: Boolean(input.dataTransmissao),
      divergenciaReceita: input.divergenciaReceita ?? null,
      anterior: anterior ?? null,
    },
  });

  return { ok: true, id };
}
