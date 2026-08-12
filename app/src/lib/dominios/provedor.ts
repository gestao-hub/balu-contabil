// Bloco 7 — provisionamento do dominio na plataforma de hospedagem.
//
// Adapter, nao dependencia dura: sem `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID`
// (o caso de hoje — o usuario fornece o token depois) `provedorDeEnv()`
// devolve null e o fluxo entra em MODO MANUAL, que e completo: a tela mostra
// o CNAME e o token, e a verificacao por HTTP (host.ts + a action) prova o
// apontamento sozinha. So o passo "adicionar o dominio no projeto" e que
// passa a ser humano.
//
// Mesma convencao de sendEmail (Bloco 1) e configDeEnv do uazapi (6B):
// falha na CHAMADA, nunca no import — o app tem de subir inteiro sem isto.
import 'server-only';

export type ConfigVercel = { token: string; projectId: string; teamId?: string };

export type ResultadoProvisionamento =
  | { ok: true; jaExistia: boolean }
  | { ok: false; erro: string };

export function provedorDeEnv(): ConfigVercel | null {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID || undefined };
}

function url(cfg: ConfigVercel, caminho: string): string {
  const base = `https://api.vercel.com${caminho}`;
  return cfg.teamId ? `${base}${caminho.includes('?') ? '&' : '?'}teamId=${cfg.teamId}` : base;
}

/**
 * Registra o dominio no projeto. Idempotente do ponto de vista de quem
 * chama: dominio ja cadastrado devolve `ok` com `jaExistia`, porque o
 * usuario clicando "verificar" duas vezes nao pode virar erro na tela.
 */
export async function provisionarDominio(
  cfg: ConfigVercel | null, host: string,
): Promise<ResultadoProvisionamento> {
  // Modo manual: nao ha o que provisionar, e isso NAO e falha. A verificacao
  // por HTTP e que decide se o dominio esta de pe.
  if (!cfg) return { ok: true, jaExistia: false };

  try {
    const res = await fetch(url(cfg, `/v10/projects/${cfg.projectId}/domains`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ name: host }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) return { ok: true, jaExistia: false };

    // 409 = ja esta no projeto. E o estado desejado, nao um erro.
    if (res.status === 409) return { ok: true, jaExistia: true };

    const corpo = await res.text().catch(() => '');
    return { ok: false, erro: `Vercel respondeu ${res.status}${corpo ? `: ${corpo.slice(0, 200)}` : ''}` };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'falha ao falar com a Vercel' };
  }
}
