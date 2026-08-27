# Focus NFe — `/v2/empresas` 401: o bloqueio era nosso

**Data:** 27/08/2026 · **Status:** causa raiz encontrada, correção de código
aplicada, **falta o token principal ser colado na plataforma**

---

## 1. O que se acreditava (e estava errado)

Desde 23/07/2026 o `POST/GET /v2/empresas` respondia `401 permissao_negada`.
A sessão 31 registrou o diagnóstico no CHECKPOINT como **"O BLOQUEIO QUE NÃO É
NOSSO"**, concluindo que era falta de permissão da CONTA no gateway da Focus,
"independente de qual token for gravado", e que "isso NÃO se resolve com
código".

A conclusão saiu de uma leitura da palavra `permissao_negada` no corpo do 401.
Ela virou comentário em `focus-token-sonda.ts`, e o comentário virou regra: a
sonda da tela de configuração passou a **evitar** `/v2/empresas` de propósito,
porque "testar por ali teria recusado tokens corretos".

## 2. O que a Focus respondeu

> Consultamos o cadastro de vocês e verificamos que a conta e o acesso estão
> liberados, **inclusive, para utilizarem a API de Empresas**. Para operar nessa
> API é preciso utilizar, **exclusivamente, o token principal de produção**. Ele
> está disponível pelo painel da API navegando por Serviços > Painel API >
> Tokens.
>
> — Hélio Marques, Suporte ao Cliente, Focus NFe, 27/08/2026

## 3. A medição

A própria mensagem de erro da Focus mudou, e a nova entrega a causa:

```
antes (23/07 → 20/08):  permissao_negada — "Contate o suporte técnico"
AGORA (27/08):          permissao_negada — "Access token inválido (host: api.focusnfe.com.br)"
```

Sonda com o token de produção configurado (`JSqPs…`, 32 chars), via
`app/scratchpad/_focus-sonda-empresas.mjs`:

| Requisição | Host | Resultado |
|---|---|---|
| `GET /v2/codigos_cnae/6201501` | `api.focusnfe.com.br` | **200** ✅ |
| `GET /v2/empresas` | `api.focusnfe.com.br` | **401** `Access token inválido` |
| `GET /v2/empresas/216964` | `api.focusnfe.com.br` | **401** `Access token inválido` |
| `GET /v2/empresas` (token de hom) | `api.focusnfe.com.br` | **401** |
| `GET /v2/empresas` | `homologacao.focusnfe.com.br` | **404** endpoint não existe |
| `GET /v2/codigos_cnae/6201501` (token hom) | `homologacao.focusnfe.com.br` | **200** ✅ |

**Mesmo host, mesmo token, um endpoint aceita e o outro não.** O catálogo aceita
qualquer token válido da conta; a API de Empresas aceita só o principal.

Descartada a hipótese de o token da plataforma ser um token de empresa
(`_focus-sonda-escopo.mjs`): ele **não enxerga** as duas NFS-e que a AL PISCINAS
emitiu em 09/06/2026 — devolve 404, idêntico a uma `ref` inventada.

## 4. O segundo problema — a Vercel

```
Vercel (Production):  FOCUS_NFE_TOKEN          existe (Sensitive, ilegível)
                      FOCUS_NFE_TOKEN_PRODUCAO NÃO EXISTE
                      FOCUS_NFE_HOMOLOGACAO    NÃO EXISTE
config_focus (banco): token_hom = vazio · token_prod = vazio
```

`obterTokenFocus` cai no genérico quando o específico falta — logo, em produção
**o mesmo token atendia `hom` e `prod`**. Como cada token só vale na sua base,
um dos dois ambientes estava necessariamente quebrado.

## 5. Correção aplicada no código

- `focus.listarEmpresas()` — `GET /v2/empresas`, a única sonda que discrimina o
  token principal.
- Sonda de **produção em dois passos**: catálogo (o token vale nesta base?) e,
  só se passar, `/v2/empresas` (e é o principal?). Homologação segue só no
  catálogo, porque `/v2/empresas` não existe naquela base.
- Status `nao_principal`: **avisa, não bloqueia**. Bloquear deixaria a
  plataforma sem token nenhum; calar foi o defeito.
- 11 testes novos, com asserção positiva.

## 6. Resposta ao suporte (rascunho pronto para enviar)

> Bom dia, Hélio! Obrigado pelo retorno — ele resolveu o diagnóstico.
>
> Conferimos e o token que estávamos usando na API de Empresas **não é** o token
> principal de produção. Ele é um token válido da conta (responde 200 em
> `GET /v2/codigos_cnae` em `api.focusnfe.com.br`), mas é recusado em
> `/v2/empresas` no mesmo host.
>
> Segue o que vocês pediram:
>
> **1) Cinco primeiros dígitos do token que estávamos usando:** `JSqPs`
> (32 caracteres, ambiente de produção).
>
> **2) JSON de criação de empresa** — é o corpo que enviamos no
> `POST /v2/empresas`:
>
> ```json
> {
>   "nome": "dev.ide",
>   "cnpj": "44555666000181",
>   "regime_tributario": 1,
>   "municipio": "Rio de Janeiro",
>   "uf": "RJ",
>   "logradouro": "Rua Artur Rios",
>   "numero": "991",
>   "bairro": "Senador Vasconcelos",
>   "cep": "23013470",
>   "nome_fantasia": "ideapp",
>   "email": "walacesssantos@gmail.com",
>   "telefone": "32987006789"
> }
> ```
>
> **3) Logs** — medição de hoje, 27/08/2026, autenticação Basic com o token
> acima como usuário e senha vazia:
>
> ```
> GET  https://api.focusnfe.com.br/v2/codigos_cnae/6201501
>      -> 200
> GET  https://api.focusnfe.com.br/v2/empresas
>      -> 401 {"codigo":"permissao_negada",
>              "mensagem":"Access token inválido (host: api.focusnfe.com.br)"}
> GET  https://api.focusnfe.com.br/v2/empresas/216964
>      -> 401 (mesma resposta)
> ```
>
> Uma pergunta para fechar, por favor: **o token principal de produção é o mesmo
> que devemos usar para emitir notas em nome das empresas cadastradas**, ou cada
> empresa continua tendo o `token_producao` próprio devolvido no
> `POST /v2/empresas`? É o que falta para ajustarmos a integração do lado certo.
>
> Obrigado!

## 7. O que falta

1. Painel da Focus → `Serviços > Painel API > Tokens` → copiar o **token
   principal de produção**; conferir se começa com `JSqPs`.
2. Colar em `/admin/configuracoes/focus`. O banco vence a variável da Vercel
   (`obterTokenFocus` lê `config_focus` primeiro) — vale sem redeploy.
3. Enviar a resposta acima ao suporte.
