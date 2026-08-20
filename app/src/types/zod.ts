// Auto-gerado — esquemas Zod para os payloads mais usados.
// Estender conforme as pages forem implementadas.
import { z } from 'zod';
import { isValidCnpj } from '@/lib/validators/cnpj';
import { normalizarValorBRL } from '@/lib/format/dinheiro';
import { COMPANY_TYPES } from '@/lib/billing/subconta';
import { TIPOS_VALOR } from '@/lib/billing/avulso';
import { PROVEDORES } from '@/lib/ai/provedores';
import { EMPRESA_TIPOS, REGIMES, SEDE_TIPOS } from '@/types/abertura';

export const ClienteSchema = z.object({
  person_type: z.enum(['PF','PJ']),
  razao_social: z.string().min(2),
  document: z.string().min(11),
  inscricao_estadual: z.string().optional(),
  indicador_inscricao_estadual: z.number().int().min(0).max(9).optional(),
  inscricao_municipal: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  pais: z.string().default('Brasil'),
});
export type ClienteInput = z.infer<typeof ClienteSchema>;

const companyObject = z.object({
  cnpj: z.string().length(14, 'CNPJ deve ter 14 dígitos.'),
  razao_social: z.string().min(2),
  nome: z.string().optional(),
  inscricao_estadual: z.string().optional(),
  inscricao_municipal: z.string().optional(),
  codigo_municipio: z.string().optional(),
  // Endereço obrigatório (rua/cidade/estado). CEP e bairro são opcionais.
  // `numero` é obrigatório, EXCETO quando `sem_numero` = true (ver refine abaixo).
  logradouro: z.string().trim().min(1, 'Logradouro (rua) é obrigatório.'),
  numero: z.string().optional(),
  sem_numero: z.boolean().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().trim().min(1, 'Município (cidade) é obrigatório.'),
  uf: z.string().trim().length(2, 'UF (estado) é obrigatória.'),
  cep: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  // Regime tributário (mora em empresas_fiscais; coletado no cadastro pra alimentar
  // o POST /v2/empresas da Focus). Opcional aqui pra não quebrar o form de edição;
  // o CompanyCreateSchema reforça como obrigatório.
  Code_regime_tributario: z.enum(['1', '2', '3', '4']).optional(),
  // CNAE principal — capturado da consulta de CNPJ no cadastro; mora em empresas_fiscais.
  cnae_principal: z.string().optional(),
});

// Número obrigatório, salvo quando "Sem número" (sem_numero) estiver marcado.
const numeroOuSemNumero = (d: { numero?: string; sem_numero?: boolean }) =>
  d.sem_numero === true || (typeof d.numero === 'string' && d.numero.trim().length > 0);
const numeroError = { message: 'Informe o número ou marque "Sem número".', path: ['numero'] };

export const CompanySchema = companyObject.refine(numeroOuSemNumero, numeroError);
export type CompanyInput = z.infer<typeof companyObject>;

// Cadastro de empresa: valida também o CNPJ pelos dígitos verificadores
// (na edição o CNPJ não é editável, então usa-se CompanySchema).
export const CompanyCreateSchema = companyObject
  .extend({
    cnpj: z.string().length(14, 'CNPJ deve ter 14 dígitos.').refine(isValidCnpj, 'CNPJ inválido.'),
    Code_regime_tributario: z.enum(['1', '2', '3', '4'], {
      errorMap: () => ({ message: 'Selecione o regime tributário.' }),
    }),
  })
  .refine(numeroOuSemNumero, numeroError);

export const HonorarioSchema = z.object({
  cliente_id:      z.string().uuid('cliente_id deve ser UUID.'),
  company_id:      z.string().uuid('company_id deve ser UUID.'),
  mes_referencia:  z.string().regex(/^\d{4}(0[1-9]|1[0-2])$/, 'Formato esperado: YYYYMM (ex: 202606).'),
  valor:           z.number({ invalid_type_error: 'Valor deve ser numérico.' }).nonnegative('Valor não pode ser negativo.'),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data_vencimento em YYYY-MM-DD.'),
  observacao:      z.string().optional(),
});
export type HonorarioInput = z.infer<typeof HonorarioSchema>;

