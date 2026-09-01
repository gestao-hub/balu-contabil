/**
 * O TENANT SINTÉTICO: atacante e VÍTIMA, os dois criados pelo teste.
 *
 * ─── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────
 * As specs de IDOR precisam de duas partes. O atacante sempre foi uma conta de
 * teste; a vítima, não — ela era descoberta como "a primeira linha de OUTRO
 * dono":
 *
 *   .neq('owner_user_id', meuId).limit(1)                    // empresário
 *   .from('contabilidades').eq('status','aprovada').neq(...)  // contador
 *
 * Num banco de desenvolvimento isso é inofensivo. Com o Supabase da aplicação
 * sendo produção (14/08/2026) e a suíte voltando a rodar nele (01/09/2026), a
 * vítima passaria a ser o primeiro cliente REAL que aparecesse na consulta.
 *
 * E o detalhe que torna isso grave é o propósito do teste: ele existe para
 * ENCONTRAR defesa quebrada. Enquanto tudo funciona, a action recusa e nada
 * acontece. No dia em que uma defesa cair — o dia em que o teste finalmente
 * serve para alguma coisa — o efeito é real e é no alvo: `cancelarNotaAction`
 * cancela uma NFS-e que existe na prefeitura, `deleteHonorarioV2Action` apaga o
 * honorário de um escritório de verdade, `cobrarClienteAction` emite cobrança
 * contra um cliente de verdade.
 *
 * Aqui a vítima nasce com o teste e morre com ele. O teste não perde nada:
 * atacante e vítima continuam sendo donos diferentes, que é a única coisa que
 * o IDOR precisa provar. E ganha duas: some o `test.skip('não há um segundo
 * escritório para atacar')`, e o alvo passa a ter exatamente as linhas que o
 * caso precisa, em vez do que por acaso existir no banco.
 *
 * Tudo que nasce aqui carrega `MARCA_SINTETICA` no e-mail e no nome — é o que
 * `exigirVitimaSintetica` confere na hora do ataque, e o que permite achar
 * lixo de uma execução interrompida.
 */
import { expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MARCA_SINTETICA } from './guarda-ambiente';
import { aceitarLgpd } from './aceite-lgpd';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** Senha única dos atores sintéticos. Eles vivem alguns segundos. */
export const SENHA_SINTETICA = 'senha-sintetica-e2e-123';

/**
 * O caderno do que foi criado, para a faxina.
 *
 * ⚠️ CADA CRIADOR REGISTRA O QUE CRIA, NA HORA. Não é estilo: a primeira versão
 * deste módulo montava o caderno DEPOIS de semear tudo, e em 01/09/2026 um
 * insert falhou no meio (CHECK de `notifications.tipo`) — o `afterAll` rodou
 * com o caderno vazio e dois usuários, duas empresas, um cliente, uma nota e
 * uma guia ficaram morando em produção. Registrar no fim só funciona quando
 * nada dá errado, que é exatamente quando a faxina não faz falta.
 */
export type Semeado = {
  honorarios?: string[];
  clientes?: string[];
  notas?: string[];
  guias?: string[];
  notificacoes?: string[];
  companies?: string[];
  contabilidades?: string[];
  usuarios?: string[];
};

function anotar(reg: Semeado, chave: keyof Semeado, id: string) {
  (reg[chave] ??= []).push(id);
}

/** Sufixo que torna e-mail e nome únicos por execução E reconhecíveis. */
function sufixo(rotulo: string): string {
  return `${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${MARCA_SINTETICA}`;
}

export type Empresario = {
  email: string;
  userId: string;
  companyId: string;
  nomeEmpresa: string;
};

/**
 * Empresário pronto para USAR o app: papel Empresa, empresa própria,
 * `current_company` no profile e os documentos LGPD aceitos.
 *
 * Os quatro são necessários juntos. Faltando `current_company`, o gated manda
 * para /onboarding; faltando o aceite, manda para /aceite — e nos dois casos o
 * teste que se apoia na sessão mede a tela do gate achando que mediu a ação.
 */
