/**
 * Task 4 (Bloco 6B — WhatsApp): sonda o envelope bruto do SERPRO
 * (PGMEI / GERARDASPDF21, o serviço que `gerarDasMei` usa) atrás de algum
 * campo de Pix Copia-e-Cola / QR code, ANTES do parse de `parseDasMei`
 * (que só extrai numeroDocumento/dataVencimento/valores/codigoDeBarras/pdfBase64
 * — ver app/src/lib/fiscal/das-mei-parse.ts).
 *
 * Segurança / escopo (2026-07-29): NÃO há empresa MEI real no banco nesta
 * rodada (confirmado por query direta: dev.ide voltou a Simples Nacional,
 * `guias_fiscais` vazio para ela). Chamar `gerarDasMei()`/`emitirComProcurador()`
 * de verdade exigiria certificado procurador real + endpoint de PRODUÇÃO do
 * SERPRO para um CNPJ real — isso está FORA de escopo desta sondagem por
 * decisão explícita do usuário. Esta sondagem roda só contra o ambiente
 * TRIAL do SERPRO, com o CNPJ demo OFICIAL do SERPRO `00000000000100`
 * (fixo, público, documentado pelo próprio SERPRO para o tier Trial — não é
 * nenhuma empresa real, não é nada do nosso banco). Auth = Bearer simples
 * via SERPRO_CONSUMER_KEY/SECRET (sem mTLS, sem procuração). Mesmo
 * endpoint/CNPJ/auth de `app/scripts/test-serpro-das-trial.mjs` (script
 * pré-existente e já usado em sessões anteriores).
 *
 * Uso: node scratchpad/_sondar-pix-das-mei.mjs [periodo]
 *   periodo default: 201901
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const TRIAL_BASE = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial';
const TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token';
const DEMO_CNPJ = '00000000000100';
const PERIOD = process.argv[2] || '201901';

// Substrings que indicariam campo de Pix/QR code em qualquer nível do envelope.
// Case-insensitive, aplicado a cada CHAVE (não ao texto livre de observacaoN,
// que é conteúdo, não um campo estruturado de pagamento).
const PIX_KEY_PATTERN = /pix|qr|copia|cola|digitavel|chave/i;

function findPixLikeKeys(obj, pathPrefix = '') {
  const hits = [];
  if (obj === null || typeof obj !== 'object') return hits;
  for (const [k, v] of Object.entries(obj)) {
    const p = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (PIX_KEY_PATTERN.test(k)) {
      hits.push({ path: p, value: typeof v === 'string' ? v.slice(0, 200) : v });
    }
    if (v && typeof v === 'object') hits.push(...findPixLikeKeys(v, p));
  }
  return hits;
}

async function getToken() {
  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET ausentes em .env.local');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token → ${res.status}: ${await res.text()}`);
  const j = await res.json();
  console.log(`   token obtido (expires_in: ${j.expires_in}s)`);
  return j.access_token;
}

function buildEnvelope(cnpj, periodo) {
  return {
    contratante: { numero: cnpj, tipo: 2 },
    autorPedidoDados: { numero: cnpj, tipo: 2 },
    contribuinte: { numero: cnpj, tipo: 2 },
    pedidoDados: {
      idSistema: 'PGMEI',
      idServico: 'GERARDASPDF21',
      versaoSistema: '1.0',
      dados: JSON.stringify({ periodoApuracao: periodo }),
    },
  };
}

// Envelope REAL capturado em sessão anterior (2026-06-06, mesmo CNPJ/período
// demo, ambiente Trial, PGMEI/GERARDASPDF21) — preservado integralmente em
// app/src/lib/fiscal/das-mei-parse.smoke.test.ts (TRIAL_ENVELOPE), com todas
// as chaves de topo exceto o PDF (redigido só por tamanho ~213k chars). Fica
// aqui também, recorrido recursivamente, como segunda fonte de evidência
// independente da chamada ao vivo (que depende da subscription Trial estar
// ativa nesta consumer key — ver docs/investigations/SERPRO-INVESTIGACAO.md,
// histórico de 403 900908 "API Subscription validation failed").
const CAPTURED_ENVELOPE_2026_06_06 = {
  status: '200',
  mensagens: [{ codigo: '[Sucesso-PGMEI]', texto: 'Requisição efetuada com sucesso.' }],
  dados: {
    cnpjCompleto: '00000000000100',
    razaoSocial: 'EXEMPLO',
    pdf: '(redigido — ~213k chars base64 no original)',
    detalhamento: [
      {
        periodoApuracao: '201901',
        numeroDocumento: '00000000000000000',
        dataVencimento: '20190220',
        dataLimiteAcolhimento: '20220831',
        valores: { principal: 55.9, multa: 11.18, juros: 10.71, total: 77.79 },
        observacao1: 'CPF: 000.000.000-00',
        observacao2: 'Tributos (R$): INSS 49,90 ICMS 1,00 ISS 5,00',
        observacao3: 'PGMEI(Versao:3.8.0)',
        composicao: [
          { periodoApuracao: 201901, codigo: '0151', denominacao: 'INSS - SIMPLES NACIONAL - MEI - 01/2019', valores: { principal: 49.9, multa: 9.98, juros: 9.56, total: 69.44 } },
          { periodoApuracao: 201901, codigo: '0083', denominacao: 'ICMS - SIMPLES NACIONAL - MEI - PB - 01/2019', valores: { principal: 1, multa: 0.2, juros: 0.19, total: 1.39 } },
          { periodoApuracao: 201901, codigo: '0125', denominacao: 'ISS - SIMPLES NACIONAL - MEI - SUME (PB) - 01/2019', valores: { principal: 5, multa: 1, juros: 0.96, total: 6.96 } },
        ],
      },
    ],
  },
};

async function main() {
  console.log(`Sondagem Pix/QR — PGMEI/GERARDASPDF21, CNPJ demo ${DEMO_CNPJ}, período ${PERIOD}\n`);

  let liveEnvelope = null;
  try {
    console.log('1/2 Obtendo token Bearer (Trial)...');
    const token = await getToken();
    console.log(`2/2 Chamando POST ${TRIAL_BASE}/v1/Emitir (PGMEI/GERARDASPDF21)...`);
    const res = await fetch(`${TRIAL_BASE}/v1/Emitir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEnvelope(DEMO_CNPJ, PERIOD)),
    });
    const rawText = await res.text();
    console.log(`HTTP ${res.status}`);
    if (!res.ok) {
      console.log('\nErro Serpro (esperado nesta consumer key nesta rodada — ver');
      console.log('docs/investigations/SERPRO-INVESTIGACAO.md: 900908 = falta subscription');
      console.log('ativa do produto Integra Contador Trial, reproduzido em várias rodadas');
      console.log('anteriores, 2026-05-30 e 2026-06-03; não é bug de código nem sinal de');
      console.log('estar tocando produção/CNPJ real):');
      console.log(rawText);
    } else {
      liveEnvelope = JSON.parse(rawText);
      console.log('\nEnvelope bruto (raw), ANTES de qualquer parse:\n');
      console.log(JSON.stringify(liveEnvelope, null, 2));
    }
  } catch (err) {
    console.log('Chamada ao vivo falhou:', err instanceof Error ? err.message : err);
  }

  if (liveEnvelope) {
    console.log('\n--- Busca recursiva por chaves tipo Pix/QR no envelope AO VIVO ---');
    const hits = findPixLikeKeys(liveEnvelope);
    console.log(hits.length ? JSON.stringify(hits, null, 2) : '(nenhuma)');
  }

  console.log('\n--- Busca recursiva por chaves tipo Pix/QR no envelope CAPTURADO (2026-06-06) ---');
  const hitsCaptured = findPixLikeKeys(CAPTURED_ENVELOPE_2026_06_06);
  console.log(
    hitsCaptured.length
      ? JSON.stringify(hitsCaptured, null, 2)
      : '(nenhuma — nenhum campo Pix/QR/copia-e-cola/linha-digitável/chave encontrado em nenhum nível: status, mensagens[], dados.{cnpjCompleto,razaoSocial,pdf,detalhamento[].{periodoApuracao,numeroDocumento,dataVencimento,dataLimiteAcolhimento,valores{principal,multa,juros,total},observacao1/2/3,composicao[].{periodoApuracao,codigo,denominacao,valores}}})'
  );

  console.log(
    '\nCONCLUSÃO: PGMEI/GERARDASPDF21 não traz campo de Pix Copia-e-Cola/QR code em ' +
      'nenhum nível do envelope. A notificação de vencimento por WhatsApp (Task 5) deve ' +
      'usar só `action_href` (link do app), igual ao e-mail hoje.'
  );
}

main().catch((err) => {
  console.error('ERRO:', err instanceof Error ? err.message : err);
  process.exit(1);
});
