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

export const MENSAGEM_CNPJ_DUPLICADO =
  'Este CNPJ já tem uma empresa ativa no Balu. Se ela está em outro escritório, ' +
  'peça o desligamento antes de vincular aqui — a empresa é transferida, não duplicada.';

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
 *  CNPJ, o texto original nos demais casos. */
export function mensagemDeErroDeEmpresa(error: ErroPostgrest, fallback: string): string {
  if (ehCnpjDuplicado(error)) return MENSAGEM_CNPJ_DUPLICADO;
  return error?.message ?? fallback;
}