export async function criarEmpresario(admin: Admin, rotulo: string, reg: Semeado): Promise<Empresario> {
  const email = `${sufixo(rotulo)}@balu-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: SENHA_SINTETICA, email_confirm: true,
    user_metadata: { type: 'Empresa', full_name: `Empresário ${rotulo}` },
  });
  expect(error, `createUser ${email} falhou: ${error?.message}`).toBeNull();
  const userId = data.user!.id;
  anotar(reg, 'usuarios', userId);

  const nomeEmpresa = `Empresa ${sufixo(rotulo)}`;
  const { data: emp, error: eErr } = await admin.from('companies')
    .insert({ user_id: userId, nome: nomeEmpresa })
    .select('id').single();
  expect(eErr, `insert company de ${email} falhou: ${eErr?.message}`).toBeNull();
  const companyId = emp!.id as string;
  anotar(reg, 'companies', companyId);

  const { error: pErr } = await admin.from('profiles')
    .upsert({ user_id: userId, company_id: companyId, current_company: companyId },
            { onConflict: 'user_id' });
  expect(pErr, `upsert profile de ${email} falhou: ${pErr?.message}`).toBeNull();

  await aceitarLgpd(admin, userId);
  return { email, userId, companyId, nomeEmpresa };
}

export type Escritorio = {
  contabilidadeId: string;
  nome: string;
  contadorEmail: string;
  contadorId: string;
};

/**
 * Escritório APROVADO com um contador membro.
 *
 * Aprovado por padrão porque é o único estado que o produto deixa operar: o
 * pendente para em /contador/aguardando, e um alvo que não opera não prova
 * fronteira nenhuma.
 */
export async function criarEscritorio(admin: Admin, rotulo: string, reg: Semeado): Promise<Escritorio> {
  const nome = `Escritório ${sufixo(rotulo)}`;
  const marca = Date.now().toString().slice(-8);
  const { data: ct, error: ctErr } = await admin.from('contabilidades')
    .insert({ nome, crc: `CRC${marca}`, crc_uf: 'SP', status: 'aprovada' })
    .select('id').single();
  expect(ctErr, `insert contabilidade ${nome} falhou: ${ctErr?.message}`).toBeNull();
  const contabilidadeId = ct!.id as string;
  anotar(reg, 'contabilidades', contabilidadeId);

  const contadorEmail = `${sufixo(`${rotulo}-contador`)}@balu-test.local`;
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email: contadorEmail, password: SENHA_SINTETICA, email_confirm: true,
    user_metadata: { type: 'Contador', full_name: `Contador ${rotulo}` },
  });
  expect(uErr, `createUser ${contadorEmail} falhou: ${uErr?.message}`).toBeNull();
  const contadorId = u.user!.id;
  anotar(reg, 'usuarios', contadorId);

  const { error: mErr } = await admin.from('contabilidade_membros')
    .insert({ contabilidade_id: contabilidadeId, user_id: contadorId });
  expect(mErr, `insert membro de ${nome} falhou: ${mErr?.message}`).toBeNull();

  await aceitarLgpd(admin, contadorId);
  return { contabilidadeId, nome, contadorEmail, contadorId };
}

/** Vincula uma empresa já existente à carteira de um escritório. */
export async function vincularNaCarteira(admin: Admin, companyId: string, contabilidadeId: string) {
  const { error } = await admin.from('companies')
    .update({ contabilidade_id: contabilidadeId }).eq('id', companyId);
  expect(error, `vincular ${companyId} à carteira falhou: ${error?.message}`).toBeNull();
}

// ─── LINHAS FILHAS (os alvos concretos de cada caso de IDOR) ────────────────

export async function criarCliente(admin: Admin, dono: { userId: string; companyId: string }, reg: Semeado) {
  const { data, error } = await admin.from('clientes').insert({
    owner_user_id: dono.userId, company_id: dono.companyId, person_type: 'PJ',
    razao_social: `Cliente ${MARCA_SINTETICA}`, document: `${Date.now()}`.slice(0, 14),
    status: 'active',
  }).select('id').single();
  expect(error, `insert cliente falhou: ${error?.message}`).toBeNull();
  anotar(reg, 'clientes', data!.id as string);
  return data!.id as string;
}

/** Guia EM ABERTO (`data_pagamento` nulo) — é o que `marcarGuiaPagaAction` ataca. */
export async function criarGuiaEmAberto(admin: Admin, companyId: string, reg: Semeado) {
  const { data, error } = await admin.from('guias_fiscais')
    .insert({ company_id: companyId, competencia_mes: 1, competencia_ano: 2026 })
    .select('id').single();
  expect(error, `insert guia falhou: ${error?.message}`).toBeNull();
  anotar(reg, 'guias', data!.id as string);
  return data!.id as string;
}

/** Nota NÃO cancelada — é o que `cancelarNotaAction` ataca. */
export async function criarNotaAtiva(admin: Admin, companyId: string, reg: Semeado) {
  const { data, error } = await admin.from('notas_fiscais').insert({
    company_id: companyId, tipo_documento: 'NFe',
    referencia: `ref-${MARCA_SINTETICA}-${Date.now()}`,
    data_emissao: new Date().toISOString(), status: 'ativa',
    valor_total: 100, payload_focusnfe: {},
  }).select('id').single();
  expect(error, `insert nota falhou: ${error?.message}`).toBeNull();
  anotar(reg, 'notas', data!.id as string);
  return data!.id as string;
}

export async function criarNotificacao(admin: Admin, ownerUserId: string, reg: Semeado) {
  const { data, error } = await admin.from('notifications').insert({
    // `tipo` e `severidade` têm CHECK no banco: não vale inventar valor.
    // 'das_a_vencer' e 'info' são dois dos permitidos — o caso de IDOR não se
    // importa com qual, só precisa de uma notificação que exista e tenha dono.
    owner_user_id: ownerUserId, tipo: 'das_a_vencer', severidade: 'info',
    titulo: `Notificação ${MARCA_SINTETICA}`, corpo: 'alvo de teste de IDOR',
    chave: `${MARCA_SINTETICA}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }).select('id').single();
  expect(error, `insert notificação falhou: ${error?.message}`).toBeNull();
  anotar(reg, 'notificacoes', data!.id as string);
  return data!.id as string;
}

