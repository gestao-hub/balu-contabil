// Bloco 4B — o escritório vê TUDO o que emitiu pela subconta.
//
// POR QUE ESTA TELA EXISTE
// Até aqui o 4B tinha duas portas de emissão (honorário e serviço avulso) e
// nenhuma porta de leitura consolidada: a cobrança de mensalidade aparecia
// dentro de `/contador/honorarios`, a avulsa dentro da ficha do cliente, e a
// avulsa VENCIDA não aparecia em lugar nenhum. Um escritório que emite não
// tinha onde perguntar "o que está em aberto comigo?" — que é a única pergunta
// que ele faz toda semana.
//
// O DINHEIRO É LIDO PELA SESSÃO, não por service role: a policy
// `cobrancas_escritorio_select` (0053) tem duas pernas, e a primeira é
// literalmente esta tela (`contabilidade_id = minha_contabilidade_membro()`).
// Ler daqui pelo admin client deixaria a policy como código morto e trocaria
// uma barreira do banco por um `.eq()` que alguém precisa lembrar de escrever.
//
// O NOME DO CLIENTE é a única coisa que vem pelo admin client, e por um motivo
// específico: cliente que SAIU do escritório tem `companies.contabilidade_id`
// zerado, então nem o embed nem uma consulta pela sessão o alcançam — e as
// cobranças dele, inclusive as ainda em aberto, ficariam sem nome nenhum na
// tela de quem precisa cobrá-las. O recorte é a lista de ids que a RLS já
// liberou na consulta do dinheiro; mesmo padrão pontual de
// `configuracoes/page.tsx` e `honorarios/page.tsx`.
//
// SEM GATE DE INADIMPLÊNCIA. Decidido em 28/07: o gate do 4A alcança apenas
// CRIAR cobrança nova pela subconta — nunca ver, sincronizar ou receber as já
// emitidas, porque é com esse dinheiro que o escritório paga a Balu. Esta tela
// é só leitura; bloqueá-la seria cortar a mão que assina o cheque.
//
// O VOCABULÁRIO DE STATUS vem de `lib/billing/cobranca-escritorio-vm`, o mesmo
// que a tela do cliente usa. A mesma cobrança não pode se chamar "Em aberto"
// aqui e outra coisa lá: a conversa entre os dois começaria com as duas telas
// discordando.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Receipt, ExternalLink } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { formatBRL } from '@/lib/format/dinheiro';
import { rotuloStatus, corStatus, estaEmAberto } from '@/lib/billing/cobranca-escritorio-vm';

export const dynamic = 'force-dynamic';

const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * As abas. `todas` não filtra; as demais recortam por `status`.
 *
 * "Em aberto" e "Vencidas" são separadas de propósito, ao contrário da tela do
 * cliente (onde as duas viram um botão "Pagar" só). Para quem cobra, a
 * diferença entre "ainda vai vencer" e "já venceu e não pagou" é a diferença
 * entre não fazer nada e ligar para o cliente.
 */
const ABAS = [
  { chave: 'todas',      label: 'Todas',      status: null },
  { chave: 'aberto',     label: 'Em aberto',  status: 'pendente' },
  { chave: 'vencidas',   label: 'Vencidas',   status: 'vencida' },
  { chave: 'pagas',      label: 'Pagas',      status: 'paga' },
  { chave: 'estornadas', label: 'Estornadas', status: 'estornada' },
] as const;

/** Aba desconhecida na URL cai em `todas` — mostrar tudo nunca esconde dinheiro,
 *  e uma tela vazia por causa de um parâmetro digitado errado pareceria "não há
 *  cobrança nenhuma". */
function abaDe(v: string | undefined): (typeof ABAS)[number] {
  return ABAS.find((a) => a.chave === v) ?? ABAS[0];
}

/**
 * Teto EXPLÍCITO da lista.
 *
 * Sem ele vale o "Max rows" do projeto Supabase (1000 por padrão), que corta a
 * lista **em silêncio** — e os dois totais abaixo são somados sobre o que
 * voltou. A tela avisaria "A receber: R$ X" com X faltando tudo o que passou do
 * corte, enquanto o cabeçalho dela manda não ler lista curta como "nada a
 * receber". Cap existe; o que não pode existir é cap calado.
 */
const LIMITE = 200;

type Row = {
  id: string;
  descricao: string;
  status: string;
  valor_centavos: number;
  vencimento: string;
  pago_em: string | null;
  link_fatura: string | null;
  honorario_id: string | null;
  empresa_cliente_id: string;
};

