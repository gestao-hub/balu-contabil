// Bloco 6A — a explicação do imposto na tela do cliente.
//
// É O ÚNICO PONTO DO BLOCO QUE O CONTRIBUINTE VÊ, e tudo que ele mostra já
// passou por um humano: o texto vem do catálogo com `status = 'aprovado'`, e a
// IA (quando houver) participou de redigir o rascunho, nunca de exibir. Provedor
// fora do ar, chave vencida ou nenhuma configuração não tiram nada daqui.
//
// FALHA FECHADA EM TRÊS PONTOS. Não há texto aprovado → não renderiza nada. Os
// valores não fecham com o total exibido → nem chega a buscar. `renderizar`
// recusa por marcador sem valor → não renderiza. Em nenhum caso aparece meia
// explicação, e em nenhum caso aparece `{iss}` cru numa tela sobre imposto.
import { createServerClient } from '@/lib/supabase/server';
import { chaveDaSituacao, type SituacaoFiscal } from '@/lib/fiscal/situacao-fiscal';
import { buscarExplicacao } from '@/lib/explicacoes/buscar';
import { renderizar } from '@/lib/explicacoes/renderizar';

type Props = {
  situacao: SituacaoFiscal;
  /** Já formatados (`{ inss: 'R$ 75,90' }`). `null` quando não é seguro
   *  explicar — ver `valoresDoDasMei`. */
  valores: Record<string, string> | null;
};

export default async function ExplicacaoImposto({ situacao, valores }: Props) {
  // Sem valores confiáveis não há o que explicar, e nem faz sentido contar a
  // situação como "faltante": o buraco não é de catálogo.
  if (!valores) return null;

  const supabase = await createServerClient();
  // A sessão do usuário, de propósito: a policy de RLS é a segunda camada do
  // filtro de `status`. A contagem de faltantes, que precisa de outro
  // privilégio, `buscarExplicacao` resolve por dentro.
  const texto = await buscarExplicacao(supabase, chaveDaSituacao(situacao));
  if (!texto) return null;

  const r = renderizar(texto, valores);
  if (!r.ok) {
    // Chegar aqui significa que a aprovação e a tela discordam: um texto foi
    // aprovado com marcador que esta situação não fornece. A validação da
    // aprovação existe para impedir isso, então é sintoma, não rotina.
    console.warn(
      '[6a] explicacao aprovada com marcador sem valor:',
      chaveDaSituacao(situacao), r.faltando.join(','),
    );
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-2 p-4">
      <p className="text-sm leading-relaxed text-foreground">{r.texto}</p>
      {/* FIXO NO COMPONENTE, fora do catálogo e fora do alcance do admin: é o
          aviso que não pode ser editado junto com o texto que ele qualifica. */}
      <p className="mt-2 text-xs text-muted-foreground">
        Informação educativa gerada com apoio de IA e revisada pela Balu. Não
        substitui a orientação do seu contador.
      </p>
    </div>
  );
}
