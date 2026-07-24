import { describe, it, expect } from 'vitest';
import { minutaPronta, tipoDocumento } from './index';

describe('minuta', () => {
  it('MEI gera roteiro, nao contrato', () => { expect(tipoDocumento('MEI')).toBe('roteiro_mei'); });
  it('EI gera requerimento de empresario', () => { expect(tipoDocumento('EI')).toBe('requerimento_empresario'); });
  it('LTDA gera ato constitutivo', () => { expect(tipoDocumento('LTDA')).toBe('ato_constitutivo_slu'); });

  it('faltando capital social bloqueia LTDA', () => {
    const r = minutaPronta({ empresa_tipo: 'LTDA', titular_nome_completo: 'X', empresa_razao_social_1: 'Y LTDA', empresa_objeto_social: 'comercio', empresa_capital_social: null } as any);
    expect(r.ok).toBe(false);
    expect(r.faltando).toContain('empresa_capital_social');
  });
  it('MEI nao exige capital social', () => {
    const r = minutaPronta({ empresa_tipo: 'MEI', titular_nome_completo: 'X', empresa_razao_social_1: 'X MEI', empresa_objeto_social: 'servicos', empresa_capital_social: null } as any);
    expect(r.ok).toBe(true);
    expect(r.faltando).toHaveLength(0);
  });
  it('LTDA completa fica pronta', () => {
    const r = minutaPronta({ empresa_tipo: 'LTDA', titular_nome_completo: 'Joao', empresa_razao_social_1: 'Acme LTDA', empresa_objeto_social: 'consultoria', empresa_capital_social: 1000 } as any);
    expect(r.ok).toBe(true);
  });
});
