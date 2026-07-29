// Bloco 6A — a lista de provedores e o que cada um precisa.
//
// Puro (sem `server-only`): a TELA do admin também consome esta lista para
// montar o dropdown, e duplicá-la faria a tela oferecer provedor que o cliente
// não sabe chamar.

export const PROVEDORES = [
  'anthropic', 'gemini', 'openai', 'openrouter', 'groq',
  'deepseek', 'mistral', 'personalizado',
] as const;

export type Provedor = (typeof PROVEDORES)[number];

/** Rótulo para a tela. */
export const PROVEDOR_LABEL: Record<Provedor, string> = {
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  personalizado: 'Personalizado…',
};

/**
 * URL base de cada provedor. Quase todos falam o dialeto OpenAI — inclusive o
 * Gemini, pelo endpoint de compatibilidade. É por isso que dois adaptadores
 * cobrem a lista inteira em vez de oito.
 *
 * `personalizado` não tem padrão de propósito: quem escolhe informa a URL, e é
 * essa saída que permite um provedor novo sem deploy.
 */
export const URL_PADRAO: Record<Provedor, string | null> = {
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  personalizado: null,
};

/** Só o Anthropic fala outro dialeto. */
export function ehAnthropic(p: Provedor): boolean {
  return p === 'anthropic';
}
