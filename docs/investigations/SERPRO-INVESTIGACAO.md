# 🟢 SERPRO — Investigação de Autenticação, Procuração e DAS

> **✅ RESOLVIDO PONTA A PONTA (2026-06-02, rodada 6):** fluxo procurador validado em PRODUÇÃO com
> dados reais. Contratante FIXO (cert PIPER no mTLS) + cliente assina **Termo de Autorização XML**
> (XMLDSig) com o próprio cert → `/Apoiar` → `autenticar_procurador_token` → `/Consultar` retorna os
> dados (DAS 2025 da AL PISCINAS). Assinatura de produção ATIVA (só o Trial falta inscrever). Ver
> Changelog rodada 6 + memória `balu-serpro-procuracao-investigacao`. **Pendente:** virar feature.
>
> **Status original:** investigação iniciada 2026-05-30, revisada 2026-05-30 (rodada 2).
> **Por quê suma prioridade:** o caminho de produção do Serpro tem **uma incógnita estrutural não
> resolvida** (modelo multi-cliente da consumer key) e o código herdado do Bubble/n8 mistura
> sinais de dois modelos de autenticação. Trial não valida nada disso; só produção dirá. Este doc
> é a fonte da verdade sobre o tema e deve ser **atualizado a cada avanço**.
>
> **⚠️ Correção da rodada 1:** na primeira versão afirmei que o código viola o erro
> `ICGERENCIADOR-016` (cert do cliente ≠ contratante). **Isso estava errado.** O FAQ define o erro
> como `cert NI ≠ campo contratante DA REQUISIÇÃO` — e no código os dois são o CNPJ do cliente,
> então **batem**. Rebaixado de ❌ contradição para ❓ lacuna (ver §3.3 e §4).
>
> **Como ler:** ✅ = confirmado por fonte oficial · ⚠️ = inferência sólida (não citação literal) ·
> ❌ = contradição / bloqueio · ❓ = lacuna em aberto.

---

## 0. TL;DR (o essencial)

1. ✅ **DAS-MEI (`PGMEI` / `GERARDASPDF21`) NÃO exige procuração eletrônica.** Só o Simples
   (`PGDAS-D`) exige (código 00146). Fonte: tabela oficial "Serviços × Procuração".
2. ❌ **PGMEI não está "rodando".** O smoke real (2026-05-30) bate **403 `900908`** — o app
   (consumer key) **não está inscrito no produto Integra Contador Trial**. É gap de
   **assinatura**, não de código nem de procuração.
3. ⚠️ **Sinais misturados no código** (não é "quebra certa", é incoerência de modelo): usa o
   **certificado do CLIENTE** + envelope com **CNPJ do cliente nos 3 campos** (sabor `PROPRIO`/
   "cliente é o próprio contratante") MAS declara **`role-type: TERCEIROS`** (sabor software-house)
   e **sem Termo de Autorização**. O `ICGERENCIADOR-016` **NÃO** dispara aqui (cert NI = contratante
   NI = cliente, batem — ver §3.3). O risco real é o `role-type` errado p/ o modelo "self".
4. ❓ **A incógnita que decide produção:** a **consumer key da Balu** (contrato pago) pode coexistir
   com `contratante` = **CNPJ do cliente**? Ou a Serpro também exige consumer key ↔ contratante?
   - Se valida só **cert ↔ contratante** (como o FAQ diz) → modelo atual **pode funcionar** p/ MEI.
   - Se amarra também **consumer key ↔ contratante** → quebra; precisa do modelo procurador.
   A doc pública (FAQ + contratação) **é silenciosa** sobre multi-cliente. **Só chamado Serpro ou
   teste em produção fecha.**

---

## 1. O que a aplicação FAZ hoje (código real, verificado)

Arquivos: `app/src/lib/clients/serpro.ts`, `serpro-auth.ts`,
`src/app/(auth)/impostos/actions.ts`, `src/app/(auth)/configuracoes/actions.ts`.

