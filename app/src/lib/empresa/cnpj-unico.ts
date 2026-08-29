// Tradução da violação do índice `companies_cnpj_ativo_uniq` (migration 0106).
//
// POR QUE EXISTE. A regra de 29/08/2026 — um CNPJ, uma empresa ativa — é
// imposta por índice único no banco. Sem esta tradução, quem esbarra nela lê
// `duplicate key value violates unique constraint "companies_cnpj_ativo_uniq"`,
// que não diz nem o que aconteceu nem o que fazer. E o que fazer é uma regra de
// negócio específica: a empresa precisa ser DESLIGADA do escritório atual antes
// de ser ligada ao novo.
//
// Mora fora das actions porque os dois caminhos que criam empresa com CNPJ
// batem no mesmo índice: `createCompanyAction` (o dono se cadastra) e
// `criarEmpresaClienteAction` (o escritório cadastra pelo cliente).

/** `unique_violation` no Postgres. */
const UNIQUE_VIOLATION = '23505';

const INDICE = 'companies_cnpj_ativo_uniq';

/**
 * DUAS mensagens, porque os dois caminhos colidem por motivos diferentes e a
 * saída de cada um é outra. Uma frase só mandava metade das pessoas para a
 * ação errada.
 *
 * TITULAR (`createCompanyAction`): quem se cadastra e esbarra num CNPJ que já
 * existe quase sempre esbarra na PRÓPRIA empresa, pré-cadastrada pelo contador
 * (`criarEmpresaClienteAction` cria com `user_id` nulo, à espera do convite).
 * Era exatamente essa a linha que o índice antigo `(user_id, cnpj)` deixava
 * duplicar. Dizer "peça o desligamento" a essa pessoa é mandá-la abrir chamado
 * contra o próprio contador; o que ela precisa é aceitar o convite, que
 * transfere a empresa existente para ela.
 *
 * ESCRITÓRIO (`criarEmpresaClienteAction`, `concluirAberturaAction`): aqui a
 * colisão é mesmo com outro escritório, e aí o desligamento é o caminho.
 */
export const MENSAGEM_CNPJ_DUPLICADO_TITULAR =
  'Este CNPJ já tem uma empresa no Balu. Se o seu contador já cadastrou a empresa para você, ' +
  'aceite o convite que ele enviou em vez de cadastrá-la de novo — o acesso é transferido para ' +
  'a sua conta, sem perder o histórico.';

export const MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO =
  'Este CNPJ já tem uma empresa ativa no Balu. Se ela está em outro escritório, ' +
  'peça o desligamento antes de vincular aqui — a empresa é transferida, não duplicada.';

/** Quem está lendo a mensagem. */
export type PublicoDaMensagem = 'titular' | 'escritorio';

type ErroPostgrest = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Diz se o erro é a colisão de CNPJ desta regra — e não outra unicidade.
 *
 * Checa o código E o nome do índice: `companies` tem outros índices únicos, e
 * responder "CNPJ duplicado" para a violação de outro deles mandaria a pessoa
 * procurar um problema que não existe. Se um dia o nome do índice mudar, esta
 * função deixa de reconhecer e o usuário volta a ver o erro cru — ruim, mas
 * honesto; o contrário (assumir que todo 23505 é CNPJ) mente.
 */
export function ehCnpjDuplicado(error: ErroPostgrest): boolean {
  if (!error) return false;
  if (error.code !== UNIQUE_VIOLATION) return false;
  return (error.message ?? '').includes(INDICE);
}

/** Mensagem pronta para devolver da action: a de negócio quando é a colisão de
 *  CNPJ — na versão do público que vai lê-la —, o texto original nos demais
 *  casos. */
export function mensagemDeErroDeEmpresa(
  error: ErroPostgrest,
  fallback: string,
  publico: PublicoDaMensagem,
): string {
  if (ehCnpjDuplicado(error)) {
    return publico === 'titular'
      ? MENSAGEM_CNPJ_DUPLICADO_TITULAR
      : MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO;
  }
  return error?.message ?? fallback;
}
