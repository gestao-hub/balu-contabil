'use server';
// "Usar serviço" — emite a cobrança de um serviço do catálogo a partir da
// própria tela do catálogo, para um cliente da carteira OU para quem o
// escritório atende sem ter na carteira (cliente avulso, 0108).
//
// A mecânica de emissão (gate, subconta, credencial, Asaas, idempotência,
// persistência, auditoria) continua em `@/lib/billing/emitir-cobranca` — porta
// única. Aqui só se resolve PARA QUEM e POR QUANTO, com as mesmas regras de
// `clientes/[companyId]/cobrar-actions.ts`.
//
// Nada de puro exportado deste arquivo: 'use server' só pode exportar função
// async (ver o cabeçalho de `cobrar-actions.ts`).
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { valorFinalCentavos } from '@/lib/billing/avulso';
import {
  emitirCobrancaEscritorio, clienteDaCarteira, clienteAvulsoDoEscritorio,
  type ClienteCobravel,
} from '@/lib/billing/emitir-cobranca';
import { documentoValido, telefoneValido, emailValido } from '@/lib/billing/cliente-avulso';
import { registrarAuditoria } from '@/lib/security/audit';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { UsarServicoSchema } from '@/types/zod';

export type UsarServicoResult =
  | {
      ok: true;
      linkFatura: string | null;
      /** Só para cliente FORA da carteira: ele não tem app, então a tela
       *  oferece mandar a fatura por WhatsApp/e-mail na hora. */
      compartilhar: {
        nome: string; email: string | null; telefone: string | null;
        descricao: string; valorCentavos: number; vencimento: string;
      } | null;
    }
  | { ok: false; error: string; linkFatura?: string | null };

const NAO_ACHADO = 'Cliente não encontrado.';