### 1.1 Autenticação Trial (token OAuth) — `serpro.ts → bearer()`
- `POST https://gateway.apiserpro.serpro.gov.br/token`
- Header `Authorization: Basic base64(SERPRO_CONSUMER_KEY:SERPRO_CONSUMER_SECRET)`,
  body `grant_type=client_credentials`.
- ✅ **Funciona** (smoke: HTTP 200, `access_token` len 1038, `expires_in` 3600).
- Não usa certificado. Cache de token em memória (module-scoped).

### 1.2 Autenticação Produção (mTLS) — `serpro-auth.ts → autenticarProcurador()`
- `POST https://autenticacao.sapi.serpro.gov.br/authenticate`
- mTLS usando **`keyPem` + `certPem` do certificado A1 do CLIENTE** (o que foi subido em
  Configurações). Headers: `Authorization: Basic ...`, **`role-type: TERCEIROS`**,
  `grant_type=client_credentials`.
- Resultado (`jwt_token` + `access_token`) cacheado em
  `empresas_fiscais.certificado_jwt / certificado_access_token / certificado_token_expiration`.
- ⚠️ **Nunca rodou em produção** (ver §4) — só o parser `parseAuthResponse` tem teste unitário.

### 1.3 Emissão do DAS-MEI — `impostos/actions.ts → gerarDasMeiAction()`
- Só MEI: recusa se `empresas_fiscais.Code_regime_tributario !== '4'`
  ("Geração de DAS via Serpro na v1 cobre só MEI; Simples virá depois.").
- `resolveSerproEnv()`: `SERPRO_ENV === 'prod' ? 'prod' : 'trial'` (default **trial**).
- **Trial**: ignora dados reais e usa demo fixo — CNPJ `00000000000100`, período `201901`.
- **Prod**: lê `certificado_access_token`/`_jwt`/`_token_expiration`; se ausente/expirado →
  erro "Produção exige certificado autenticado + procuração...". Senão monta envelope com
  CNPJ real + competência.
- Envelope: `idSistema:'PGMEI'`, `idServico:'GERARDASPDF21'`, `versaoSistema:'1.0'`,
  `dados:{periodoApuracao}`. `buildEnvelope` põe **o mesmo CNPJ** em contratante/autor/contribuinte.
- `serpro.emitirDasMei()` → `parseDasMei()` → upsert em `guias_fiscais`
  (onConflict `company_id,competencia_referencia`) → liga `apuracoes_fiscais.guia_fiscal_id`.

### 1.4 Cadastro do certificado — `configuracoes/actions.ts`
- Upload `.pfx/.p12` + senha → `node-forge` abre, extrai key+cert PEM, valida validade.
- PEM **cifrado** (AES-256-GCM, `CERT_ENC_KEY`) no bucket `company-certificates`;
  **senha original descartada** (`cert_password = null`).
- Grava metadados em `arquivos_auxiliares`: `cert_cnpj` = **CNPJ extraído do certificado do
  cliente**, `cert_subject_cn`, `cert_not_after`, `cert_fingerprint`.
- Best-effort: chama `autenticarProcurador(keyPem, certPem+chainPem)` e cacheia o JWT.

---

## 2. O que veio do BUBBLE / n8n (origem do código)

Arquivos: `docs/n8n/api serpro integra contador.json`, `excluviapainel.bubble`.

- ✅ O n8n original (`autenticacao_mTLS`) faz **exatamente** o que o código novo faz:
  `POST autenticacao.sapi.serpro.gov.br/authenticate`, mTLS com o **PFX do cliente**
  (+ `cert_password` da tabela auxiliar), header **`role-type: TERCEIROS`**.
  → O `TERCEIROS` foi **copiado verbatim do n8n**, sem ninguém modelar a parte de autorização.
- ✅ O envelope Serpro no Bubble usava **o MESMO CNPJ nos três campos**
  (`contratante` = `autorPedidoDados` = `contribuinte` = `61061690000183`).
