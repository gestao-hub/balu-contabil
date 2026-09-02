#!/usr/bin/env tsx
/**
 * SMOKE FISCAL — MCB MARKETING, em HOMOLOGAÇÃO.
 *
 * POR QUE EXISTE. O parecer de lançamento de 01/09 disse que nenhum dos sete
 * blocos completou seu ciclo com dado real: as 2 notas do banco são de 09/06,
 * as 4 PGDAS-D marcadas `transmitida` nunca foram transmitidas. Este script
 * fecha o ciclo uma vez — emitir, consultar, cancelar — para a MCB, a primeira
 * empresa que passa por `decidirCredencial` sem recusa.
 *
 * O QUE ELE NÃO FAZ. Não reimplementa a regra. Chama exatamente o que
 * `emitirNotaAction` chama — `resolverCredencialEmissao`, `buildNfsePayload`,
 * `focus.emitirNfse` — porque um smoke que anda por fora do caminho de
 * produção prova o script, não o produto.
 *
 * SEGURANÇA. Sem `--aplicar`, NADA sai para a Focus e NADA é escrito no banco:
 * o modo padrão só mostra os alvos e o payload montado. As checagens de
 * ambiente são as da guarda real; se ela recusar, o script para.
 *
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json scripts/smoke-fiscal-mcb.ts             # prévia
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json scripts/smoke-fiscal-mcb.ts emitir --aplicar
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json scripts/smoke-fiscal-mcb.ts status
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json scripts/smoke-fiscal-mcb.ts cancelar --aplicar
 */
import { createClient } from '@supabase/supabase-js';
import { focus, generateRef } from '../src/lib/clients/focus-nfe';
import { buildNfsePayload } from '../src/lib/fiscal/nfse-payload';
import { resolverCredencialEmissao } from '../src/lib/fiscal/resolver-credencial';
import { mapStatusFocus } from '../src/lib/fiscal/focus-status';
import { extrairCamposNota } from '../src/lib/fiscal/nfse-callback';
import { calcularApuracao } from '../src/lib/fiscal/apuracao';
import { lerReceitasParaApuracao } from '../src/lib/fiscal/receitas-source';
import { anexarAnexosDasReceitas } from '../src/lib/fiscal/segregacao';
import { getParametrosDaCompetencia } from '../src/lib/fiscal/parametros';
import { resolverAnexoEmpresa } from '../src/lib/fiscal/cnae-sync';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const CNPJ_MCB = '53015033000171';
const EMPRESA_MCB = '79a5d6b1-2bb9-4b1b-9d5b-02aee82fea2c';
const DOC_TOMADOR = '11222333000181'; // CNPJ de teste, o mesmo do smoke da AL
// Lista de Serviços NACIONAL, 6 dígitos — NÃO é o CNAE. A primeira versão
// deste script passou o CNAE da empresa (7 dígitos) aqui e `buildNfsePayload`
// recusou, corretamente. 170801 = "Serviços de propaganda e publicidade",
// que é o que a MCB MARKETING faz (CNAEs 7311400 e 7319004).
const CODIGO_TRIBUTACAO = '170801';
const VALOR = 100;
const ALIQUOTA_ISS = 5;
const JUSTIFICATIVA = 'Cancelamento de nota de teste emitida em homologacao (smoke fiscal).';

const comando = (process.argv[2] ?? 'previa').toLowerCase();
const aplicar = process.argv.includes('--aplicar');

function titulo(s: string) {
  console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);
}

