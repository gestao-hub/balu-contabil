// src/app/(auth)/(gated)/cobrancas/page.tsx
// Bloco 4B — o cliente final vê as cobranças do escritório dele (decisão 7.3).
//
// Boleto que só chega por e-mail se perde, e a inadimplência por esquecimento é
// a mais comum. Mostrar a cobrança onde o cliente já está é o que a evita.
//
// FRONTEIRA. Esta dívida é do cliente COM O ESCRITÓRIO. A Balu não é credora,
// não intermedia e não garante nada aqui: a cobrança nasce na subconta Asaas do
// escritório e o dinheiro liquida na conta dele. Por isso a tela não tem tarja
// de bloqueio, não fala em "acesso" e não sugere consequência dentro do app —
// o gate de inadimplência do 4A vale só para a assinatura da Balu.
//
// A faixa de aviso do 4A não precisa de exceção aqui, e é de propósito que eu
// não mexi em SEM_FAIXA (_components/AvisoCobranca.tsx): aquela lista codifica
// as fronteiras da LGPD, e diluí-la com um motivo de UX enfraqueceria o que ela
// significa. A faixa já não aparece nesta tela por construção — resumoAssinatura
// (lib/billing/resumo.ts:43) devolve `null` para empresa com contabilidade_id,
// que é exatamente a única empresa para quem esta tela tem conteúdo. E é a mesma
// linha que garante que a inadimplência DO ESCRITÓRIO com a Balu nunca respinga
// no cliente: a busca do resumo do empresário nem chega a olhar a assinatura do
// escritório.
//
// LEITURA PELA SESSÃO DO USUÁRIO, não por service role: a policy
// `cobrancas_escritorio_select` (0053) tem duas pernas, e a segunda é
// literalmente esta tela (`companies.user_id = auth.uid()`). Ler daqui pelo
// admin client deixaria a policy como código morto e trocaria uma barreira do
// banco por um `.eq()` que alguém precisa lembrar de escrever.
import { redirect } from 'next/navigation';
import { Receipt, ExternalLink } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getGateContext } from '@/lib/auth/gate-context';
import { formatBRL } from '@/lib/format/dinheiro';
import CopiarPix from './CopiarPix';
import { type CobrancaVm, rotuloStatus, corStatus, podePagar, totalEmAberto } from './cobrancas-vm';

export const dynamic = 'force-dynamic';

const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

type Row = {
  id: string;
  descricao: string;
  status: string;
  valor_centavos: number;
  vencimento: string;
  pago_em: string | null;
  link_fatura: string | null;
  pix_copia_cola: string | null;
  contabilidade_id: string;
};

function Moldura({ children }: { children: React.ReactNode }) {
  return <main className="p-6 max-w-3xl">{children}</main>;
}

