import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  NOTIFICACAO_TIPOS, severidadePadrao, TIPOS_VALIDOS, TIPOS_PREFERENCIAVEIS,
} from './tipos';

describe('notificacao tipos', () => {
  it('inclui abertura_etapa (usado pelo Bloco 2)', () => {
    expect(TIPOS_VALIDOS).toContain('abertura_etapa');
  });
  it('das_vencido é danger', () => {
    expect(severidadePadrao('das_vencido')).toBe('danger');
  });
  it('das_a_vencer é warning', () => {
    expect(severidadePadrao('das_a_vencer')).toBe('warning');
  });
  it('todo tipo tem label', () => {
    for (const t of TIPOS_VALIDOS) {
      expect(NOTIFICACAO_TIPOS[t].label.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O teste que existe por causa de um defeito real.
//
// Em 13/08/2026 este arquivo listava 11 tipos e o banco aceitava 16. Os cinco
// de fora (assinatura_trial_acabando, assinatura_cobranca_vencida,
// whatsapp_escalado, sla_estourado, pagamento_nao_detectado) CHEGAVAM ao
// usuário e não apareciam na tela de preferências — avisos impossíveis de
// desligar, e invisíveis como opção. `whatsapp_escalado` já tinha 11 linhas em
// produção quando a divergência foi notada.
//
// Nada obriga as duas listas a andarem juntas: uma é TypeScript, a outra é uma
// constraint em SQL. Este teste é a obrigação — lê a migration mais recente que
// (re)define a constraint e compara conjunto a conjunto.
// ─────────────────────────────────────────────────────────────────────────────

/** Lista do `CHECK` na migration mais recente que recria a constraint. */
function tiposDoCheckMaisRecente(): { arquivo: string; tipos: string[] } {
  const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');
  const candidatos = readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort() // prefixo numérico de 4 dígitos ⇒ ordem lexicográfica = ordem de aplicação
    .reverse();

  for (const arquivo of candidatos) {
    const sql = readFileSync(join(migrations, arquivo), 'utf8');
    const m = sql.match(/ADD CONSTRAINT notifications_tipo_check\s+CHECK\s*\(\s*tipo IN \(([\s\S]*?)\)\s*\)/i);
    if (!m) continue;
    const tipos = [...m[1].matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]);
    return { arquivo, tipos };
  }
  throw new Error('Nenhuma migration recria notifications_tipo_check — o teste perdeu seu alvo.');
}

describe('tipos.ts x CHECK de notifications.tipo', () => {
  const { arquivo, tipos } = tiposDoCheckMaisRecente();

  it(`não deixa tipo do banco (${arquivo}) fora de tipos.ts`, () => {
    const faltando = tipos.filter((t) => !(TIPOS_VALIDOS as string[]).includes(t));
    expect(faltando, `tipos aceitos pelo banco e ausentes de tipos.ts: ${faltando.join(', ')}`).toEqual([]);
  });

  it('não deixa tipo de tipos.ts fora do banco', () => {
    // Esta direção é a que quebra em produção: um INSERT com tipo que o CHECK
    // não conhece falha, e a notificação simplesmente não nasce.
    const sobrando = (TIPOS_VALIDOS as string[]).filter((t) => !tipos.includes(t));
    expect(sobrando, `tipos em tipos.ts que o CHECK recusa: ${sobrando.join(', ')}`).toEqual([]);
  });
});

describe('TIPOS_PREFERENCIAVEIS', () => {
  it('exclui só o que tem motivo declarado', () => {
    const fora = TIPOS_VALIDOS.filter((t) => !TIPOS_PREFERENCIAVEIS.includes(t));
    expect(fora.sort()).toEqual(['abertura_etapa', 'parametro_fiscal_desatualizado']);
  });

  it('oferece o aviso de pagamento confirmado ao usuário', () => {
    expect(TIPOS_PREFERENCIAVEIS).toContain('pagamento_confirmado');
  });
});
