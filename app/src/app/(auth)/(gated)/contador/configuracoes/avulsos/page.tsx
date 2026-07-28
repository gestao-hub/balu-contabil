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
  const { data, error } = await supabase
    .from('servicos_avulsos')
    .select('id, nome, categoria, tipo_valor, valor_centavos, percentual, ativo')
    .eq('contabilidade_id', ctx.contabilidade.id)
    .order('categoria', { ascending: true })
    .order('nome', { ascending: true });

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

      <CatalogoAvulsos servicos={servicos} />
    </main>
  );
}
