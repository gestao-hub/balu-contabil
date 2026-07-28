import { describe, it, expect, beforeAll } from 'vitest';
import { guardarCredencial, lerCredencial, mascarar } from './credencial-subconta';

beforeAll(() => {
  // A chave real vive em CERT_ENC_KEY. No teste, uma fixa de 32 bytes.
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

describe('ciclo completo da credencial', () => {
  // A razao de existir deste arquivo: cifrarCampo tem teste, mas o ciclo
  // ida-e-volta nunca rodou em runtime neste repo (landmine do Bloco E).
  it('o que entra e o que sai sao a MESMA string', () => {
    const chave = '$aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZm';
    const guardada = guardarCredencial(chave);
    expect(guardada).not.toBe(chave);
    expect(guardada.startsWith('enc:v1:')).toBe(true);
    expect(lerCredencial(guardada)).toBe(chave);
  });

  // O token do Asaas comeca com `$` — o caractere que ja custou meio dia
  // nesta base por causa do dotenv-expand.
  it('preserva o cifrao inicial do token do Asaas', () => {
    expect(lerCredencial(guardarCredencial('$aact_abc'))).toBe('$aact_abc');
  });

  it('cifra duas vezes a mesma chave dando blobs diferentes (IV aleatorio)', () => {
    expect(guardarCredencial('$aact_x')).not.toBe(guardarCredencial('$aact_x'));
  });

  it('recusa guardar string vazia', () => {
    expect(() => guardarCredencial('')).toThrow();
  });

  it('lerCredencial devolve null quando nao ha nada guardado', () => {
    expect(lerCredencial(null)).toBeNull();
  });

  // `decifrarCampo` tolera valor sem prefixo por causa do certificado gravado
  // em claro antes do Bloco E. Para a apiKey da subconta nao existe legado, e
  // devolver o valor cru esconderia o segredo mais sensivel do sistema em
  // claro no banco — parecendo que tudo funciona.
  it('recusa ler credencial sem cifra em vez de devolver o valor cru', () => {
    expect(() => lerCredencial('$aact_gravado_em_claro')).toThrow(/sem cifra/);
  });
});

describe('mascarar', () => {
  // A chave nao pode aparecer inteira em log NENHUM, nem de erro. Mascarar
  // existe para que exista um jeito seguro de falar dela.
  it('mostra so o comeco e o fim', () => {
    const m = mascarar('$aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZm');
    expect(m).toBe('$aact_…NWZm');
    expect(m).not.toContain('YTU5YTE0');
  });

  it('nao vaza nada de chave curta demais', () => {
    expect(mascarar('abc')).toBe('…');
  });
});
