// Bloco 6B — cliente da uazapi.
//
// ✅ CONTRATO CONFIRMADO contra instância real em 12/08/2026: `POST /send/text`
// com header `token` e corpo `{ number, text }` devolveu 200 e a mensagem
// chegou no WhatsApp de destino. A hipótese que ficou marcada desde o Bloco 6B
// (a documentação pública é um SPA que não expõe conteúdo estático) estava
// correta — o aviso que vivia aqui foi removido porque virou fato.
//
// Tentativa de sondagem em 2026-07-29: docs.uazapi.com é um SPA renderizado em
// JS (gerador de doc OpenAPI) que não expõe conteúdo estático — não deu para
// confirmar path/header por fetch simples. Integrações comunitárias de
// terceiros (uazapi-cli) confirmam o padrão de baseUrl
// (`https://<instancia>.uazapi.com`) e a existência de um "token" de
// instância, mas nenhuma fonte alcançável expôs o nome exato do header HTTP
// nem o path do endpoint de texto com certeza. A hipótese abaixo permanece
// NÃO CONFIRMADA.
//
// Mesma convenção do sendEmail (Bloco 1): sem credencial configurada, no-op
// logado — nunca derruba quem chama.
import 'server-only';
import { soDigitosWhatsapp } from '@/lib/whatsapp/numero';

export type ConfigUazapi = { baseUrl: string; token: string };
export type EnvioResultado = { ok: true } | { ok: false; skipped?: true; erro?: string };

export function configDeEnv(): ConfigUazapi | null {
  const baseUrl = process.env.UAZAPI_BASE_URL;
  const token = process.env.UAZAPI_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export async function enviarMensagem(
  cfg: ConfigUazapi | null, msg: { telefone: string; texto: string },
): Promise<EnvioResultado> {
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: cfg.token },
      // Normaliza no PONTO ÚNICO DE SAÍDA: o número pode vir do cadastro
      // (E.164 com `+`), de um JID (`…@s.whatsapp.net`) ou já em dígitos,
      // dependendo de quem chama. Mandar `+55…` ou um JID para a API é pedir
      // para a mensagem sumir sem erro — e isso valeria para TODO telefone da
      // plataforma, não só para o do teste.
      body: JSON.stringify({ number: soDigitosWhatsapp(msg.telefone), text: msg.texto }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, erro: `uazapi respondeu ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
