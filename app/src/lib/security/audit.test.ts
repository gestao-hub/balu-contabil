// Conserto 3 (Bloco 5 producao fiscal) — a auditoria falhava CALADA.
//
// Causa raiz: `audit_log.alvo_id` e uuid, e quatro actions passavam
// `alvoId: '1'` (ou `salario_minimo:<vigencia>`) — string que nao e uuid.
// `registrarAuditoria` fazia o `insert` sem conferir o `error` que o
// supabase-js devolve (em vez de lancar), o `try/catch` so pegava falha de
// REDE, e a falha de constraint ficava 100% invisivel. Resultado confirmado
// em producao: nenhuma troca de credencial de config_focus/config_serpro/
// config_ia/parametros_fiscais jamais gravou linha em `audit_log`, embora a
// tela prometesse.
//
// Este teste prova o lado de `registrarAuditoria`: quando o insert devolve
// `{ error }`, a funcao continua sem lancar (auditoria e best-effort por
// design), mas agora loga com `console.warn` — a falha deixa de ser muda.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = { erro: null as { message: string } | null };
  const insert = vi.fn(async (_valores: Record<string, unknown>) => ({
    data: null,
    error: estado.erro,
  }));
  const from = vi.fn((_tabela: string) => ({ insert }));
  return { estado, insert, from };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));

import { registrarAuditoria } from './audit';

beforeEach(() => {
  h.estado.erro = null;
  h.insert.mockClear();
  h.from.mockClear();
});

describe('registrarAuditoria', () => {
  it('insert sem erro: nao loga nada', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await registrarAuditoria({ actorUserId: 'u1', acao: 'teste.acao' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // O DEFEITO EM SI: `'1'::uuid` e erro de sintaxe no Postgres. O supabase-js
  // devolve isso como `{ error }`, nunca lanca — sem conferir o campo, a
  // funcao engolia o erro inteiro e devolvia sucesso para quem chamou.
  it('insert com erro: loga com console.warn, citando a acao e a mensagem', async () => {
    h.estado.erro = { message: 'invalid input syntax for type uuid: "1"' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await registrarAuditoria({ actorUserId: 'u1', acao: 'focus.config_salvar', alvoId: '1' as never });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, ...args] = warnSpy.mock.calls[0]!;
    const serializado = args.join(' ');
    expect(serializado).toContain('focus.config_salvar');
    expect(serializado).toContain('invalid input syntax for type uuid');
  });

  // BEST-EFFORT POR DESIGN: mesmo com erro no insert, a funcao NAO lanca —
  // trocar credencial nao pode falhar porque a auditoria falhou.
  it('insert com erro: nao lanca', async () => {
    h.estado.erro = { message: 'boom' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      registrarAuditoria({ actorUserId: 'u1', acao: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('falha de rede (insert lanca) continua sem lancar, e tambem loga', async () => {
    h.insert.mockImplementationOnce(async () => {
      throw new Error('ECONNRESET');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      registrarAuditoria({ actorUserId: 'u1', acao: 'y' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
