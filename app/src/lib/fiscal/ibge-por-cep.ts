import 'server-only';

// Resolve o código IBGE (7 díg) do município a partir do CEP, via ViaCEP.
// É a fonte que o cadastro usa pra `companies.codigo_municipio` — a Focus
// (/v2/cnpjs) NÃO devolve o IBGE e o autofill por CNPJ deixava o campo vazio,
// travando a emissão de NFS-e ("Município sem código IBGE"). Best-effort: null
// em qualquer erro (CEP inválido, ViaCEP fora, sem ibge).
export async function ibgePorCep(cep: string): Promise<string | null> {
  const d = (cep ?? '').replace(/\D+/g, '');
  if (d.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if (json['erro']) return null;
    const ibge = String(json['ibge'] ?? '').replace(/\D+/g, '');
    return ibge.length === 7 ? ibge : null;
  } catch {
    return null;
  }
}