- ❌ **Não existe NADA sobre gerar/cadastrar procuração** em nenhuma camada (Bubble, n8n,
  Next, PRD, specs). Busca exaustiva por: procuração, procurador, e-CAC, outorga, Termo de
  Autorização → **zero** resultados de implementação. Só o nome da função `autenticarProcurador`
  (que é o login mTLS, não emissão de procuração) e o `role-type: TERCEIROS` hardcoded.
- ⚠️ Forte indício de que **a emissão NUNCA rodou em produção** — bate com a memória
  `balu-focus-cert-registration-gap` ("emissão só foi homologação").

---

## 3. O que a DOC OFICIAL da Serpro diz (com fontes)

### 3.1 Tabela "Serviços × Procuração" — a peça decisiva
Cabeçalho: `SOLUÇÃO | idSistema | idServico | Cód. Procuração | Nome do Serviço`

| Solução | idServico | Procuração? |
|---|---|---|
| ✅ **PGMEI — Gerar DAS** | `GERARDASPDF21` | **NÃO** (`n/a`) |
| ✅ PGMEI — demais (cód. barras, benefício, dívida ativa) | ... | **NÃO** (`n/a`) |
| ❌ PGDAS-D — Transmitir declaração | `TRANSDECLARACAO11` | **SIM** — cód. `00146` |
| ❌ PGDAS-D — Gerar DAS | `GERARDAS12` | **SIM** — cód. `00146` |

→ **DAS-MEI é liberado de procuração. Simples (PGDAS-D) exige procuração 00146.**

### 3.2 Papéis de autenticação (role-type) — CONFIRMADO (rodada 3)
Papéis: **Contratante / Autor do Pedido de Dados / Contribuinte / Procurador**.
- **Contratante**: dono da consumer key. **Autor do Pedido**: quem assina/autoriza.
  **Contribuinte**: dono dos dados (o cliente MEI).

Os **3 valores de `role-type`** e o que cada um exige:
| `role-type` | Quem autentica | Certificado e-CNPJ | Autorização extra |
|---|---|---|---|
| ✅ **PRÓPRIO** | o contribuinte por si | **do contribuinte** | nenhuma |
| ✅ **PROCURADOR** | escritório c/ procuração | do escritório (ou contribuinte) | **procuração e-CAC** |
| ✅ **TERCEIROS** | **software-house** | **da própria software-house** | **Termo de Autorização XML** |

### 3.2-bis A REGRA-MÃE (texto literal) — o que dispara procuração
> *"Existem serviços que exigem a procuração eletrônica **quando o autor do pedido de dados não é
> o próprio contribuinte**."*

→ A exigência **não é do serviço**, é da relação de papéis:
- `autorPedidoDados == contribuinte` → **PRÓPRIO** → **sem procuração**.
- `autorPedidoDados != contribuinte` → procurador/terceiro → **procuração/termo**.

**Consequência:** o código da Balu (`contratante=autor=contribuinte=CNPJ do cliente`, cert do
cliente) **JÁ É o modelo PRÓPRIO** → dispensa procuração por definição. O único erro que sobra é o
`role-type: TERCEIROS` hardcoded (deveria ser o de contribuinte/PRÓPRIO). Ver §4.

### 3.3 Regra do certificado — definição PRECISA (corrige a rodada 1)
- ✅ FAQ (literal): *"403 `[AcessoNegado-ICGERENCIADOR-016]` indica uma inconsistência entre o
  **NI do Contratante informado na requisição** e o **NI extraído do certificado digital**"* +
  *"O NI extraído do certificado deve coincidir com o informado na requisição."*
  → A regra é **cert NI == campo `contratante` do envelope**. **NÃO** é "cert == consumer key"
  nem "cert == contribuinte". **Isto é o que invalida a contradição da rodada 1.**
- ⚠️ Buscas anteriores sugeriam *"e-CNPJ do próprio Contratante da API"* e *"o mesmo certificado da
  contratação"* — mas o FAQ-fonte só amarra cert↔contratante-da-requisição. Se a Serpro **também**
  exige cert/contratante == consumer-key-holder, isso **não foi confirmado** (lacuna §4/§7).
