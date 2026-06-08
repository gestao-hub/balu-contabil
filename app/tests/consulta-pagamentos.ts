#!/usr/bin/env tsx
/**
 * Consulta SERPRO Integra Contador via endpoint /v1/Consultar.
 *
 * Uso, a partir de app/:
 *   npx tsx --env-file=.env.local tests/consulta-pagamentos.ts
 *
 * Overrides úteis:
 *   COMPANY_ID=... CNPJ=... USER_EMAIL=...
 *   NUMERO_PAGINA=1 TAMANHO_DA_PAGINA=100
 *   ANO=2026
 *   DATA_INICIAL=2026-01-01 DATA_FINAL=2026-12-31
 *   OMITIR_DATAS=1
 *   MAX_DIAS_PERIODO=30
 *   CODIGO_TIPO_DOCUMENTO_LISTA=9 CODIGO_RECEITA_LISTA=1007,1124 NUMERO_DOCUMENTO_LISTA=...
 *   DADOS_JSON='{"dataInicial":"2026-01-01","dataFinal":"2026-12-31"}'
 */
import Module from 'node:module';
import { createClient } from '@supabase/supabase-js';
import type { Envelope } from '../src/lib/clients/serpro';

type SerproModules = {
  garantirAuthContratante: typeof import('../src/lib/fiscal/serpro-contratante').garantirAuthContratante;
  garantirTokenProcurador: typeof import('../src/lib/fiscal/serpro-procurador').garantirTokenProcurador;
  consultarComProcurador: typeof import('../src/lib/clients/serpro').consultarComProcurador;
  Tipo: typeof import('../src/lib/clients/serpro').Tipo;
};

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const AL_PISCINAS_COMPANY_ID = '41a9c2a4-241f-40b0-a1c5-da3fced49359';
const AL_PISCINAS_CNPJ = '10358425000120';

const USER_EMAIL = process.env.USER_EMAIL ?? 'allanvalle@outlook.com';
const COMPANY_ID = process.env.COMPANY_ID ?? AL_PISCINAS_COMPANY_ID;
const CNPJ = onlyDigits(process.env.CNPJ ?? AL_PISCINAS_CNPJ);
const ID_SISTEMA = process.env.ID_SISTEMA ?? 'PAGTOWEB';
const ID_SERVICO = process.env.ID_SERVICO ?? 'PAGAMENTOS71';
const ANO = Number(process.env.ANO ?? new Date().getFullYear());
const OMITIR_DATAS = process.env.OMITIR_DATAS === '1';
const DATA_INICIAL = process.env.DATA_INICIAL ?? (OMITIR_DATAS ? undefined : `${ANO}-01-01`);
const DATA_FINAL = process.env.DATA_FINAL ?? (OMITIR_DATAS ? undefined : defaultDataFinal(ANO));
const MAX_DIAS_PERIODO = Number(process.env.MAX_DIAS_PERIODO ?? 30);
const TAMANHO_DA_PAGINA = Number(process.env.TAMANHO_DA_PAGINA ?? 100);
const NUMERO_PAGINA = Number(process.env.NUMERO_PAGINA ?? 1);
const PRIMEIRO_DA_PAGINA = Number(
  process.env.PRIMEIRO_DA_PAGINA ?? ((NUMERO_PAGINA - 1) * TAMANHO_DA_PAGINA),
);
const CODIGO_TIPO_DOCUMENTO_LISTA = process.env.CODIGO_TIPO_DOCUMENTO_LISTA ?? '9';

