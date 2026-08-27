# Como toda empresa da plataforma passa a emitir nota

**Data:** 27/08/2026 · **Pergunta:** o que falta para que qualquer empresa que
usa o Balu consiga emitir NFS-e, sem burocracia por cliente?

---

## Conclusão, antes das evidências

**Não há arquitetura a construir.** O fluxo sem burocracia já está inteiro no
código e já roda sozinho no onboarding. O que falta é **uma credencial** — e não
é "outro token" genérico: é um token de **classe diferente** do que está
configurado hoje.

---

## 1. O fluxo automático que JÁ EXISTE

| # | Etapa | Onde | Estado |
|---|---|---|---|
| 1 | Empresa entra → cadastro na Focus | `onboarding/actions.ts:124` → `syncEmpresaNaFocus` | ⛔ **401** |
| 2 | Focus devolve `token_producao` + `token_homologacao` | `focus-empresa-sync.ts` → `empresa_credenciais_focus` | depende de 1 |
| 3 | Snapshot preenche `focus_habilita_*` | `snapshotFocusEmpresa` | depende de 1 |
| 4 | Seletor de tipo de nota libera NFS-e / NF-e / NFC-e | `listarTiposEmissaoAction` | depende de 3 |
| 5 | Cliente sobe o A1 → vai para a Focus | `cert-upload.ts` → `PUT /v2/empresas/:id` | depende de 1 |
| 6 | Emissão | `POST /v2/nfsen` com o token da empresa | depende de 2 |

**A etapa 1 é automática** — não depende de ninguém clicar em nada. As cinco
seguintes caem em cascata a partir dela. É o desenho que o produto precisa, e ele
já está construído.

## 2. O bloqueio, medido hoje

A doc da Focus documenta `dry_run=1`, que **não cria nada**. Com ele dá para
provar que o 401 é de autenticação, e não de payload:

```
POST https://api.focusnfe.com.br/v2/empresas?dry_run=1
     [token de produção configurado]  -> 401
     {"codigo":"permissao_negada",
      "mensagem":"Access token inválido (host: api.focusnfe.com.br)"}
```

Recusado **antes** de olhar o corpo. Não é dado faltando, não é CNPJ, não é
regime tributário. É a credencial.

## 3. 🔑 O ACHADO: o token que temos é da classe errada

