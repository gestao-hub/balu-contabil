# Pedido de DNS — balucontabil.com.br (19/08/2026)

Para quem administra a zona DNS de `balucontabil.com.br`
(nameservers `ns1.dns-parking.com` / `ns2.dns-parking.com` — painel Hostinger).

## O que aconteceu

A zona foi editada hoje (SOA serial `2026081905`) para incluir os registros de
e-mail do Resend. Os registros de **e-mail entraram e estão corretos**, mas os
registros que apontam o **site** para a Vercel saíram junto.

Estado agora, conferido no servidor autoritativo `ns1.dns-parking.com`:

| Nome | Tipo | Estado |
|---|---|---|
| `balucontabil.com.br` | A | **ausente** |
| `www.balucontabil.com.br` | qualquer | **NXDOMAIN** (o nome não existe) |
| `resend._domainkey.balucontabil.com.br` | TXT | ok (DKIM) |
| `send.balucontabil.com.br` | TXT | ok (SPF) |
| `send.balucontabil.com.br` | MX | ok (feedback Amazon SES) |

Consequência: o site está fora do ar no domínio (responde só em
`balu-contabil.vercel.app`), e todo link de e-mail de autenticação — confirmação
de cadastro, redefinição de senha, convite — aponta para um endereço que não
resolve.

## O que precisa ser criado

Dois registros, exatamente estes (valores informados pela própria Vercel):

```
Tipo: A    Nome: @      Valor: 76.76.21.21    TTL: padrão
Tipo: A    Nome: www    Valor: 76.76.21.21    TTL: padrão
```

No painel da Hostinger, `@` costuma aparecer como o próprio domínio ou campo
vazio — é o apex, `balucontabil.com.br` sem prefixo.

## ⚠️ O que NÃO pode ser mexido

Os três registros do Resend abaixo. Se algum deles sair, **o e-mail do sistema
para de ser entregue** (e a falha é silenciosa — nada dá erro na tela):

- `resend._domainkey` (TXT, começa com `p=MIGfMA0GCSq...`)
- `send` (TXT, `v=spf1 include:amazonses.com ~all`)
- `send` (MX, `feedback-smtp.sa-east-1.amazonses.com`, prioridade 10)

É a mesma armadilha que causou o problema de hoje, na direção contrária.

## Alternativa (não recomendada agora)

A Vercel também aceita transferir os nameservers para `ns1.vercel-dns.com` /
`ns2.vercel-dns.com`. **Não faça isso sem replanejar**: a zona inteira passa a
viver na Vercel e os três registros do Resend teriam de ser recriados lá — se
não forem, o e-mail cai no mesmo instante.

## Como conferir depois de aplicar

```bash
nslookup -type=A balucontabil.com.br 8.8.8.8        # deve devolver 76.76.21.21
nslookup -type=A www.balucontabil.com.br 8.8.8.8    # idem
curl -sI https://balucontabil.com.br | head -1      # deve responder 307 (redireciona p/ /login)
```

Propagação: o TTL da zona é 600s, então vale em ~10 minutos.

---

## Passo a passo no painel da Hostinger

Conferido no autoritativo em 19/08: a zona **não tem** AAAA, **não tem** CAA e
`www` não existe. Ou seja, não há registro conflitante para editar — é só criar
os dois.

**1. Entrar no hPanel** — `https://hpanel.hostinger.com`, com a conta que
administra `balucontabil.com.br` (é a conta que responde pelos nameservers
`ns1/ns2.dns-parking.com`, não necessariamente quem registrou no Registro.br).

**2. Abrir o editor de DNS** — menu **Domínios** → localizar
`balucontabil.com.br` → **Gerenciar** → no menu lateral, **DNS / Nameservers**
→ aba **Registros DNS**. Atalho direto:
`https://hpanel.hostinger.com/domain/balucontabil.com.br/dns`

**3. Antes de mexer, fotografar a lista.** Um print da tela inteira de registros.
Se algo der errado, é o que permite voltar.

**4. Criar o registro do site (apex):**

| Campo | Valor |
|---|---|
| Tipo | `A` |
| Nome | `@` |
| Aponta para / Points to | `76.76.21.21` |
| TTL | deixar o padrão (ou `3600`) |

Clicar em **Adicionar registro**.

**5. Criar o registro do www** — mesma tela, novo registro:

| Campo | Valor |
|---|---|
| Tipo | `A` |
| Nome | `www` |
| Aponta para / Points to | `76.76.21.21` |
| TTL | deixar o padrão (ou `3600`) |

**6. Conferir que os três registros do Resend continuam na lista** (eles ficam
mais abaixo, junto dos outros TXT/MX):

- `resend._domainkey` — TXT, começa com `p=MIGfMA0GCSq...`
- `send` — TXT, `v=spf1 include:amazonses.com ~all`
- `send` — MX, `feedback-smtp.sa-east-1.amazonses.com`, prioridade 10

### 🚫 O que não fazer nessa tela

- **Não clicar em "Redefinir registros DNS" / "Reset DNS records".** Esse botão
  devolve a zona ao padrão da Hostinger e apaga os registros do Resend. É a
  hipótese mais provável para o que aconteceu hoje: os registros do site sumiram
  de uma vez, sem que ninguém tivesse motivo para removê-los um a um.
- **Não trocar os nameservers** para os da Vercel. A Vercel sugere isso na tela
  dela, mas aqui significaria mover a zona inteira e recriar os registros do
  Resend do outro lado. Se não forem recriados, o e-mail cai no mesmo instante.
- **Não apagar nada** para "limpar" — os registros que estão lá foram postos hoje
  de propósito.

## Como fica a zona no fim

| Nome | Tipo | Valor | Para quê |
|---|---|---|---|
| `@` | A | `76.76.21.21` | site (Vercel) |
| `www` | A | `76.76.21.21` | site (Vercel) |
| `resend._domainkey` | TXT | `p=MIGf...` | assinatura DKIM do e-mail |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | SPF do e-mail |
| `send` | MX | `feedback-smtp.sa-east-1.amazonses.com` (10) | retorno de bounce |
