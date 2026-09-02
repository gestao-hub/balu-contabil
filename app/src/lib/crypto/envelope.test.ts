import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { encryptBlob, decryptBlob, cifrarCampo, decifrarCampo, PREFIXO } from './envelope';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

beforeAll(() => {
  process.env.CERT_ENC_KEY = KEY_B64;
});
afterEach(() => {
  process.env.CERT_ENC_KEY = KEY_B64; // restaura entre casos que mexem no env
});

describe('envelope AES-256-GCM', () => {
  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const plain = Buffer.from('material de chave PEM', 'utf8');
    const back = decryptBlob(encryptBlob(plain));
    expect(back.equals(plain)).toBe(true);
  });

  it('detecta adulteração (GCM authTag)', () => {
    const blob = encryptBlob(Buffer.from('abc'));
    blob[blob.length - 1] ^= 0xff; // corrompe o ciphertext
    expect(() => decryptBlob(blob)).toThrow();
  });

  it('lança se CERT_ENC_KEY ausente', () => {
    delete process.env.CERT_ENC_KEY;
    expect(() => encryptBlob(Buffer.from('x'))).toThrow(/CERT_ENC_KEY/);
  });

  it('lança se a chave não decodifica para 32 bytes', () => {
    process.env.CERT_ENC_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptBlob(Buffer.from('x'))).toThrow(/32 bytes/);
  });

  it('lança para blob curto demais (corrompido)', () => {
    expect(() => decryptBlob(Buffer.alloc(10))).toThrow(/curto/);
  });
});

describe('cifrarCampo/decifrarCampo', () => {
  it('round-trip com prefixo enc:v1:', () => {
    const c = cifrarCampo('senha-secreta');
    expect(c.startsWith('enc:v1:')).toBe(true);
    expect(decifrarCampo(c)).toBe('senha-secreta');
  });
  it('valor legado em claro passa direto na leitura', () => {
    expect(decifrarCampo('claro-legado')).toBe('claro-legado');
  });
  it('vazio/null: cifrar retorna o mesmo; decifrar idem', () => {
    expect(cifrarCampo('')).toBe('');
    expect(decifrarCampo(null)).toBe(null);
  });
});

/**
 * ENDURECIMENTO DE 02/09/2026 — achado do semgrep (`gcm-no-tag-length`) durante
 * a auditoria de seguranca, triado a mao.
 *
 * O GCM aceita tag de 4 a 16 bytes e o `setAuthTag` do Node aceita a que vier,
 * a menos que `authTagLength` seja fixado na criacao do decipher. Sem isso, uma
 * tag TRUNCADA e validada como legitima — e com 4 bytes a forja cai para 1 em
 * 2^32, que e viavel para quem consegue tentar.
 *
 * `decryptBlob` ja recusava blob curto (guarda de tamanho); `decifrarCampo`
 * NAO — a mesma familia de funcao, no mesmo arquivo, com defesas diferentes.
 * Explorar exigiria escrita no banco, entao e defesa em profundidade e nao
 * buraco aberto; mas o conserto e uma linha e a assimetria era acidental.
 */
describe('autenticacao do GCM: tag truncada nao pode passar', () => {
  it('decifrarCampo RECUSA valor curto demais em vez de aceitar tag menor', () => {
    // 12 bytes de IV + 4 de "tag" = 16, abaixo do minimo de 28 (12+16).
    const curto = PREFIXO + Buffer.alloc(16, 7).toString('base64');
    expect(() => decifrarCampo(curto)).toThrow(/curto demais/i);
  });

  it('decryptBlob continua recusando blob curto', () => {
    expect(() => decryptBlob(Buffer.alloc(16, 7))).toThrow(/curto demais/i);
  });

  // Contrapositivo: o caminho feliz nao pode ter sido quebrado pela guarda.
  it('ida e volta continua funcionando para campo e para blob', () => {
    const txt = 'senha-do-certificado-A1';
    expect(decifrarCampo(cifrarCampo(txt))).toBe(txt);
    const bin = Buffer.from('conteudo binario do pfx');
    expect(decryptBlob(encryptBlob(bin)).toString()).toBe(bin.toString());
  });

  // A tag adulterada tem de derrubar, que e a razao de existir do GCM.
  it('tag adulterada faz a decifragem estourar', () => {
    const blob = encryptBlob(Buffer.from('x'));
    blob[12] = blob[12] ^ 0xff; // primeiro byte da authTag
    expect(() => decryptBlob(blob)).toThrow();
  });
});
