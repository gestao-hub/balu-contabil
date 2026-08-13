// A trava de CNPJ do upload de certificado.
//
// POR QUE ESTE ARQUIVO EXISTE: enquanto só o dono subia o próprio certificado,
// trocar o arquivo era improvável. Com o contador subindo o PFX de dezenas de
// clientes (card P11: até 30 por regime), o arquivo errado deixa de ser
// hipótese — e o erro NÃO aparece aqui: o Termo de Autorização é assinado com o
// CNPJ do certificado e o envelope do DAS declara o CNPJ da empresa, a SERPRO
// recusa lá na frente, e a tela diz "a empresa ainda não autorizou a Balu",
// mandando o contador caçar procuração por causa de um arquivo trocado.
import { describe, it, expect } from 'vitest';
import { conferirCnpjDoCertificado } from '@/lib/fiscal/cert-upload';

const A = '12345678000195';
const B = '98765432000110';

describe('conferirCnpjDoCertificado', () => {
  it('aceita quando os dois CNPJs são o mesmo', () => {
    expect(conferirCnpjDoCertificado(A, A).ok).toBe(true);
  });

  it('aceita ignorando máscara — a comparação é por dígito', () => {
    expect(conferirCnpjDoCertificado('12.345.678/0001-95', A).ok).toBe(true);
  });

  it('RECUSA certificado de outra empresa', () => {
    const r = conferirCnpjDoCertificado(A, B);
    expect(r.ok).toBe(false);
    // A mensagem precisa mostrar OS DOIS números: "certificado inválido" faria o
    // contador tentar de novo com o mesmo arquivo.
    if (!r.ok) {
      expect(r.error).toContain('12.345.678/0001-95');
      expect(r.error).toContain('98.765.432/0001-10');
    }
  });

  it('deixa passar quando o certificado não expõe CNPJ no CN', () => {
    // Recusar aqui seria barrar certificado válido por limitação da NOSSA
    // leitura do subject.
    expect(conferirCnpjDoCertificado(null, A).ok).toBe(true);
    expect(conferirCnpjDoCertificado('', A).ok).toBe(true);
  });

  it('deixa passar quando a empresa ainda não tem CNPJ cadastrado', () => {
    expect(conferirCnpjDoCertificado(A, null).ok).toBe(true);
  });
});