- ✅ Software-house: *"deve usar seu próprio e-CNPJ para autenticação junto com um Termo de
  Autorização assinado eletronicamente por um procurador (ex. escritórios de contabilidade)"*.

### 3.4-bis Cenário de procuração (exemplo oficial Trial) — papéis DIFERENTES
- `idSistema:"PROCURACOES"`, `idServico:"OBTERPROCURACAO41"`.
- `contratante` = `autorPedidoDados` = `99999999999999` (PJ, o escritório) **≠**
  `contribuinte` = `99999999999` (PF, o cliente). → modelo "procurador de terceiros":
  **contratante ≠ contribuinte**. O código da Balu faz o oposto (3 iguais) = modelo "self".

### 3.4 Termo de Autorização (modelo software-house / TERCEIROS)
- XML assinado digitalmente (XMLDSig W3C) pelo **Autor do Pedido**, autorizando o **Contratante**
  a enviar requisições em seu nome. Vira base64 → token via serviço auxiliar
  (`autenticar_procurador_token`), válido até a meia-noite do dia seguinte (Brasília).
- É **diferente** de procuração e-CAC (esta é ato do contribuinte no portal e-CAC).

### 3.5 Consumer key — modelo multi-cliente — ✅ RESOLVIDO (rodada 4)
A doc oficial é silenciosa, mas **3 fontes práticas independentes** convergem:
- **Lib Dart oficial** (`serpro_integra_contador_api`, pub.dev): autentica **1×** (consumer key +
  cert) e passa o **contribuinte por requisição**. `contratanteNumero`/`contribuinteNumero` são
  params por chamada → "sistemas que atendem múltiplos clientes". Suporta `authenticateWithProcurador`
  (OAuth2 + Termo XML RSA-SHA256).
- **Alterdata** (ERP contábil), literal: *"o escritório realiza **uma única contratação** que atende
  todos os clientes"*; cobrança **por consumo**: *"para cada declaração transmitida será tarifado o
  valor de 0,90 centavos"*; *"o certificado utilizado pode ser **do escritório contábil OU da própria
  empresa contribuinte**"*; *"é necessário que este escritório possua uma **'Procuração' digital do
  contribuinte**"* para entregar em nome dele.
- **Calima**: confirma modelo **por consumo** (faixas), cert vinculado ao contratante, procuração
  e-CAC por cliente.

→ **VEREDITO: 1 consumer key da Balu atende N clientes.** Modelo de mercado = **1 contratante
(escritório) → muitos contribuintes**, cobrado **por requisição** (~R$0,90/declaração de ref.).
A incógnita-chave está **resolvida** quanto ao multi-cliente.

---

## 4. INCOERÊNCIAS código vs doc (rebaixadas após rodada 2)

O código implementa, de fato, o modelo **"self"** (cliente é o próprio contratante): cert do cliente
+ `contratante`/`autor`/`contribuinte` todos = CNPJ do cliente. Isso é **internamente consistente**
e **não** dispara `ICGERENCIADOR-016` (cert NI == contratante NI). As incoerências restantes:

| Dimensão | Código faz | Observação | Veredito |
|---|---|---|---|
| `cert NI` vs `contratante` | ambos = CNPJ do cliente | regra do FAQ satisfeita | ✅ OK (não é bug) |
| `role-type` | `TERCEIROS` hardcoded | modelo "self" pediria valor de contribuinte, não TERCEIROS | ⚠️ provável mismatch |
| Termo de Autorização | ausente | só necessário SE for usar TERCEIROS de verdade | ⚠️ depende do modelo |
| Consumer key (Balu) vs `contratante` (cliente) | divergem | a Serpro tolera? **não sabemos** | ❓ **incógnita-chave** |

