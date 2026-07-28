// src/app/(auth)/contador/honorarios/page.tsx
// Honorários v2 do escritório: mesma guarda de acesso das demais páginas /contador.
import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import HonorariosV2List, { type HonorarioV2Row } from './HonorariosV2List';
import type { ClienteOption } from './HonorarioV2FormDialog';

export default async function ContadorHonorariosPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const supabase = await createServerClient();
  const contabilidadeId = ctx.contabilidade.id;

  // A LISTA CONTINUA VISÍVEL. Consultar honorários não é ação comercial de
  // escrita e não depende de pagamento — bloquear a leitura seria esconder do
  // escritório o que ele já registrou. O que muda é o aviso no topo e o
  // "Novo honorário", que passa a dizer o motivo em vez de deixar preencher.
  const gate = await assertAssinaturaEscritorio(contabilidadeId);
  const assinaturaPendente = !gate.ok;

  // Join FK-desambiguado: honorarios.empresa_cliente_id → companies via a constraint
  // gerada pela 0032 (`ADD COLUMN ... REFERENCES` sem nome explícito = <tabela>_<coluna>_fkey).
  const [{ data: honorariosRaw }, { data: carteiraRaw }, { data: cont }] = await Promise.all([
    supabase
      .from('honorarios')
      .select(`
        id, empresa_cliente_id, mes_referencia, valor, data_vencimento, data_pagamento,
        status, observacao, forma_pagamento, recorrente, recorrencia_dia,
        companies!honorarios_empresa_cliente_id_fkey ( nome, cnpj )
      `)
      .eq('contabilidade_id', contabilidadeId)
      .not('empresa_cliente_id', 'is', null)
      .order('data_vencimento', { ascending: false }),
    supabase
      .from('companies')
      .select('id, nome')
      .eq('contabilidade_id', contabilidadeId)
      .is('deleted_at', null)
      .order('nome'),
    // Bloco 4B — sem subconta APROVADA no Asaas não há para onde o dinheiro do
    // cliente ir, e "Gerar cobrança" falharia no envio. Leitura pela sessão
    // (policy `contabilidades_select_membro`); a chave cifrada não está no
    // select nem poderia estar — a 0053 revogou a leitura dela.
    supabase
      .from('contabilidades')
      .select('asaas_subconta_status')
      .eq('id', contabilidadeId)
      .maybeSingle(),
  ]);

  // FALHA FECHADA: erro de leitura vira "não pode cobrar", nunca "pode". Errar
  // para este lado custa um refresh; para o outro, custa a cobrança falhar na
  // frente do cliente do escritório.
  const subcontaAprovada = cont?.asaas_subconta_status === 'aprovada';

  const clientes: ClienteOption[] = (carteiraRaw ?? []).map(c => ({
    id: c.id as string,
    nome: (c.nome as string) ?? '',
  }));

  // Normaliza o join `companies` (pode vir como array ou objeto, a depender do driver).
  const honorarios: HonorarioV2Row[] = (honorariosRaw ?? []).map(r => {
    const raw = r as Record<string, unknown>;
    const comp = raw.companies;
    const compObj = Array.isArray(comp) ? (comp[0] ?? null) : (comp ?? null);
    return {
      id:                 raw.id as string,
      empresa_cliente_id: raw.empresa_cliente_id as string,
      mes_referencia:     raw.mes_referencia as string,
      valor:              String(raw.valor),
      data_vencimento:    raw.data_vencimento as string,
      data_pagamento:     (raw.data_pagamento as string | null) ?? null,
      observacao:         (raw.observacao as string | null) ?? null,
      forma_pagamento:    (raw.forma_pagamento as string | null) ?? null,
      recorrente:         Boolean(raw.recorrente),
      recorrencia_dia:    (raw.recorrencia_dia as number | null) ?? null,
      companies:          compObj as { nome: string | null; cnpj: string | null } | null,
    };
  });

  return (
    <main className="p-6 max-w-6xl">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Honorários</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {honorarios.length} registro{honorarios.length !== 1 ? 's' : ''}
        </p>
      </header>

      <HonorariosV2List
        initial={honorarios}
        clientes={clientes}
        assinaturaPendente={assinaturaPendente}
        subcontaAprovada={subcontaAprovada}
      />
    </main>
  );
}
