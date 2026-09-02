import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm, type PlanoVm } from './AssinaturaView';
import PlanosCards, { type PlanoCard } from './PlanosCards';

export const dynamic = 'force-dynamic';

/**
 * A TELA ÚNICA DE ASSINATURA (02/09/2026).
 *
 * ─── POR QUE VIROU UMA SÓ ───────────────────────────────────────────────────
 * Existiam duas rotas, `/conta/assinatura` e `/contador/assinatura`, e o menu
 * listava as duas com o MESMO rótulo "Assinatura". Um contador que também tem
 * empresa própria fora de carteira passava nos dois filtros e via dois botões
 * idênticos, sem nada dizendo de quem era cada assinatura. Não é duplicação de
 * código: são dois PAGADORES diferentes — mas isso é uma distinção que o
 * produto tem de EXPLICAR, não empurrar para o usuário adivinhar no menu.
 *
 * Agora é uma página com até dois blocos, cada um dizendo de quem é a conta.
 * Quem tem só um dos papéis vê só o bloco dele, e a tela fica igual à de antes.
 *
 * `/contador/assinatura` continua existindo e redireciona para cá: ela é
 * destino de avisos do cron (`lib/billing/cron.ts`), de `lib/billing/resumo.ts`
 * e de três telas do escritório. Quebrar esses links para arrumar um item de
 * menu seria uma troca ruim.
 */

type PlanoJoin = { nome: string; valor_centavos: number } | null;

/** As colunas de `assinaturas` que as duas leituras precisam — uma lista só,
 *  para que escritório e empresa nunca divirjam no que mostram. */
const CAMPOS_ASSINATURA =
  'id, status, trial_termina_em, proxima_cobranca_em, plano_id, asaas_subscription_id, liberado_ate, planos ( nome, valor_centavos )';

/**
 * O supabase-js tipa a relação embutida como ARRAY mesmo quando ela é to-one
 * (FK simples), e em runtime devolve objeto. Normalizar as duas formas evita
 * depender de qual delas aparece.
 */
function normalizarAssinatura(a: Record<string, unknown>): AssinaturaVm {
  const planoRaw = a.planos as unknown;
  const plano = (Array.isArray(planoRaw) ? planoRaw[0] ?? null : planoRaw ?? null) as PlanoJoin;
  const liberadoAte = a.liberado_ate as string | null;
  return {
    id: a.id as string,
    status: a.status as string,
    trial_termina_em: a.trial_termina_em as string | null,
    proxima_cobranca_em: a.proxima_cobranca_em as string | null,
    planoNome: plano?.nome ?? null,
    valor_centavos: plano?.valor_centavos ?? null,
    contratada: Boolean(a.asaas_subscription_id),
    // Só mostra se AINDA vale — data vencida na linha não é liberação.
    liberadoAte: liberadoAte && ymdBrt() <= liberadoAte ? liberadoAte : null,
  } as AssinaturaVm;
}

async function lerCobrancas(supabase: SupabaseClient, assinaturaId: string) {
  const { data } = await supabase
    .from('cobrancas')
    .select('id, status, valor_centavos, vencimento, link_fatura, pix_copia_cola')
    .eq('assinatura_id', assinaturaId)
    .order('vencimento', { ascending: false })
    .limit(24);
  return (data ?? []) as CobrancaVm[];
}

// ───────────────────────────────────────────────────────────────────────────
// Bloco do ESCRITÓRIO — quem paga por faixa de clientes da carteira.
// ───────────────────────────────────────────────────────────────────────────
type BlocoEscritorio =
  | { tipo: 'sem-assinatura' }
  | {
      tipo: 'ok';
      assinatura: AssinaturaVm;
      cobrancas: CobrancaVm[];
      planos: PlanoCard[];
      planoAtivo: string | null;
      recomendado: string | null;
      clientes: number;
      semFaixa: boolean;
    };