if (!URL || !SERVICE) {
  throw new Error('Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
}

if (!Number.isInteger(TAMANHO_DA_PAGINA) || TAMANHO_DA_PAGINA < 1) {
  throw new Error('TAMANHO_DA_PAGINA deve ser um inteiro positivo.');
}

if (!Number.isInteger(NUMERO_PAGINA) || NUMERO_PAGINA < 1) {
  throw new Error('NUMERO_PAGINA deve ser um inteiro positivo comecando em 1.');
}

if (!Number.isInteger(PRIMEIRO_DA_PAGINA) || PRIMEIRO_DA_PAGINA < 0) {
  throw new Error('PRIMEIRO_DA_PAGINA deve ser um inteiro maior ou igual a 0.');
}

const supabase = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function allowServerOnlyImportsInCli() {
  const mod = Module as typeof Module & {
    _load?: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = mod._load;
  if (!originalLoad) return;

  mod._load = function patchedLoad(request, parent, isMain) {
    if (request === 'server-only') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
}

async function loadSerproModules(): Promise<SerproModules> {
  allowServerOnlyImportsInCli();
  const [
    contratante,
    procurador,
    serproClient,
  ] = await Promise.all([
    import('../src/lib/fiscal/serpro-contratante'),
    import('../src/lib/fiscal/serpro-procurador'),
    import('../src/lib/clients/serpro'),
  ]);

  return {
    garantirAuthContratante: contratante.garantirAuthContratante,
    garantirTokenProcurador: procurador.garantirTokenProcurador,
    consultarComProcurador: serproClient.consultarComProcurador,
    Tipo: serproClient.Tipo,
  };
}

function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

function defaultDataFinal(ano: number): string {
  const today = new Date();
  const currentYear = today.getFullYear();
  if (ano < currentYear) return `${ano}-12-31`;
  if (ano === currentYear) return formatLocalDate(today);
  throw new Error(`ANO=${ano} esta no futuro. Informe um ano ate ${currentYear}.`);
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function validateDateRange(dados: Record<string, unknown>) {
  const start = parseDate(dados.dataInicial);
  const end = parseDate(dados.dataFinal);
  if (!start && !end) return;
  if (!start || !end) throw new Error('Informe dataInicial e dataFinal juntas no formato AAAA-MM-DD.');
  if (start > end) throw new Error('dataInicial nao pode ser maior que dataFinal.');

  const today = parseDate(formatLocalDate(new Date()));
  if (today && end > today) {
    throw new Error(`dataFinal nao pode estar no futuro. Use no maximo ${formatUtcDate(today)}.`);
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDadosRequests(baseDados: Record<string, unknown>): Record<string, unknown>[] {
  if (process.env.DADOS_JSON) return [baseDados];
  validateDateRange(baseDados);

  const start = parseDate(baseDados.dataInicial);
  const end = parseDate(baseDados.dataFinal);
  if (!start || !end || start > end) return [baseDados];

  if (!Number.isInteger(MAX_DIAS_PERIODO) || MAX_DIAS_PERIODO < 1) {
    throw new Error('MAX_DIAS_PERIODO deve ser um inteiro positivo.');
  }

  const requests: Record<string, unknown>[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, MAX_DIAS_PERIODO)) {
    const chunkEnd = addDays(cursor, MAX_DIAS_PERIODO - 1);
    const effectiveEnd = chunkEnd < end ? chunkEnd : end;
    requests.push({
      ...baseDados,
      dataInicial: formatUtcDate(cursor),
      dataFinal: formatUtcDate(effectiveEnd),
    });
  }

  return requests;
}

function envList(name: string): string[] | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const items = splitList(value);
  return items.length ? items : undefined;
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function envNumber(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} deve ser numerico.`);
  return parsed;
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  ) as T;
}

function buildDados(): Record<string, unknown> {
  if (process.env.DADOS_JSON) {
    const parsed = JSON.parse(process.env.DADOS_JSON);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('DADOS_JSON deve ser um objeto JSON.');
    }
    return parsed as Record<string, unknown>;
  }

  return cleanObject({
    dataInicial: DATA_INICIAL,
    dataFinal: DATA_FINAL,
    codigoReceitaLista: envList('CODIGO_RECEITA_LISTA'),
    valorInicial: envNumber('VALOR_INICIAL'),
    valorFinal: envNumber('VALOR_FINAL'),
    numeroDocumentoLista: envList('NUMERO_DOCUMENTO_LISTA'),
    codigoTipoDocumentoLista: splitList(CODIGO_TIPO_DOCUMENTO_LISTA),
    primeiroDaPagina: PRIMEIRO_DA_PAGINA,
    tamanhoDaPagina: TAMANHO_DA_PAGINA,
  });
}

async function findCompany() {
  if (COMPANY_ID) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, cnpj, razao_social')
      .eq('id', COMPANY_ID)
      .single();
    if (error) throw error;
    return data;
  }

  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersError) throw usersError;

  const user = users.users.find((item) => item.email?.toLowerCase() === USER_EMAIL.toLowerCase());
  if (!user) throw new Error(`Usuario nao encontrado: ${USER_EMAIL}`);

  let query = supabase
    .from('companies')
    .select('id, cnpj, razao_social')
    .eq('user_id', user.id);

  if (CNPJ) query = query.eq('cnpj', CNPJ);

  const { data, error } = await query.limit(1).single();
  if (error) throw error;
  return data;
}

async function main() {
  const {
    garantirAuthContratante,
    garantirTokenProcurador,
    consultarComProcurador,
    Tipo,
  } = await loadSerproModules();

  console.log('[1/4] Localizando empresa...');
  const company = await findCompany();
  const empresaCnpj = onlyDigits(String(company.cnpj ?? ''));
  if (!empresaCnpj) throw new Error('Empresa sem CNPJ.');
  console.log(`  Empresa: ${company.razao_social ?? company.id} (${empresaCnpj})`);

  console.log('[2/4] Garantindo autenticacao SERPRO do contratante e procurador...');
  const auth = await garantirAuthContratante();
  if (!auth) throw new Error('Contratante SERPRO nao configurado na tabela serpro_contratante.');

  const procurador = await garantirTokenProcurador(supabase, company.id);
  if (!procurador.ok) throw new Error(procurador.warning);

  console.log('[3/4] Montando envelope /Consultar...');
  const requests = buildDadosRequests(buildDados());
  if (requests.length > 1) {
    console.log(`  Intervalo dividido em ${requests.length} chamadas de ate ${MAX_DIAS_PERIODO} dias.`);
  }

  console.log('[4/4] POST SERPRO /integra-contador/v1/Consultar...');
  const responses: unknown[] = [];
  for (const [index, dados] of requests.entries()) {
    const envelope: Envelope = {
      contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
      autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
      contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
      pedidoDados: {
        idSistema: ID_SISTEMA,
        idServico: ID_SERVICO,
        versaoSistema: '1.0',
        dados: JSON.stringify(dados),
      },
    };

    console.log(`\nChamada ${index + 1}/${requests.length}:`);
    console.log(JSON.stringify(envelope, null, 2));

    const response = await consultarComProcurador({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      procuradorToken: procurador.token,
      envelope,
    });

    responses.push(response);
    console.log('Resposta SERPRO:');
    console.log(JSON.stringify(response, null, 2));
  }

  if (responses.length > 1) {
    console.log('\nTodas as respostas SERPRO:');
    console.log(JSON.stringify(responses, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
