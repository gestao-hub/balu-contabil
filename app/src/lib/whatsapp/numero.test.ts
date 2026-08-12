import { describe, it, expect } from 'vitest';
import { soDigitosWhatsapp, variantesDoNumero, mesmoNumero } from './numero';

describe('soDigitosWhatsapp', () => {
  it('tira o + do E.164', () => {
    expect(soDigitosWhatsapp('+5532987006789')).toBe('5532987006789');
  });

  it('tira o sufixo de JID', () => {
    expect(soDigitosWhatsapp('553291511415@s.whatsapp.net')).toBe('553291511415');
  });

  it('tira máscara', () => {
    expect(soDigitosWhatsapp('+55 (32) 98700-6789')).toBe('5532987006789');
  });

  it('nulo e vazio não explodem', () => {
    expect(soDigitosWhatsapp(null)).toBe('');
    expect(soDigitosWhatsapp('')).toBe('');
  });
});

describe('variantesDoNumero — o nono dígito', () => {
  it('celular com 9 gera também a forma sem 9', () => {
    const v = variantesDoNumero('5532991511415');
    expect(v).toContain('5532991511415');
    expect(v).toContain('553291511415');   // é assim que o WhatsApp identifica
    expect(v).toContain('+5532991511415');
  });

  it('celular sem 9 gera também a forma com 9', () => {
    const v = variantesDoNumero('553291511415');
    expect(v).toContain('5532991511415');
  });

  it('não inventa variação de número estrangeiro', () => {
    const v = variantesDoNumero('971561124546');
    expect(v.sort()).toEqual(['+971561124546', '971561124546']);
  });

  it('fixo (8 dígitos sem 9 inicial) ganha a variante, mas não vira outro número', () => {
    // "9" + 8 dígitos é o padrão de celular; para fixo a variante extra é
    // inofensiva porque nenhum cadastro de fixo bate com ela.
    const v = variantesDoNumero('553233238582');
    expect(v).toContain('553233238582');
  });

  it('vazio devolve lista vazia (e não uma lista com string vazia)', () => {
    expect(variantesDoNumero('')).toEqual([]);
    expect(variantesDoNumero(null)).toEqual([]);
  });
});

describe('mesmoNumero — os casos que quebravam em produção', () => {
  it('E.164 cadastrado × dígitos crus do webhook', () => {
    // O caso real: `.eq('whatsapp_numero', from)` nunca casava por causa do +.
    expect(mesmoNumero('+5532987006789', '5532987006789')).toBe(true);
  });

  it('cadastrado com 9 × identificado sem 9', () => {
    // Também real: a instância do Balu é (32) 99151-1415 e o WhatsApp a
    // identifica como 553291511415.
    expect(mesmoNumero('+5532991511415', '553291511415')).toBe(true);
  });

  it('JID completo × cadastro com máscara', () => {
    expect(mesmoNumero('+55 (32) 98700-6789', '5532987006789@s.whatsapp.net')).toBe(true);
  });

  it('números diferentes continuam diferentes', () => {
    expect(mesmoNumero('+5532987006789', '5532991511415')).toBe(false);
  });

  it('DDD diferente não casa', () => {
    expect(mesmoNumero('+5531987006789', '5532987006789')).toBe(false);
  });

  it('vazio nunca casa com nada — nem com outro vazio', () => {
    // Se vazio casasse com vazio, um perfil sem número cadastrado seria
    // encontrado por qualquer remetente sem identificação.
    expect(mesmoNumero('', '')).toBe(false);
    expect(mesmoNumero(null, '5532987006789')).toBe(false);
  });
});