export const EmpresaFiscalSchema = z.object({
  // 'simples' abrange Code 1-3 (Simples Nacional e Regime Normal); 'mei' = Code 4
  regime_tributario: z.enum(['simples', 'mei']),
  Code_regime_tributario: z.enum(['1', '2', '3', '4']),
  anexo_simples: z.enum(['Anexo I', 'Anexo II', 'Anexo III', 'Anexo IV', 'Anexo V']).nullable().optional(),
  usa_fator_r: z.boolean().nullable().optional(),
  cnae_principal: z.string().trim().min(1, 'CNAE inválido.').nullable().optional(),
  atividade_mei: z.enum(['Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos']).nullable().optional(),
  // NFS-e (PR 1.5) — todos opcionais (o upsert é parcial).
  municipio_id: z.string().uuid().nullable().optional(),
  inscricao_municipal: z.string().nullable().optional(),
  serie_rps: z.string().nullable().optional(),
  numero_rps_inicial: z.coerce.number().int().nonnegative().nullable().optional(),
  nfse_autenticacao_tipo: z.string().nullable().optional(),
  nfse_usuario_login: z.string().nullable().optional(),
  nfse_senha_login: z.string().nullable().optional(),
  nfse_token_api: z.string().nullable().optional(),
  nfse_habilitada: z.boolean().nullable().optional(),
  empresa_fiscal_ativada: z.boolean().nullable().optional(),
});
export type EmpresaFiscalInput = z.infer<typeof EmpresaFiscalSchema>;