**Resumo:** não há "quebra certa" comprovada. Há (a) um `role-type: TERCEIROS` que **não casa** com o
modelo PRÓPRIO que o resto do código implementa (deveria ser o role-type de contribuinte) — esse é o
provável ponto de falha da auth de produção, e é **correção de 1 string**; e (b) a **incógnita-chave**
(§3.5): a Serpro tolera 1 consumer key (Balu) emitindo em modo PRÓPRIO para N contribuintes distintos?

⚠️ **Hipótese (rodada 3, inferência — não citação):** a existência do role-type `TERCEIROS`
("software-house atende terceiros") sugere que o caminho oficial p/ SaaS multi-cliente é **TERCEIROS
(Termo XML)** ou **PROCURADOR (procuração e-CAC)**, não PRÓPRIO replicado com cert de cada cliente. O
modelo atual deve funcionar p/ **1 CNPJ piloto**, mas pode não ser o desenho esperado p/ escala.

✅ **Rodada 4 CONFIRMA a hipótese acima.** Mercado (Alterdata/Calima/lib Dart) usa o modelo
**procurador**: `contratante` = **CNPJ do escritório FIXO** (cert do escritório), `contribuinte` =
cliente (varia), **+ procuração e-CAC por cliente**. O código da Balu faz o OPOSTO (contratante =
cliente, cert do cliente, sem procuração). Comparativo:

| Dimensão | Modelo de mercado (validado) | Código Balu hoje |
|---|---|---|
| Contratação | 1 do escritório p/ todos | Balu tem 1 ✅ |
| `contratante` no envelope | **CNPJ do escritório (fixo)** | CNPJ do **cliente** ❌ |
| `contribuinte` | cliente (varia) | cliente ✅ |
| Cert no mTLS | do escritório (ou do cliente) | do cliente |
| Autorização | **procuração e-CAC por cliente** | nenhuma ❌ |

**Reviravolta sobre procuração (matiza a rodada 3):** "código é PRÓPRIO → sem procuração" é verdade
SÓ para o modelo PRÓPRIO. Mas o modelo de mercado (Balu=contratante, cliente=contribuinte,
`autorPedidoDados != contribuinte`) **reentra na regra-mãe (§3.2-bis) e PEDE procuração** — inclusive
p/ MEI. Há **tensão não resolvida** entre a tabela Serviços×Procuração (MEI `n/a`) e a regra-mãe
(papéis diferentes exigem procuração). ❓ Qual prevalece p/ DAS-MEI emitido por terceiro → **pergunta
direta p/ Serpro**.

---

## 5. Os caminhos possíveis para PRODUÇÃO (decisão de arquitetura pendente)

> Esta é decisão de **produto/operação** — não dá pra cravar via código. Define o onboarding.
> Vale **só para PGDAS-D/Simples** e para o modelo de cert; **o DAS-MEI não precisa de procuração**
> (§3.1), mas ainda precisa resolver "qual cert no mTLS / quem é o contratante".

- **PROCURADOR** — Balu usa **1 cert (o dela)**; cada cliente cria **procuração e-CAC** (manual,
  no portal Receita) outorgando ao CNPJ da Balu. Modelo clássico de escritório. Exigido p/ Simples.
- **TERCEIROS (software-house)** — Balu usa **1 cert (o dela)** + coleta **Termo de Autorização
  XML assinado** de cada cliente (dá pra fluir no app). É o `role-type` que o código já manda,
  mas falta implementar o Termo.
- **PROPRIO (por cliente)** — cert do cliente (como hoje), mas exigiria **uma consumer key /
  assinatura Serpro por cliente** (cert tem que casar com o contratante). ⚠️ inviável p/ SaaS
  multi-cliente sob uma assinatura só. **Inferência** (não citação literal) — confirmar.

---

## 6. Estado por trilha

| Trilha | Código | Token | Assinatura produto | Procuração | mTLS prod | Veredito |
|---|---|---|---|---|---|---|
| **PGMEI / DAS-MEI** | ✅ | ✅ 200 | ❌ 403 900908 (falta Trial) | ✅ não exige | ⚠️ contradição cert | **falta assinar Trial; modelo cert a confirmar** |
| **PGDAS-D / Simples** | ❌ não implementado | ✅ | ❌ | ❌ exige 00146 | ⚠️ | **spec próprio; 2 passos; procuração** |

