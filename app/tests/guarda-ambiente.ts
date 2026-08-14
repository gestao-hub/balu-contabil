/**
 * TRAVA: teste destrutivo não roda contra o banco de PRODUÇÃO.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * Decisão do usuário em 14/08/2026: o Supabase `Balu Contábil` passa a ser
 * **produção e só produção** — não haverá um segundo banco por enquanto.
 *
 * Só que seis specs deste diretório CRIAM E APAGAM usuários, empresas,
 * contabilidades e linhas filhas via `service_role`, que ignora RLS por
 * definição. Duas outras (as de IDOR em Server Action) invocam ações reais
 * contra dados reais. Rodar qualquer uma delas contra produção contradiz a
 * decisão — e a contradiz em silêncio, que é o pior jeito.
 *
 * Antes, a única coisa entre "rodar a suíte" e "criar usuário em produção" era
 * lembrar de não fazer isso. Combinado não é trava. Isto é a trava.
 *
 * ─── COMO A REGRA FUNCIONA ──────────────────────────────────────────────────
 * O banco onde o teste PODE escrever tem de vir em `E2E_SUPABASE_URL`, e ele
 * precisa ser DIFERENTE do que a aplicação usa (`NEXT_PUBLIC_SUPABASE_URL`).
 * Não há ref de produção codificado aqui: o que a aplicação aponta É produção,
 * por definição, então a regra continua valendo no dia em que o projeto mudar.
 *
 * A assimetria entre pular e explodir é deliberada:
 *
 *   - `E2E_SUPABASE_URL` AUSENTE  → o teste se declara **skipped**. É o caso de
 *     quem só rodou `npx playwright test` sem querer nada disso; encher a tela
 *     de vermelho aí ensina a ignorar vermelho.
 *
 *   - `E2E_SUPABASE_URL` APONTANDO PARA PRODUÇÃO → **lança**. Aqui alguém
 *     configurou de propósito e configurou errado. Pular seria esconder
 *     exatamente o acidente que esta trava existe para impedir.
 *
 * ─── QUANDO HOUVER UM BANCO DE DEV ──────────────────────────────────────────
 *   export E2E_SUPABASE_URL=https://<ref-dev>.supabase.co
 *   export E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=...
 * e a suíte volta a rodar inteira. A fixture do escritório B está exportada em
 * `app/scratchpad/fixture-escritorio-b.json` para ser recriada lá.
 */

export type AmbienteE2E = { url: string; anon: string; service: string };

/**
 * Valores INERTES para quando o arquivo vai ser pulado.
 *
 * Cinco specs chamam `createClient(URL, SERVICE)` em escopo de `describe`, que
 * o Playwright executa na COLETA — antes de qualquer `test.skip` valer. Com
 * string vazia o `createClient` lança ("supabaseUrl is required") e o arquivo
 * fica vermelho em vez de pulado, que é o oposto do que esta trava quer.
 *
 * O endereço é propositalmente impossível (porta 1 em loopback): se algum dia
 * um caminho escapar do skip e tentar usar isto, a falha é imediata e óbvia —
 * nunca uma conexão silenciosa com o lugar errado.
 */
export const URL_INERTE = 'http://127.0.0.1:1/ambiente-nao-configurado';
export const CHAVE_INERTE = 'ambiente-nao-configurado';

/** Normaliza para comparar: sem barra final, minúsculo. */
function canonica(u: string): string {
  return (u ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Devolve o ambiente onde o teste destrutivo pode escrever, ou `null` quando
 * não há um configurado (o chamador deve then `test.skip`).
 *
 * LANÇA se o alvo for o mesmo banco da aplicação.
 */
export function ambienteDestrutivo(): AmbienteE2E | null {
  const producao = canonica(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const alvo = canonica(process.env.E2E_SUPABASE_URL ?? '');

  if (!alvo) return null;

  if (producao && alvo === producao) {
    throw new Error(
      'RECUSADO: E2E_SUPABASE_URL aponta para o MESMO banco da aplicação — ' +
      'que é produção. Estes testes criam e apagam usuários, empresas e ' +
      'contabilidades via service_role. Aponte para um banco de desenvolvimento ' +
      '(ver tests/guarda-ambiente.ts).',
    );
  }

  const anon = process.env.E2E_SUPABASE_ANON_KEY ?? '';
  const service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!anon || !service) {
    throw new Error(
      'E2E_SUPABASE_URL foi definida, mas faltam E2E_SUPABASE_ANON_KEY e/ou ' +
      'E2E_SUPABASE_SERVICE_ROLE_KEY. Usar as chaves de produção contra outro ' +
      'banco não funcionaria, e cair de volta nelas por omissão é justamente o ' +
      'acidente que esta trava impede.',
    );
  }
  return { url: alvo, anon, service };
}

/** Motivo legível para o `test.skip`, quando não há ambiente configurado. */
export const MOTIVO_SKIP =
  'teste destrutivo: defina E2E_SUPABASE_URL apontando para um banco de ' +
  'desenvolvimento (nunca o de produção) — ver tests/guarda-ambiente.ts';
