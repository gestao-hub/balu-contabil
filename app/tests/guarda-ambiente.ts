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
 *   - ...A MENOS que `E2E_TENANT_SINTETICO` traga o opt-in por extenso. Aí a
 *     suíte roda em produção criando e apagando só os PRÓPRIOS atores
 *     (decisão do usuário em 01/09/2026 — sem segundo banco, era isso ou
 *     manter 9 specs desligadas por tempo indeterminado). Esse opt-in libera a
 *     ESCRITA em produção, e nada além disso: quem o teste ATACA continua
 *     tendo de ser sintético, e é `exigirVitimaSintetica` no fim deste arquivo
 *     que cobra isso.
 *
 * ─── QUANDO HOUVER UM BANCO DE DEV ──────────────────────────────────────────
 *   export E2E_SUPABASE_URL=https://<ref-dev>.supabase.co
 *   export E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=...
 * e a suíte volta a rodar inteira. A fixture do escritório B está exportada em
 * `app/scratchpad/fixture-escritorio-b.json` para ser recriada lá.
 */

export type AmbienteE2E = {
  url: string;
  anon: string;
  service: string;
  /**
   * `true` quando o alvo É o banco da aplicação (produção), liberado pelo
   * opt-in de tenant sintético. Quem cria VÍTIMA precisa olhar isto — ver
   * `exigirVitimaSintetica()`.
   */
  emProducao: boolean;
};

/**
 * Opt-in para rodar o tenant sintético DENTRO de produção.
 *
 * Decisão do usuário em 01/09/2026, revertendo em parte a de 14/08: não haverá
 * segundo banco, e a regressão dos 3 papéis não pode ficar mais 18 dias
 * desligada. O que ela autoriza é ESTREITO: as specs podem criar e apagar os
 * PRÓPRIOS atores em produção.
 *
 * O que ela NÃO autoriza é o teste escolher como vítima uma linha que já
 * estava lá. Ver `exigirVitimaSintetica()`.
 *
 * O valor é uma frase inteira, e não `1`/`true`, para que ninguém a ligue por
 * reflexo nem a herde de outro projeto sem ler o que está ligando.
 */
const OPT_IN = 'sim-eu-autorizo-tenant-sintetico-em-producao';

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

  const emProducao = Boolean(producao) && alvo === producao;
  if (emProducao && process.env.E2E_TENANT_SINTETICO !== OPT_IN) {
    throw new Error(
      'RECUSADO: E2E_SUPABASE_URL aponta para o MESMO banco da aplicação — ' +
      'que é produção. Estes testes criam e apagam usuários, empresas e ' +
      'contabilidades via service_role. Aponte para um banco de desenvolvimento, ' +
      `ou, para rodar o tenant sintético em produção, defina E2E_TENANT_SINTETICO='${OPT_IN}' ` +
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
  return { url: alvo, anon, service, emProducao };
}

/** Motivo legível para o `test.skip`, quando não há ambiente configurado. */
export const MOTIVO_SKIP =
  'teste destrutivo: defina E2E_SUPABASE_URL apontando para um banco de ' +
  'desenvolvimento (nunca o de produção) — ver tests/guarda-ambiente.ts';

// ─── A SEGUNDA TRAVA: A VÍTIMA ──────────────────────────────────────────────
//
// A trava de cima decide ONDE o teste escreve. Esta decide EM QUEM ele bate.
//
// As specs de IDOR e de isolamento precisam de duas partes: um atacante e uma
// vítima. Historicamente a vítima era descoberta como "a primeira linha de
// OUTRO dono" (`.neq('owner_user_id', meuId)`) — o que, num banco de
// desenvolvimento, é inofensivo, e em produção é o primeiro cliente real que
// aparecer.
//
// O detalhe que torna isso grave: estes testes existem para ENCONTRAR defesa
// quebrada. Enquanto tudo funciona, nada acontece — a action recusa. No dia em
// que uma defesa cair, que é o dia em que o teste finalmente serve para algo, o
// efeito é real: `cancelarNotaAction` cancela uma nota fiscal que existe na
// prefeitura, `deleteHonorarioV2Action` apaga o honorário de um escritório de
// verdade, `cobrarClienteAction` emite cobrança contra um cliente de verdade.
//
// Por isso a vítima também é semeada pelo teste. `MARCA_SINTETICA` é o que
// prova isso na hora do ataque, e não só na hora da criação.

/**
 * Marca que TODA linha criada por teste destrutivo carrega — no e-mail do
 * usuário e no nome de empresa/escritório.
 *
 * Serve a dois donos: identifica o lixo de execução interrompida, e é o que
 * `exigirVitimaSintetica` confere antes de deixar um ataque acontecer.
 */
export const MARCA_SINTETICA = 'e2e-sintetico';

/** `true` se o valor carrega a marca — e-mail, nome de empresa ou de escritório. */
export function ehSintetico(valor: string | null | undefined): boolean {
  return (valor ?? '').toLowerCase().includes(MARCA_SINTETICA);
}

/**
 * Recusa seguir se a vítima escolhida não for sintética.
 *
 * Chamar DEPOIS de escolher o alvo e ANTES do primeiro ataque. Lança em vez de
 * pular: chegar aqui com alvo real significa que a descoberta do alvo mudou e
 * ninguém percebeu — pular esconderia justamente isso.
 *
 * @param rotulo  o que é o alvo, para a mensagem ("nota", "honorário")
 * @param marca   o campo que carrega (ou deveria carregar) `MARCA_SINTETICA`
 *                — o e-mail do dono, ou o nome da empresa/escritório
 */
export function exigirVitimaSintetica(rotulo: string, marca: string | null | undefined): void {
  if (ehSintetico(marca)) return;
  throw new Error(
    `RECUSADO: a vítima escolhida para "${rotulo}" não é sintética (marca lida: ` +
    `${JSON.stringify(marca ?? null)}). Estes testes tentam operações destrutivas ` +
    `de verdade; se uma defesa estiver quebrada, o dano acontece em quem for o ` +
    `alvo. O alvo tem de ser semeado pelo próprio teste e carregar ` +
    `'${MARCA_SINTETICA}' — ver tests/guarda-ambiente.ts.`,
  );
}
