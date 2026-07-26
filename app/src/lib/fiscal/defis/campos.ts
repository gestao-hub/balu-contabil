// src/lib/fiscal/defis/campos.ts
// Schema do DEFIS. Espelha grupos.ts campo a campo — o último teste de
// campos.test.ts falha se os dois saírem de sincronia.
import { z } from 'zod';
import { camposPlanos, GRUPOS_DEFIS } from './grupos';

const moeda = z.number().min(0, 'Valor não pode ser negativo.');
const inteiro = z.number().int('Informe um número inteiro.').min(0);

export const SocioDefisSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos, sem máscara.'),
  nome: z.string().trim().min(3, 'Informe o nome do sócio.'),
  participacaoPct: z.number().min(0).max(100, 'Participação não pode passar de 100%.'),
  proLabore: moeda,
  lucroDistribuido: moeda,
  impostoRetido: moeda,
});

export type SocioDefis = z.infer<typeof SocioDefisSchema>;

const objeto = z.object({
  // identificação
  houveEvento: z.boolean(),
  eventoTipo: z.string().trim().nullable().default(null),
  eventoData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').nullable().default(null),
  ganhosCapital: moeda,
  doacoesCampanhaEleitoral: moeda,
  // empregados
  empregadosInicio: inteiro,
  empregadosFim: inteiro,
  // receitas
  receitaMercadoInterno: moeda,
  receitaMercadoExterno: moeda,
  receitaBrutaTotal: moeda,
  // despesas e resultado
  totalDespesas: moeda,
  estoqueInicial: moeda,
  estoqueFinal: moeda,
  saldoCaixaInicio: moeda,
  saldoCaixaFim: moeda,
  // aquisições
  aquisicoesMercadoInterno: moeda,
  aquisicoesMercadoExterno: moeda,
  creditosIcmsIssRetido: moeda,
  // sócios (grupo repetível)
  socios: z.array(SocioDefisSchema).min(1, 'Informe ao menos um sócio.'),
});

// A soma das participações tem de fechar em 100%. A tolerância cobre SÓ resíduo
// de ponto flutuante (33.33+33.33+33.34 não fecha exato em binário) — é da ordem
// de 1e-13. Um centésimo de ponto de folga seria largo demais: 59,99+40 é erro de
// digitação, não arredondamento, e é justamente o que precisa ser barrado.
export const DefisCamposSchema = objeto.refine(
  (v) => Math.abs(v.socios.reduce((s, x) => s + x.participacaoPct, 0) - 100) < 1e-6,
  { message: 'A participação dos sócios precisa somar 100%.', path: ['socios'] },
);

export type DefisCampos = z.infer<typeof DefisCamposSchema>;

/**
 * Schema do RASCUNHO: nada é obrigatório. Salvar trabalho pela metade é o
 * propósito do botão — validar o art. 72 inteiro tornava "Salvar rascunho"
 * impossível de usar até o último dos 22 campos estar preenchido, e a mensagem
 * era um "Required" sem nome de campo. O que estiver preenchido continua sendo
 * validado (moeda não-negativa, CPF de 11 dígitos, participação até 100%); só a
 * exigência de estar completo cai, junto com a regra de somar 100%, que não faz
 * sentido enquanto os sócios ainda estão sendo digitados.
 */
export const DefisRascunhoSchema = objeto.partial().extend({
  socios: z.array(SocioDefisSchema.partial()).default([]),
});

const ROTULOS = new Map(camposPlanos().map((c) => [c.chave, c.label]));
const ROTULOS_SOCIO = new Map(
  (GRUPOS_DEFIS.find((g) => g.repetivel)?.campos ?? []).map((c) => [c.chave, c.label]),
);

/** Nome de tela de um campo do DEFIS, a partir do caminho do erro do Zod. */
export function rotuloCampoDefis(caminho: readonly (string | number)[]): string {
  const [primeiro, indice, campo] = caminho;
  if (primeiro === 'socios') {
    if (typeof indice !== 'number') return 'Sócios';
    const nome = typeof campo === 'string' ? ROTULOS_SOCIO.get(campo) ?? campo : '';
    return nome ? `Sócio ${indice + 1} — ${nome}` : `Sócio ${indice + 1}`;
  }
  return typeof primeiro === 'string' ? ROTULOS.get(primeiro) ?? primeiro : '';
}

/** Formulário em branco: todo campo plano como undefined, sócios vazio. */
export function defisVazio(): Record<string, unknown> {
  const vazio: Record<string, unknown> = {};
  for (const c of camposPlanos()) vazio[c.chave] = undefined;
  vazio.socios = [];
  return vazio;
}
