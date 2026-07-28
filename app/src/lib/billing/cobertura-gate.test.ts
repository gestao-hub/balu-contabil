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
const lerLib = (p: string) => readFileSync(join(process.cwd(), 'src', 'lib', p), 'utf8');

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

  // ── Bloco 4B: o gate da EMISSAO mora um nivel abaixo da action ───────────
  // Ha dois caminhos de emissao pela subconta (servico avulso e honorario) e
  // havera mais. Repetir a chamada do gate em cada um seria repetir a chance de
  // esquece-la, entao ela mora na porta unica: `emitirCobrancaEscritorio`.
  //
  // A rede muda de forma junto, e continua falhando nos dois sentidos: prova
  // que o MOTOR chama o gate, e que cada action de emissao passa pelo motor em
  // vez de falar com o Asaas por conta propria.
  //
  // DECISAO DO USUARIO (27/07), na mesma forma das duas fronteiras acima: o
  // gate bloqueia CRIAR cobranca nova e NUNCA alcanca ver, sincronizar ou
  // receber as ja emitidas — e com esse dinheiro que o escritorio paga a Balu.
  describe('emissao pela subconta — gate na porta unica', () => {
    const motor = lerLib(join('billing', 'emitir-cobranca.ts'));

    it('emitirCobrancaEscritorio chama o gate', () => {
      expect(CHAMA_GATE.test(corpoDaAction(motor, 'emitirCobrancaEscritorio'))).toBe(true);
    });

    it.each([
      ['(auth)/(gated)/contador/clientes/[companyId]/cobrar-actions.ts', 'cobrarClienteAction'],
      ['(auth)/(gated)/contador/honorarios/cobrar-actions.ts', 'cobrarHonorarioAction'],
    ])('%s passa pelo motor (e nao pelo Asaas direto)', (arquivo, action) => {
      const corpo = corpoDaAction(ler(arquivo), action);
      expect(corpo).toContain('emitirCobrancaEscritorio(');
      // Falar com o Asaas daqui seria contornar o gate e o cofre da credencial.
      expect(corpo).not.toMatch(/asaasSub\s*\(|lerCredencial\s*\(/);
    });
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