// Validador de CPF (isValidCnpj já existe via @/lib/validators/cnpj; não havia isValidCpf).
export function isValidCpf(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const d = (sum * 10) % 11;
    return d === 10 ? 0 : d;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export const ContabilidadeSchema = z.object({
  nome: z.string().min(2, 'Informe o nome do escritório.'),
  cnpj: z.string().refine(isValidCnpj, 'CNPJ inválido.'),
  crc: z.string().min(3, 'Informe o registro CRC.'),
  crc_uf: z.string().length(2, 'UF do CRC inválida.'),
});
export type ContabilidadeInput = z.infer<typeof ContabilidadeSchema>;

export const ContabilidadeBrandingSchema = z.object({
  nome: z.string().min(2),
  whatsapp_suporte: z.string().regex(/^\+?\d{10,15}$/, 'WhatsApp inválido (use DDD+número).').optional().or(z.literal('')),
  email_remetente_nome: z.string().max(80).optional().or(z.literal('')),
});
export type ContabilidadeBrandingInput = z.infer<typeof ContabilidadeBrandingSchema>;

export const HonorarioV2Schema = z.object({
  empresa_cliente_id: z.string().uuid('Selecione o cliente.'),
  // Normaliza formatos de moeda reais ("1.200,00", "R$ 1.500", "1200,5") antes de
  // validar — o usuário digita com separador de milhar e o regex cru rejeitava.
  valor: z.preprocess(
    (v) => (typeof v === 'string' ? normalizarValorBRL(v) : v),
    z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor inválido.').refine((s) => Number(s) > 0, 'Valor deve ser maior que zero.'),
  ),
  mes_referencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência inválida.'), // YYYY-MM
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().max(500).optional().or(z.literal('')),
  recorrente: z.boolean().default(false),
  recorrencia_dia: z.coerce.number().int().min(1).max(28).optional(),
}).refine((h) => !h.recorrente || h.recorrencia_dia != null,
  { message: 'Informe o dia da recorrência (1–28).' });
export type HonorarioV2Input = z.infer<typeof HonorarioV2Schema>;

/**
 * Bloco 4B — a fronteira de entrada de `criarSubcontaAction`.
 *
 * O tipo `DadosSubconta` e apagado na compilacao: quem chama a action pode
 * mandar QUALQUER coisa. Sem este schema, `incomeValue: "25000"` passava como
 * string para um KYC IRREVERSIVEL, `name` nao-string estourava `TypeError` no
 * `.trim()` (500 em vez de mensagem em portugues) e `companyType` nao era
 * conferido contra o enum do Asaas.
 *
 * Aqui e so a checagem de FORMA. As regras do cadastro (documento com 11 ou 14
 * digitos, CEP com 8, PJ pede tipo e PF pede nascimento) continuam em
 * `validarDadosSubconta`, que a action chama logo depois — elas sao as mesmas
 * que o formulario aplica antes do round-trip.
 *
 * `incomeValue` SEM `z.coerce`, de proposito: coagir "25000" e justamente o que
 * deixava o valor errado entrar no KYC. Numero tem de chegar numero.
 */
const textoObrigatorio = (mensagem: string) =>
  z.string({ required_error: mensagem, invalid_type_error: mensagem });

export const SubcontaSchema = z.object({
  name: textoObrigatorio('Informe o nome do escritório.'),
  cpfCnpj: textoObrigatorio('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.'),
  email: textoObrigatorio('Informe o e-mail do responsável.'),
  mobilePhone: textoObrigatorio('Informe o celular com DDD.'),
  incomeValue: z
    .number({
      required_error: 'Informe o faturamento mensal estimado.',
      invalid_type_error: 'Informe o faturamento mensal estimado como número.',
    })
    .finite('Informe o faturamento mensal estimado como número.'),
  address: textoObrigatorio('Informe endereço, número e bairro.'),
  addressNumber: textoObrigatorio('Informe endereço, número e bairro.'),
  province: textoObrigatorio('Informe endereço, número e bairro.'),
  postalCode: textoObrigatorio('Informe o CEP com 8 dígitos.'),
  birthDate: z
    .string({ invalid_type_error: 'Informe a data de nascimento do responsável.' })
    .nullish()
    .transform((v) => v ?? null),
  companyType: z
    .enum(COMPANY_TYPES, { errorMap: () => ({ message: 'Informe o tipo da empresa.' }) })
    .nullish()
    .transform((v) => v ?? null),
});
export type SubcontaInput = z.infer<typeof SubcontaSchema>;

/**
 * Bloco 4B — a fronteira de entrada de `salvarServicoAction` (catalogo de
 * avulsos do escritorio).
 *
 * Mesmo motivo do `SubcontaSchema`: o tipo `ServicoAvulso` some na compilacao e
 * a action e um endpoint HTTP — quem chama pode mandar `valorCentavos: "900"`,
 * `tipoValor: 'gratis'` ou `nome: {}`. Sem schema, a string de valor chegaria
 * ate o INSERT (onde vira preco errado ou erro cru de Postgres na tela) e o
 * `{}` estouraria `TypeError` no `.trim()` de `validarServicoAvulso`.
 *
 * So checagem de FORMA. As REGRAS — fixo exige valor e proibe percentual, e
 * vice-versa — continuam em `validarServicoAvulso`, que espelha o CHECK
 * `servicos_avulsos_valor_check` da 0053 e e a mesma funcao que a tela chama
 * antes do round-trip.
 *
 * `valorCentavos` inteiro e limitado ao teto do `integer` do Postgres: acima
 * disso o banco responde "value out of range", que chegaria ao escritorio como
 * erro tecnico em ingles no meio do cadastro.
 */
export const ServicoAvulsoSchema = z.object({
  // `null` = criar; uuid = editar aquele servico. String qualquer nao entra:
  // o id vai direto para o `.eq('id', ...)` da action.
  id: z.string().uuid('Serviço inválido.').nullish().transform((v) => v ?? null),
  nome: z
    .string({ required_error: 'Informe o nome do serviço.', invalid_type_error: 'Informe o nome do serviço.' })
    .trim()
    .min(1, 'Informe o nome do serviço.')
    .max(200, 'Nome do serviço longo demais.'),
  categoria: z
    .string({ invalid_type_error: 'Categoria inválida.' })
    .max(100, 'Categoria longa demais.')
    .nullish()
    .transform((v) => v?.trim() || null),
  tipoValor: z.enum(TIPOS_VALOR, {
    errorMap: () => ({ message: 'Escolha entre valor fixo e percentual.' }),
  }),
  valorCentavos: z
    .number({ invalid_type_error: 'Informe o valor do serviço em números.' })
    .int('Informe o valor do serviço em números.')
    .max(2_147_483_647, 'Valor alto demais.')
    .nullish()
    .transform((v) => v ?? null),
  percentual: z
    .number({ invalid_type_error: 'Informe o percentual em números.' })
    .finite('Informe o percentual em números.')
    // A coluna e `numeric(5,2)`: 33.333 seria gravado como 33.33 SEM erro
    // nenhum. A tela mostraria um numero e o escritorio cobraria outro, e a
    // diferenca so apareceria na conciliacao. Recusar aqui e a unica forma de
    // o que se ve ser o que se cobra. Tolerancia porque 33.33*100 nao da
    // exatamente 3333 em ponto flutuante.
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9,
      'O percentual aceita no máximo duas casas decimais.',
    )
    .nullish()
    .transform((v) => v ?? null),
  ativo: z.boolean({ invalid_type_error: 'Situação inválida.' }).nullish().transform((v) => v ?? true),
});
export type ServicoAvulsoInput = z.infer<typeof ServicoAvulsoSchema>;