---

## 7. ❓ Lacunas em aberto (próximos passos da investigação)

- [x] ~~`ICGERENCIADOR-016` quebra o código?~~ **NÃO** — regra é cert↔contratante-da-requisição, e
      ambos são o CNPJ do cliente. (rodada 2)
- [x] ~~**(PRIORIDADE 1)** Incógnita-chave multi-cliente~~ **RESOLVIDO (rodada 4):** 1 consumer key
      atende N clientes; modelo de mercado = contratante(escritório) fixo + contribuinte por
      requisição + procuração e-CAC por cliente; cobrança por consumo (~R$0,90/decl). Ver §3.5/§4.
- [ ] **(PRIORIDADE 1 nova)** Resolver a **tensão tabela vs regra-mãe** p/ DAS-MEI emitido por
      terceiro (Balu=contratante≠contribuinte): a tabela diz MEI `n/a` (sem procuração), mas a
      regra-mãe diz que `autorPedidoDados != contribuinte` exige procuração. **Pergunta direta p/
      Serpro** (ou teste no Trial c/ contratante≠contribuinte).
- [ ] **DECISÃO DE PRODUTO:** adotar modelo **procurador** (mercado: Balu=contratante fixo, 1 cert da
      Balu, procuração e-CAC por cliente) OU manter **self** (cert por cliente). Mercado e lib Dart
      apontam fortemente p/ procurador. Isso **redesenha** o onboarding (hoje cada cliente sobe cert).
- [x] ~~Confirmar os 3 valores de `role-type`~~ **FEITO** (rodada 3): PRÓPRIO/PROCURADOR/TERCEIROS
      mapeados (§3.2). Regra-mãe: procuração só quando `autorPedidoDados != contribuinte` (§3.2-bis).
- [ ] **(PRIORIDADE 2)** Corrigir o `role-type` no código: hoje `TERCEIROS` hardcoded em
      `serpro-auth.ts`; no modelo PRÓPRIO deveria ser o valor de contribuinte. Confirmar a string
      exata aceita (a doc nomeia "PRÓPRIO" mas o valor literal do header precisa ser verificado).
- [x] ~~Após assinar o Trial: re-rodar o smoke e confirmar 200 no `/Emitir`.~~ **DESCARTADO (rodada 7):**
      o fluxo procurador (XML) também bate `900908` no Trial (`test-serpro-procurador-trial.mjs`) — é
      bloqueio de **subscription do produto**, não da operação. Trial é beco sem saída p/ essa consumer
      key; produção já valida o fluxo (rodada 6). Não vale assinar/insistir no Trial.
- [ ] Decidir arquitetura de produção (§5) e **alinhar `role-type` + envelope** ao modelo escolhido.
      Se ficar "self": trocar `TERCEIROS` pelo role-type de contribuinte. Se "procurador": cert da
      Balu + procuração/Termo + contratante≠contribuinte.

---

## 8. Fontes (doc oficial Serpro — Integra Contador)

- Índice: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
- Serviços × Procuração: `.../pt/servicos_vs_procuracoes/`
- Como autenticar (Quick Start): `.../pt/quick_start/`
- Autentica Procurador: `.../pt/solucoes/integra-contador-gerenciador/autenticaprocurador/`
- FAQ (erro ICGERENCIADOR-016): `.../pt/faq/`
- PGMEI Gerar DAS: `.../pt/solucoes/integra-mei/pgmei/servicos/gerar_das/`
- PGDAS-D: `.../pt/solucoes/integra-sn/pgdasd/`
- Cenários Procurações: `.../pt/cenarios_trial/cenarios_procuracoes/`

## 9. Evidência do smoke (2026-05-30) — teste reforçado p/ confirmar assinatura do cliente

