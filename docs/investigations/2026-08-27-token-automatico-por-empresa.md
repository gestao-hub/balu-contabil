# Token automático por empresa — o que falta

**Data:** 27/08/2026 · **Pedido:** toda empresa que se cadastrar gera o próprio
token de emissão, sem o cliente trazer contrato com a Focus e sem ninguém do
Balu gerar token à mão.

---

## Conclusão, antes das evidências

**A função pedida já está escrita e já roda sozinha.** Não é construir — é
destravar. O gerador automático dispara em todo cadastro de empresa, nos dois
caminhos (dono e contador), sem contrato do cliente com a Focus e sem gesto de
admin nenhum.

O que impede a promessa de valer são **três travas**. Só uma delas é a Focus. As
outras duas são nossas — e uma é um **impasse circular** que trava produção para
100% das empresas do caminho automático e continuaria travado mesmo com o token
certo em mãos.

---

## 1. O gerador automático que já existe

| # | Etapa | Onde |
|---|---|---|
| 1 | Empresa é criada (dono ou contador) | `onboarding/actions.ts:124` → `posProcessarNovaEmpresa` |
| 2 | `POST /v2/empresas` na conta da **Balu** | `focus-empresa-sync.ts:115` |
| 3 | Focus devolve `token_producao` + `token_homologacao` | `FocusEmpresaCriada` |
| 4 | Os dois tokens são cifrados e guardados | `empresa_credenciais_focus` (0096/0097) |
| 5 | Snapshot preenche `focus_habilita_*` | `snapshotFocusEmpresa` |
| 6 | Cliente sobe o A1 → espelhado na Focus | `cert-upload.ts:171` |

Confira o que isso já entrega do pedido:

- **Sem contrato do cliente com a Focus** — a conta é a da Balu. O modelo de
  revenda é exatamente isso: uma conta, N empresas, um token por empresa.
- **Sem admin gerando token** — ninguém clica em nada. O POST sai do
  pós-processamento do cadastro.
- **Token por empresa** — cada uma recebe o par hom/prod que é só dela.

O desenho está certo. O problema é que ele não chega ao fim.

## 2. Trava 1 — o token da conta é da classe errada

Levantado em `2026-08-27-emissao-para-toda-empresa.md`. Em resumo:

```
GET /v2/nfsen /nfse /nfe /nfce  -> 404   token ACEITO (recurso inexistente)
GET /v2/empresas                -> 401   token RECUSADO
POST /v2/empresas?dry_run=1     -> 401   recusado antes de olhar o corpo
```

O token configurado é aceito pela API de **emissão** e recusado pela API de
**Empresas** — a assinatura de um token *revendido*, não de um token de
*revenda*. Sem o token de revenda, a **etapa 2** morre e as quatro seguintes nem
começam.

**Fora do código.** Painel da Focus, `Serviços > Painel API > Tokens`.

## 3. 🔴 Trava 2 — o impasse circular da produção (ACHADO NOVO)

Mesmo com o token de revenda certo, toda empresa nasce em **homologação** e
**não existe caminho para produção**. É um ciclo fechado, sem porta de entrada:

```
  ┌─> focus_ambiente = 'prod'
  │      só `definirModoFiscalAction` grava (focus-actions.ts:217),
  │      e ela pré-valida com `decidirCredencial`, que exige…
  │
  ├─> focus_habilita_nfsen_producao = true
  │      resolver-credencial.ts:84 — `producao_nao_habilitada`.
  │      Só `snapshotFocusEmpresa` preenche, lendo da Focus, que só
  │      devolve true se antes tiver recebido…
  │
  ├─> PUT habilita_nfsen_producao: true
  │      decidirFlagsNfse (focus-empresa-update-payload.ts:93) só monta
  │      esse campo quando env === 'prod', e env sai de…
  │
  └─── focus_ambiente  ⟲  volta ao topo
```

Cada elo é uma decisão defensável isolada. Juntos, fecham o círculo.

**Três fatos que fecham o diagnóstico:**

1. `empresas_fiscais.focus_ambiente` nasce `'hom'` — `NOT NULL DEFAULT 'hom'`
   (migration `0096`, linha 19). Toda empresa, sem exceção.
2. O payload de **criação** (`focus-empresa-payload.ts`) não tem nenhum campo
   `habilita_*`. A habilitação só existe no PUT.
3. `definirModoFiscalAction` é o **único** escritor de `focus_ambiente` no
   produto inteiro — e vive só no painel do contador, atrás de
   `companyDaCarteira`. **Empresa que se cadastra sem contador não tem nem o
   botão manual.**

Medido no banco de produção, hoje — as quatro empresas:

```
focus_ambiente:                  hom, hom, hom, hom
focus_habilita_nfsen_producao:   null, null, null, null
```

O único caminho que hoje escapa do ciclo é origem `'propria'`, onde
`focus_producao_declarada` — uma declaração humana — substitui a confirmação da
Focus (`resolver-credencial.ts:82`). Ou seja: **a saída existente é justamente a
burocracia manual que o pedido quer eliminar.**

### O conserto

Inverter a ordem: **pedir a habilitação antes de exigir a confirmação.** O
caminho de ligar produção passa a ser:

1. `PUT` na Focus com `habilita_nfsen_producao: true` — `atualizarEmpresaNaFocus`
   **já aceita `env` explícito** (`focus-empresa-sync.ts:267`); hoje só scripts
   de smoke usam.
