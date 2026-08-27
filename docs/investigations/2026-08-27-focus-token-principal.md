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

## 4-B. 🔴 O ACHADO MAIS FORTE: um token que a própria Focus emitiu está morto

A AL PISCINAS foi cadastrada em 09/06/2026 pelo `POST /v2/empresas` — o único
cadastro que deu certo. A Focus devolveu o `token_homologacao` dela, que está
guardado cifrado em `empresa_credenciais_focus` e **emitiu duas NFS-e naquele
dia** (`notas_fiscais`, 09/06/2026 14:16 e 14:23).

Esse mesmo token, hoje (`_focus-sonda-alpiscinas.mjs`):

```
token go6FN… (32 chars, decifrado de empresa_credenciais_focus)

GET /v2/codigos_cnae/6201501   [homologacao.focusnfe.com.br]  -> 401
GET /v2/codigos_cnae/6201501   [api.focusnfe.com.br]          -> 401
GET /v2/nfsen/man_3bb1eac0-…   [homologacao.focusnfe.com.br]  -> 401
     {"codigo":"permissao_negada",
      "mensagem":"Access token inválido (host: homologacao.focusnfe.com.br)"}
```

**401 nos DOIS hosts** — não é ambiente trocado, é token inválido. E a última
requisição é o caso mais claro possível: o token não consegue mais ler **a nota
que ele mesmo emitiu**.

A decifra é prova de que o valor está íntegro: AES-256-GCM falha na verificação
do *auth tag* com chave errada, e ela não falhou. O token guardado é exatamente
o que a Focus devolveu.

**Consequência para o diagnóstico:** não é só o `/v2/empresas` que parou. As
credenciais por empresa emitidas ANTES também morreram. Isso aponta para uma
mudança no lado da conta na Focus — e a janela bate com o início dos 401
(23/07/2026).

**Consequência para o produto:** a AL PISCINAS não está "funcionando". Ela passa
em todas as guardas internas (assinatura `cortesia`, município ativo, NFS-e
habilitada, token presente) e falharia na chamada à Focus, com 401. As quatro
empresas estão bloqueadas.

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

> Bom dia, Hélio! Obrigado pelo retorno.
>
> Confirmando o que você pediu: **sim**, estamos usando o token de produção do
> painel (Serviços > Painel API > Tokens) nessa API — não temos outro. Os
> **5 primeiros dígitos** são `JSqPs` (32 caracteres). E o erro persiste, então
> seguem os dados.
>
> **1) O token é aceito pela API — mas não pela API de Empresas.** Mesmo host,
> mesmo token, mesma sessão, hoje 27/08/2026:
>
> ```
> GET  https://api.focusnfe.com.br/v2/codigos_cnae/6201501
>      -> 200 OK
>
> GET  https://api.focusnfe.com.br/v2/empresas
>      -> 401 {"codigo":"permissao_negada",
>              "mensagem":"Access token inválido (host: api.focusnfe.com.br)"}
>
> GET  https://api.focusnfe.com.br/v2/empresas/216964
>      -> 401 (mesma resposta)
> ```
>
> Autenticação HTTP Basic, token como usuário e senha vazia.
>
> **2) Um token que vocês nos emitiram parou de funcionar.** Este é o ponto que
> achamos mais revelador. Em 09/06/2026 cadastramos a empresa AL PISCINAS LTDA
> (CNPJ 10358425000120) pelo `POST /v2/empresas` — deu certo, id **216964** — e
> emitimos duas NFS-e de homologação com o `token_homologacao` que vocês
> devolveram. Guardamos esse token. Hoje ele responde:
>
> ```
> GET  https://homologacao.focusnfe.com.br/v2/codigos_cnae/6201501  -> 401
> GET  https://api.focusnfe.com.br/v2/codigos_cnae/6201501          -> 401
> GET  https://homologacao.focusnfe.com.br/v2/nfsen/man_3bb1eac0-5dce-4501-8bb9-f2a1f77e6b4e
>      -> 401 {"codigo":"permissao_negada",
>              "mensagem":"Access token inválido (host: homologacao.focusnfe.com.br)"}
> ```
>
> Ou seja: o token não consegue mais nem consultar a nota que ele mesmo emitiu.
> Os 401 nos dois ambientes começaram em **23/07/2026** — o último cadastro
> bem-sucedido foi o de 09/06 e nada mudou do nosso lado entre as duas datas.
>
> **3) JSON de criação de empresa** — o corpo que enviamos no `POST /v2/empresas`:
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
> Duas perguntas para fecharmos:
>
> **a)** Houve alguma rotação de tokens ou migração da nossa conta por volta de
> 23/07/2026? O comportamento (token do painel aceito em uns endpoints e
> recusado na API de Empresas, e tokens de empresa emitidos por vocês agora
> inválidos) parece indicar isso.
>
> **b)** O token principal de produção também serve para **emitir** notas em nome
> das empresas cadastradas, ou cada empresa continua tendo o `token_producao`
> próprio devolvido no `POST /v2/empresas`? É o que falta para ajustarmos a
> integração do lado certo.
>
> Obrigado!

## 7. O que falta

1. **Conferir os 5 primeiros dígitos** do token de produção no painel da Focus
   contra `JSqPs`. Não se trata de procurar um token novo — o dono confirmou que
   não existe um terceiro. Trata-se de saber se o VALOR no painel hoje é o mesmo
   que está no `.env.local`, ou se ele foi rotacionado em algum momento.
   - Se for diferente: colar em `/admin/configuracoes/focus` (o banco vence a
     variável da Vercel — vale sem redeploy) e refazer a medição.
   - Se for igual: está provado que o bloqueio é do lado da Focus, e a resposta
     da seção 6 é o que destrava.
2. Enviar a resposta ao suporte de qualquer forma — o achado 4-B (token emitido
   por eles, morto nos dois hosts) não depende do item 1.
3. **Independente da Focus:** o trial da PADARIA MODELO venceu em 26/08/2026 e
   ela está bloqueada também pelo gate de assinatura.
