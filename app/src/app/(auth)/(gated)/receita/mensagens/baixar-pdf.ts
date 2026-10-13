// PDF que veio da Receita em base64 → arquivo baixado, sem passar por URL de
// dados na barra de endereço. Usado pelos cartões de DCTFWeb e parcelamentos.
export function baixarPdf(base64: string, nome: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
