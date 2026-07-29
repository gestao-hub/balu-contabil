// Bloco 6A — a busca da explicação para a tela do cliente.
//
// DUAS CAMADAS PARA A MESMA GARANTIA. O filtro `status = 'aprovado'` está aqui,
// explícito, E na policy de RLS da 0056. Não é redundância à toa: a policy é o
// que continua valendo se alguém escrever outra consulta e esquecer o filtro; o
// filtro é o que continua valendo se um dia esta leitura passar pelo service
// role, que ignora RLS. Rascunho chegando ao cliente é a única falha deste bloco
// que não tem conserto depois — o texto já foi lido.
//
// ⚠️ A LEITURA VAI PELA SESSÃO, A CONTAGEM VAI PELO ADMIN. São privilégios
// diferentes de propósito: a leitura quer a RLS por cima; a contagem escreve
// numa tabela fechada para as roles do cliente, e desde a 0059 a RPC só é
// executável pelo service role (ela conta SITUAÇÃO, não pessoa — nada nela
// depende de quem está logado).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * O texto aprovado para esta situação, ou `null`.
 *
 * `null` NÃO é erro: a maior parte das situações começa sem texto, e é isso que
 * a contagem existe para transformar em fila de trabalho do admin.
 *
 * @param sb cliente da SESSÃO do usuário (a RLS é a segunda camada do filtro).
 */
export async function buscarExplicacao(
  sb: SupabaseClient, chave: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('explicacoes_fiscais')
    .select('texto')
    .eq('chave', chave)
    .eq('status', 'aprovado')
    .maybeSingle();

  if (error) {
    // NÃO conta como faltante. A leitura falhou — não se sabe se o texto existe,
    // e contar encheria a fila do admin de situações que talvez já tenham
    // explicação, fazendo "vistas" deixar de significar demanda real.
    console.error('[6a] busca da explicacao falhou:', error.message);
    return null;
  }

  const texto = data?.texto?.trim();
  if (texto) return texto;

  await contarFaltante(chave);
  return null;
}

/**
 * Registra que a situação foi exibida sem texto.
 *
 * ENGOLE QUALQUER FALHA, e é o ponto do módulo em que isso é certo: quem chama é
 * a tela de impostos, e uma explicação que não existe não pode tirar do ar a
 * página que mostra o imposto a pagar. Mas engolir calado esconderia a 0059
 * negando a chamada, então a falha vai para o log.
 *
 * Os DOIS caminhos de falha precisam ser tratados: `supabase-js` devolve
 * `{ error }` sem lançar quando a RPC é recusada, e lança quando a rede cai.
 * Um `try` sozinho pegaria só o segundo.
 */
async function contarFaltante(chave: string): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .rpc('registrar_explicacao_faltando', { p_chave: chave });
    if (error) {
      console.warn('[6a] nao foi possivel contar a explicacao faltante:', error.message);
    }
  } catch (e) {
    console.warn(
      '[6a] nao foi possivel contar a explicacao faltante:',
      e instanceof Error ? e.message : String(e),
    );
  }
}
