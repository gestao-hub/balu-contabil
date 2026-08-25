// Encerra por inatividade os atendimentos cujo relógio venceu.
//
// PEDIDO DO USUÁRIO (25/08/2026): quando a pessoa agradece, o assistente
// responde ao agradecimento; se não houver mais nada em 5 minutos, ele agradece
// o contato, diz que está à disposição e encerra.
//
// O RELÓGIO É ARMADO PELO WEBHOOK, não aqui — `armarEncerramento` grava
// `encerrar_em` na linha ao responder um agradecimento entregue (0105). Este
// arquivo só varre o que venceu. A separação importa: o cron nunca decide se
// algo *era* agradecimento, então não há duas leituras da mesma regra para
// divergirem com o tempo.
//
// ⚠️ POR QUE pg_cron E NÃO cron DA VERCEL. Os crons da Vercel neste projeto são
// diários (`vercel.json`) e o plano limita a quantidade; 5 minutos exige
// granularidade de minuto. `pg_cron` + `pg_net` já estão instalados e em uso
// aqui (dois jobs diários), e aceitam `* * * * *`. O agendamento vive em
// `scratchpad/_agendar-cron-encerramento.mjs`, que interpola o `CRON_SECRET` do
// `.env.local` — mesmo padrão de `_agendar-cron-base-juridica.mjs`, e é o que
// mantém o segredo fora do git.
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checarCron } from '@/lib/security/segredo';
import { enviarMensagem } from '@/lib/uazapi/cliente';
import { configDaPlataforma, escritorioPorId } from '@/lib/uazapi/instancia';
import { TEXTO_ENCERRAMENTO, MINUTOS_ATE_ENCERRAR } from '@/lib/atendimento/agradecimento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Teto por execução. O cron roda de minuto em minuto: se algum dia houver uma
 *  fila grande, ela escoa em vários minutos em vez de estourar o tempo da
 *  função — e o `log` abaixo diz que sobrou, para o corte não passar por
 *  "encerrei tudo". */
const MAX_POR_RODADA = 50;

/**
 * De quanto tempo atrás conta "a pessoa voltou a falar".
 *
 * O relógio é armado para `agora + MINUTOS_ATE_ENCERRAR`, então
 * `encerrar_em - MINUTOS_ATE_ENCERRAR` é o instante em que ele foi armado — ou
 * seja, o momento do agradecimento. Toda linha do mesmo telefone criada DEPOIS
 * disso é a pessoa tendo voltado a falar.
 *
 * DERIVA da constante, não repete o número: com um `5` solto aqui, mudar o
 * prazo para 10 minutos faria esta janela parar de enxergar metade dos retornos
 * — e o sintoma seria o assistente se despedindo no meio da conversa, sem nada
 * no código apontando para cá.
 */
const MINUTOS_DA_JANELA_ARMADA = MINUTOS_ATE_ENCERRAR;

type Linha = {
  id: string;
  telefone: string;
  contabilidade_id: string | null;
  encerrar_em: string;
};

export async function GET(req: Request) {
  const recusa = checarCron(req);
  if (recusa) return NextResponse.json(recusa.body, { status: recusa.status });

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('whatsapp_atendimentos')
    .select('id, telefone, contabilidade_id, encerrar_em')
    .not('encerrar_em', 'is', null)
    .is('encerrado_em', null)
    .lte('encerrar_em', new Date().toISOString())
    .order('encerrar_em', { ascending: true })
    .limit(MAX_POR_RODADA + 1);

  if (error) {
    console.error('[cron encerrar] falha ao ler a fila:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const todas = (data ?? []) as Linha[];
  const fila = todas.slice(0, MAX_POR_RODADA);
  const sobrou = todas.length > MAX_POR_RODADA;

  let encerrados = 0;
  let cancelados = 0;
  let falhas = 0;

  for (const linha of fila) {
    try {
      // ═══ A PESSOA VOLTOU A FALAR? ENTÃO NÃO HÁ O QUE ENCERRAR ═══
      //
      // Entre armar o relógio e ele vencer, a pessoa pode ter mandado outra
      // mensagem — e aí a conversa não parou, ela continuou. Despedir-se no
      // meio dela seria pior do que nunca ter tido a funcionalidade.
      //
      // A checagem é por TELEFONE e por tempo, não pela linha: a mensagem nova
      // gera uma linha NOVA, então olhar só para esta nunca veria a volta.
      const { count } = await admin
        .from('whatsapp_atendimentos')
        .select('id', { count: 'exact', head: true })
        .eq('telefone', linha.telefone)
        .neq('id', linha.id)
        .gt('created_at', new Date(new Date(linha.encerrar_em).getTime()
          - MINUTOS_DA_JANELA_ARMADA * 60_000).toISOString());

      if ((count ?? 0) > 0) {
        // Desarma sem despedida. `encerrado_em` fica NULL de propósito: este
        // atendimento não foi encerrado, ele foi RETOMADO.
        await admin.from('whatsapp_atendimentos')
          .update({ encerrar_em: null }).eq('id', linha.id);
        cancelados++;
        continue;
      }

      // O canal: escritório dono da linha, ou a plataforma. Usa `config`
      // (envio ATIVO), não `configDeResposta` — aqui ninguém escreveu para nós
      // agora, então uma instância desconectada é silêncio de verdade, e
      // mandar por ela seria falar com o vazio e receber `ok` de volta.
      const canal = linha.contabilidade_id
        ? (await escritorioPorId(admin, linha.contabilidade_id))?.config ?? null
        : await configDaPlataforma();

      if (!canal) {
        console.warn('[cron encerrar] sem canal para', linha.id, '— deixando armado');
        falhas++;
        continue;
      }

      const envio = await enviarMensagem(canal, {
        telefone: linha.telefone,
        texto: TEXTO_ENCERRAMENTO,
      });

      if (!envio.ok) {
        // Fica armado para a próxima rodada: o relógio já venceu, então a
        // consulta o pega de novo daqui a um minuto. Não gravamos
        // `encerrado_em` — dizer "encerrado" sem ter entregue a despedida é
        // exatamente a "falha que retorna sucesso" que a auditoria de hoje
        // procurou o dia inteiro.
        console.error('[cron encerrar] envio falhou para', linha.id, envio.erro ?? 'desconhecido');
        falhas++;
        continue;
      }

      const { error: erroUp } = await admin
        .from('whatsapp_atendimentos')
        .update({ encerrado_em: new Date().toISOString(), encerrar_em: null })
        .eq('id', linha.id);
      if (erroUp) {
        // A despedida JÁ FOI. Se o carimbo não gravar, a próxima rodada
        // mandaria de novo — então isto precisa gritar no log, não passar.
        console.error('[cron encerrar] despedida enviada mas carimbo falhou para', linha.id, erroUp.message);
        falhas++;
        continue;
      }
      encerrados++;
    } catch (e) {
      console.error('[cron encerrar] erro inesperado em', linha.id, e instanceof Error ? e.message : String(e));
      falhas++;
    }
  }

  if (sobrou) {
    console.warn(`[cron encerrar] fila maior que ${MAX_POR_RODADA}; o resto sai na próxima rodada`);
  }

  return NextResponse.json({
    ok: true, encerrados, cancelados, falhas, truncado: sobrou,
  });
}
