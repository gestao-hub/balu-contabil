# Templates de e-mail (Supabase Auth)

Templates HTML da marca Balu. Tema claro, header com o símbolo da marca (PNG hospedado em
Storage público — `brand/balu-symbol-white.png`; SVG não renderiza em e-mail), table-based +
CSS inline (Gmail/Outlook/Apple Mail). Cores do manual de marca: Azul Profundo `#0D3558`,
Azul Principal `#1882C8`, acento `#5DC0F0`/`#2ECF8A`, alerta `#E05252`.

## Arquivos × template do Supabase

| Arquivo | Template (Dashboard) | Assunto sugerido | Link usado |
|---|---|---|---|
| `confirm-signup.html` | **Confirm signup** | `Confirme seu e-mail — Balu` | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/` |
| `reset-password.html` | **Reset password** | `Redefina sua senha — Balu` | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset_pw?step=update` |
| `change-email.html` | **Change Email Address** | `Confirme seu novo e-mail — Balu` | `{{ .ConfirmationURL }}` (mostra `{{ .NewEmail }}`) |

## Informativos de segurança (enviados pelo app — NÃO são templates do Supabase Auth)

Avisos pós-mudança, sem link de ação obrigatória, só com o caminho "não foi você?". O Supabase
Auth **não** dispara estes automaticamente — o app os envia (transacional via Resend/SES, ou um
**Send Email Hook**) depois da troca. Os placeholders são ilustrativos (ajuste ao seu sender).

| Arquivo | Quando | Assunto sugerido | Observações |
|---|---|---|---|
| `email-alterado.html` | após trocar o e-mail | `Seu e-mail foi alterado · Balu` | enviar ao e-mail **antigo**; mostra `{{ .Email }}`; botão "Falar com o suporte" (`mailto:` placeholder) |
| `senha-alterada.html` | após trocar a senha | `Sua senha foi alterada · Balu` | botão "Redefinir senha" → `{{ .SiteURL }}/reset_pw` |

## Como instalar

Estes templates **não ficam no Postgres** — são configurados no Supabase Auth (GoTrue).

**Via Dashboard** (projeto `llykzqnugdpojwnlontj`):
1. **Authentication → Email Templates** → escolha o template da tabela acima.
2. Cole o **Assunto** sugerido e o **corpo** (conteúdo do `.html`).
3. **Authentication → URL Configuration → Redirect URLs**: garanta que estão liberados
   `…/auth/confirm` e `…/auth/callback` (prod + `http://localhost:3000/...` em dev).
   Sem isso o link de confirmação/recuperação falha (ver `balu-reset-needs-redirect-allowlist`).

**Via Management API** (alternativa, precisa de *personal access token* — não a senha do banco
nem a service_role):
```
PATCH https://api.supabase.com/v1/projects/llykzqnugdpojwnlontj/config/auth
Authorization: Bearer <PERSONAL_ACCESS_TOKEN>
{ "mailer_subjects_confirmation": "...", "mailer_templates_confirmation_content": "<html…>" , ... }
```

## Por que estes links

- **Confirm signup** aponta para a rota `app/src/app/auth/confirm/route.ts` (`verifyOtp` por
  `token_hash`, grava cookies no domínio do app — não no `.supabase.co`).
- **Reset password** aponta para a mesma rota `auth/confirm/route.ts`, com `type=recovery`.
  **Não** use `{{ .ConfirmationURL }}` aqui: ele passa pelo `/auth/v1/verify` do GoTrue, que
  devolve o resultado no **fragmento** da URL (`#access_token=…` no sucesso, `#error=…` na
  falha). Fragmento não é enviado ao servidor — o route handler via uma URL sem parâmetro
  nenhum e respondia "Link inválido" tanto para link bom quanto para link expirado. O
  `token_hash` também dispensa o cookie `code-verifier` do PKCE, então o link funciona quando
  o reset é pedido no desktop e aberto no celular.
  O `{{ .RedirectTo }}` vem do `redirectTo` passado em `resetPasswordForEmail` — é o que faz o
  mesmo template servir `localhost` e produção; por isso ele precisa estar na allowlist de
  Redirect URLs.
- `/auth/hash` (`app/src/app/auth/hash/page.tsx`) é a rede de segurança para os e-mails
  **antigos**, já enviados no formato `{{ .ConfirmationURL }}`: o `/auth/callback` manda o
  navegador para lá quando a query vem vazia, e de lá o fragmento é lido no cliente.
- **Change email** usa `{{ .ConfirmationURL }}` e exibe `{{ .NewEmail }}` no corpo.

## Notas

- O SMTP padrão do Supabase tem limite baixo de envio; para produção, configurar **SMTP custom**
  (Resend/SendGrid/SES) em Authentication → SMTP Settings.
- Logo é 100% HTML (badge azul + wordmark + "sorriso"); não depende de imagem hospedada.
  Se quiser o símbolo "u" como arte, dá pra gerar um PNG e hospedar (trocar o badge por `<img>`).