async function carregarEscritorio(supabase: SupabaseClient): Promise<BlocoEscritorio | null> {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx || !ctx.contabilidade) return null; // não é de escritório: bloco não existe

  const { data: a } = await supabase
    .from('assinaturas').select(CAMPOS_ASSINATURA)
    .eq('contabilidade_id', ctx.contabilidade.id).maybeSingle();
  if (!a) return { tipo: 'sem-assinatura' };

  const assinatura = normalizarAssinatura(a);

  // A contagem usa o client admin: a RLS de `companies` para o contador é por
  // carteira, e `count` sob RLS varia com a policy — aqui precisamos do número
  // EXATO que o cron vai usar para decidir a faixa.
  const admin = createAdminClient();
  const { count } = await admin
    .from('companies').select('id', { count: 'exact', head: true })
    .eq('contabilidade_id', ctx.contabilidade.id).is('deleted_at', null);
  const clientes = count ?? 0;

  const { data: planos } = await supabase
    .from('planos').select('id, nome, valor_centavos, clientes_min, clientes_max, ativo')
    .eq('publico', 'escritorio').eq('ativo', true).order('valor_centavos');

  // A faixa da carteira vira RECOMENDAÇÃO, não imposição: o escritório escolhe
  // nos cards. O cron nunca o rebaixa abaixo desta faixa — só corrige para cima
  // se a carteira crescer (ver lib/billing/cron.ts).
  const escolha = planoPorQtdClientes(clientes, (planos ?? []) as PlanoFaixa[]);

  return {
    tipo: 'ok',
    assinatura,
    cobrancas: await lerCobrancas(supabase, assinatura.id),
    planos: (planos ?? []) as PlanoCard[],
    planoAtivo: (a.plano_id as string | null) ?? null,
    recomendado: escolha.ok ? escolha.planoId : null,
    clientes,
    semFaixa: !escolha.ok,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Bloco da EMPRESA — quem paga a própria conta (empresa avulsa).
// ───────────────────────────────────────────────────────────────────────────
type BlocoEmpresa =
  | { tipo: 'em-carteira' }
  | { tipo: 'sem-assinatura' }
  | { tipo: 'ok'; assinatura: AssinaturaVm; cobrancas: CobrancaVm[]; planos: PlanoVm[] };

async function carregarEmpresa(supabase: SupabaseClient, userId: string): Promise<BlocoEmpresa | null> {
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', userId).maybeSingle();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return null; // sem empresa corrente: bloco não existe

  const { data: company } = await supabase
    .from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle();

  // Empresa de carteira NÃO paga — quem paga é o escritório (decisão 3.2).
  // Mostrar cobrança a quem não deve nada é bug de produto.
  if (company?.contabilidade_id) return { tipo: 'em-carteira' };

  const { data: a } = await supabase
    .from('assinaturas').select(CAMPOS_ASSINATURA).eq('company_id', companyId).maybeSingle();
  if (!a) return { tipo: 'sem-assinatura' };

  const assinatura = normalizarAssinatura(a);

  // Catálogo do público certo. Empresa nunca vê plano de escritório.
  const { data: planos } = await supabase
    .from('planos').select('id, nome, valor_centavos')
    .eq('publico', 'empresa').eq('ativo', true).order('valor_centavos');

  return {
    tipo: 'ok',
    assinatura,
    cobrancas: await lerCobrancas(supabase, assinatura.id),
    planos: (planos ?? []) as PlanoVm[],
  };
}

// ───────────────────────────────────────────────────────────────────────────

function Secao({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{titulo}</h2>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return <p className="max-w-prose text-sm text-muted-foreground-2">{children}</p>;
}

export default async function Page() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [escritorio, empresa] = await Promise.all([
    carregarEscritorio(supabase),
    carregarEmpresa(supabase, user.id),
  ]);

  // Com os DOIS papéis, cada bloco precisa dizer de quem é a conta — é
  // exatamente o que faltava quando eram duas telas de mesmo nome.
  const doisBlocos = escritorio !== null && empresa !== null;

  return (
    <main className="p-6 space-y-8">
      <h1 className="text-xl font-semibold text-foreground">Assinatura</h1>

      {escritorio && (
        <Secao
          titulo={doisBlocos ? 'Do seu escritório' : 'Assinatura do escritório'}
          sub={escritorio.tipo === 'ok'
            ? `Sua carteira tem ${escritorio.clientes} cliente${escritorio.clientes === 1 ? '' : 's'} hoje.`
            : undefined}
        >
          {escritorio.tipo === 'sem-assinatura' ? (
            <Aviso>Assinatura não encontrada para este escritório. Fale com o suporte.</Aviso>
          ) : (
            <>
              {/* `semAcoes`: contratar e cancelar ficam nos cards de plano abaixo.
                  Dois botões de cancelar na mesma tela seria armadilha. */}
              <AssinaturaView assinatura={escritorio.assinatura} cobrancas={escritorio.cobrancas} semAcoes />
              <div>
                <h3 className="mb-3 font-medium text-foreground">Planos</h3>
                <PlanosCards
                  assinaturaId={escritorio.assinatura.id}
                  planos={escritorio.planos}
                  planoAtivo={escritorio.planoAtivo}
                  planoRecomendado={escritorio.recomendado}
                  contratada={escritorio.assinatura.contratada}
                  clientes={escritorio.clientes}
                  status={escritorio.assinatura.status}
                />
              </div>
              {escritorio.semFaixa && (
                <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
                  Não há plano configurado para a sua quantidade de clientes — nenhum aparece como
                  recomendado. Fale com o suporte.
                </p>
              )}
            </>
          )}
        </Secao>
      )}

      {empresa && (
        <Secao titulo={doisBlocos ? 'Da sua empresa' : 'Assinatura'}>
          {empresa.tipo === 'em-carteira' ? (
            <Aviso>
              Sua empresa é atendida por um escritório de contabilidade, e o acesso à Balu está
              incluído no serviço dele. Não há cobrança para você aqui.
            </Aviso>
          ) : empresa.tipo === 'sem-assinatura' ? (
            <Aviso>Assinatura não encontrada para esta empresa. Fale com o suporte.</Aviso>
          ) : (
            <AssinaturaView
              assinatura={empresa.assinatura}
              cobrancas={empresa.cobrancas}
              planos={empresa.planos}
            />
          )}
        </Secao>
      )}

      {/* Nenhum dos dois. NÃO é só alcançável por URL: `assinaturaVisivel` passa
          para `userRole === 'empresa'` independentemente de `qtdEmpresas`, então
          um usuário recém-cadastrado, ainda sem empresa, VÊ o item no menu e cai
          aqui. Comportamento anterior à consolidação, não regressão — mas o
          comentário original prometia uma garantia que não existe. (Achado do
          /code-review de 02/09/2026.) */}
      {!escritorio && !empresa && (
        <Aviso>Nenhuma empresa selecionada, e você não faz parte de um escritório.</Aviso>
      )}
    </main>
  );
}
