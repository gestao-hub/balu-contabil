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
import SubcontaForm from './SubcontaForm';

export const dynamic = 'force-dynamic';

export default async function ContadorSubcontaPage() {
  // Mesma guarda das demais páginas /contador.
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const sb = await createServerClient();
  const { data: cont } = await sb
    .from('contabilidades')
    .select('nome, cnpj, asaas_subconta_id, asaas_wallet_id, asaas_subconta_status, asaas_subconta_criada_em')
    .eq('id', ctx.contabilidade.id)
    .maybeSingle();

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
      />
    </main>
  );
}
