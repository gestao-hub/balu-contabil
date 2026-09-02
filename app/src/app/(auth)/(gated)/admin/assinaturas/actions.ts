'use server';
// Bloco 4A — o AdminBalu gerencia os planos. Mudar preco e ato
// administrativo com consequencia financeira: tudo vai pro audit_log.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { validarFaixas } from '@/lib/billing/validar-planos';
import { asaas } from '@/lib/clients/asaas';
import { VALOR_MINIMO_ASSINATURA_CENTAVOS } from '@/lib/billing/assinar';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export type PlanoInput = {
  id: string;
  nome: string;
  publico: 'empresa' | 'escritorio';
  valor_centavos: number;
  ciclo: 'MONTHLY' | 'YEARLY';
  clientes_min: number | null;
  clientes_max: number | null;
  trial_dias: number;
  ativo: boolean;
};

/** Status que significam "assinatura viva" — os que impedem desativar um
 *  plano e os que contam como "em uso" na tela. */
const VIVOS = ['trial', 'ativa', 'inadimplente'];

export async function salvarPlanoAction(input: PlanoInput): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  if (!input.id || !input.nome) return { ok: false, error: 'Id e nome são obrigatórios.' };
  if (!Number.isInteger(input.valor_centavos) || input.valor_centavos < 0) {
    return { ok: false, error: 'Valor inválido.' };
  }
  // GUARDA NA ORIGEM (02/09/2026). Sem ela, o admin salva um plano que o Asaas
  // vai recusar, e quem descobre e o TITULAR, no clique de assinar — que foi o
  // que aconteceu com o `empresario_mensal` em R$ 1,00. Barrar aqui troca um
  // erro no fim da jornada de outra pessoa por um aviso imediato para quem
  // decidiu o preco.
  //
  // Zero continua permitido: plano gratuito nao passa pelo Asaas.
  if (input.valor_centavos > 0 && input.valor_centavos < VALOR_MINIMO_ASSINATURA_CENTAVOS) {
    const min = (VALOR_MINIMO_ASSINATURA_CENTAVOS / 100).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
    });
    return {
      ok: false,
      error: `O Asaas não aceita cobrança abaixo de ${min} na forma de pagamento que usamos `
        + '("Pergunte ao Cliente", em que o cliente escolhe boleto, Pix ou cartão). '
        + 'Um plano com valor menor seria salvo aqui e recusado na hora de assinar.',
    };
  }
  if (!Number.isInteger(input.trial_dias) || input.trial_dias < 0) {
    return { ok: false, error: 'Dias de teste inválido.' };
  }

  const admin = createAdminClient();

  // Faixas so fazem sentido para escritorio; validar ANTES de salvar evita
  // que o admin crie o buraco que o cron de recalculo so descobriria no mes
  // seguinte, e em silencio.
  if (input.publico === 'escritorio') {
    const { data: outros } = await admin
      .from('planos').select('id, clientes_min, clientes_max')
      .eq('publico', 'escritorio').eq('ativo', true).neq('id', input.id);
    const conjunto = [
      ...(outros ?? []),
      ...(input.ativo
        ? [{ id: input.id, clientes_min: input.clientes_min, clientes_max: input.clientes_max }]
        : []),
    ];
    const v = validarFaixas(conjunto);
    if (!v.ok) return { ok: false, error: v.erro };
  }

  // ─── O ASAAS PRIMEIRO. LOCAL DEPOIS. ───────────────────────────────────
  //
  // Mudar o preco de um plano NAO alcancava o Asaas (achado de 02/09/2026). O
  // admin subia de R$199 para R$249, a tela mostrava R$249, `lib/admin/
  // metricas.ts` passava a contar R$249 de MRR -- e o Asaas seguia cobrando
  // R$199 de todo mundo, para sempre. Receita registrada e nunca cobrada, com o
  // painel que denunciaria o problema sendo justamente o que reporta o numero
  // errado.
  //
  // E o MESMO defeito que `lib/billing/cron.ts` ja tinha achado e consertado no
  // caminho da troca de faixa. La o comentario explica a ordem; aqui ela vale
  // igual: se o Asaas recusar, NAO grave local -- melhor o preco ficar
  // desatualizado na tela por um minuto do que os dois lados discordarem em
  // silencio, que e o estado que ninguem percebe.
  //
  // IDEMPOTENTE de proposito: reenviar o mesmo `value` para uma assinatura que
  // ja foi atualizada e no-op no Asaas. Por isso, em falha PARCIAL, a saida e
  // o admin salvar de novo -- a segunda passada reaplica as que faltaram sem
  // estragar as que ja foram.
  // ⚠️ O `error` E CONFERIDO, e nao ignorado. Sem isto, uma falha transitoria de
  // leitura devolve `data: null` -- indistinguivel de "plano novo" -- e o codigo
  // concluiria "o preco nao mudou", gravaria o valor novo e NAO propagaria.
  // Ou seja: a leitura falha e o resultado e exatamente a divergencia silenciosa
  // que este bloco existe para impedir.
  const { data: planoAtual, error: erroLeitura } = await admin
    .from('planos').select('valor_centavos, ciclo, nome').eq('id', input.id).maybeSingle();
  if (erroLeitura) {
    return {
      ok: false,
      error: 'Não foi possível ler o preço atual do plano para comparar. '
        + 'Nada foi alterado — tente de novo.',
    };
  }
  // O QUE CONTA COMO "PRECISA ALCANCAR O ASAAS" (02/09/2026).
  //
  // A primeira versao olhava so o preco. Duas lacunas, ambas achadas no review:
  //  · `ciclo` era gravado local e NUNCA propagado. Pior que o preco: ao ver
  //    YEARLY, `metricas.ts` divide o valor por 12 -- entao o MRR cai pela
  //    metade do ano enquanto o Asaas segue cobrando todo mes.
  //  · renomear o plano nao atualizava a `description`, que e o texto que o
  //    cliente LE na fatura. Ele continuaria vendo o nome antigo para sempre.
  const antes = planoAtual as { valor_centavos: number; ciclo: string; nome: string } | null;
  const precoMudou = antes != null && Number(antes.valor_centavos) !== input.valor_centavos;
  const cicloMudou = antes != null && String(antes.ciclo) !== input.ciclo;
  const nomeMudou = antes != null && String(antes.nome) !== input.nome;
  const precisaPropagar = precoMudou || cicloMudou || nomeMudou;

  let excedenteGlobal = 0;
  if (precisaPropagar) {
    // `VIVOS` exclui 'cortesia' e 'cancelada': cortesia nao tem cobranca real, e
    // cancelada nao pode ser ressuscitada por um reajuste de tabela.
    // ⚠️ LIMITE EXPLICITO + DISJUNTOR. O PostgREST corta em `max-rows` (1000 no
    // padrao do Supabase) e devolve `error: null` -- uma pagina curta e
    // indistinguivel da lista inteira. A licao esta escrita em
    // `lib/fiscal/receitas-source.ts`, que levou o mesmo tombo com base de
    // calculo. Aqui o custo seria pior: com mais de mil assinantes num plano, os
    // primeiros mil seriam reajustados, o resto ficaria no preco antigo PARA
    // SEMPRE, e a action devolveria `ok: true`.
    //
    // TETO baixo DE PROPOSITO: sao N chamadas HTTP SEQUENCIAIS dentro de uma
    // Server Action. O proprio repo ja mediu isso --
    // `api/cron/obrigacoes/route.test.ts:512`: "200 envios sequenciais passam
    // dos 60s de maxDuration sozinhos". Estourar aqui e pior que parar: a
    // funcao MORRE no meio do laco, sem auditoria e sem mensagem.
    //
    // 50 x ~500ms ~ 25s, dentro do `maxDuration = 60` declarado na page.
    //
    // ⚠️ ACIMA DO TETO NAO RECUSA MAIS (02/09/2026, achado do review). Recusar
    // travava o reajuste de um plano bem-sucedido: o seed tem UM plano de
    // empresa, entao todo assinante cai no mesmo `plano_id` e o admin perderia
    // ate a capacidade de BAIXAR um preco. Agora o excedente fica para
    // `reconciliarAssinaturas` (lib/billing/cron.ts), que compara cada
    // assinatura com o Asaas DE VERDADE e converge. O pior caso deixou de ser
    // "nao da para mexer" e passou a ser "leva ate um dia", que e o mesmo
    // trade-off que `cron.ts` ja aceitou para a troca de faixa.
    const TETO = 50;
    const { data: afetadas, error: erroAssin } = await admin
      .from('assinaturas')
      .select('id, asaas_subscription_id')
      .eq('plano_id', input.id)
      .in('status', VIVOS)
      .not('asaas_subscription_id', 'is', null)
      .limit(TETO + 1);

    if (erroAssin) {
      return {
        ok: false,
        error: 'Não foi possível listar as assinaturas afetadas. Nada foi alterado.',
      };
    }
    // Pedimos TETO+1 para SABER que ha excedente; processamos so o TETO.
    const todas = afetadas ?? [];
    const excedente = Math.max(0, todas.length - TETO);
    excedenteGlobal = excedente;
    const lote = todas.slice(0, TETO);

    const falhas: string[] = [];
    for (const a of lote) {
      try {
        await asaas.atualizarAssinatura(a.asaas_subscription_id as string, {
          value: input.valor_centavos / 100,
          description: `Balu — ${input.nome}`,
          cycle: input.ciclo,
        });
      } catch (err) {
        console.error('[plano] falha ao propagar preco no Asaas', a.id, err);
        falhas.push(a.id as string);
      }
    }

    if (falhas.length > 0) {
      // Nao grava local. E registra a falha: sem isto, uma assinatura que ficou
      // no preco antigo some do radar assim que a tela recarrega.
      await registrarAuditoria({
        actorUserId: ctx.userId, acao: 'plano.reajuste_parcial',
        // ⚠️ `alvoId: null`, e o id no `meta`. `audit_log.alvo_id` e UUID (0038)
        // e `planos.id` e TEXTO com slug (`escritorio_ate_50`): mandar o id ali
        // faz o PostgREST recusar com 22P02, e `registrarAuditoria` rebaixa
        // isso a `console.warn` -- some sem deixar rastro. Medido em 02/09:
        // `audit_log` tinha ZERO linhas com `alvo_tipo='plano'`, ou seja, a
        // auditoria de plano NUNCA gravou desde que foi escrita. Mesmo padrao ja
        // adotado em `admin/configuracoes/{focus,ia,serpro}/actions.ts`.
        alvoTipo: 'plano', alvoId: null,
        meta: {
          plano_id: input.id,
          valor_centavos: input.valor_centavos,
          total: lote.length,
          excedente,
          // "nao confirmadas", nao "falharam": `call()` faz retry de 502/503/504
          // e pode lancar DEPOIS de o Asaas ter aplicado. Chamar de falha manda
          // quem for reconciliar a mao procurar o oposto do que aconteceu.
          nao_confirmadas: falhas,
        },
      });
      return {
        ok: false,
        error: `O Asaas não confirmou o reajuste de ${falhas.length} de ${lote.length} `
          + 'assinatura(s), então o preço NÃO foi salvo — os dois lados ficariam divergentes. '
          + 'Salve de novo em alguns minutos: reenviar o mesmo valor é inofensivo para as '
          + 'que já foram reajustadas.',
      };
    }
  }

  const { error } = await admin.from('planos').upsert({
    id: input.id,
    nome: input.nome,
    publico: input.publico,
    valor_centavos: input.valor_centavos,
    ciclo: input.ciclo,
    // Empresa nao tem faixa: gravar numero aqui viraria lixo que a
    // validacao de faixas leria depois.
    clientes_min: input.publico === 'escritorio' ? input.clientes_min : null,
    clientes_max: input.publico === 'escritorio' ? input.clientes_max : null,
    trial_dias: input.trial_dias,
    ativo: input.ativo,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    // A JANELA QUE FALTAVA (achado do /code-review de 02/09). O laco acima pode
    // ter reajustado TODO mundo no Asaas e o upsert local falhar por um erro
    // transitorio. Ai o Asaas cobra o preco novo e `metricas.ts` reporta o
    // MRR pelo antigo -- a mesma divergencia silenciosa que este bloco inteiro
    // existe para impedir, so que pelo outro lado, e era o unico caminho aqui
    // sem log nem sinal para quem opera.
    if (precoMudou) {
      console.error('[plano] Asaas reajustado mas gravacao local falhou', input.id, error.message);
      await registrarAuditoria({
        actorUserId: ctx.userId, acao: 'plano.divergencia_local',
        alvoTipo: 'plano', alvoId: null,
        meta: { plano_id: input.id, valor_centavos: input.valor_centavos, erro: error.message },
      });
      return {
        ok: false,
        error: 'O reajuste JÁ FOI aplicado no Asaas, mas não foi possível salvar o preço aqui. '
          + 'Salve de novo para alinhar os dois lados — enquanto isso, a cobrança usa o valor novo '
          + `e esta tela mostra o antigo. (${error.message})`,
      };
    }
    return { ok: false, error: error.message };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'plano.salvar',
    alvoTipo: 'plano', alvoId: null, // ver a nota em 'plano.reajuste_parcial'
    meta: {
      plano_id: input.id,
      valor_centavos: input.valor_centavos, trial_dias: input.trial_dias, ativo: input.ativo,
      // Preco e ato com consequencia financeira: o rastro tem de dizer se o
      // reajuste alcancou o Asaas, e nao so que alguem clicou em salvar.
      preco_mudou: precoMudou,
      ciclo_mudou: cicloMudou,
      nome_mudou: nomeMudou,
    },
  });

  revalidatePath('/admin/assinaturas');
  if (excedenteGlobal > 0) {
    // `ok: true` porque o plano FOI salvo e o excedente tem dono (o cron). O
    // que nao pode acontecer e o admin sair achando que 100% ja mudou.
    return {
      ok: true,
      data: {
        aviso: `${excedenteGlobal} assinatura(s) além do lote imediato ficaram para a `
          + 'conferência automática, que roda diariamente e alinha cada uma com o Asaas.',
      },
    };
  }
  return { ok: true };
}

