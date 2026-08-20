// Saúde das instâncias de WhatsApp dos escritórios (0092).
//
// POR QUE ISTO EXISTE, com número: em 19/08/2026 o servidor uazapi hospedava
// 37 instâncias e **24 estavam desconectadas**. Cair é o estado normal de uma
// sessão de WhatsApp — o aparelho reinicia, o chip sai, o próprio WhatsApp
// desconecta dispositivos antigos.
//
// Sem esta varredura o canal do escritório morre em SILÊNCIO: o cliente
// escreve e ninguém responde, o aviso de DAS para de sair, e o escritório só
// descobre quando alguém reclama. É o modo de falhar que este projeto combate
// desde o começo — o silêncio que parece sucesso.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decifrarCampo } from '@/lib/crypto/envelope';
import { statusInstancia } from './provisionamento';

export type ResultadoSaude = {
  verificadas: number;
  cairam: number;
  avisados: number;
  erros: number;
};

/**
 * Confere as instâncias que o banco diz estarem CONECTADAS e avisa o escritório
 * quando alguma caiu.
 *
 * Só as conectadas: uma instância que já está `desconectado` no banco não tem o
 * que avisar de novo — o aviso já saiu quando ela caiu.
 *
 * O aviso vai para o membro mais antigo, mesmo destinatário da escalação de
 * atendimento (`escalarParaContador`) e do billing (`donoDaAssinatura`). Seguir
 * o precedente evita N notificações por evento, que o resto do app não faz.
 *
 * Idempotente pela `chave`: uma queda gera UM aviso, não um por dia. A chave
 * inclui a data para que uma queda nova, semanas depois, volte a avisar.
 */
export async function verificarSaudeDosCanais(
  admin: SupabaseClient, hoje: Date = new Date(),
): Promise<ResultadoSaude> {
  const r: ResultadoSaude = { verificadas: 0, cairam: 0, avisados: 0, erros: 0 };

  const { data, error } = await admin
    .from('contabilidades')
    .select('id, nome, uazapi_token_cifrado')
    .eq('uazapi_status', 'conectado')
    .limit(100);

  if (error) {
    console.error('[saude whatsapp] leitura falhou:', error.message);
    return { ...r, erros: 1 };
  }

  for (const c of (data ?? []) as { id: string; nome: string | null; uazapi_token_cifrado: string | null }[]) {
    const token = decifrarCampo(c.uazapi_token_cifrado);
    if (!token) continue;

    r.verificadas++;
    const st = await statusInstancia(token);
    if (!st.ok) {
      // Falha de rede não é queda de instância. Contar e seguir: marcar
      // 'desconectado' aqui faria um blip de rede desligar o canal de um
      // escritório que está funcionando.
      r.erros++;
      continue;
    }
    if (st.dados.status === 'connected') continue;

    r.cairam++;

    // ⚠️ AVISAR ANTES DE MARCAR (achado do code-review de 19/08/2026).
    //
    // A ordem inversa criava um aviso que se perdia para sempre: marcada como
    // `desconectado`, a instância deixa de casar com o `.eq('uazapi_status',
    // 'conectado')` da próxima rodada, e um aviso que tivesse falhado (rede,
    // escritório sem membro) nunca mais teria uma segunda chance. Marcando
    // depois, a rodada seguinte tenta de novo.
    const { data: membro } = await admin
      .from('contabilidade_membros').select('user_id')
      .eq('contabilidade_id', c.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();

    const userId = (membro as { user_id: string } | null)?.user_id;
    if (!userId) {
      // Escritório sem nenhum membro: não há a quem avisar, e inventar
      // destinatário é pior que não avisar. O estado gravado ainda tem de
      // virar verdade, senão a instância é reconferida todo dia para sempre.
      console.warn('[saude whatsapp] escritorio sem membro, aviso pulado:', c.id);
      await admin.from('contabilidades')
        .update({ uazapi_status: 'desconectado', uazapi_conectado_em: null })
        .eq('id', c.id);
      continue;
    }

    const dia = hoje.toISOString().slice(0, 10);
    const { error: eAviso } = await admin.from('notifications').upsert({
      owner_user_id: userId,
      // `notifications` NÃO tem coluna de contabilidade — só `company_id`
      // (conferido no banco). Mandar `contabilidade_id` fazia o PostgREST
      // recusar a linha inteira, e o aviso NUNCA era gravado: a funcionalidade
      // inteira era silenciosa, exatamente o que o cabeçalho deste arquivo diz
      // existir para impedir. O escritório já está identificado na `chave`.
      company_id: null,
      tipo: 'whatsapp_desconectado',
      severidade: 'danger',
      titulo: 'O WhatsApp do escritório desconectou',
      corpo: 'Enquanto ele estiver fora, seus clientes não recebem aviso de imposto '
        + 'nem resposta do assistente por WhatsApp. Reconecte em Configurações → WhatsApp.',
      action_href: '/contador/configuracoes/whatsapp',
      chave: `whatsapp_desconectado:${c.id}:${dia}`,
    }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });

    if (eAviso) {
      // Aviso falhou: NÃO marca desconectado. A instância continua na varredura
      // e a rodada seguinte tenta avisar de novo.
      r.erros++;
      console.error('[saude whatsapp] aviso falhou:', eAviso.message);
      continue;
    }
    r.avisados++;

    await admin.from('contabilidades')
      .update({ uazapi_status: 'desconectado', uazapi_conectado_em: null })
      .eq('id', c.id);
  }

  return r;
}
