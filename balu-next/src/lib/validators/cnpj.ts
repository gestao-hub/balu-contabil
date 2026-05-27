// @custom — validação de CNPJ pelos dígitos verificadores (algoritmo da Receita).
// Aceita com ou sem máscara; normaliza para 14 dígitos antes de validar.
export function isValidCnpj(cnpj: string | null | undefined): boolean {
  const d = (cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false; // rejeita sequências repetidas (000…, 111…)

  const dv = (len: number): number => {
    let soma = 0;
    let peso = len - 7;
    for (let i = 0; i < len; i++) {
      soma += Number(d[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