/**
 * Bloco 4B — as duas fronteiras de EMISSÃO de cobrança pela subconta.
 *
 * Mesmo motivo dos dois schemas acima, com a aposta mais alta do bloco: daqui
 * sai dinheiro real cobrado de um cliente real. Sem schema, `baseCentavos:
 * "1000"` chegaria como string ao cálculo do percentual (`"1000" * 20 / 100`
 * dá número, mas `"1000" + x` daria concatenação em qualquer refactor), e um
 * `companyId` que não é uuid iria direto para o `.eq('id', ...)`.
 *
 * `vencimento` no formato do Asaas (YYYY-MM-DD) e **não no passado**: o Asaas
 * recusa `dueDate` anterior a hoje com erro em inglês, e o contador veria
 * "invalid_dueDate" no meio da tela de cobrança. A comparação é de string
 * porque YYYY-MM-DD ordena lexicograficamente — e quem passa o "hoje" é a
 * action, em BRT (`ymdBrt`), para não recusar o dia corrente às 21h.
 */
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const CobrarClienteSchema = z.object({
  companyId: z.string().uuid('Cliente inválido.'),
  // `null` = cobrança livre (descrição e valor digitados na hora).
  servicoAvulsoId: z.string().uuid('Serviço inválido.').nullish().transform((v) => v ?? null),
  descricaoLivre: z
    .string({ invalid_type_error: 'Descrição inválida.' })
    .max(200, 'Descrição longa demais.')
    .nullish()
    .transform((v) => v?.trim() || null),
  // Base do percentual (crédito recuperado, serviço-base da taxa de urgência) e
  // também o valor da cobrança livre. Inteiro: centavo não tem fração.
  baseCentavos: z
    .number({ invalid_type_error: 'Informe o valor em números.' })
    .int('Informe o valor em números.')
    .max(2_147_483_647, 'Valor alto demais.')
    .nullish()
    .transform((v) => v ?? null),
  vencimento: z.string({ required_error: 'Informe o vencimento.', invalid_type_error: 'Informe o vencimento.' })
    .regex(DATA_ISO, 'Informe o vencimento.'),
  // A CHAVE DE IDEMPOTENCIA DA SUBMISSAO (0055). O avulso nao tem chave
  // natural — cobrar duas vezes o mesmo servico do mesmo cliente e legitimo —
  // entao quem separa "duplo clique" de "cobrar de novo" e este UUID, gerado
  // por `novaChaveEmissao` (lib/billing/chave-emissao) UMA VEZ POR ABERTURA DO
  // FORMULARIO e renovado so apos uma emissao bem-sucedida. `CobrarDialog.tsx`
  // e quem o manda hoje.
  //
  // OBRIGATORIA (28/07): Server Action e endpoint publico — um POST direto sem
  // passar pela tela emitia MESMO ASSIM, sem reserva e sem indice unico, ou
  // seja, SEM TRAVA NENHUMA contra duplo clique. Tornar a chave obrigatoria
  // aqui, na fronteira do avulso, fecha o buraco sem mexer no motor: o
  // caminho do honorario usa a chave NATURAL do `honorarioId` (`hon:<id>`),
  // nunca manda `idempotencyKey`, e `chaveDeReserva` (emitir-cobranca.ts)
  // resolve essa chave PRIMEIRO — continua emitindo sem esta aqui.
  //
  // `.toLowerCase()` porque `z.string().uuid()` aceita hexadecimal MAIUSCULO e
  // o CHECK de formato da 0055 (`[0-9a-f]`) nao — sem isto, uma chave em
  // maiusculas viraria erro cru de Postgres na tela do contador.
  idempotencyKey: z.string({
    required_error: 'Informe a chave de emissão.',
    invalid_type_error: 'Chave de emissão inválida.',
  }).uuid('Chave de emissão inválida.').transform((v) => v.toLowerCase()),
});
export type CobrarClienteInput = z.infer<typeof CobrarClienteSchema>;

