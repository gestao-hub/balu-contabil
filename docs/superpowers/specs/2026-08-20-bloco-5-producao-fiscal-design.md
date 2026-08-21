# Bloco 5 — produção fiscal: emissão real na Focus

> Spec de design. Sessão 30, 2026-08-20.
> Substitui o §6 de `docs/novas specs e prd/2026-07-22-remanescente-design.md`,
> que foi escrito antes de existirem as evidências abaixo.

## §0 — Decisões fechadas com o usuário (não rediscutir)

| # | decisão | consequência |
|---|---|---|
| D1 | **Modelo híbrido de credencial.** Cada empresa ou **traz a própria** conta Focus, ou **compra da Balu** (cadastrada na conta da plataforma). | `empresas_fiscais` ganha a origem. Todo o resto deriva daqui. |
| D2 | **Quem cadastra o token da empresa é o CONTADOR**, pelo cliente. | Exceção deliberada ao "painel do contador é somente visualização" — ver §7. |
| D3 | **Ambiente é por empresa, nunca global.** | Feature-flag em `empresas_fiscais`, não variável de ambiente. |
| D4 | **A nota carrega o ambiente em que foi emitida.** | Consulta, download e cancelamento usam o ambiente DA NOTA. |
| D5 | Falhar a guarda de produção é **erro claro**, nunca queda silenciosa para homologação. | Emitir em homologação achando que é produção é pior que não emitir. |

## §1 — Estado atual, com evidência

Tudo abaixo foi medido em 2026-08-20, não inferido.

**A emissão está presa em homologação por constante.** `env: FocusEnv = 'hom'`
aparece em quatro arquivos de produto: `notas_fiscais/actions.ts` (emissão,
polling e cancelamento), `notas_fiscais/[id]/download/route.ts`,
`configuracoes/actions.ts` e `lib/fiscal/cert-upload.ts`.

**A API de Empresas da Focus está bloqueada.** Desde 2026-07-23, `POST
/v2/empresas` devolve `401 {"codigo":"permissao_negada","mensagem":"Permissão
negada no Gateway. Contate o suporte técnico"}` — registrado em
`companies.focus_last_error` das empresas `ideapp` e `dev.ide`. O último cadastro
bem-sucedido foi 2026-06-09 (AL PISCINAS, `focus_empresa_id=216964`).

**O token da plataforma está morto.** O `FOCUS_NFE_TOKEN` (presente em seis
backups do `.env.local`, de 31/07 a 19/08, e nas variáveis de produção da
Vercel) leva 401 em catálogo, emissão e revenda, nos dois ambientes.

**Os tokens de EMPRESA funcionam.** O par do `.env.local` autentica, cada um no
seu ambiente:

| token | catálogo | emissão `/v2/nfsen` | revenda `/v2/empresas` |
|---|---|---|---|
| `FOCUS_NFE_HOMOLOGAÇÃO` | 200 hom | 404 hom (autenticou) | 401 |
| `FOCUS_NFE_TOKEN_PRODUÇÃO` | 200 prod | 404 prod (autenticou) | 401 |

**O token guardado da empresa piloto está morto.** `companies.focus_token` da AL
PISCINAS: 401 em homologação e em produção, tanto em `/v2/nfe` quanto em
`/v2/nfsen`.

**Um campo para dois tokens.** `focus-empresa-sync.ts:97` grava
`token_homologacao ?? token_producao` numa coluna só — e depois não há como
saber qual dos dois está lá.

**Os tokens de empresa estão em TEXTO PURO.** Dois gravados, zero com o prefixo
`enc:v1:`. `anon` e `authenticated` têm `SELECT/INSERT/UPDATE` na coluna; com a
RLS ligada, quem enxerga é o dono (`companies_select`) e o contador dele
(`companies_select_contador`). Não é vazamento entre tenants — é credencial de
emissão fiscal ao alcance de uma sessão de navegador.