2. Reler o snapshot (`snapshotFocusEmpresa` já roda pós-PUT).
3. Só então gravar `focus_ambiente = 'prod'`, com `decidirCredencial` como
   guarda final — sem afrouxar nada.

E, para ser automático de verdade, disparar isso sozinho quando as
pré-condições existirem: empresa cadastrada na Focus + certificado A1 válido.
O gesto do cliente vira o upload do certificado; o resto o sistema faz.

**Esforço: pequeno e cirúrgico.** Nenhuma guarda de segurança muda — muda a
ordem em que elas são consultadas.

## 4. Trava 3 — o seletor de tipos discorda do validador

`listarTiposEmissaoAction` (`notas_fiscais/actions.ts:1131`):

```ts
nfse: fiscal?.focus_habilita_nfse === true
   || fiscal?.focus_habilita_nfsen_homologacao === true,
```

Dois defeitos na mesma linha:

- Lê a flag de **homologação** e nunca a de produção. Empresa habilitada em
  produção — o alvo do produto — some do seletor.
- Para origem `'propria'`, `focus_habilita_*` fica `NULL` para sempre, porque o
  snapshot **recusa rodar** nesse caminho (`focus-empresa-sync.ts:62`).

E `prepararEmissaoAction('nfse')` — o validador de verdade — **não gateia em
nenhuma dessas colunas**. Os dois portões respondem diferente à mesma pergunta,
e o do seletor usa um sinal que, em metade dos casos, não pode existir.

## 5. O que continua sendo do cliente — e é pouco

Depois das três travas, sobra **um** gesto por empresa, e é do próprio cliente,
na tela dele:

- **Certificado A1.** Obrigatório para emitir em produção — é exigência legal, não
  burocracia nossa. A guarda `certificado_invalido` existe por isso. O upload já
  é self-service e já espelha na Focus no mesmo PUT (`cert-upload.ts:171`), com a
  senha do PFX descartada em seguida.
- **Inscrição municipal / credenciais da prefeitura**, só em municípios legados
  fora da NFS-e Nacional. O campo já existe (`withCredenciaisPrefeitura`).

Nada disso pede contrato com a Focus, e nada disso passa por um admin do Balu.

### Simplificação disponível

`POST /v2/empresas` aceita `arquivo_certificado_base64` + `senha_certificado` na
**mesma chamada** e já devolve `certificado_valido_ate`. Se o A1 for pedido no
cadastro, o fluxo inteiro vira uma requisição só. Melhoria, não bloqueio.

## 6. O que falta para "automático" resistir ao mundo real

O gerador é *best-effort* — por decisão consciente, para nunca derrubar um
cadastro. O efeito colateral é que ele falha em silêncio:

- **Não há retry.** POST falhou → `focus_status = 'erro'` e fica lá. Os crons da
  Vercel são só `honorarios-recorrentes` e `obrigacoes`; nenhum reprocessa Focus.
  A única retentativa é um botão em `/configuracoes`. Focus fora do ar no minuto
  do cadastro = empresa sem token, e ninguém é avisado.
- **Não há recuperação de token.** Os tokens só existem na resposta do POST. Se a
  gravação cifrada falhar — o código trata como erro, corretamente
  (`focus-empresa-sync.ts:146`) — a empresa **já existe na Focus** e o token se
  perdeu. O retry vai bater em "CNPJ já cadastrado" para sempre. Falta um caminho
  de reconciliação por CNPJ.
- **Idempotência é emprestada.** `syncEmpresaNaFocus` não checa `focus_empresa_id`
  antes do POST; quem impede a duplicata é o erro da própria Focus.

Nada disso aparece hoje porque a etapa 2 nunca passou. No dia em que passar,
aparece — e a hora de resolver é antes de ter cliente pagando.

## 7. Pergunta em aberto — custo

Cadastrar **toda** empresa na Focus no instante do signup inclui trials que nunca
vão emitir uma nota. Se a Focus cobra por empresa cadastrada, isso vira custo
proporcional a cadastros, não a receita.

**A confirmar com a Focus antes de escalar.** Se houver cobrança por empresa, a
correção é barata: mover o POST do cadastro para o primeiro gesto fiscal real
(upload do A1), sem mudar nada do resto — continua automático, só dispara mais
tarde.

## 8. Plano

| # | Passo | Onde | Esforço |
|---|---|---|---|
| 1 | Obter o token de **revenda** no painel | Focus (fora do código) | minutos |
| 2 | Quebrar o impasse circular da produção | `focus-actions.ts` + `focus-empresa-sync.ts` | pequeno |
| 3 | Alinhar o seletor ao validador | `notas_fiscais/actions.ts:1131` | pequeno |
| 4 | Retry + reconciliação por CNPJ | cron novo + `focus-empresa-sync.ts` | médio |
| 5 | Confirmar o modelo de cobrança | Focus (fora do código) | uma pergunta |

Os passos **2 e 3 não dependem da Focus** e podem ser feitos hoje. O passo 1 é o
que destrava tudo, mas sozinho não basta: sem o passo 2, o token novo cadastra as
empresas e elas continuam paradas em homologação.

## 9. Ferramenta que fica

`app/scratchpad/_focus-dryrun-empresas.mjs` — testa o cadastro com `dry_run=1`,
**sem criar nada**. No minuto em que houver token novo, ele diz se destravou.
