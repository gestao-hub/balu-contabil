// Gate de PAPEL do subtree /contador — achado BUG-003 da auditoria de 29/08/2026.
//
// O QUE ESTAVA ABERTO: nenhuma página daqui checava papel. Elas checavam
// VÍNCULO (`getContabilidadeCtx` → `contabilidade_membros`), e quem não tinha
// vínculo caía no `redirect('/contador/cadastro')` de `page.tsx` — que é o
// onboarding de escritório. Admin e Empresa desciam por esse caminho e
// chegavam ao formulário. Pior: `criarContabilidadeAction` completava a
// criação, porque também só checava vínculo e grava com service role.
//
// POR QUE UM LAYOUT, e não a guarda no topo de cada página: são doze rotas sob
// /contador, e uma regra de acesso que precisa ser repetida doze vezes é uma
// regra que um dia vai faltar na décima terceira. Aqui ela é estrutural — rota
// nova nasce protegida.
//
// O QUE ISTO NÃO COBRE, de propósito: Server Actions não passam por layout (o
// mesmo motivo já registrado no `(gated)/layout.tsx` sobre o gate de cobrança).
// Toda mutação do escritório continua precisando do seu próprio guard —
// `requireContadorAction` para o papel, `requireEscritorioAprovado` para o
// resto.
import { requireContadorPage } from '@/lib/contador/guards';

export default async function ContadorLayout({ children }: { children: React.ReactNode }) {
  await requireContadorPage();
  return <>{children}</>;
}