export const CobrarHonorarioSchema = z.object({
  honorarioId: z.string().uuid('Honorário inválido.'),
  // Ausente = usa o vencimento que o honorário já tem. Só é preciso digitar
  // quando aquele já passou — o Asaas não aceita vencimento no passado.
  vencimento: z.string().regex(DATA_ISO, 'Informe o vencimento.').nullish().transform((v) => v ?? null),
});
export type CobrarHonorarioInput = z.infer<typeof CobrarHonorarioSchema>;

export const AberturaCreateSchema = z.object({
  // required
  titular_nome_completo: z.string().trim().min(1, 'Informe o nome completo do titular.'),
  titular_cpf: z.string().refine((v) => isValidCpf(v), 'CPF inválido.'),
  empresa_razao_social_1: z.string().trim().min(1, 'Informe ao menos a 1ª opção de razão social.'),
  empresa_tipo: z.enum([...EMPRESA_TIPOS] as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o tipo de empresa.' }) }),
  empresa_regime_tributario: z.enum([...REGIMES] as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o regime.' }) }),
  sede_tipo_endereco: z.enum([...SEDE_TIPOS] as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o tipo de endereço da sede.' }) }),
  // optional text fields (explicit — sem passthrough para evitar mass assignment)
  titular_rg_numero: z.string().optional(),
  titular_rg_orgao_emissor: z.string().optional(),
  titular_rg_uf: z.string().optional(),
  titular_data_nascimento: z.string().optional(),
  titular_estado_civil: z.string().optional(),
  titular_nome_mae: z.string().optional(),
  titular_nacionalidade: z.string().optional(),
  titular_telefone: z.string().optional(),
  titular_email: z.string().email('E-mail do titular inválido.').or(z.literal('')).optional(),
  titular_naturalidade_cidade: z.string().optional(),
  titular_naturalidade_uf: z.string().length(2).or(z.literal('')).optional(),
  titular_cep: z.string().optional(),
  titular_logradouro: z.string().optional(),
  titular_numero: z.string().optional(),
  titular_complemento: z.string().optional(),
  titular_bairro: z.string().optional(),
  titular_cidade: z.string().optional(),
  titular_uf: z.string().length(2).or(z.literal('')).optional(),
  empresa_razao_social_2: z.string().optional(),
  empresa_razao_social_3: z.string().optional(),
  empresa_nome_fantasia: z.string().optional(),
  empresa_capital_social: z.string().optional(),
  empresa_objeto_social: z.string().optional(),
  empresa_cnae_principal: z.string().optional(),
  empresa_cnaes_secundarios: z.array(z.string()).optional(),
  sede_mesmo_que_titular: z.boolean().optional(),
  sede_cep: z.string().optional(),
  sede_logradouro: z.string().optional(),
  sede_numero: z.string().optional(),
  sede_complemento: z.string().optional(),
  sede_bairro: z.string().optional(),
  sede_cidade: z.string().optional(),
  sede_uf: z.string().length(2).or(z.literal('')).optional(),
});

// Bloco 6A — configuração do provedor de IA (AdminBalu).
//
// Mora aqui, e não na action, porque arquivo `'use server'` só pode exportar
// função async — exportar um schema de lá quebra o `next build` sem o `tsc`
// reclamar (a mesma regra que levou `ServicoAvulsoSchema` para cá).
//
// DUAS SUTILEZAS QUE VALEM MAIS QUE O RESTO DO SCHEMA:
//  - `chave` VAZIA significa "não trocar a chave", NUNCA "apagar a chave". O
//    campo da tela vem vazio toda vez que o admin não quer digitá-la de novo, e
//    é a action que decide não gravar a coluna.
//  - `base_url` é obrigatória se, e somente se, o provedor for 'personalizado'
//    — nos demais o adaptador conhece a URL, e aceitar uma aqui só criaria um
//    jeito silencioso de apontar o "Anthropic" para outro servidor.
export const ConfigIaSchema = z
  .object({
    provedor: z.enum(PROVEDORES),
    modelo: z.string().trim().min(1, 'Informe o modelo.'),
    base_url: z.string().trim().max(300).nullable().optional(),
    chave: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const base = (v.base_url ?? '').trim();
    if (v.provedor === 'personalizado') {
      if (!base) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ['base_url'],
          message: 'Provedor personalizado exige a URL base.',
        });
        return;
      }
      // `https` exigido: a chave do provedor viaja neste cabeçalho.
      if (!/^https:\/\/\S+$/i.test(base)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ['base_url'],
          message: 'A URL base precisa começar com https://.',
        });
      }
    }
  });