export async function criarHonorario(
  admin: Admin,
  alvo: { contabilidadeId: string; companyId: string; empresaClienteId: string },
  reg: Semeado,
) {
  const { data, error } = await admin.from('honorarios').insert({
    company_id: alvo.companyId, contabilidade_id: alvo.contabilidadeId,
    empresa_cliente_id: alvo.empresaClienteId,
    mes_referencia: '2026-01-01', valor: 199.9, data_vencimento: '2026-01-10',
  }).select('id').single();
  expect(error, `insert honorário falhou: ${error?.message}`).toBeNull();
  anotar(reg, 'honorarios', data!.id as string);
  return data!.id as string;
}

// ─── FAXINA ─────────────────────────────────────────────────────────────────

/**
 * Apaga o que foi semeado, das filhas para as mães.
 *
 * Cada passo RECLAMA quando falha, em vez de engolir: esta suíte roda contra
 * produção, e uma FK barrando o delete deixaria ator sintético morando lá para
 * sempre — em silêncio, porque o teste já teria passado.
 */
export async function limparSemeado(admin: Admin, s: Semeado, rotulo = 'tenant-sintetico') {
  const restos: string[] = [];
  const apagar = async (tabela: string, ids?: string[]) => {
    for (const id of ids ?? []) {
      const { error } = await admin.from(tabela).delete().eq('id', id);
      if (error) restos.push(`${tabela} ${id}: ${error.message}`);
    }
  };

  await apagar('honorarios', s.honorarios);
  await apagar('clientes', s.clientes);
  await apagar('notas_fiscais', s.notas);
  await apagar('guias_fiscais', s.guias);
  await apagar('notifications', s.notificacoes);

  for (const uid of s.usuarios ?? []) {
    for (const t of ['aceites', 'profiles', 'contabilidade_membros']) {
      const { error } = await admin.from(t).delete().eq('user_id', uid);
      if (error) restos.push(`${t} de ${uid}: ${error.message}`);
    }
  }

  await apagar('companies', s.companies);
  await apagar('contabilidades', s.contabilidades);

  for (const uid of s.usuarios ?? []) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) restos.push(`deleteUser ${uid}: ${error.message}`);
  }

  if (restos.length) console.warn(`[${rotulo}] limpeza incompleta:\n  ${restos.join('\n  ')}`);
}
