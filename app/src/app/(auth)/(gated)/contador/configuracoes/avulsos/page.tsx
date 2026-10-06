// src/app/(auth)/(gated)/contador/configuracoes/avulsos/page.tsx
// Bloco 4B — catálogo de serviços avulsos do escritório: o que ele cobra fora
// da mensalidade, e de onde a tela de emissão vai escolher.
//
// LEITURA PELA SESSÃO DO USUÁRIO, e não pelo service role (diferente da tela
// irmã da subconta): a 0053 criou em `servicos_avulsos` uma policy de SELECT
// para o escritório dono — ler daqui pelo admin client deixaria essa policy
// como código morto e trocaria uma barreira do banco por um `.eq()` meu. O
// `.eq('contabilidade_id')` fica assim mesmo, junto: RLS e filtro concordando.
// O que EXIGE service role é a escrita, que a 0053 não concedeu a ninguém —
// isso mora em actions.ts.
import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import type { TipoValor } from '@/lib/billing/avulso';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import { MSG_ASSINATURA_PENDENTE, MSG_SUBCONTA_NAO_APROVADA } from '@/lib/billing/mensagens';
import CatalogoAvulsos, { type ServicoVm } from './CatalogoAvulsos';

export const dynamic = 'force-dynamic';

export default async function ContadorAvulsosPage() {
  // Mesma guarda das demais páginas /contador.
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const supabase = await createServerClient();
  // SEM filtro por `ativo`: a tela lista os desativados também, senão desativar
  // seria indistinguível de sumir para sempre e não haveria como reativar.
  const contabilidadeId = ctx.contabilidade.id;
  const [{ data, error }, { data: empresasRaw }, { data: avulsosRaw }, { data: cont }, gate] = await Promise.all([
    supabase
      .from('servicos_avulsos')
      .select('id, nome, categoria, tipo_valor, valor_centavos, percentual, ativo')
      .eq('contabilidade_id', contabilidadeId)
      .order('categoria', { ascending: true })
      .order('nome', { ascending: true }),
    // Destinos do "Usar serviço": a carteira (policy `companies_select_contador`)
    // e os clientes avulsos (policy da 0108) — os dois pela sessão.
    supabase
      .from('companies')
      .select('id, nome, razao_social')
      .eq('contabilidade_id', contabilidadeId)
      .is('deleted_at', null)
      .order('nome'),
    supabase
      .from('clientes_avulsos')
      .select('id, nome, cpf_cnpj, email, telefone')
      .eq('contabilidade_id', contabilidadeId)
      .order('nome'),
    supabase
      .from('contabilidades')
      .select('asaas_subconta_status')
      .eq('id', contabilidadeId)
      .maybeSingle(),
    assertAssinaturaEscritorio(contabilidadeId),
  ]);

  // FALHA FECHADA, como em honorários: erro de leitura vira "não pode cobrar".
  const subcontaAprovada = cont?.asaas_subconta_status === 'aprovada';
  const bloqueioCobranca = !gate.ok
    ? { texto: MSG_ASSINATURA_PENDENTE, href: '/contador/assinatura', rotulo: 'Ver assinatura' }
    : !subcontaAprovada
      ? { texto: MSG_SUBCONTA_NAO_APROVADA, href: '/contador/configuracoes/subconta', rotulo: 'Configurar conta de recebimento' }
      : null;

  const empresas = (empresasRaw ?? []).map((e) => ({
    id: e.id as string,
    nome: ((e.nome as string | null)?.trim() || (e.razao_social as string | null)?.trim()) ?? '',
  }));
  const clientesAvulsos = (avulsosRaw ?? []).map((c) => ({
    id: c.id as string,
    nome: c.nome as string,
    cpfCnpj: c.cpf_cnpj as string,
    email: (c.email as string | null) ?? null,
    telefone: (c.telefone as string | null) ?? null,
  }));

  // Falha de leitura NÃO pode chegar como lista vazia: o escritório veria um
  // catálogo cheio como "vazio" e clicaria em "começar com a lista sugerida"
  // (que a action recusa, corretamente, deixando a tela sem explicação).
  if (error) console.error('[4b] ler catalogo de avulsos falhou:', error.message);

  const servicos: ServicoVm[] = (data ?? []).map((s) => ({
    id: s.id,
    nome: s.nome,
    categoria: s.categoria,
    tipoValor: s.tipo_valor as TipoValor,
    valorCentavos: s.valor_centavos,
    percentual: s.percentual == null ? null : Number(s.percentual),
    ativo: s.ativo,
  }));

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Serviços avulsos</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          O que o escritório cobra fora da mensalidade. Serviços de{' '}
          <strong className="text-foreground">percentual</strong> (recuperação de crédito, taxa de
          urgência) pedem o valor-base na hora de cobrar — aqui você guarda só a porcentagem.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Não foi possível carregar o catálogo agora. Recarregue a página — o que já estava
          cadastrado continua lá.
        </p>
      )}

      <CatalogoAvulsos
        servicos={servicos}
        empresas={empresas}
        clientesAvulsos={clientesAvulsos}
        nomeEscritorio={ctx.contabilidade.nome ?? null}
        bloqueioCobranca={bloqueioCobranca}
      />
    </main>
  );
}