export async function usarServicoAction(entrada: unknown): Promise<UsarServicoResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = UsarServicoSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  const dados = parsed.data;

  // Mesmo motivo de `cobrar-actions.ts`: em BRT, para não recusar o próprio
  // dia depois das 21h (a Vercel roda em UTC).
  if (dados.vencimento < ymdBrt()) {
    return { ok: false, error: 'O vencimento não pode ser anterior a hoje.' };
  }

  const sb = createAdminClient();

  // ─── O SERVIÇO ─────────────────────────────────────────────────────────────
  // `.eq('contabilidade_id')` além do id: o admin client ignora RLS.
  const { data: srv } = await sb.from('servicos_avulsos')
    .select('id, nome, tipo_valor, valor_centavos, percentual, ativo')
    .eq('id', dados.servicoAvulsoId).eq('contabilidade_id', ctx.id).maybeSingle();
  if (!srv) return { ok: false, error: 'Serviço não encontrado no catálogo.' };
  if (!srv.ativo) return { ok: false, error: 'Este serviço está desativado — reative-o para poder cobrar.' };

  const valor = valorFinalCentavos(
    { tipoValor: srv.tipo_valor, valorCentavos: srv.valor_centavos, percentual: srv.percentual },
    dados.baseCentavos,
  );
  if (valor == null) {
    return srv.tipo_valor === 'percentual'
      ? { ok: false, error: 'Este serviço é percentual — informe o valor-base da cobrança.' }
      : { ok: false, error: 'Este serviço está sem valor no catálogo — corrija-o antes de cobrar.' };
  }
  const descricao = dados.descricaoLivre || srv.nome;

  // ─── PARA QUEM ─────────────────────────────────────────────────────────────
  let cliente: ClienteCobravel | null = null;
  let contato: { email: string | null; telefone: string | null } | null = null;
  const d = dados.destino;

  if (d.tipo === 'empresa') {
    // ANTI-IDOR: só empresa da carteira DESTE escritório.
    cliente = await clienteDaCarteira(sb, ctx.id, d.companyId);
    if (!cliente) return { ok: false, error: NAO_ACHADO };
  } else if (d.tipo === 'avulso') {
    cliente = await clienteAvulsoDoEscritorio(sb, ctx.id, d.clienteAvulsoId);
    if (!cliente) return { ok: false, error: NAO_ACHADO };
    const { data: c } = await sb.from('clientes_avulsos').select('email, telefone')
      .eq('id', cliente.id).eq('contabilidade_id', ctx.id).maybeSingle();
    contato = { email: c?.email ?? null, telefone: c?.telefone ?? null };
  } else {
    const doc = documentoValido(d.cpfCnpj);
    if (!doc) return { ok: false, error: 'CPF/CNPJ inválido — confira os números.' };
    const email = d.email ? emailValido(d.email) : null;
    if (d.email && !email) return { ok: false, error: 'E-mail inválido.' };
    const telefone = d.telefone ? telefoneValido(d.telefone) : null;
    if (d.telefone && !telefone) return { ok: false, error: 'WhatsApp inválido — informe com DDD.' };

    // Documento que JÁ é de uma empresa da carteira vai para a carteira: lá o
    // cliente vê a cobrança no próprio app, e não nasce um cadastro paralelo
    // da mesma empresa.
    // `companies.cnpj` pode estar gravado com ou sem máscara — procura os dois.
    const mascarado = doc.length === 14
      ? doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
      : doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    const { data: daCarteira } = await sb.from('companies').select('id')
      .eq('contabilidade_id', ctx.id).is('deleted_at', null).in('cnpj', [doc, mascarado]).limit(1);
    if (daCarteira?.[0]) {
      cliente = await clienteDaCarteira(sb, ctx.id, daCarteira[0].id as string);
    } else {
      // Mesmo documento já cadastrado: reaproveita a linha (índice único da
      // 0108) e atualiza só o contato que veio preenchido — um campo deixado
      // em branco agora não apaga o que o escritório já tinha.
      const { data: existente, error: eLer } = await sb.from('clientes_avulsos').select('id, email, telefone')
        .eq('contabilidade_id', ctx.id).eq('cpf_cnpj', doc).maybeSingle();
      if (eLer) {
        console.error('[avulso] leitura do cliente avulso falhou:', eLer.message);
        return { ok: false, error: 'Não foi possível cadastrar o cliente agora. Tente de novo.' };
      }
      let id: string;
      if (existente) {
        id = existente.id as string;
        const { error: eUpd } = await sb.from('clientes_avulsos').update({
          nome: d.nome.trim(),
          email: email ?? existente.email ?? null,
          telefone: telefone ?? existente.telefone ?? null,
          updated_at: new Date().toISOString(),
        }).eq('id', id).eq('contabilidade_id', ctx.id);
        if (eUpd) console.error('[avulso] atualizar contato do cliente avulso falhou:', eUpd.message);
        contato = { email: email ?? existente.email ?? null, telefone: telefone ?? existente.telefone ?? null };
      } else {
        const { data: novo, error: eIns } = await sb.from('clientes_avulsos').insert({
          contabilidade_id: ctx.id, nome: d.nome.trim(), cpf_cnpj: doc, email, telefone,
        }).select('id').single();
        if (eIns || !novo) {
          console.error('[avulso] cadastrar cliente avulso falhou:', eIns?.message);
          return { ok: false, error: 'Não foi possível cadastrar o cliente agora. Tente de novo.' };
        }
        id = novo.id as string;
        contato = { email, telefone };
        await registrarAuditoria({
          actorUserId: ctx.userId, acao: 'cliente_avulso.criar',
          alvoTipo: 'cliente_avulso', alvoId: id, contabilidadeId: ctx.id,
        });
      }
      cliente = { origem: 'avulso', id, nome: d.nome.trim(), cpfCnpj: doc, email: contato.email };
    }
    if (!cliente) return { ok: false, error: NAO_ACHADO };
  }

  // ─── EMISSÃO ───────────────────────────────────────────────────────────────
  const r = await emitirCobrancaEscritorio(sb, {
    contabilidadeId: ctx.id,
    userId: ctx.userId,
    cliente,
    descricao,
    valorCentavos: valor,
    vencimento: dados.vencimento,
    servicoAvulsoId: srv.id,
    honorarioId: null,
    // Chave da submissão, gerada pela tela uma vez por abertura do card —
    // ver o cabeçalho de `CobrarDialog.tsx`.
    idempotencyKey: dados.idempotencyKey,
  });
  if (!r.ok) return r;

  revalidatePath('/contador/cobrancas');
  if (cliente.origem !== 'avulso') revalidatePath(`/contador/clientes/${cliente.id}`);

  return {
    ok: true,
    linkFatura: r.linkFatura,
    compartilhar: cliente.origem === 'avulso'
      ? {
          nome: cliente.nome, email: contato?.email ?? null, telefone: contato?.telefone ?? null,
          descricao, valorCentavos: valor, vencimento: dados.vencimento,
        }
      : null,
  };
}