Script: `app/scripts/serpro-smoke.mjs` (não imprime segredos; rodado ao vivo 2×).

```
[1] POST /token                              → 200  access_token OK (len 1038), expires_in 3600, scope default
[2] POST .../integra-contador-trial/v1/Emitir    (PGMEI GERARDASPDF21, CNPJ demo 00000000000100, 201901)
                                             → 403  {"code":"900908", "API Subscription validation failed"}
[3] POST .../integra-contador-trial/v1/Consultar (mesma envelope)
                                             → 403  {"code":"900908", idem}
```

**Por que o teste é conclusivo (3 hipóteses separadas):**
| Hipótese | Veredito do teste |
|---|---|
| Credenciais erradas / app inexistente | ❌ descartada — `/token` deu **200** (token válido, 1038 chars) |
| Bug de código / certificado | ❌ descartada — Trial nem usa cert; o token chega à API |
| **App não inscrita no produto** | ✅ **confirmada** — `900908` em **DUAS rotas** (`/Emitir` + `/Consultar`) do mesmo produto, com token válido |

→ As duas rotas baterem o **mesmo** `900908` prova que o bloqueio é **no nível do produto/assinatura**,
não da operação. Em linguagem do portal: a consumer key autentica mas **não tem subscription ativa no
Integra Contador**.

**⚠️ O que o teste prova vs não prova (p/ decidir cobrar o cliente):**
- ✅ **Prova:** essa consumer key **NÃO tem o produto Integra Contador ativo hoje**.
- ❓ **Não distingue o porquê:** (a) nunca assinou · (b) assinou mas inadimplente/suspenso ·
  (c) assinou o produto errado · (d) assinou em outra app/consumer-key (≠ da que está no `.env.local`).
- Decodificar o JWT p/ listar produtos assinados **não ajudou**: token Trial só traz `scope: default`,
  não expõe a lista de subscriptions.

**Ação recomendada (lado do cliente):** verificar no `loja.serpro.gov.br`, na **mesma aplicação**
cuja consumer key está no `.env.local` (28 chars), se o produto **Integra Contador** consta como
**assinado e ativo**. Ao ativar → re-rodar o script e esperar `200` no `/Emitir`.

---

## Changelog
- **2026-05-30 (rodada 1)** — Criação. Smoke (403 900908), tabela Serviços×Procuração (DAS-MEI sem
  procuração; Simples exige 00146), mapeamento código↔doc, origem Bubble/n8n do `TERCEIROS`.
- **2026-05-30 (rodada 2)** — **Correção importante:** FAQ define `ICGERENCIADOR-016` como
  cert↔`contratante`-da-requisição (não cert↔consumer-key) → a "contradição que quebra produção" da
  rodada 1 estava **errada**; o código é consistente p/ modelo "self" e o erro **não** dispara.
  Rebaixado ❌→❓. Confirmado: código = modelo "self" (3 CNPJs iguais, cert do cliente); exemplo
  oficial de procuração usa contratante≠contribuinte (modelo procurador). Contratação e FAQ
  **silenciosos** sobre multi-cliente → eleito **incógnita-chave**. `servicos_vs_procuracoes` deu
  HTTP 500. Lacuna nova: enumerar valores de role-type (só TERCEIROS confirmado).
- **2026-05-30 (rodada 3)** — Fechadas 2 lacunas: (a) os **3 role-types** mapeados
  (PRÓPRIO/PROCURADOR/TERCEIROS, §3.2); (b) **regra-mãe** literal: procuração só quando
  `autorPedidoDados != contribuinte` (§3.2-bis). **Conclusão:** o código já é **PRÓPRIO** → dispensa
  procuração; único erro real = `role-type: TERCEIROS` hardcoded (deveria ser contribuinte). Incógnita
  multi-cliente persiste + hipótese de que SaaS-escala pede TERCEIROS/PROCURADOR, não PRÓPRIO.
