// Teste de cobertura do gate. Le os fontes e confere QUEM chama o gate.
//
// Existe por causa da licao do Bloco 3: sem discriminante, os testes de
// bloqueio passariam mesmo com um gate que barra tudo. Aqui ele falha nos
// DOIS sentidos — action comercial que perdeu o gate, e action fiscal, de
// direito do titular ou perversa-de-bloquear que ganhou gate por engano.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src', 'app');
const ler = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** Extrai o corpo de uma action exportada, do `export async function NOME`
 *  ate o proximo `export async function` (ou fim do arquivo). */
function corpoDaAction(fonte: string, nome: string): string {
  const i = fonte.indexOf(`export async function ${nome}`);
  if (i < 0) throw new Error(`action nao encontrada: ${nome}`);
  const resto = fonte.slice(i + 1);
  const j = resto.indexOf('\nexport async function ');
  return j < 0 ? resto : resto.slice(0, j);
}

const CHAMA_GATE = /assertAssinatura(Empresa|Escritorio)\s*\(/;

const DEVE_TER_GATE: Array<[string, string[]]> = [
  ['(auth)/(gated)/notas_fiscais/actions.ts', [
    'emitirNotaAction', 'emitirNfeAction', 'emitirNfceAction',
    'cancelarNotaAction', 'lancarNotaManualAction', 'criarProdutoAction',
  ]],
  ['(auth)/(gated)/clientes/actions.ts', [
    'createClienteAction', 'updateClienteAction', 'softDeleteClienteAction',
  ]],
  ['(auth)/(gated)/contador/aberturas/actions.ts', [
    'avancarProcessoAction', 'concluirAberturaAction', 'decidirAlteracaoAction',
    'gerarMinutaAction', 'revisarDocumentoAction',
  ]],
  ['(auth)/(gated)/contador/honorarios/actions.ts', [
    'createHonorarioV2Action', 'updateHonorarioV2Action', 'marcarPagoV2Action',
    'desmarcarPagoV2Action', 'deleteHonorarioV2Action',
  ]],
  ['(auth)/(gated)/contador/actions.ts', [
    'criarEmpresaClienteAction', 'criarAberturaClienteAction',
  ]],
  ['(auth)/(gated)/contador/convites-actions.ts', [
    'convidarClienteAction', 'convidarMembroAction',
  ]],
  ['(onboarding)/onboarding/abertura/actions.ts', ['submitAberturaAction']],
];

const NUNCA_PODE_TER_GATE: Array<[string, string[], string]> = [
  // ── Obrigacao legal com prazo: bloquear vira multa da Receita ──────────
  ['(auth)/(gated)/impostos/actions.ts', [
    'gerarDasMeiAction', 'gerarDasSimplesAction', 'iniciarApuracaoAction',
    'consultarDeclaracoesAction', 'consultarDasnSimeiAction', 'previewDeclaracaoAction',
    'registrarDeclaracaoAnualAction', 'marcarGuiaPagaAction', 'salvarFolhaAction',
    'marcarSincronizacaoInicialAction',
  ], 'obrigacao legal com prazo'],
  ['(auth)/(gated)/contador/clientes/actions.ts', [
    'registrarDeclaracaoAnualContadorAction',
  ], 'obrigacao legal com prazo'],

  // ── Direito do titular: LGPD art. 18 e §5º (atendimento sem custo) ─────
  ['(auth)/(gated)/conta/actions.ts', [
    'updateNomeAction', 'updateEmailAction', 'updateSenhaAction', 'deleteAccountAction',
    'salvarPreferenciasNotificacaoAction', 'exportarMeusDadosAction',
  ], 'direito do titular (LGPD art. 18)'],
  ['(auth)/(gated)/notas_fiscais/actions.ts', [
    'exportNotasCsvAction',
  ], 'direito do titular (LGPD art. 18)'],

  // ── Bloquear seria perverso ou impossivel ──────────────────────────────
  // criarContabilidadeAction: o escritorio ainda NAO EXISTE, entao nao ha
  //   assinatura a consultar. Exigir seria ovo antes da galinha.
  // removerClienteDaCarteiraAction: reduzir a carteira BAIXA a fatura do
  //   escritorio (a faixa e por nº de clientes). Bloquear prenderia o
  //   inadimplente no plano caro que ele nao consegue pagar.
  // removerMembroAction: tirar acesso de alguem e acao de SEGURANCA —
  //   bloquear impediria remover um membro comprometido ou desligado.
  ['(auth)/(gated)/contador/actions.ts', [
    'criarContabilidadeAction', 'removerClienteDaCarteiraAction', 'removerMembroAction',
  ], 'bloquear seria perverso ou impossivel'],
];

describe('cobertura do gate de assinatura', () => {
  describe('actions comerciais TEM de chamar o gate', () => {
    for (const [arquivo, actions] of DEVE_TER_GATE) {
      const fonte = ler(arquivo);
      for (const nome of actions) {
        it(nome, () => {
          expect(CHAMA_GATE.test(corpoDaAction(fonte, nome))).toBe(true);
        });
      }
    }
  });

  for (const [arquivo, actions, motivo] of NUNCA_PODE_TER_GATE) {
    describe(`NUNCA pode ter gate — ${motivo}`, () => {
      const fonte = ler(arquivo);
      for (const nome of actions) {
        it(nome, () => {
          expect(CHAMA_GATE.test(corpoDaAction(fonte, nome))).toBe(false);
        });
      }
    });
  }
});
