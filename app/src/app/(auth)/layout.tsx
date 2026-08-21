// @custom — bubble-behavior: editado à mão, não regenerar.
// Auth gate: sem sessão → /login. Os gates de aceite LGPD e de onboarding vivem
// no sub-grupo (gated)/layout.tsx — assim /aceite fica fora deles e não há como
// formar loop de redirect (antes o gate dependia do header x-pathname setado por
// middleware, que não chegava nas navegações RSC em produção → loop /aceite→/aceite
// e tela preta pós-login).
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getGateContext } from '@/lib/auth/gate-context';
import { mostrarItemCobrancas } from '@/lib/billing/cobranca-escritorio-vm';
import { signedUrlBranding } from '@/lib/clients/supabase-storage';
import MenuLateral, { type EscritorioBranding } from '@/components/MenuLateral';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // user + role + current_company vêm do helper memoizado por request — o mesmo que
  // o (gated)/layout usa, então getUser/profiles/role_types rodam uma vez só.
  const ctx = await getGateContext();
  if (!ctx) redirect('/login');
  const { user, currentCompany, normalizedRole } = ctx;

  const supabase = await createServerClient();
  const [{ data: companies }, { data: membro }, cobrancasDoEscritorio] = await Promise.all([
    // contabilidade_id junto — evita 1 query extra pra descobrir se a empresa
    // ativa tem escritório (co-branding, Task 18).
    supabase.from('companies').select('id, nome, contabilidade_id').eq('user_id', user.id).is('deleted_at', null).order('nome'),
    supabase.from('contabilidade_membros').select('contabilidade_id').eq('user_id', user.id).maybeSingle(),
    // Bloco 4B — EXISTE ALGUM BOLETO? (decisão do usuário, 28/07). O item
    // "Cobranças" só entra no menu do empresário quando o escritório de fato
    // emitiu algo pela subconta: vínculo com escritório não basta, porque a
    // esmagadora maioria cobra fora da Balu e o item viraria uma tela vazia
    // permanente ao lado de "Honorários", que fala da mesma dívida.
    //
    // `limit(1)`, não `count` — a pergunta é "existe?", e um COUNT exato varre
    // a partição inteira do índice a cada carregamento de página autenticada.
    // Sem empresa ativa a consulta nem sai (o item já não apareceria).
    currentCompany
      ? supabase.from('cobrancas_escritorio').select('id').eq('empresa_cliente_id', currentCompany).limit(1)
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Marca do menu. Duas origens, com precedências diferentes:
  //
  //  1. O PRÓPRIO escritório, quando o usuário é membro de uma contabilidade.
  //     O contador em geral não tem empresa ativa, então antes disto ele nunca
  //     via a própria marca — caía no logo da Balu. Aqui não exigimos status
  //     'aprovada': é a marca dele, vendo a si mesmo, e o logo tem de aparecer
  //     assim que for enviado.
  //  2. Co-branding (Task 18): o empresário vê a marca do escritório que o
  //     atende. Aqui a aprovação É exigida — exibir a marca de um escritório
  //     não aprovado para o cliente dele seria endossar quem ainda não passou
  //     pela análise.
  //
  // `proprio` separa os dois casos na UI: "oferecido por X" e o WhatsApp de
  // suporte só fazem sentido quando X é outra pessoa.
  let escritorio: EscritorioBranding | null = null;
  const admin = createAdminClient();   // empresa não tem RLS de leitura em `contabilidades`

  // Vínculo cru da empresa ativa, sem exigir aprovação — o co-branding abaixo
  // EXIGE 'aprovada', mas esta variável é a matéria-prima dele.
  const currentCompanyContabilidadeId =
    (companies ?? []).find((c) => c.id === currentCompany)?.contabilidade_id ?? null;

  // O item /cobrancas do 4B: existe boleto, ponto. Não exige escritório
  // aprovado, e não exige que a subconta ainda esteja de pé — escritório
  // suspenso continua tendo boleto em aberto na mão do cliente, e sumir com o
  // link de pagamento por causa do status DO ESCRITÓRIO seria fazer a briga
  // deles respingar nele. Uma vez emitido, o item nunca mais some: a tela é
  // também o histórico do que o cliente pagou.
  //
  // FALHA ABERTA em erro de leitura — a regra e o porquê moram em
  // `mostrarItemCobrancas`. Esconder o item por um blip de rede faria o cliente
  // concluir que não tem cobrança, e no menu não há onde escrever "não deu para
  // conferir". Isto roda em TODA página autenticada, então "um blip" não é
  // hipótese remota.
  if (cobrancasDoEscritorio.error) {
    console.error('[4b] existência de cobranças do escritório não pôde ser lida:',
      cobrancasDoEscritorio.error.message);
  }
  const temCobrancasDoEscritorio = mostrarItemCobrancas({
    erro: !!cobrancasDoEscritorio.error,
    quantidade: (cobrancasDoEscritorio.data ?? []).length,
  });

  if (membro?.contabilidade_id) {
    const { data: contab } = await admin
      .from('contabilidades')
      .select('nome, logo_url')
      .eq('id', membro.contabilidade_id)
      .maybeSingle();
    if (contab) {
      escritorio = {
        nome: contab.nome as string,
        logoUrl: contab.logo_url ? await signedUrlBranding(contab.logo_url as string) : null,
        whatsapp: null,      // não faz sentido oferecer suporte de si para si
        proprio: true,
      };
    }
  } else {
    if (currentCompanyContabilidadeId) {
      const { data: contab } = await admin
        .from('contabilidades')
        .select('nome, logo_url, whatsapp_suporte, status, sla_resposta_horas')
        .eq('id', currentCompanyContabilidadeId)
        .maybeSingle();
      if (contab?.status === 'aprovada') {
        escritorio = {
          nome: contab.nome as string,
          logoUrl: contab.logo_url ? await signedUrlBranding(contab.logo_url as string) : null,
          whatsapp: (contab.whatsapp_suporte as string | null) ?? null,
          proprio: false,
          // Bloco 7: a promessa de prazo aparece junto do Suporte — que é o
          // lugar onde ela significa alguma coisa pro cliente.
          slaHoras: (contab.sla_resposta_horas as number | null) ?? null,
        };
      }
    }
  }

  // normalizedRole vem do helper (role_types.type canônico; user_metadata fallback).
  const userRole: 'empresa' | 'contador' | 'adminbalu' =
    normalizedRole === 'contador' ? 'contador' : normalizedRole === 'adminbalu' ? 'adminbalu' : 'empresa';

  // Layout SaaS: sidebar fixa no viewport, área principal com scroll próprio.
  // `h-screen overflow-hidden` no wrapper trava a página em 100vh; o `<main>`
  // de cada rota fica em um `overflow-y-auto` próprio, e o scrollbar aparece
  // ao lado do conteúdo (sem mover a sidebar).
  return (
    <div className="h-screen flex overflow-hidden">
      <MenuLateral
        userName={
          ((user.user_metadata?.full_name as string | null)?.trim()) ||
          user.email ||
          'Usuário'
        }
        userRole={userRole}
        companies={(companies ?? []).map((c) => ({ id: c.id, nome: c.nome }))}
        currentCompanyId={currentCompany}
        // MESMO CRITERIO DO GATE DE COBRANCA, e nao o objeto `escritorio` acima:
        // `assertAssinaturaEmpresa` libera pela PRESENCA de `contabilidade_id`,
        // enquanto `escritorio` so e montado com o escritorio ja `aprovada`.
        // Usar `escritorio` faria a empresa ligada a um escritorio pendente ver
        // "Assinatura" enquanto a cobranca ja a trata como coberta.
        empresaDeCarteira={Boolean(currentCompanyContabilidadeId)}
        temEscritorio={!!membro}
        temCobrancasDoEscritorio={temCobrancasDoEscritorio}
        escritorio={escritorio}
      />
      <div className="flex-1 overflow-y-auto pt-14 md:pt-0">{children}</div>
    </div>
  );
}
