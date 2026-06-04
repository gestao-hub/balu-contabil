import { describe, it, expect } from 'vitest';
import { camposOficiaisDaReceita, CAMPOS_OFICIAIS_RECEITA, CAMPOS_MANUAIS } from './campos-empresa';

describe('camposOficiaisDaReceita', () => {
  it('extrai razão social + endereço; ignora o que não vem do /v2/cnpjs', () => {
    const patch = camposOficiaisDaReceita({
      razao_social: 'AL PISCINAS LTDA',
      nome_fantasia: 'Fantasia',
      inscricao_estadual: '123',
      inscricao_municipal: '456',
      logradouro: 'Rua X', numero: '10', complemento: 'sala 2',
      bairro: 'Centro', municipio: 'Londrina', uf: 'PR', cep: '86010000',
      telefone: '4399999', email: 'a@b.com',
    });
    expect(patch).toEqual({
      razao_social: 'AL PISCINAS LTDA',
      logradouro: 'Rua X', numero: '10', complemento: 'sala 2',
      bairro: 'Centro', municipio: 'Londrina', uf: 'PR', cep: '86010000',
    });
  });

  it('ignora campos nulos/vazios e lookup vazio → {}', () => {
    expect(camposOficiaisDaReceita({})).toEqual({});
    expect(camposOficiaisDaReceita({ razao_social: '', logradouro: undefined })).toEqual({});
  });
});

describe('classificação de campos', () => {
  it('oficial e manual não se sobrepõem; cnpj não está em nenhum', () => {
    const oficiais = new Set<string>(CAMPOS_OFICIAIS_RECEITA);
    for (const m of CAMPOS_MANUAIS) expect(oficiais.has(m)).toBe(false);
    expect(oficiais.has('cnpj')).toBe(false);
    expect((CAMPOS_MANUAIS as readonly string[]).includes('cnpj')).toBe(false);
  });
});