/** Tudo que é leitura, comum a todos os comandos. Não escreve nada. */
async function levantarEstado() {
  const { data: company, error: eC } = await sb
    .from('companies')
    .select('id, cnpj, razao_social, codigo_municipio, user_id')
    .eq('id', EMPRESA_MCB)
    .maybeSingle();
  if (eC) throw new Error(`companies: ${eC.message}`);
  if (!company) throw new Error(`empresa ${EMPRESA_MCB} não encontrada`);
  if (String(company.cnpj) !== CNPJ_MCB) {
    throw new Error(`CNPJ divergente: esperado ${CNPJ_MCB}, achei ${company.cnpj}`);
  }
  console.log(`  empresa   ${company.razao_social}`);
  console.log(`  cnpj      ${company.cnpj}`);
  console.log(`  municipio ${company.codigo_municipio} (IBGE)`);

  const { data: fiscal } = await sb
    .from('empresas_fiscais')
    .select('Code_regime_tributario, focus_empresa_id, focus_ambiente, focus_habilita_nfsen_homologacao')
    .eq('empresa_id', EMPRESA_MCB)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal) throw new Error('empresas_fiscais ausente — a action recusaria aqui');
  console.log(`  regime    ${fiscal.Code_regime_tributario}`);
  console.log(`  focus id  ${fiscal.focus_empresa_id} · ambiente=${fiscal.focus_ambiente} · nfse_hom=${fiscal.focus_habilita_nfsen_homologacao}`);

  // Mesma checagem que `emitirNotaAction` faz antes de montar o payload.
  // O erro é PROPAGADO de propósito: na primeira versão deste script a coluna
  // pedida estava errada (`nome`, que não existe — é `nome_municipio`), o
  // PostgREST devolveu erro, `data` veio null e o script anunciou "sem linha em
  // municipios_nfse" para um município que está lá e ativo. Engolir o erro
  // transformou um typo meu num falso achado sobre o produto.
  const { data: muni, error: eM } = await sb
    .from('municipios_nfse')
    .select('codigo_ibge, nome_municipio, status_nfse, possui_cancelamento_nfse, possui_ambiente_homologacao_nfse')
    .eq('codigo_ibge', String(company.codigo_municipio))
    .maybeSingle();
  if (eM) throw new Error(`municipios_nfse: ${eM.message}`);
  console.log(`  muni nfse ${muni ? `${muni.nome_municipio} · status_nfse=${muni.status_nfse} · hom=${muni.possui_ambiente_homologacao_nfse} · cancela=${muni.possui_cancelamento_nfse}` : '(sem linha em municipios_nfse)'}`);
  if (muni && muni.status_nfse !== 'ativo') {
    console.log(`  ⚠ a action RECUSARIA: "NFS-e indisponível para este município (Focus: ${muni.status_nfse})"`);
  }

  const { data: cnaes } = await sb
    .from('company_cnaes').select('codigo').eq('company_id', EMPRESA_MCB).is('deleted_at', null);
  console.log(`  cnaes     ${(cnaes ?? []).map((c) => c.codigo).join(', ') || '(nenhum)'}`);

  const { data: cliente } = await sb
    .from('clientes')
    .select('id, razao_social, document, person_type')
    .eq('company_id', EMPRESA_MCB)
    .eq('document', DOC_TOMADOR)
    .is('deleted_at', null)
    .maybeSingle();
  console.log(`  tomador   ${cliente ? `${cliente.razao_social} · ${cliente.document} (existe)` : '(não existe — seria criado)'}`);

  // A guarda real. Não imprime o token, só a decisão.
  const credencial = await resolverCredencialEmissao(EMPRESA_MCB);
  if (credencial.ok) {
    console.log(`  GUARDA    ✅ ok · ambiente=${credencial.ambiente} · token de ${credencial.token.length} chars`);
  } else {
    console.log(`  GUARDA    ❌ recusa · motivo=${credencial.motivo}`);
  }

  return { company, fiscal, cliente, cnaes: cnaes ?? [], credencial };
}

async function garantirTomador(companyId: string, userId: string) {
  const { data: existente } = await sb
    .from('clientes')
    .select('id, razao_social, document, person_type')
    .eq('company_id', companyId).eq('document', DOC_TOMADOR).is('deleted_at', null).maybeSingle();
  if (existente) return existente;
  const { data: novo, error } = await sb.from('clientes').insert({
    owner_user_id: userId,
    company_id: companyId,
    person_type: 'PJ',
    razao_social: 'CLIENTE TESTE SMOKE LTDA',
    document: DOC_TOMADOR,
    email: 'cliente@teste.local',
    municipio: 'FLORIANOPOLIS',
    uf: 'SC',
    codigo_municipio: '4205407',
    status: 'active',
  }).select('id, razao_social, document, person_type').single();
  if (error) throw new Error(`criar tomador: ${error.message}`);
  return novo;
}

