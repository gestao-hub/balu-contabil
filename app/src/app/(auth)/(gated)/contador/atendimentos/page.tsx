// Bloco 7, Task 6 — fila de escaladas de atendimento (§2.4 da spec).
//
// A escalada existe desde o Bloco 6B, mas `whatsapp_atendimentos` nasceu
// "service_role apenas, sem tela nesta rodada" (0061). Sem esta tela, o alerta
// de SLA da Task 7 dispararia para sempre sem ter como ser fechado.
import { redirect } from 'next/navigation';
import { Headset } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import FilaAtendimentos, { type EscaladaVM } from './FilaAtendimentos';

export default async function AtendimentosPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status !== 'aprovada') redirect('/contador/aguardando');

  const supabase = await createServerClient();

  // Cliente da sessão, não admin: a policy da 0070 já escopa por
  // `contabilidade_id = minha_contabilidade_membro()`. Usar service_role aqui
  // seria trocar a fronteira do banco por um `.eq()` no app.
  const { data: linhas } = await supabase
    .from('whatsapp_atendimentos')
    .select('id,telefone,mensagem_recebida,created_at')
    .is('atendido_em', null)
    .order('created_at', { ascending: true })
    .limit(100);

  const { data: cfg } = await supabase
    .from('contabilidades')
    .select('sla_resposta_horas')
    .eq('id', ctx.contabilidade.id)
    .maybeSingle();
  const slaHoras = (cfg?.sla_resposta_horas ?? null) as number | null;

  const agora = Date.now();
  const itens: EscaladaVM[] = (linhas ?? []).map((l) => {
    const criado = new Date(l.created_at as string).getTime();
    const horas = Math.floor((agora - criado) / 3_600_000);
    return {
      id: l.id as string,
      telefone: l.telefone as string,
      mensagem: l.mensagem_recebida as string,
      criadoEm: l.created_at as string,
      horasEsperando: horas,
      estourouSla: slaHoras !== null && horas >= slaHoras,
    };
  });

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Headset className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Atendimentos aguardando</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Conversas de WhatsApp que a IA não soube responder e passou para a equipe.
          {slaHoras
            ? ` Seu prazo configurado é de ${slaHoras}h corridas.`
            : ' Nenhum prazo de resposta configurado — defina um em Config. escritório para receber alertas.'}
        </p>
      </header>

      <FilaAtendimentos itens={itens} slaHoras={slaHoras} />
    </main>
  );
}
