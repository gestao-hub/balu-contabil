// src/app/(auth)/(gated)/contador/configuracoes/subconta/page.tsx
// Bloco 4B — onboarding da subconta Asaas do escritório. É a porta de entrada
// do bloco: sem subconta aprovada o escritório não cobra ninguém.
//
// LEITURA PELA SESSÃO DO USUÁRIO, e não pelo service role: a 0053 revogou o
// SELECT de tabela de `public.contabilidades` mas RECONCEDEU todas as colunas
// menos `asaas_api_key_cifrada` — então o select abaixo passa pela sessão, e a
// policy `contabilidades_select_membro` garante que só o próprio escritório se
// vê. Usar service role aqui seria dispensar a RLS sem precisar, e deixar a
// segurança do isolamento por conta de lembrar do `.eq('id', ...)`.
// A chave cifrada não está no select nem poderia estar: é a única coluna cuja
// leitura continua revogada.
import { redirect } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { soDigitos } from '@/lib/billing/subconta';
import type { StatusSubconta } from '@/lib/billing/status-subconta';
import { estadoWebhookDaContabilidade } from '@/lib/billing/webhook-subconta-asaas';
import { avisoDoDiagnostico } from '@/lib/billing/webhook-subconta';
import SubcontaForm from './SubcontaForm';
import SaldoSaque, { type SaqueHistorico } from './SaldoSaque';

export const dynamic = 'force-dynamic';

export default async function ContadorSubcontaPage() {
  // Mesma guarda das demais páginas /contador.
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const sb = await createServerClient();
  const { data: cont, error: erroCont } = await sb
    .from('contabilidades')
    .select('nome, cnpj, asaas_subconta_id, asaas_wallet_id, asaas_subconta_status, asaas_subconta_criada_em, asaas_subconta_criada_por, conta_destino_resumo')
    .eq('id', ctx.contabilidade.id)
    .maybeSingle();

  // NÃO engolir o erro. A 0053 concede SELECT coluna a coluna, e coluna nova
  // nasce sem permissão — foi o que aconteceu com as colunas da 0069/0073
  // (corrigido pela 0074). O sintoma era pior que o defeito: `data` vinha
  // nulo, a tela concluía "este escritório não tem subconta" e oferecia criar
  // uma SEGUNDA. Falha silenciosa por natureza, porque `maybeSingle()` não
  // lança. Com o log, o próximo esquecimento aparece no servidor em vez de
  // virar tela mentirosa.
  if (erroCont) {
    console.error('[4b] leitura da contabilidade falhou (coluna sem GRANT?):', erroCont.message);
  }

  // QUEM MANDA É O VÍNCULO, NÃO A COLUNA DE STATUS. Se existe `asaas_subconta_id`
  // a subconta existe no Asaas — mostrar o formulário de criação nesse caso
  // convidaria o escritório a criar uma SEGUNDA conta (a action recusaria, mas
  // depois de já ter gasto a tentativa). Um status 'ausente' com id gravado é
  // deriva de dado: tratamos como 'pendente', o estado mais conservador de quem
  // tem conta. O inverso — status otimista sem id — cai em 'ausente'.
  const temSubconta = Boolean(cont?.asaas_subconta_id);
  const gravado = (cont?.asaas_subconta_status ?? 'ausente') as StatusSubconta;
  const status: StatusSubconta = temSubconta
    ? (gravado === 'ausente' ? 'pendente' : gravado)
    : 'ausente';

  // O WEBHOOK É LIDO AO VIVO, e não de uma coluna. A ausência dele é o modo de
  // falha mais silencioso do 4B — o escritório emite a cobrança, o cliente
  // paga, e nada nunca chega — então o estado tem de aparecer sozinho, a cada
  // carregamento, sem depender de o escritório apertar nada. Uma coluna
  // espelhando isso envelheceria (o webhook pode ser apagado no painel do
  // Asaas a qualquer momento, sem avisar ninguém) e mentiria justamente no
  // caso que importa.
  //
  // Custa um GET ao Asaas numa tela de configuração pouco visitada, e a função
  // nunca lança: Asaas fora do ar vira 'indeterminado', não uma página quebrada.
  const webhook = temSubconta ? await estadoWebhookDaContabilidade(ctx.contabilidade.id) : null;
  const avisoWebhook =
    webhook && webhook.estado !== 'impedido' && webhook.estado !== 'indeterminado'
      ? avisoDoDiagnostico(webhook)
      : null;

  // Saldo/saque: só para o DONO da subconta (quem a criou) e só com a conta
  // aprovada. `criada_por` nulo é subconta anterior à 0073 — o backfill já
  // apontou o membro mais antigo, então nulo aqui significa "sem dono
  // identificável", e nesse caso ninguém saca: dinheiro não é lugar de
  // presumir permissão.
  const ehDono = Boolean(cont?.asaas_subconta_criada_por) && cont?.asaas_subconta_criada_por === ctx.userId;

  let historico: SaqueHistorico[] = [];
  if (temSubconta && status === 'aprovada') {
    const { data: saques } = await sb
      .from('saques_escritorio')
      .select('id,valor_centavos,status,destino_resumo,created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    historico = (saques ?? []).map((x) => ({
      id: x.id as string,
      valorCentavos: Number(x.valor_centavos),
      status: x.status as SaqueHistorico['status'],
      destinoResumo: (x.destino_resumo as string | null) ?? null,
      criadoEm: x.created_at as string,
    }));
  }

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Receber pelos seus clientes</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Para cobrar honorários e serviços pelo app, o escritório precisa de uma conta de
          recebimento própria. <strong className="text-foreground">O dinheiro cai direto na sua
          conta</strong> — a Balu não recebe por você e não fica com nada no caminho.
        </p>
      </header>

      <SubcontaForm
        nomeSugerido={cont?.nome ?? ''}
        documentoSugerido={soDigitos(cont?.cnpj ?? '')}
        status={status}
        walletId={cont?.asaas_wallet_id ?? null}
        criadaEm={cont?.asaas_subconta_criada_em ?? null}
        avisoWebhook={avisoWebhook}
      />

      {temSubconta && status === 'aprovada' && (
        <SaldoSaque
          ehDono={ehDono}
          contaResumo={(cont?.conta_destino_resumo as string | null) ?? null}
          historico={historico}
        />
      )}
    </main>
  );
}