export async function desativarPlanoAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!id) return { ok: false, error: 'ID ausente.' };

  const admin = createAdminClient();

  // Desativar plano com assinatura viva deixaria orfaos que ninguem
  // conseguiria cobrar nem exibir. Recusar dizendo QUANTAS sao.
  const { count } = await admin
    .from('assinaturas').select('id', { count: 'exact', head: true })
    .eq('plano_id', id).in('status', VIVOS);
  if ((count ?? 0) > 0) {
    return { ok: false, error: `Não dá para desativar: ${count} assinatura(s) usam este plano.` };
  }

  // A contagem acima NAO basta: assinatura de escritorio nasce com
  // plano_id NULL e so ganha plano na primeira passada do cron, entao numa
  // base recem-instalada ela le 0 e deixaria desativar a faixa do meio,
  // abrindo um buraco. Validar o conjunto RESULTANTE fecha isso.
  const { data: alvo } = await admin
    .from('planos').select('publico').eq('id', id).maybeSingle();
  if (alvo?.publico === 'escritorio') {
    const { data: restantes } = await admin
      .from('planos').select('id, clientes_min, clientes_max')
      .eq('publico', 'escritorio').eq('ativo', true).neq('id', id);
    const v = validarFaixas(restantes ?? []);
    if (!v.ok) {
      return { ok: false, error: `Desativar deixaria as faixas inconsistentes. ${v.erro}` };
    }
  }

  const { error } = await admin.from('planos')
    .update({ ativo: false, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    // Mesmo conserto de `plano.salvar`: `alvo_id` e UUID e `planos.id` e slug de
    // texto, entao o insert era recusado com 22P02 e virava `console.warn`.
    // Bug PRE-EXISTENTE -- por isso `audit_log` nao tinha nenhuma linha de plano.
    actorUserId: ctx.userId, acao: 'plano.desativar', alvoTipo: 'plano', alvoId: null,
    meta: { plano_id: id },
  });

  revalidatePath('/admin/assinaturas');
  return { ok: true };
}