A Focus documenta **duas classes** de token (fórum oficial, "Autenticação e
utilização dos tokens da API — revenda e emissão"):

- **Token de revenda** — o da CONTA. Dá acesso à API de Revenda / de Empresas.
  **Só existe em produção.**
- **Token revendido (de emissão)** — vem **em par hom/prod**, é **de uma
  empresa**, e é devolvido quando a empresa é cadastrada.

E o painel expõe o **token principal**, que segundo o material da Focus "permite
usar qualquer API do ecossistema, bem como emitir documentos fiscais para
qualquer empresa cadastrada na sua conta".

**Agora cruze com o que foi medido**, com o token `JSqPs…` configurado hoje:

```
GET  /v2/nfsen/<ref>   [api.focusnfe.com.br]  -> 404  "Nota fiscal não encontrada"
GET  /v2/nfse/<ref>    [api.focusnfe.com.br]  -> 404
GET  /v2/nfe/<ref>     [api.focusnfe.com.br]  -> 404
GET  /v2/nfce/<ref>    [api.focusnfe.com.br]  -> 404
GET  /v2/empresas      [api.focusnfe.com.br]  -> 401  "Access token inválido"
```

404 é **token aceito, recurso inexistente**. 401 é **token recusado**.

> A API de **emissão aceita** o nosso token. A API de **Empresas recusa**. Essa é
> exatamente a assinatura de um token **revendido (de emissão)** — não de um
> token de revenda.

E ele vem **em par hom/prod** (`FOCUS_NFE_TOKEN_PRODUCAO` +
`FOCUS_NFE_HOMOLOGACAO`), que é a característica que a Focus atribui ao token
revendido; o de revenda "só existe em produção".

**Isso explica tudo de uma vez** — os 35 dias de 401, o "a conta está liberada"
do suporte, e o fato de o catálogo funcionar. Não falta permissão na conta e não
falta um token a mais: está preenchido um token **de emissão** no lugar onde o
sistema precisa do token **de revenda**.

## 4. Descoberta que reduz o trabalho: o A1 vai no próprio cadastro

`POST /v2/empresas` aceita, na mesma chamada
(`doc.focusnfe.com.br/reference/criar_empresa`):

- `arquivo_certificado_base64` — o PFX/P12 em base64
- `senha_certificado`

E devolve `token_producao`, `token_homologacao`, `certificado_valido_ate`,
`certificado_cnpj`.

Hoje o Balu faz isso em duas chamadas (POST para criar, PUT para o certificado).
Funciona, mas dá para reduzir a uma só quando o cliente já sobe o A1 no cadastro
— **melhoria, não bloqueio**.

## 5. As opções

### Opção 1 — Obter o token de revenda/principal no painel ✅ RECOMENDADA

- **Esforço de código: ZERO.** Cola em `/admin/configuracoes/focus`, que grava no
  banco e vence a variável da Vercel — vale sem redeploy.
- **Destrava:** todas as seis etapas, para toda empresa, automaticamente.
- **Risco:** depende de a conta ter esse token disponível. O suporte já afirmou
  por escrito que a conta está liberada para a API de Empresas.
- **Como confirmar em 1 minuto:** no painel, `Serviços > Painel API > Tokens`. O
  token de revenda/principal **não** vem em par hom/prod. Se o que estiver lá for
  um par, é revendido — e aí a pergunta ao suporte fica específica: *"onde fica o
  token de revenda da nossa conta?"*

### Opção 2 — Emitir com o token da conta, sem guardar token por empresa

- **O que muda:** a emissão passa a usar o token da conta; o `cnpj_prestador` /
  `cnpj_emitente` **já vai no payload** hoje (`nfse-payload.ts:189`,
  `nfe-payload.ts:134`, `nfce-payload.ts:90`).
- **NÃO destrava sozinha:** a empresa ainda precisa existir na conta da Focus,
  com A1 — e isso é a API de Empresas de novo.
- **Por que ainda vale:** elimina a classe de falha que matou a AL PISCINAS —
  token por empresa que morre quando a credencial da conta é trocada, em
  silêncio, sem nada no produto perceber.
- **Esforço:** médio. Mexe no caminho de emissão fiscal — exige teste real.

### Opção 3 — Ponte manual, só para os pilotos

- Cadastrar a empresa e o A1 **no painel da Focus**, colar o token dela em
  `/contador/clientes/[id]` (origem `própria`, ambiente `produção`).
- **Funciona hoje**, sem depender de a Focus responder.
- **Precisa de um conserto:** `listarTiposEmissaoAction` gateia NFS-e em
  `focus_habilita_*`, que só o snapshot preenche — e o snapshot **recusa rodar**
  para origem `própria` (`focus-empresa-sync.ts:61`). As colunas ficam `NULL`
  para sempre e o seletor nunca oferece NFS-e, **embora
  `prepararEmissaoAction` — o validador de verdade — não gateie nisso para
  NFS-e**. Os dois portões discordam, e o do seletor usa um sinal que não pode
  existir nesse caminho.
- **Não serve de modelo:** é trabalho manual por cliente. Serve de ponte para 2–5
  empresas.

### Opção 4 — Segundo provedor de emissão

Só se a Opção 1 falhar. Semanas de trabalho, e nada indica ser necessário.

## 6. Recomendação

1. **Hoje:** conferir a classe do token no painel (Opção 1). É a diferença entre
   "um minuto" e "um projeto", e a evidência da seção 3 diz exatamente o que
   procurar.
2. **Em paralelo, independente da Focus:** consertar o seletor da Opção 3. É um
   defeito real — dois portões discordando sobre a mesma pergunta — e destrava os
   pilotos sem depender de terceiro.
3. **Depois, com calma:** Opção 2, como resiliência. Não é urgente e não deve
   competir com as duas acima.

## 7. Ferramenta que fica

`app/scratchpad/_focus-dryrun-empresas.mjs` — testa o cadastro de empresa com
`dry_run=1`, **sem criar nada**. No minuto em que houver um token novo, ele diz
se destravou, antes de qualquer cliente ser afetado.