**Nenhuma nota sabe em que ambiente nasceu.** `notas_fiscais` não tem coluna de
ambiente. Hoje há **2 notas** no banco inteiro; o backfill é trivial agora e
deixa de ser depois do lançamento.

## §2 — O que a origem da credencial decide

```
empresa
 ├── origem = 'propria'  → o cliente tem contrato com a Focus
 │      · tokens vêm de fora, cadastrados na plataforma
 │      · a Balu NÃO cadastra, NÃO atualiza e NÃO sobe certificado na Focus
 │      · NÃO depende da API de Empresas → não está bloqueado hoje
 │
 └── origem = 'balu'     → a empresa vive na conta da plataforma
        · tokens nascem do POST /v2/empresas
        · a Balu cadastra, atualiza e sobe o certificado
        · DEPENDE da API de Empresas → bloqueado até a Focus liberar
```

A consequência que mais importa: **o caminho `propria` permite emitir sem
destravar nada com a Focus.** É por ele que o piloto sai.

## §3 — Schema

```sql
-- em empresas_fiscais
focus_origem   text NOT NULL DEFAULT 'balu' CHECK (focus_origem IN ('propria','balu'))
focus_ambiente text NOT NULL DEFAULT 'hom'  CHECK (focus_ambiente IN ('hom','prod'))

-- em companies (cifrados, prefixo enc:v1:)
focus_token_hom_cifrado  text
focus_token_prod_cifrado text

-- em notas_fiscais
ambiente text NOT NULL DEFAULT 'hom' CHECK (ambiente IN ('hom','prod'))
```

`focus_origem` nasce `'balu'` porque é o que as empresas existentes são — foram
cadastradas pela API. Mudar o default mentiria sobre elas.

**O `companies.focus_token` antigo:** migra para `focus_token_hom_cifrado`
(cifrado), já que o que está lá é sabidamente o de homologação — é o que
`focus-empresa-sync.ts:97` grava quando a Focus devolve os dois. A coluna velha
fica, vazia, até uma migration posterior derrubá-la; derrubar junto com a
migração de dados impede rollback.

**Backfill de `notas_fiscais.ambiente`:** o DEFAULT resolve. As 2 notas
existentes foram emitidas com `env: 'hom'` fixo, então `'hom'` é o valor
verdadeiro, não uma conveniência.

## §4 — A guarda de emissão

Um helper único, `resolverCredencialEmissao(companyId)`, é o **único** lugar que
decide ambiente e token. Devolve `{ ambiente, token }` ou um erro nomeado.

Para devolver `prod`, **as quatro** precisam ser verdadeiras:

1. `empresas_fiscais.focus_ambiente = 'prod'`
2. `companies.focus_token_prod_cifrado` presente e decifrável
3. certificado A1 válido — `arquivos_auxiliares.cert_not_after > now()`, sem `deleted_at`
4. `empresas_fiscais.focus_habilita_nfsen_producao = true` (snapshot da Focus)

Falhando qualquer uma: **erro que nomeia qual falhou**. Nunca `?? 'hom'`. O
motivo está em D5 — e o precedente é o `catch` de `obterTokenRevendaFocus`, que
cai para a variável de ambiente **de propósito** e é o oposto do que se quer
aqui.

Para `origem = 'propria'`, o critério 4 não pode ser conferido pela API (o
snapshot vem de `GET /v2/empresas`, bloqueado). Nesse caso a habilitação é
**declarada por quem cadastrou** e registrada como declaração, não como fato
verificado. A tela diz isso com todas as letras.

## §5 — Certificado A1, por origem

`cert-upload.ts:159` hoje chama `atualizarEmpresaNaFocus(...)` **sempre**. Isso
quebra para `origem = 'propria'`: o `PUT /v2/empresas/:id` é o endpoint
bloqueado, e o token da empresa não o abre (401 provado).

