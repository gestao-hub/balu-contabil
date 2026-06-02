// @custom — Lista curta de municípios que aderiram à NFSe Nacional e portanto
// são automaticamente atendidos pela Focus via endpoint /v2/nfsen, mesmo que
// a tabela legada `municipios_nfse` (Bubble) esteja desatualizada pra eles.
//
// Fonte: decretos municipais + lista oficial da Receita ("Monitoramento de
// Adesão dos Municípios à NFSe Nacional"). Esta lista é mantida manualmente
// hoje; quando houver demanda, vira tabela `municipios_nfsen_nacional` ou
// um cron que importa o CSV oficial.

/** Mapeia código IBGE do município → data em que NFSe Nacional virou obrigatória. */
export const ADERENTES_NFSEN_NACIONAL: ReadonlyMap<string, string> = new Map([
  // 4113700 = Londrina/PR — Decreto Municipal 1.627/2025, NT 001/2025.
  ['4113700', '2026-01-01'],
]);

/** True se o município (código IBGE) já adere ao NFSe Nacional na data `now`. */
export function isAderenteNfsenNacional(
  codigoIbge: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!codigoIbge) return false;
  const desde = ADERENTES_NFSEN_NACIONAL.get(codigoIbge.trim());
  if (!desde) return false;
  return Date.parse(desde) <= now.getTime();
}
