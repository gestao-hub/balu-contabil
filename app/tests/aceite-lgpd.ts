/**
 * Registra, via service_role, o aceite dos documentos LGPD vigentes para um
 * usuário sintético.
 *
 * ─── POR QUE ISTO É PRÉ-REQUISITO DE QUALQUER TESTE AUTENTICADO ─────────────
 * `(gated)/layout.tsx` manda para `/aceite` quem tem qualquer documento
 * publicado sem aceite na versão vigente. `/aceite` é uma tela curta e simples,
 * que passa em quase toda asserção genérica — então o teste não fica vermelho
 * por causa do gate: ele fica VERDE medindo a tela errada, ou vermelho por um
 * motivo que não tem nada a ver com o que ele foi escrever.
 *
 * Não é hipótese. Em 01/09/2026 o `walkthrough-contador` falhou no passo 1
 * procurando o heading "Cadastro do escritório", e a página era o `/aceite`
 * pedindo consentimento dos Termos 1.1. O ator sintético nascia sem aceite
 * nenhum, e o arquivo não tinha esta função — `responsivo.spec.ts` tinha, o que
 * explica por que só ele passava.
 *
 * A regra de "vigente" é a mesma de `lib/lgpd/pendencia-aceite.ts`: a
 * publicação mais recente de cada tipo.
 */
import { expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export async function aceitarLgpd(admin: Admin, userId: string): Promise<void> {
  const { data: docs, error } = await admin
    .from('documento_versoes')
    .select('tipo, versao, publicado_em')
    .not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });
  expect(error, `leitura de documento_versoes falhou: ${error?.message}`).toBeNull();

  const vigentes = new Map<string, string>();
  for (const d of docs ?? []) if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, d.versao as string);
  // Zero documento publicado é estado legítimo (banco novo), não erro.
  if (vigentes.size === 0) return;

  const linhas = [...vigentes].map(([tipo, versao]) => ({ user_id: userId, tipo, versao, ip: '127.0.0.1' }));
  const { error: insErr } = await admin.from('aceites').insert(linhas);
  expect(insErr, `insert aceites falhou: ${insErr?.message}`).toBeNull();
}