export type ConfigIaInput = z.infer<typeof ConfigIaSchema>;

/**
 * Bloco 6A — a chave de uma situação fiscal, na fronteira da action.
 *
 * A MESMA FORMA QUE A 0059 EXIGE NO BANCO (`registrar_explicacao_faltando`), de
 * propósito: chave que a action aceitasse e o banco recusasse produziria um
 * catálogo que a contagem de faltantes nunca alcança. Não fixa a lista de
 * tributos — o 6B trará outros —, mas fixa caixa, charset e teto de tamanho.
 *
 * A validação de SIGNIFICADO (o tributo existe? o anexo existe?) é de
 * `situacaoDaChave`, que devolve `null` para o que não reconhece. Aqui é só a
 * forma, que é o que a fronteira tem como julgar sozinha.
 */
export const ChaveExplicacaoSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,19}:[a-z0-9+-]{1,64}$/, 'Chave de situação inválida.');

/**
 * Bloco 6A — o texto de uma explicação, na fronteira de salvar e aprovar.
 *
 * O teto de 4000 é generoso de propósito: a explicação são duas a quatro frases,
 * e qualquer coisa muito maior é colagem acidental. Texto vazio é recusado aqui
 * porque `explicacoes_fiscais.texto` é NOT NULL e um texto em branco aprovado
 * seria uma explicação invisível que ninguém entende por que não aparece.
 */
export const ExplicacaoTextoSchema = z.object({
  chave: ChaveExplicacaoSchema,
  texto: z.string().trim().min(1, 'Escreva o texto da explicação.').max(4000, 'Texto longo demais.'),
  /**
   * TRAVA OTIMISTA: o `updated_at` que a tela leu quando carregou. A action só
   * grava se ele ainda for o do banco — senão outro admin escreveu no meio e a
   * gravação seria um lost update silencioso.
   *
   * `null`/ausente significa "a situação não tinha linha quando a tela carregou"
   * e leva ao caminho de INSERT, onde a corrida é resolvida pelo UNIQUE da
   * chave. Não é escapatória: com linha existente, a action exige a versão.
   */
  versao: z.string().nullable().optional(),
});

/**
 * 0094/0095 — o token de REVENDA da Focus na fronteira da action do AdminBalu.
 *
 * UM token, não um par por ambiente: a 0095 registra a sondagem que provou que
 * os dois tokens do `.env.local` não têm acesso a `/v2/empresas*`. O par
 * hom/prod pertence ao token da EMPRESA, que não passa por esta tela.
 *
 * Opcional de propósito: vazio quer dizer "não trocar". A action é que recusa
 * gravar quando não há nada a gravar — aqui não dá para saber o que já existe.
 */
export const ConfigFocusSchema = z.object({
  token_revenda: z.string().max(500).optional(),
});
export type ConfigFocusInput = z.infer<typeof ConfigFocusSchema>;

/**
 * 0094 — credenciais do SERPRO Integra Contador na fronteira da action.
 *
 * Mesma regra de campo vazio = não trocar. A validação de "par completo" NÃO
 * mora aqui: só o servidor sabe o que já está gravado, e é lá que se decide se
 * a gravação deixaria meia credencial no banco.
 */
export const ConfigSerproSchema = z.object({
  consumer_key: z.string().max(500).optional(),
  consumer_secret: z.string().max(500).optional(),
});
export type ConfigSerproInput = z.infer<typeof ConfigSerproSchema>;
