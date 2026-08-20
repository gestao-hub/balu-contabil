'use server';
// Parâmetros fiscais versionados (AdminBalu) — hoje, o salário mínimo.
//
// O QUE ESTA TELA DECIDE: o INSS de todo MEI da base, a partir da data de
// vigência. Não é configuração de aparência; é a entrada de um número que vira
// guia. Por isso a validação está num módulo puro e testado
// (`lib/fiscal/salario-minimo-entrada.ts`) e é reaplicada aqui — a tela pode
// avisar antes, mas quem decide gravar é o servidor.
//
// INSERT COM ON CONFLICT NA PK (chave, vigencia_inicio), nunca UPDATE cego:
// cadastrar 2027 não pode encostar em 2026. Corrigir um valor já cadastrado é
// re-enviar a mesma vigência — e aí o UPDATE é explícito e auditado.
//
// NADA É APAGADO POR AQUI. Vigência antiga é o que faz a reapuração de uma
// competência velha continuar certa; um botão de excluir só serviria para
// reescrever o passado.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { validarSalarioMinimo, lerValorBR } from '@/lib/fiscal/salario-minimo-entrada';

type ActionResult = { ok: true; mensagem: string } | { ok: false; error: string };

const ROTA = '/admin/configuracoes/parametros';

export async function salvarSalarioMinimoAction(entrada: {
  valor: string | number;
  vigenciaInicio: string;
  norma?: string | null;
}): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const validado = validarSalarioMinimo({
    valor: lerValorBR(entrada.valor),
    vigenciaInicio: entrada.vigenciaInicio,
    norma: entrada.norma ?? null,
  });
  if (!validado.ok) return { ok: false, error: validado.erro };
  const { valor, vigenciaInicio, norma } = validado.dados;

  const sb = createAdminClient();

  // Saber se JÁ existia muda a mensagem e o registro de auditoria: "cadastrou o
  // de 2027" e "corrigiu o de 2026" são eventos diferentes, e o segundo merece
  // ser encontrável depois.
  const { data: existente } = await sb
    .from('parametros_fiscais')
    .select('valor')
    .eq('chave', 'salario_minimo')
    .eq('vigencia_inicio', vigenciaInicio)
    .maybeSingle();

  const { error } = await sb
    .from('parametros_fiscais')
    .upsert(
      { chave: 'salario_minimo', valor, valor_json: null, vigencia_inicio: vigenciaInicio, norma },
      { onConflict: 'chave,vigencia_inicio' },
    );
  if (error) {
    console.error('[parametros] salvar salario_minimo falhou:', error.message);
    return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
  }

  // CONSERTO 3 (Bloco 5 producao fiscal): `alvo_id` e uuid, e a chave
  // composta `salario_minimo:${vigenciaInicio}` nao e um — o insert falhava
  // com erro de sintaxe, calado ate `registrarAuditoria` passar a conferir o
  // `error` do insert. A chave e a vigencia vao para o `meta`.
  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: existente ? 'parametro_fiscal.corrigir' : 'parametro_fiscal.cadastrar',
    alvoTipo: 'parametros_fiscais',
    alvoId: null,
    meta: {
      chave: 'salario_minimo', vigencia_inicio: vigenciaInicio,
      valor, valor_anterior: existente?.valor ?? null, norma,
    },
  });

  // A tela de impostos lê o parâmetro no render; sem isto o admin salvaria e
  // continuaria vendo o número velho por causa do cache de rota.
  revalidatePath(ROTA);
  revalidatePath('/impostos');

  const inss = (valor * 0.05).toFixed(2).replace('.', ',');
  return {
    ok: true,
    mensagem: existente
      ? `Salário mínimo de ${vigenciaInicio.slice(0, 4)} corrigido. INSS do MEI: R$ ${inss}.`
      : `Salário mínimo de ${vigenciaInicio.slice(0, 4)} cadastrado. INSS do MEI: R$ ${inss}.`,
  };
}