export default async function CobrancasPage() {
  // Helper memoizado por request: os dois layouts acima já o chamaram, então
  // getUser/profiles não rodam de novo.
  const ctx = await getGateContext();
  if (!ctx) redirect('/login');

  // QUAL EMPRESA: `profiles.current_company`, o mesmo seletor do menu lateral e
  // o mesmo que /notas_fiscais, /honorarios e /configuracoes usam. O usuário
  // pode ter várias empresas; a RLS libera as cobranças de TODAS elas (a perna
  // do cliente é por `companies.user_id`), então é o `.eq()` abaixo que recorta
  // a empresa corrente. Sem ele a tela misturaria as cobranças de duas empresas
  // do mesmo dono sem dizer de qual é cada uma.
  const companyId = ctx.currentCompany;
  if (!companyId) {
    return (
      <Moldura>
        <h1 className="text-2xl font-semibold text-foreground">Cobranças do escritório</h1>
        <p className="mt-2 text-sm text-muted-foreground">Selecione uma empresa para ver as cobranças.</p>
      </Moldura>
    );
  }

  const supabase = await createServerClient();

  const [{ data: empresa }, { data, error }] = await Promise.all([
    // RLS de `companies` já restringe ao dono; serve para distinguir "sem
    // escritório vinculado" de "escritório vinculado e nada cobrado ainda".
    supabase.from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle(),
    supabase
      .from('cobrancas_escritorio')
      .select('id, descricao, status, valor_centavos, vencimento, pago_em, link_fatura, pix_copia_cola, contabilidade_id')
      .eq('empresa_cliente_id', companyId)
      .order('vencimento', { ascending: false }),
  ]);

  // Falha de leitura NÃO pode chegar como lista vazia: o cliente leria "nenhuma
  // cobrança" como "não devo nada" e deixaria vencer um boleto que existe.
  if (error) console.error('[4b] ler cobrancas do escritorio falhou:', error.message);

  const rows = (data ?? []) as Row[];
  const contabilidadeAtual = (empresa?.contabilidade_id as string | null) ?? null;

  // Nome do escritório via admin client: o empresário não é membro de
  // `contabilidade_membros`, e a policy `contabilidades_select_membro` (0035)
  // não libera esse SELECT pela sessão dele. Mesmo recorte pontual já usado em
  // configuracoes/page.tsx:96 e honorarios/page.tsx:54 — só a coluna `nome`, e
  // só para ids que já vieram de linhas que a RLS liberou.
  const ids = Array.from(new Set([...rows.map((r) => r.contabilidade_id), contabilidadeAtual].filter(Boolean) as string[]));
  const nomePorId: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: contabs } = await createAdminClient()
      .from('contabilidades')
      .select('id, nome')
      .in('id', ids);
    for (const c of contabs ?? []) nomePorId[c.id as string] = (c.nome as string | null) ?? '';
  }
  const nomeAtual = contabilidadeAtual ? nomePorId[contabilidadeAtual] || null : null;

  // `contabilidade_id` fica no servidor: só o NOME atravessa para o HTML, e
  // apenas quando o emissor não é o escritório que atende a empresa hoje.
  // Nada de `asaas_charge_id` — ele nem é selecionado.
  const cobrancas: CobrancaVm[] = rows.map((r) => ({
    id: r.id,
    descricao: r.descricao,
    status: r.status,
    valorCentavos: r.valor_centavos,
    vencimento: r.vencimento,
    pagoEm: r.pago_em,
    linkFatura: r.link_fatura,
    pixCopiaCola: r.pix_copia_cola,
    emitidaPor:
      r.contabilidade_id !== contabilidadeAtual ? nomePorId[r.contabilidade_id] || null : null,
  }));

  const emAberto = totalEmAberto(cobrancas);

  return (
    <Moldura>
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Cobranças do escritório</h1>
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          {nomeAtual ? (
            <>
              Honorários e serviços cobrados por <strong className="text-foreground">{nomeAtual}</strong>.
            </>
          ) : (
            <>Honorários e serviços cobrados pelo seu escritório de contabilidade.</>
          )}{' '}
          Quem emite e recebe é o escritório — o pagamento vai direto para ele, sem passar pela Balu.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Não foi possível carregar as cobranças agora. Recarregue a página — esta tela só mostra o
          que o escritório emitiu, então não tome a lista vazia como &ldquo;nada em aberto&rdquo;.
        </p>
      )}

      {emAberto > 0 && (
        <p className="mb-4 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground">
          Em aberto com o escritório:{' '}
          <strong className="tabular-nums">{formatBRL(emAberto)}</strong>
        </p>
      )}

      {cobrancas.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {contabilidadeAtual
            ? 'Nenhuma cobrança do seu escritório por aqui ainda.'
            : 'Sua empresa não está vinculada a um escritório de contabilidade, então não há cobranças a mostrar aqui.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {cobrancas.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="font-medium">{c.descricao}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${corStatus(c.status)}`}>
                    {rotuloStatus(c.status)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatBRL(c.valorCentavos)}</span> · vence{' '}
                  {dataBR(c.vencimento)}
                  {c.pagoEm ? ` · paga em ${dataBR(c.pagoEm)}` : ''}
                </p>
                {/* Só aparece no histórico de quem trocou de contador. */}
                {c.emitidaPor && (
                  <p className="mt-1 text-xs text-muted-foreground">emitida por {c.emitidaPor}</p>
                )}
                {/* Pix copia e cola. O campo `pix_copia_cola` existe na 0053 mas
                    HOJE NENHUM CÓDIGO O PREENCHE — nem no 4B, nem no 4A (as duas
                    telas de assinatura também o selecionam e nunca o exibem).
                    Por isso o bloco é condicional em vez de um "Pix indisponível"
                    fixo em toda linha: enquanto não houver escritor, a tela
                    simplesmente não fala de Pix; no dia em que houver, ela passa
                    a falar sozinha. Nada é inventado aqui. */}
                {podePagar(c) && c.pixCopiaCola && <CopiarPix payload={c.pixCopiaCola} />}
              </div>

              {podePagar(c) && c.linkFatura && (
                <a
                  href={c.linkFatura}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  Pagar <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {cobrancas.length > 0 && (
        <p className="mt-6 max-w-prose text-xs text-muted-foreground">
          Dúvidas sobre valores, prazos ou uma cobrança que não reconhece?{' '}
          {nomeAtual ? `Fale com ${nomeAtual}` : 'Fale com o seu escritório'} — a Balu só exibe aqui
          o que o escritório emitiu e não interfere nesta cobrança.
        </p>
      )}
    </Moldura>
  );
}