- `origem = 'balu'` → mantém o espelho na Focus
- `origem = 'propria'` → **não tenta**, e a tela informa que o certificado
  precisa ser enviado no painel da Focus do próprio cliente

O certificado continua sendo guardado no Balu nos dois casos — ele é usado
também na SERPRO, que não tem nada a ver com a Focus.

## §6 — Ambiente da nota manda nas leituras

Emissão carimba `notas_fiscais.ambiente`. Depois disso, **consulta de status,
download de PDF/XML e cancelamento leem o ambiente da nota**, nunca o da
empresa. Sem isso, o dia em que uma empresa virar `prod` transforma toda nota
antiga de homologação em 404 — no PDF, no XML e no cancelamento.

## §7 — Quem cadastra, e por que isso não derruba a garantia do contador

D2 diz que o contador cadastra pelo cliente. Isso **não** exige policy de
escrita para o contador: o padrão já existe e está provado em
`contador/clientes/[companyId]/cert-actions.ts`.

```
requireEscritorioAprovado()            → escritório existe e está aprovado
companyDaCarteira(admin, ctx.id, id)   → ANTI-IDOR: a empresa é da carteira dele
                                         (erro genérico, não revela existência)
escrita por service_role               → a RLS do contador segue SELECT-only
registrarAuditoria(...)                → o registro que vale
```

Três coisas vêm junto, copiadas do card de certificado porque a natureza do dado
é a mesma:

1. **Declaração de custódia.** Quem cadastra declara que o titular autorizou.
   Com este token se emite nota fiscal em nome do CNPJ do cliente.
2. **Colunas de rastro** (`focus_token_por`, `focus_token_em`), para a tela do
   empresário mostrar que o escritório cadastrou e quando.
3. **Auditoria sem o segredo** — quem, quando, qual empresa. Nunca o token, nem
   mascarado.

O token **nunca volta para a tela**, nem mascarado — mesma regra dos cards do
admin. Campo vazio significa "não trocar".

## §8 — Segurança

- Os campos novos nascem cifrados (`cifrarCampo`, envelope AES-256-GCM).
- `companies.focus_token` em texto puro é migrado e a coluna esvaziada.
- Depois da migração, **nenhum `select` de produto traz coluna de token para
  fora do servidor**. Auditar os pontos que hoje fazem `.select('focus_token')`:
  `notas_fiscais/actions.ts`, `[id]/download/route.ts`, `focus-empresa-sync.ts`.
- Emissão em `prod` entra no `audit_log` com empresa, ref e ambiente.

## §9 — O que esta spec NÃO consegue entregar

Honestidade de escopo, para não virar promessa:

- **Emissão em produção com `origem = 'balu'`** — depende da Focus liberar a API
  de Empresas. Nada em código destrava.
- **Habilitar NFS-e produção** de qualquer empresa pela plataforma — mesmo
  `PUT` bloqueado.
- **Provar uma emissão real em produção** — gera documento fiscal de verdade.
  Só com autorização explícita do titular, empresa e competência escolhidas a
  dedo. Não é passo de rotina de teste.

O que **é** entregável e provável: todo o caminho em homologação, a guarda com
seus quatro critérios, a não-regressão do fluxo atual, e o caminho
`origem = 'propria'` pronto para receber uma empresa real.

## §10 — Testes

- **Puros:** `resolverCredencialEmissao` com os 16 arranjos dos quatro critérios;
  cifra e recusa de valor sem prefixo; carimbo de ambiente.
- **Fronteira das actions:** anti-IDOR (empresa fora da carteira), campo vazio =
  não trocar, UPDATE que não pega linha não é sucesso, auditoria sem segredo.
- **Não-regressão:** empresa sem nada configurado continua emitindo em
  homologação exatamente como hoje.
- **Playwright:** o contador de um escritório não alcança empresa de outro.
- **Gate:** `tsc --noEmit` 0 · `vitest` verde · `next build` limpo · migration
  conferida no banco vivo — a partir de `app/`, nunca da raiz.
