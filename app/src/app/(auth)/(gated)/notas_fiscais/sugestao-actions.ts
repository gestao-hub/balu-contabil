'use server';
// P10 — "IA que sugere o código de serviço certo e evita erro ao emitir a nota"
// (item 6.3 da devolutiva, marcado como essencial para lançar).
//
// Ordem de responsabilidade, e ela importa:
//   1. o determinístico monta a lista curta de candidatos (`sugerirCodigosServico`);
//   2. se não houver candidato, acaba aqui — não se chama modelo para chutar;
//   3. a descrição é REDIGIDA antes de sair da máquina;
//   4. a IA, se houver chave, só escolhe um da lista e escreve o porquê.
//
// Nada aqui emite nota nem grava campo. A sugestão volta para a tela e só entra
// no formulário se a pessoa clicar em "Usar este código" — código de tributação
// errado vira retificação no município, então a confirmação é humana por
// desenho, não por esquecimento.
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { gerarTexto } from '@/lib/ai/cliente';
import { lerChaveIa } from '@/lib/ai/config-ia';
// Reaproveita a redação do onboarding em vez de escrever outra: é a mesma
// pergunta ("o que não pode sair daqui") e duas implementações divergiriam.
import { redigir } from '@/lib/onboarding/extrair';
import { sugerirCodigosServico, type SugestaoCodigo } from '@/lib/fiscal/sugerir-codigo';
import { montarPromptSugestao, lerSugestaoModelo } from '@/lib/fiscal/sugestao-prompt';

export type RespostaSugestao =
  | {
      ok: true;
      /** Do mais provável ao menos. O primeiro é o recomendado. */
      sugestoes: SugestaoCodigo[];
      /** Frase do modelo sobre o recomendado; `null` quando a IA não entrou. */
      porqueIa: string | null;
      comIa: boolean;
    }
  | { ok: false; error: string };

const MIN_DESCRICAO = 8;

export async function sugerirCodigoServicoAction(entrada: {
  descricao: string;
  cnae?: string | null;
}): Promise<RespostaSugestao> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  // A chave de IA é da plataforma. Sem sessão, ninguém gasta com ela.
  if (!user) return { ok: false, error: 'Sua sessão expirou. Entre novamente.' };

  const descricao = String(entrada.descricao ?? '').slice(0, 1000).trim();
  if (descricao.length < MIN_DESCRICAO) {
    return { ok: false, error: 'Escreva um pouco mais da descrição do serviço para eu sugerir o código.' };
  }

  const sugestoes = sugerirCodigosServico(descricao, entrada.cnae ?? null);
  if (sugestoes.length === 0) {
    return {
      ok: false,
      error: 'Não reconheci o tipo de serviço nessa descrição. Escolha o código na lista — ou detalhe o serviço e tente de novo.',
    };
  }

  const doModelo = await escolherComIa(descricao, sugestoes);

  // O modelo pode reordenar — mas só dentro da lista, e o motivo determinístico
  // do escolhido continua junto na tela.
  if (doModelo) {
    const i = sugestoes.findIndex((s) => s.codigo === doModelo.codigo);
    if (i > 0) sugestoes.unshift(...sugestoes.splice(i, 1));
    return { ok: true, sugestoes, porqueIa: doModelo.porque, comIa: true };
  }

  return { ok: true, sugestoes, porqueIa: null, comIa: false };
}

async function escolherComIa(descricao: string, candidatos: SugestaoCodigo[]) {
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from('config_ia').select('*').eq('id', 1).maybeSingle();
    if (!cfg) return null;

    const chave = lerChaveIa(cfg.chave_cifrada as string | null);
    if (!chave) return null;

    // Descrição de nota costuma trazer número de contrato, CNPJ do tomador e
    // às vezes telefone. Nada disso ajuda a escolher o código.
    const { texto: descricaoRedigida } = redigir(descricao);

    const bruto = await gerarTexto(
      {
        provedor: cfg.provedor as never,
        modelo: cfg.modelo as string,
        base_url: (cfg.base_url as string | null) ?? '',
        chave,
      },
      montarPromptSugestao({ descricaoRedigida, candidatos }),
    );
    return lerSugestaoModelo(bruto, candidatos.map((c) => c.codigo));
  } catch (e) {
    // Silencioso para quem emite, visível para nós: a sugestão determinística
    // já está pronta e é ela que aparece. A emissão não pode depender de um
    // provedor de IA estar no ar.
    console.error('[nfse/sugestao-codigo]', e instanceof Error ? e.message : e);
    return null;
  }
}