- **2026-05-30 (rodada 4)** — **Incógnita-chave RESOLVIDA** via 3 fontes práticas (lib Dart Serpro,
  Alterdata, Calima): **1 consumer key atende N clientes**; modelo de mercado = contratante(escritório)
  fixo + contribuinte por requisição + **procuração e-CAC por cliente**; cobrança **por consumo**
  (~R$0,90/decl). **Confirma a hipótese da rodada 3** e **matiza** a conclusão "PRÓPRIO dispensa
  procuração": o modelo de mercado (Balu=contratante≠contribuinte) **reentra na regra-mãe e pede
  procuração até p/ MEI** → tensão tabela×regra-mãe a confirmar com Serpro. Vira **decisão de produto**
  (procurador vs self) que redesenha o onboarding de certificado.
- **2026-05-30 (rodada 5)** — Smoke **reforçado** (2 rotas + decode de JWT) p/ confirmar, antes de
  cobrar o cliente, que o 403 é assinatura e não código/cert. Resultado conclusivo: `/token` 200 +
  `900908` em `/Emitir` **e** `/Consultar` → app autentica mas **sem subscription ativa** no produto.
  Prova que a consumer key não tem o produto ativo hoje; **não** distingue o motivo (nunca assinou /
  inadimplente / produto errado / outra app). Ver §9.
- **2026-06-03 (rodada 7)** — ❌ **Fluxo procurador (XML) NÃO passa no Trial — fecha a lacuna.** Variante
  `app/scripts/test-serpro-procurador-trial.mjs` (mesmo fluxo da rodada 6, mas operações em
  `integra-contador-trial/v1/...`): `/authenticate` mTLS PIPER → **200**; Termo XML montado + assinado
  (5531 chars, `<Signature>` presente) → **OK**; `POST /Apoiar` (trial) → **403 `900908`** (mesmo erro do
  smoke de DAS antigo). **Prova:** o `900908` é bloqueio de **assinatura do produto** (a consumer key não
  tem o *Integra Contador Trial* ativo) e dispara **antes** da operação — o XML/Termo chega ao gateway mas
  é barrado na camada de subscription. **Não** é bug de código/cert/XML. **Consequência:** Trial é beco sem
  saída p/ essa consumer key; o caminho validado é **produção** (rodada 6). Próximo passo real = virar o
  procurador de produção em feature, não insistir no Trial.
- **2026-06-02 (rodada 6)** — ✅✅ **RESOLVIDO PONTA A PONTA EM PRODUÇÃO.** Com o cert do **contratante
  (PIPER, 61061690000183)** + cert do **cliente (AL PISCINAS, 10358425000120)**:
  (1) mTLS PIPER → `/authenticate` 200; (2) `/Consultar` direto deu 403 `ICGERENCIADOR-022` (sem
  procuração eCAC) — **mas NÃO 900908: a assinatura de PRODUÇÃO está ATIVA** (só o Trial segue sem);
  (3) implementado o **fluxo procurador via Termo de Autorização**: XML oficial assinado (XMLDSig
  RSA-SHA256, c14n 1.0, cert do CLIENTE, lib `xml-crypto`) → POST `/Apoiar`
  (`AUTENTICAPROCURADOR/ENVIOXMLASSINADO81`, **envelope completo** contratante=PIPER/autor+contribuinte=cliente,
  `dados={"xml":<b64>}`) → 200 + `autenticar_procurador_token` → `/Consultar` (PGDASD/CONSDECLARACAO13)
  com header `autenticar_procurador_token` → **200, DAS reais 2025 da AL PISCINAS**. **Resolve a tensão
  da rodada 4:** o Termo XML assinado pelo cliente é a alternativa à procuração eCAC manual; modelo =
  contratante FIXO + Termo (ou procuração eCAC) por cliente. Spike: `app/scripts/test-serpro-procurador-al-piscinas.mjs`
  e `…-consulta-prod-al-piscinas.mjs`. **Falta:** virar feature (redesenhar `serpro-auth.ts`/`serpro.ts`
  + cachear token por cliente + onboarding do cert do contratante).
