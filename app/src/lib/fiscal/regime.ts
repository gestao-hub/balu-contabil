// @custom — PR 1.4: option sets + helpers puros do regime tributário / faixa de atividade.
// Sem dependências de React/Supabase — testável isoladamente (regime.test.ts).

export type RegimeCode = '1' | '2' | '3' | '4';
export type RegimeTipo = 'simples' | 'mei';
export type AnexoSimples = 'Anexo I' | 'Anexo II' | 'Anexo III' | 'Anexo IV' | 'Anexo V';

export const REGIME_OPTIONS: ReadonlyArray<{ code: RegimeCode; label: string; tipo: RegimeTipo }> = [
  { code: '1', label: 'Simples Nacional', tipo: 'simples' },
  { code: '2', label: 'Simples Nacional — Excesso de sublimite de receita bruta', tipo: 'simples' },
  { code: '3', label: 'Regime Normal (Lucro Real ou Presumido)', tipo: 'simples' },
  { code: '4', label: 'Simples Nacional — MEI', tipo: 'mei' },
];

export const FAIXA_OPTIONS: ReadonlyArray<{ label: string; anexo: AnexoSimples }> = [
  { label: 'I Comércio', anexo: 'Anexo I' },
  { label: 'II Indústria', anexo: 'Anexo II' },
  { label: 'III Serviços comuns', anexo: 'Anexo III' },
  { label: 'IV Serviços com folha relevante', anexo: 'Anexo IV' },
  { label: 'V Serviços especializados', anexo: 'Anexo V' },
];

export function tipoFromCode(code: string | null | undefined): RegimeTipo {
  return code === '4' ? 'mei' : 'simples';
}

export function isMei(code: string | null | undefined): boolean {
  return code === '4';
}

export function faixaFromAnexo(anexo: string | null | undefined): string | null {
  return FAIXA_OPTIONS.find((f) => f.anexo === anexo)?.label ?? null;
}

export function anexoFromFaixa(label: string | null | undefined): AnexoSimples | null {
  return FAIXA_OPTIONS.find((f) => f.label === label)?.anexo ?? null;
}

export function fatorRAplicavel(anexo: string | null | undefined): boolean {
  return anexo === 'Anexo III' || anexo === 'Anexo V';
}

export type RegimePatch = {
  Code_regime_tributario?: string | null;
  regime_tributario?: string | null;
  anexo_simples?: string | null;
  usa_fator_r?: boolean | null;
  cnae_principal?: string | null;
};

// Normaliza um patch de empresas_fiscais antes de persistir:
// - mantém regime_tributario coerente com o Code
// - MEI (code 4) zera anexo_simples + usa_fator_r
// - Fator R só vale p/ Anexo III/V; caso contrário força false
export function normalizeRegimePatch(patch: RegimePatch): RegimePatch {
  const out: RegimePatch = { ...patch };
  // Só sincroniza quando há um Code de fato: code vazio/ausente = "não selecionado",
  // não fabricamos regime_tributario nesse caso.
  if (out.Code_regime_tributario) {
    out.regime_tributario = tipoFromCode(out.Code_regime_tributario);
  }
  if (out.Code_regime_tributario === '4') {
    out.anexo_simples = null;
    out.usa_fator_r = false;
  } else if (out.anexo_simples != null && !fatorRAplicavel(out.anexo_simples)) {
    out.usa_fator_r = false;
  }
  return out;
}