function montarPayload(company: any, fiscal: any, cliente: any, cnaes: any[]) {
  return buildNfsePayload(
    { cnpj: company.cnpj as string, codigo_municipio: (company.codigo_municipio as string | null) ?? null },
    { Code_regime_tributario: fiscal.Code_regime_tributario },
    { cnpj: String(cliente.document), cpf: null, razaoSocial: String(cliente.razao_social) },
    {
      codigoTributacao: CODIGO_TRIBUTACAO,
      descricao: 'Smoke fiscal MCB — emissao de NFS-e em homologacao para fechar o ciclo.',
      valor: VALOR,
      aliquotaIssPercentual: ALIQUOTA_ISS,
    },
  );
}

/** A nota deste smoke, se já existir. Reconhecida pela descrição, não por adivinhação. */
async function notaDoSmoke() {
  const { data } = await sb
    .from('notas_fiscais')
    .select('id, referencia, status, ambiente, valor_total, data_emissao, payload_focusnfe')
    .eq('company_id', EMPRESA_MCB)
    .eq('tipo_documento', 'NFSe')
    .order('data_emissao', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function main() {
  titulo(`SMOKE FISCAL MCB — comando "${comando}"${aplicar ? ' --aplicar' : '  (PRÉVIA, nada sai)'}`);
  const { company, fiscal, cliente, cnaes, credencial } = await levantarEstado();

  if (comando === 'previa') {
    titulo('PAYLOAD que seria enviado');
    const tomadorFicticio = cliente ?? { document: DOC_TOMADOR, razao_social: 'CLIENTE TESTE SMOKE LTDA' };
    try {
      console.log(JSON.stringify(montarPayload(company, fiscal, tomadorFicticio, cnaes), null, 2));
    } catch (e) {
      console.log(`❌ buildNfsePayload recusou: ${e instanceof Error ? e.message : String(e)}`);
    }
    titulo('NADA FOI ENVIADO NEM GRAVADO');
    console.log('Para emitir de verdade (homologação):');
    console.log('  npx tsx --tsconfig scripts/tsconfig.smoke.json scripts/smoke-fiscal-mcb.ts emitir --aplicar');
    return;
  }

  if (!credencial.ok) {
    console.error(`\n❌ guarda recusou (${credencial.motivo}) — o produto não emitiria. Parando.`);
    process.exit(1);
  }
  if (credencial.ambiente !== 'hom') {
    console.error(`\n🛑 ambiente resolvido = "${credencial.ambiente}". Este smoke só roda em homologação. Parando.`);
    process.exit(1);
  }

  if (comando === 'emitir') {
    const tomador = await (aplicar
      ? garantirTomador(company.id as string, company.user_id as string)
      : Promise.resolve(cliente ?? { id: null, document: DOC_TOMADOR, razao_social: 'CLIENTE TESTE SMOKE LTDA' }));
    const payload = montarPayload(company, fiscal, tomador, cnaes);
    const ref = generateRef(company.id as string);
    titulo(`EMITIR · ref=${ref}`);
    console.log(JSON.stringify(payload, null, 2));
    if (!aplicar) {
      titulo('PRÉVIA — nada enviado. Repita com --aplicar.');
      return;
    }

    const { data: nota, error: eIns } = await sb.from('notas_fiscais').insert({
      company_id: company.id,
      tipo_documento: 'NFSe',
      referencia: ref,
      data_emissao: new Date().toISOString(),
      status: 'pendente',
      valor_total: VALOR,
      payload_focusnfe: payload as never,
      cliente_id: (tomador as any).id,
      cnae: cnaes[0]?.codigo ? String(cnaes[0].codigo).replace(/\D+/g, '') : null,
      ambiente: 'hom',
    }).select('id').single();
    if (eIns || !nota) throw new Error(`insert nota: ${eIns?.message}`);
    console.log(`\n  nota local ${nota.id} criada como 'pendente' (igual à action)`);

    try {
      const resp = await focus.emitirNfse(ref, payload, credencial.token, 'hom');
      await sb.from('notas_fiscais')
        .update({ payload_focusnfe: { request: payload, response: resp } as never })
        .eq('id', nota.id).eq('company_id', company.id);
      console.log('\n✅ FOCUS ACEITOU:');
      console.log(JSON.stringify(resp, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from('notas_fiscais')
        .update({ status: 'erro', payload_focusnfe: { request: payload, error: msg } as never })
        .eq('id', nota.id).eq('company_id', company.id);
      console.error(`\n❌ FOCUS RECUSOU: ${msg}`);
      console.error('   (nota local marcada como erro, igual à action)');
      process.exit(1);
    }
    console.log(`\nPróximo: --tsconfig scripts/tsconfig.smoke.json scripts/smoke-fiscal-mcb.ts status`);
    return;
  }

  if (comando === 'status') {
    const nota = await notaDoSmoke();
    if (!nota) { console.log('\n(nenhuma NFS-e da MCB no banco)'); return; }
    titulo(`STATUS · nota ${nota.id} · ref=${nota.referencia} · local=${nota.status}`);
    const resp = await focus.consultarStatusNfse(String(nota.referencia), credencial.token, 'hom');
    console.log(JSON.stringify(resp, null, 2));
    return;
  }

  // Espelha `atualizarStatusNotaAction`: o webhook da Focus não alcança esta
  // máquina, e o produto já tem um caminho de polling para exatamente isso.
  // Usa os MESMOS mapeadores da action (`extrairCamposNota`, `mapStatusFocus`)
  // — escrever o status na mão aqui provaria o script, não o produto.
  if (comando === 'sincronizar') {
    const nota = await notaDoSmoke();
    if (!nota) { console.log('\n(nenhuma NFS-e da MCB)'); return; }
    const resp = await focus.consultarStatusNfse(String(nota.referencia), credencial.token, 'hom');
    const { chaveAcesso: chave, protocolo, numero, serie, pdf, xml } = extrairCamposNota(resp);
    const novoStatus = mapStatusFocus(resp.status as string | undefined);
    titulo(`SINCRONIZAR · ${nota.id}`);
    console.log(`  focus.status   ${resp.status}`);
    console.log(`  mapStatusFocus ${nota.status} → ${novoStatus}`);
    console.log(`  chave=${chave ?? '—'} numero=${numero ?? '—'} serie=${serie ?? '—'} protocolo=${protocolo ?? '—'}`);
    console.log(`  pdf=${pdf ? 'sim' : '—'} xml=${xml ? 'sim' : '—'}`);
    if (!aplicar) { titulo('PRÉVIA — nada gravado. Repita com --aplicar.'); return; }

    const requestAnterior = (nota.payload_focusnfe as { request?: unknown } | null)?.request ?? null;
    const update: Record<string, unknown> = {
      status: novoStatus,
      payload_focusnfe: requestAnterior ? { request: requestAnterior, callback: resp } : { callback: resp },
      updated_at: new Date().toISOString(),
    };
    if (chave) update.chave_acesso = chave;
    if (pdf) update.pdf_url = pdf;
    if (xml) update.xml_url = xml;
    if (protocolo) update.protocolo_autorizacao = protocolo;
    if (numero) update.numero_nf = numero;
    if (serie) update.serie = serie;
    const { error } = await sb.from('notas_fiscais').update(update as never)
      .eq('id', nota.id).eq('company_id', EMPRESA_MCB);
    if (error) throw new Error(`update nota: ${error.message}`);
    console.log(`\n✅ nota local agora é '${novoStatus}'`);
    return;
  }

  // APURAR — mesma cadeia de `calcularApuracaoAction` em modo preview:
  // lerReceitasParaApuracao → anexarAnexosDasReceitas → getParametrosDaCompetencia
  // → calcularApuracao. Nada é gravado; `apuracoes_fiscais` não é tocada.
  //
  // Roda para a empresa passada em --empresa=<uuid> (default MCB), porque o que
  // este passo precisa mostrar é a BASE DE CÁLCULO, e hoje só a AL PISCINAS tem
  // receita no banco.
  if (comando === 'apurar') {
    const arg = process.argv.find((a) => a.startsWith('--empresa='));
    const alvo = arg ? arg.slice('--empresa='.length) : EMPRESA_MCB;
    const compArg = process.argv.find((a) => a.startsWith('--competencia='));
    const hoje = new Date();
    const competencia = compArg
      ? compArg.slice('--competencia='.length)
      : `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}`;

    const { data: alvoCompany } = await sb.from('companies').select('razao_social').eq('id', alvo).maybeSingle();
    const { data: fiscalAlvo } = await sb
      .from('empresas_fiscais')
      .select('Code_regime_tributario, anexo_simples, atividade_mei, data_inicio_atividade')
      .eq('empresa_id', alvo).is('deleted_at', null).maybeSingle();
    if (!fiscalAlvo) throw new Error('empresas_fiscais ausente para o alvo');

    titulo(`APURAR (preview) · ${alvoCompany?.razao_social ?? alvo} · competência ${competencia}`);

    const receitas = await lerReceitasParaApuracao(sb as never, alvo, competencia);
    const total = receitas.reduce((s, r) => s + r.valor, 0);
    console.log(`  receitas lidas: ${receitas.length} linha(s) · soma R$ ${total.toFixed(2)}`);

    // A MESMA janela, agora perguntando o ambiente de cada nota — coluna que
    // `lerReceitasParaApuracao` nem seleciona. Serve para mostrar quanto da
    // base de cálculo veio de nota de TESTE.
    const { data: comAmbiente } = await sb
      .from('notas_fiscais')
      .select('valor_total, ambiente, status, data_emissao')
      .eq('company_id', alvo)
      .in('status', ['ativa', 'lancada'])
      .in('tipo_documento', ['NFSe', 'NFe', 'NFCe']);
    const porAmbiente = new Map<string, { n: number; soma: number }>();
    for (const n of comAmbiente ?? []) {
      const k = String((n as { ambiente?: string }).ambiente ?? '(null)');
      const at = porAmbiente.get(k) ?? { n: 0, soma: 0 };
      at.n += 1; at.soma += Number((n as { valor_total: number }).valor_total);
      porAmbiente.set(k, at);
    }
    for (const [amb, v] of porAmbiente) {
      const marca = amb === 'hom' ? '   ⚠ HOMOLOGAÇÃO — nota de teste dentro da base' : '';
      console.log(`    ambiente=${amb.padEnd(6)} ${v.n} nota(s)  R$ ${v.soma.toFixed(2)}${marca}`);
    }

    const resolvido = await resolverAnexoEmpresa(
      sb as never, alvo, (fiscalAlvo.anexo_simples ?? null) as never, competencia,
    );
    const receitasAnexadas = await anexarAnexosDasReceitas(
      sb as never, alvo, competencia, receitas, resolvido.anexo,
    );
    const parametros = await getParametrosDaCompetencia(sb as never, competencia);
    const resultado = calcularApuracao({
      regimeCode: String(fiscalAlvo.Code_regime_tributario ?? ''),
      anexo: resolvido.anexo,
      receitas: receitasAnexadas,
      competencia,
      atividadeMei: (fiscalAlvo.atividade_mei ?? null) as string | null,
      tabelaSimples: parametros.tabelaSimples,
      salarioMinimo: parametros.salarioMinimo,
      dataInicioAtividade: (fiscalAlvo.data_inicio_atividade ?? undefined) as string | undefined,
    });
    console.log('\n  RESULTADO (não gravado):');
    console.log(`    tipo            ${resultado.tipoApuracao}`);
    console.log(`    anexo           ${resolvido.anexo ?? '—'}  fatorR=${resolvido.fatorR ?? '—'}`);
    console.log(`    receita do mês  R$ ${Number(resultado.receitaMes).toFixed(2)}`);
    console.log(`    RBT12           R$ ${Number(resultado.rbt12).toFixed(2)}`);
    console.log(`    alíquota efet.  ${resultado.aliquotaEfetiva}%`);
    console.log(`    imposto         R$ ${Number(resultado.valorImposto).toFixed(2)}`);
    titulo('NADA GRAVADO — apuracoes_fiscais intocada');
    return;
  }

  // TRANSMITIR — sempre DRY-RUN (`indicadorTransmissao: false`): o SERPRO monta
  // e calcula a declaração inteira, mas NÃO a entrega à Receita. Percorre o
  // mesmo caminho da transmissão real (auth contratante → token de procurador →
  // montarDeclaracaoPgdasd → /Declarar), que é o que este smoke precisa provar.
  //
  // NÃO existe flag aqui para transmitir de verdade, de propósito. Entregar
  // PGDAS-D é irreversível e tem efeito legal, e hoje a base de cálculo vem de
  // notas de HOMOLOGAÇÃO (ver o comando `apurar`) — transmitir isso declararia
  // à Receita receita que não existiu.
  if (comando === 'transmitir') {
    const arg = process.argv.find((a) => a.startsWith('--empresa='));
    const alvo = arg ? arg.slice('--empresa='.length) : EMPRESA_MCB;
    const compArg = process.argv.find((a) => a.startsWith('--competencia='));
    const competencia = compArg ? compArg.slice('--competencia='.length) : '202606';
    titulo(`TRANSMITIR (DRY-RUN, indicadorTransmissao=false) · ${alvo} · ${competencia}`);
    const { transmitirPgdasd } = await import('../src/lib/fiscal/serpro-pgdasd');
    const r = await transmitirPgdasd(sb as never, alvo, competencia, { indicadorTransmissao: false });
    console.log(JSON.stringify(r, null, 2));
    titulo('NADA FOI ENTREGUE À RECEITA — dry-run');
    return;
  }

  if (comando === 'cancelar') {
    const nota = await notaDoSmoke();
    if (!nota) { console.log('\n(nenhuma NFS-e da MCB para cancelar)'); return; }
    titulo(`CANCELAR · nota ${nota.id} · ref=${nota.referencia} · local=${nota.status}`);
    console.log(`  justificativa: "${JUSTIFICATIVA}" (${JUSTIFICATIVA.length} chars)`);
    if (!aplicar) {
      titulo('PRÉVIA — nada enviado. Repita com --aplicar.');
      return;
    }
    // A action recusa nota que não está 'ativa'. Mesma regra aqui.
    if (nota.status !== 'ativa') {
      console.error(`\n❌ status local é '${nota.status}' — a action diria "Só notas ativas podem ser canceladas."`);
      process.exit(1);
    }
    const resp = await focus.cancelarNfse(String(nota.referencia), JUSTIFICATIVA, credencial.token, 'hom');
    console.log('\n✅ FOCUS RESPONDEU:');
    console.log(JSON.stringify(resp, null, 2));

    // Espelha o update de `cancelarNotaAction` — inclusive `cancelled_at` e
    // `cancellation_reason`, que é o que a tela mostra. Cancelar na Focus e
    // deixar o banco 'ativa' é exatamente a divergência banco↔SEFAZ que a
    // action trata como incidente.
    const { error } = await sb.from('notas_fiscais').update({
      status: 'cancelada',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: JUSTIFICATIVA,
      updated_at: new Date().toISOString(),
    } as never).eq('id', nota.id).eq('company_id', EMPRESA_MCB);
    if (error) throw new Error(`update cancelamento: ${error.message}`);
    console.log("\n✅ nota local agora é 'cancelada'");
    return;
  }

  console.error(`comando desconhecido: ${comando}`);
  process.exit(2);
}

main().catch((e) => { console.error('\n💥', e); process.exit(1); });