export default async function ContadorCobrancasPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string }>;
}) {
  // Mesma guarda das demais páginas /contador.
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const aba = abaDe((await searchParams).situacao);
  const supabase = await createServerClient();

  // SEM o join embutido em `companies`, de propósito. Esta leitura é pela
  // SESSÃO, e o embed herdaria a policy `companies_select_contador` (0033), que
  // exige o vínculo ATUAL (`companies.contabilidade_id = minha_contabilidade()`).
  // Cliente que saiu do escritório tem esse vínculo zerado — e então TODA
  // cobrança histórica dele, inclusive as ainda EM ABERTO que o escritório
  // precisa cobrar, apareceria como "Cliente sem nome", sem nenhum outro campo
  // que a identificasse. O nome vem separado, pelo admin client, e só para ids
  // que a RLS já liberou nesta consulta.
  let q = supabase
    .from('cobrancas_escritorio')
    .select(`
      id, descricao, status, valor_centavos, vencimento, pago_em, link_fatura,
      honorario_id, empresa_cliente_id
    `)
    .eq('contabilidade_id', ctx.contabilidade.id)
    .order('vencimento', { ascending: false })
    .limit(LIMITE);
  if (aba.status) q = q.eq('status', aba.status);

  const { data, error } = await q;
  // Falha de leitura NÃO pode chegar como lista vazia: o escritório leria
  // "nenhuma cobrança" como "não tenho nada a receber" e pararia de cobrar.
  if (error) console.error('[4b] ler cobrancas do escritorio (painel) falhou:', error.message);

  const rows = (data ?? []) as unknown as Row[];
  const truncada = rows.length === LIMITE;

  // Nome do cliente pelo admin client — ver o comentário da consulta acima. O
  // `.eq('contabilidade_id')` NÃO serve aqui, justamente porque o ex-cliente já
  // não o tem; o recorte é a lista de ids que a RLS liberou logo acima.
  const nomePorEmpresa: Record<string, string> = {};
  const idsEmpresas = Array.from(new Set(rows.map((r) => r.empresa_cliente_id)));
  if (idsEmpresas.length > 0) {
    const { data: empresas } = await createAdminClient()
      .from('companies').select('id, nome').in('id', idsEmpresas);
    for (const e of empresas ?? []) nomePorEmpresa[e.id as string] = ((e.nome as string) ?? '').trim();
  }
  const nomeDoCliente = (empresaId: string): string =>
    nomePorEmpresa[empresaId] || 'Cliente sem nome';

  // Os dois totais que importam para quem cobra, e só sobre o RECORTE ATUAL —
  // um total "de tudo" mostrado sob uma aba filtrada seria lido como o total da
  // aba. Estornada fica de fora dos dois: o dinheiro voltou.
  //
  // Quando a lista bate no teto, estes totais passam a ser PARCIAIS — e é por
  // isso que `truncada` vira aviso na tela em vez de ficar só no comentário.
  const emAberto = rows.reduce((t, r) => (estaEmAberto(r.status) ? t + r.valor_centavos : t), 0);
  const recebido = rows.reduce((t, r) => (r.status === 'paga' ? t + r.valor_centavos : t), 0);

  return (
    <main className="p-6 max-w-5xl">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Cobranças emitidas</h1>
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          Tudo o que este escritório cobrou pela conta de recebimento própria — mensalidades e
          serviços avulsos. O dinheiro entra direto na sua conta Asaas; a Balu não intermedia.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Não foi possível carregar as cobranças agora. Recarregue a página — não tome a lista
          vazia como &ldquo;nada a receber&rdquo;.
        </p>
      )}

      {/* Abas por link, não por estado de cliente: o filtro sobrevive ao
          recarregar, dá para mandar a URL de "vencidas" para alguém da equipe,
          e a tela funciona com o JS ainda carregando. */}
      <nav className="mb-4 flex flex-wrap gap-1" aria-label="Filtrar por situação">
        {ABAS.map((a) => (
          <Link
            key={a.chave}
            href={a.chave === 'todas' ? '/contador/cobrancas' : `/contador/cobrancas?situacao=${a.chave}`}
            aria-current={a.chave === aba.chave ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              a.chave === aba.chave
                ? 'bg-primary/15 font-semibold text-primary'
                : 'text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground'
            }`}
          >
            {a.label}
          </Link>
        ))}
      </nav>

      {/* CAP EXPLÍCITO. Só aparece quando a lista realmente bateu no teto — e
          aparece ANTES dos totais, porque é sobre eles que ele muda a leitura. */}
      {truncada && (
        <p className="mb-4 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-foreground">
          Mostrando as <strong>{LIMITE}</strong> cobranças mais recentes desta situação. Há mais
          além destas, e <strong>os totais abaixo somam só o que está na lista</strong>. Use as
          abas para estreitar o recorte.
        </p>
      )}

      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {emAberto > 0 && (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-foreground">
              {truncada ? 'A receber (parcial)' : 'A receber'}:{' '}
              <strong className="tabular-nums">{formatBRL(emAberto)}</strong>
            </p>
          )}
          {recebido > 0 && (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-foreground">
              {truncada ? 'Recebido (parcial)' : 'Recebido'}:{' '}
              <strong className="tabular-nums">{formatBRL(recebido)}</strong>
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {aba.chave === 'todas' ? (
            <>
              Nenhuma cobrança emitida ainda. Você cobra a mensalidade em{' '}
              <Link href="/contador/honorarios" className="inline-flex min-h-6 items-center text-primary hover:underline">
                Honorários
              </Link>{' '}
              e um serviço avulso pela ficha do cliente.
            </>
          ) : (
            <>Nenhuma cobrança nesta situação.</>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="font-medium">{nomeDoCliente(r.empresa_cliente_id)}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${corStatus(r.status)}`}>
                    {rotuloStatus(r.status)}
                  </span>
                  {/* De onde a cobrança veio. Sem isto, "Mensalidade 08/2026" e
                      "Certidão negativa" ficam indistinguíveis na hora de
                      conferir o que é recorrente e o que foi pontual. */}
                  <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-xs text-muted-foreground">
                    {r.honorario_id ? 'honorário' : 'avulso'}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground-2">{r.descricao}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatBRL(r.valor_centavos)}</span> · vence{' '}
                  {dataBR(r.vencimento)}
                  {r.pago_em ? ` · paga em ${dataBR(r.pago_em)}` : ''}
                </p>
              </div>

              {/* A fatura do Asaas, para o escritório reenviar o link ao cliente
                  sem precisar entrar no painel do Asaas. Aparece também em
                  cobrança paga: é o comprovante. Some na estornada, onde o link
                  não leva a lugar útil. */}
              {r.link_fatura && r.status !== 'estornada' && (
                <a
                  href={r.link_fatura}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  Ver fatura <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
