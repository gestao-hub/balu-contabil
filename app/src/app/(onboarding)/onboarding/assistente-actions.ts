// Onboarding conversacional — a orquestração (Bloco: onboarding com IA).
//
// Ordem de responsabilidade, e ela importa:
//   1. `redigir()` tira o dado pessoal do texto ANTES de qualquer coisa;
//   2. a extração determinística preenche os campos (o modelo não toca neles);
//   3. a `maquina` decide o que falta e quando concluir;
//   4. a IA — se houver — só reescreve a próxima pergunta com jeito de gente.
//
// Se o passo 4 falhar (sem chave, provedor fora do ar, JSON torto), a conversa
// continua com o texto padrão da máquina. O onboarding é a porta de entrada do
// produto: ele não pode depender de um terceiro estar no ar.
'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { gerarTexto } from '@/lib/ai/cliente';
import { lerChaveIa } from '@/lib/ai/config-ia';
import { redigir, intencaoPorPalavras, type Intencao, type CamposExtraidos } from '@/lib/onboarding/extrair';
import { proximoPasso, acumular, pediuRecomecar, type EstadoOnboarding } from '@/lib/onboarding/maquina';
import { montarPromptOnboarding, lerRespostaModelo, type TurnoRedigido } from '@/lib/onboarding/prompt';

export type RespostaAssistente = {
  mensagem: string;
  estado: EstadoOnboarding;
  /** Preenchido quando a coleta terminou e a tela deve agir. */
  concluir?: 'empresa' | 'escritorio' | 'abertura';
  /** true quando a frase veio do modelo; false quando veio do texto padrão. */
  comIa: boolean;
};

const ESTADO_INICIAL: EstadoOnboarding = { intencao: 'indefinido', campos: {} };

/**
 * Um turno da conversa.
 *
 * `historico` chega REDIGIDO da tela (é o que a tela guarda), então mesmo um
 * bug futuro no cliente não teria como empurrar dado pessoal para o provedor.
 */
export async function conversarOnboardingAction(entrada: {
  mensagem: string;
  estado?: EstadoOnboarding;
  historico?: TurnoRedigido[];
}): Promise<RespostaAssistente> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { mensagem: 'Sua sessão expirou. Entre novamente para continuar.', estado: ESTADO_INICIAL, comIa: false };
  }

  const texto = (entrada.mensagem ?? '').slice(0, 500);
  if (pediuRecomecar(texto)) {
    return {
      mensagem: 'Sem problema, vamos do começo. Você é contador e vai atender clientes por aqui, ou está cadastrando a sua própria empresa?',
      estado: ESTADO_INICIAL,
      comIa: false,
    };
  }

  // 1. Redigir ANTES de tudo.
  const { texto: redigido, campos } = redigir(texto);

  // 2. Estado novo, por código.
  const anterior = entrada.estado ?? ESTADO_INICIAL;
  const estado = acumular(anterior, campos as CamposExtraidos, intencaoPorPalavras(texto));

  // 3. A máquina decide.
  const passo = proximoPasso(estado);
  if (passo.tipo === 'concluir') {
    return { mensagem: '', estado, concluir: passo.destino, comIa: false };
  }

  // 4. A IA só embeleza — e só se estiver configurada.
  const historico: TurnoRedigido[] = [...(entrada.historico ?? []), { de: 'usuario', texto: redigido }];
  const doModelo = await perguntarAoModelo({
    historico, campoPendente: passo.campo, intencaoAtual: estado.intencao,
  });

  if (!doModelo) return { mensagem: passo.sugestao, estado, comIa: false };

  // A intenção do modelo só entra quando a determinística não concluiu nada —
  // palavra-chave explícita ("sou contador") vale mais que leitura de modelo.
  const estadoFinal = estado.intencao === 'indefinido' && doModelo.intencao !== 'indefinido'
    ? { ...estado, intencao: doModelo.intencao as Intencao }
    : estado;

  // Se a leitura do modelo mudou a intenção, o passo muda junto.
  const passoFinal = proximoPasso(estadoFinal);
  if (passoFinal.tipo === 'concluir') {
    return { mensagem: '', estado: estadoFinal, concluir: passoFinal.destino, comIa: true };
  }

  return { mensagem: doModelo.pergunta, estado: estadoFinal, comIa: true };
}

async function perguntarAoModelo(entrada: Parameters<typeof montarPromptOnboarding>[0]) {
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from('config_ia').select('*').eq('id', 1).maybeSingle();
    if (!cfg) return null;

    const chave = lerChaveIa(cfg.chave_cifrada as string | null);
    if (!chave) return null;

    const bruto = await gerarTexto(
      {
        provedor: cfg.provedor as never,
        modelo: cfg.modelo as string,
        base_url: (cfg.base_url as string | null) ?? '',
        chave,
      },
      montarPromptOnboarding(entrada),
    );
    return lerRespostaModelo(bruto);
  } catch (e) {
    // Silencioso para o usuário, visível para nós: a conversa segue com o
    // texto padrão, e o cadastro não trava por causa de um provedor.
    console.error('[onboarding/ia]', e instanceof Error ? e.message : e);
    return null;
  }
}
