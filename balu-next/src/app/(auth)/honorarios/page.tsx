import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import HonorarioList, { type HonorarioRow } from './HonorarioList';
import type { ClienteOption } from './HonorarioFormDialog';

export default async function HonorariosPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verifica role Contador
  const { data: roleRow } = await supabase
    .from('role_types')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (roleRow?.role as string | null) ?? (user.user_metadata?.type as string | null) ?? '';
  if (role !== 'Contador') redirect('/');

  // Empresa do contador
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company as string | null) ?? '';
  if (!companyId) redirect('/');

  // Carrega honorários com join do cliente
  const { data: honorariosRaw } = await supabase
    .from('honorarios')
    .select(`
      id, cliente_id, company_id, mes_referencia, valor,
      data_vencimento, data_pagamento, status, observacao,
      clientes (nome, nome_fantasia)
    `)
    .eq('company_id', companyId)
    .order('mes_referencia', { ascending: false })
    .order('data_vencimento', { ascending: true });

  // Lista de clientes para dropdowns
  const { data: clientesRaw } = await supabase
    .from('clientes')
    .select('id, nome, nome_fantasia')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .order('nome');

  const clienteOptions: ClienteOption[] = (clientesRaw ?? []).map(c => ({
    id: c.id as string,
    nome: ((c.nome_fantasia || c.nome) as string) ?? '',
  }));

  // Normaliza o join clientes (pode vir como array ou objeto)
  const honorarios: HonorarioRow[] = (honorariosRaw ?? []).map(r => {
    const raw = r as Record<string, unknown>;
    const cl = raw.clientes;
    const clObj = Array.isArray(cl) ? (cl[0] ?? null) : (cl ?? null);
    return {
      id:             raw.id as string,
      cliente_id:     raw.cliente_id as string,
      company_id:     raw.company_id as string,
      mes_referencia: raw.mes_referencia as string,
      valor:          Number(raw.valor),
      data_vencimento:raw.data_vencimento as string,
      data_pagamento: (raw.data_pagamento as string | null) ?? null,
      status:         (raw.status as string | null) ?? null,
      observacao:     (raw.observacao as string | null) ?? null,
      clientes:       clObj as { nome: string; nome_fantasia?: string | null } | null,
    };
  });

  const totalPendente = honorarios
    .filter(r => r.status === 'pendente' || r.status === 'atrasado')
    .reduce((s, r) => s + r.valor, 0);
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <main className="p-6 max-w-6xl">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Honorários</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {honorarios.length} registro{honorarios.length !== 1 ? 's' : ''}
          {totalPendente > 0 && (
            <span className="ml-2 text-alert font-medium">· {brl(totalPendente)} a receber</span>
          )}
        </p>
      </header>

      <HonorarioList
        initial={honorarios}
        companyId={companyId}
        clientes={clienteOptions}
      />
    </main>
  );
}
