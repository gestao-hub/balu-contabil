# Spec — Bloco 4: Billing Asaas

> **Data:** 2026-07-27 · **Status:** aprovada (design) · **Bloco:** 4 de 7 do `PRD-MASTER-Balu-2026-07-24.md`
> **Pré-requisito de leitura:** §3 (princípios anti-bug) e §4 Bloco 4 do Master PRD; spec do Bloco 1 (motor de notificações), reusado aqui; Bloco E (padrão de webhook e de gate de escrita).
> **Natureza:** 🟢 buildável agora contra o **sandbox** do Asaas (self-service, não depende de terceiro). A virada para produção é uma env var.
> **Base factual:** auditoria do código real em 2026-07-27 (migrations até `0049`, `src/`). Todo seam citado é arquivo real, com linha conferida.

---

## 1. Objetivo

Dar à Balu o que ela ainda não tem: **cobrança**. Assinatura recorrente via Asaas, com um gate de acesso que pressiona o inadimplente **sem nunca reter dado do titular e sem nunca causar dano fiscal a ele**.

Hoje não existe uma linha de código de billing. O que existe são duas colunas-gancho, `honorarios.asaas_charge_id` e `honorarios.asaas_customer_id` (`0032:9-10`), criadas no Bloco A e **nunca lidas nem escritas** em TypeScript.

### 1.1 Fronteira inegociável — o gate nunca causa multa

O app tem dois tipos de escrita, e tratá-los igual é o erro central que esta spec existe para evitar:

- **Escrita comercial** — emitir uma nota, criar um cliente, abrir uma empresa. Adiar isso custa negócio ao usuário. É pressão legítima de cobrança.
- **Escrita de obrigação legal com prazo** — gerar a guia do DAS, registrar o comprovante da DASN/DEFIS, transmitir PGDAS-D. Adiar isso custa **multa da Receita e irregularidade fiscal**.

Bloquear a segunda para cobrar uma dívida com a Balu transfere ao usuário uma penalidade de terceiro, desproporcional ao valor devido, num serviço que ele contratou justamente para não ter esse risco. Além do dano ao usuário, expõe a Balu pelo CDC art. 39.

**Decisão de produto nº 1: o gate nunca alcança ação de obrigação legal.** Vale mesmo com a assinatura vencida há meses. A alavanca de cobrança é o bloqueio comercial, que já dói o suficiente.

## 2. Escopo

**Dentro:**
- Migration `0050` — tabelas `planos`, `assinaturas`, `cobrancas`; assinaturas de cortesia para as contas que já existem; ampliação do CHECK de `notifications.tipo`.
- Cliente `src/lib/clients/asaas.ts` (sandbox ↔ produção por env).
- Webhook `src/app/api/webhooks/asaas/route.ts` + extração do módulo de segredo hoje acoplado à Focus.
- Módulo `src/lib/billing/` — status efetivo, resolução de titular, faixa de plano, tradução dos eventos do Asaas.
- Gate de escrita em duas portas (`assertAssinaturaEmpresa`, `assertAssinaturaEscritorio`), aplicado às actions comerciais.
- Reconciliação diária + recálculo mensal da faixa do escritório.
- Telas de assinatura (empresário autosserviço e escritório), faixa de aviso, e avisos de cobrança pelo motor do Bloco 1.

**Fora, de propósito:**
- **Honorários do escritório ao cliente dele.** Ver §3.1 — decisão registrada, com motivo.
- **Split de pagamento e subconta Asaas por escritório.** Consequência da anterior.
- Armazenar PAN/cartão. O Asaas guarda; a Balu guarda id e token, nunca o número.
- **Cobrança avulsa** (ex.: cobrar pela abertura de uma empresa). O Michel pediu na q1.3 da devolutiva, mas ela **não é assinatura** — não tem ciclo nem faixa, e não cabe em `planos` sem desfigurar a tabela. Sem piloto real não há como definir quando dispara nem quanto custa. Fica como follow-up nomeado (§11, premissa 6), não meio-implementada.
- Nota fiscal da própria Balu sobre a assinatura. É emissão da Balu para o cliente dela, não do produto.

## 3. Decisões de produto

### 3.1 Os honorários ficam de fora — e por quê

O PRD Master manda "plugar nos honorários recorrentes" (`PRD-MASTER:229`) e, na mesma seção, põe **"split de pagamento" fora de escopo** (`PRD-MASTER:231`). Os dois não fecham: o honorário é **o escritório cobrando o cliente dele**, dinheiro que não é da Balu. Sem subconta, ele cairia na conta Asaas da Balu, que passaria a intermediar dinheiro de terceiro — repasse manual, exposição regulatória e contábil.

Levantamento dos documentos, feito antes de decidir:

| Fonte | O que diz |
|---|---|
| `docs/product/PRD-Balu-V2.md:96` | "o escritório cobra o cliente pelo app **(subconta/split a decidir na spec)**" — adiado para cá |
| `PRD-MASTER-Balu-2026-07-24.md:231` | "Fora de escopo. (...) Split de pagamento." |
| `PRD-Remanescente-Balu.md:116` | idem |
| Devolutiva do Michel, q1.3 | marcou os três produtos, e **os três são a Balu cobrando**: assinatura do empresário, assinatura do escritório por nº de clientes, avulso |
| Devolutiva do Michel, q1.4 | "o app precisa cobrar essa mensalidade dentro dele mesmo" = **"Sim, essencial"** |

O Michel nunca pediu que o escritório cobrasse o cliente pelo app. O "não é o que eu esperava" que ele marcou no item de honorários (`conf10`) vem acompanhado da observação que ele mesmo escreveu — `"n vimos funcionar"` — repetida em outros sete itens; é "não vi funcionar", não "está desenhado errado", e o próprio HTML marca essas respostas como incompletas.

**Decisão nº 2: o Bloco 4 cobra só o que é da Balu.** O honorário segue como está: controle manual do contador, recebimento por fora. As colunas `asaas_*` de `honorarios` **continuam sem uso, de propósito** — não são esquecimento. Subconta por escritório fica anotada como candidata a bloco futuro, e implica onboarding KYC de cada escritório no Asaas.

### 3.2 Quem paga, conforme a origem

- Empresa **sem** `contabilidade_id` — chegou por autosserviço — assina o próprio plano.
- Empresa **com** `contabilidade_id` — veio pela carteira de um escritório — é coberta pela assinatura do escritório e nunca vê cobrança.

Nenhum campo novo decide isso: a regra lê o multitenant que o Bloco A construiu (`companies.contabilidade_id`).

### 3.3 Escritório inadimplente não bloqueia a carteira

**Decisão nº 3.** O escritório inadimplente perde as ações dele (operar abertura, criar cliente, honorários, convites). Os empresários da carteira **seguem trabalhando**.

Motivo: o empresário não é parte do contrato e não tem como quitar a dívida do contador. Pará-lo é dano a quem não deve, e a reclamação chega na marca da Balu, não na do escritório.

**Consequência aceita, registrada para ninguém tratar como bug:** um escritório que nunca assinou, ou que cancelou, **não trava a carteira dele**. As empresas com `contabilidade_id` respondem sempre liberadas. A alavanca é que o escritório não consegue operar.

### 3.4 Trial de 3 dias; contas existentes entram como cortesia

Cadastro novo nasce em `trial` por **3 dias** — duração em `planos`, não constante em código, para mudar sem deploy.

Toda `contabilidade` e toda `company` sem `contabilidade_id` **que já existirem no banco no momento da migration** recebem uma assinatura `cortesia`: sem vínculo Asaas, sem vencimento, nunca bloqueia. É o que garante que o deploy do bloco não bloqueia ninguém — nem os pilotos, nem as contas de teste, nem vocês. A virada de cada uma para cobrança real é manual e deliberada.

## 4. Modelo de dados — migration `0050`

Aditiva e idempotente, no espírito das `0045`–`0049`. Próximo número livre é **0050** (`0049_defis_pendente.sql` é o último aplicado).

### 4.1 `planos`

Catálogo semeado pela migration. Preço, ciclo e faixa moram em tabela, não em código, porque mudar preço não pode exigir deploy.

```sql
CREATE TABLE IF NOT EXISTS public.planos (
  id            text PRIMARY KEY,             -- 'empresario_mensal', 'escritorio_ate_50', ...
  nome          text NOT NULL,
  publico       text NOT NULL CHECK (publico IN ('empresa','escritorio')),
  valor_centavos int NOT NULL CHECK (valor_centavos >= 0),
  ciclo         text NOT NULL DEFAULT 'MONTHLY' CHECK (ciclo IN ('MONTHLY','YEARLY')),
  clientes_min  int,                           -- só para publico='escritorio'
  clientes_max  int,                           -- NULL = faixa aberta no topo
  trial_dias    int NOT NULL DEFAULT 3,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Valor em **centavos inteiros**, nunca `numeric` de reais — o repo já apanhou de dinheiro em ponto flutuante (`lib/format/dinheiro.ts` e o `normalizarValorBRL` do honorário nasceram disso).

As faixas de escritório precisam ser **contíguas e sem sobreposição**; a função de escolha de faixa (§6.3) trata explicitamente o caso de nenhuma faixa casar, em vez de devolver `undefined` silencioso.

### 4.2 `assinaturas`

```sql
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id      uuid REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  company_id            uuid REFERENCES public.companies(id)      ON DELETE CASCADE,
  plano_id              text REFERENCES public.planos(id),
  status                text NOT NULL CHECK (status IN
                          ('trial','ativa','inadimplente','cancelada','cortesia')),
  trial_termina_em      date,
  proxima_cobranca_em   date,
  asaas_customer_id     text,
  asaas_subscription_id text,
  cancelada_em          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinaturas_titular_chk CHECK (
    (contabilidade_id IS NOT NULL AND company_id IS NULL) OR
    (contabilidade_id IS NULL AND company_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_contabilidade_uidx
  ON public.assinaturas(contabilidade_id) WHERE contabilidade_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_company_uidx
  ON public.assinaturas(company_id) WHERE company_id IS NOT NULL;
```

Duas FKs anuláveis com `CHECK` de exclusividade, em vez de um par `titular_tipo`/`titular_id`: preserva integridade referencial e cascata de verdade nos dois lados. Os índices únicos parciais garantem **uma assinatura por titular** — sem eles, dois webhooks concorrentes criariam linhas duplicadas e o gate leria a errada.

O `status` é **vocabulário nosso**, traduzido do Asaas na borda (§6.4). Espelhar cru o vocabulário do provedor faria uma mudança de nomenclatura dele virar mudança de regra de negócio aqui dentro.

### 4.3 `cobrancas`

```sql
CREATE TABLE IF NOT EXISTS public.cobrancas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id    uuid NOT NULL REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  asaas_charge_id  text NOT NULL UNIQUE,
  status           text NOT NULL,
  valor_centavos   int  NOT NULL,
  vencimento       date NOT NULL,
  pago_em          date,
  link_fatura      text,
  pix_copia_cola   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

`asaas_charge_id UNIQUE` é a idempotência do webhook no nível do banco: reprocessar o mesmo evento é upsert, não linha nova.

O `pix_copia_cola` já nasce aqui porque o **Bloco 6** vai enviar cobrança por WhatsApp e vai precisar dele; guardar agora custa uma coluna e evita uma migration depois.

### 4.4 RLS

`assinaturas` e `cobrancas` são legíveis pelo titular e **escritas só pelo service role** — mesma forma de `notifications` (`0045:32-39`), que não tem policy de INSERT de propósito. O webhook e os crons escrevem com `createAdminClient()`; nenhum caminho de usuário escreve estado de pagamento.

O titular lê: o dono da `company` (`companies.user_id = auth.uid()`) e os membros da `contabilidade` (via `minha_contabilidade_membro()`, o helper `SECURITY DEFINER` que a `0035` criou justamente para não recursar).

### 4.5 Cortesia para o que já existe

```sql
INSERT INTO public.assinaturas (contabilidade_id, status)
  SELECT id, 'cortesia' FROM public.contabilidades
  ON CONFLICT DO NOTHING;

INSERT INTO public.assinaturas (company_id, status)
  SELECT id FROM public.companies
   WHERE contabilidade_id IS NULL AND deleted_at IS NULL
  ON CONFLICT DO NOTHING;
```

O `ON CONFLICT DO NOTHING` casa com os índices únicos parciais e torna a migration re-executável.

### 4.6 Ampliar o CHECK de `notifications.tipo` — **armadilha**

`notifications.tipo` tem CHECK de lista fechada (`0045:10-12`). Os avisos de cobrança **não entram** sem alterar a constraint; inserir um tipo novo hoje falha com `check_violation` em runtime, não em compilação.

```sql
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida'));
```

A lista antiga tem de ser repetida **na íntegra** — omitir um valor existente quebra linhas já gravadas.

## 5. O gate

### 5.1 Forma

Duas portas, no formato exato do `assertAceitesEmDia` (`src/lib/lgpd/pendencia-aceite.ts:22`), que já é chamado no topo de oito actions de escrita:

```ts
assertAssinaturaEmpresa(companyId: string):   Promise<{ok:true} | {ok:false; error:string}>
assertAssinaturaEscritorio(contabId: string): Promise<{ok:true} | {ok:false; error:string}>
```

Duas portas em vez de uma resolução mágica porque cada action **já tem em mãos** o identificador certo: as do empresário têm `companyId`, as do contador têm `ctx.id` do `getContabilidadeCtx()`. Uma porta única teria de adivinhar o contexto — e adivinhar é como o Bloco 3 gravou declaração na empresa errada.

`assertAssinaturaEmpresa` resolve a origem por dentro: `company.contabilidade_id` preenchido ⇒ responde `{ok:true}` sem consultar assinatura nenhuma (decisão nº 3).

### 5.2 Por que não no layout nem no middleware

O docblock do `assertAceitesEmDia` já registra a lição do Bloco E: *"o layout só cobre navegação de página; server actions e route handlers não passam pelo layout"*. E a sessão 3 gastou um dia num loop de redirect causado por gate em middleware (`2513c1a`+`3868866`). **Bloqueio é sempre na action.** A camada de navegação só avisa.

### 5.3 O que o gate alcança

**Bloqueia** — escrita comercial e reversível:

| Arquivo | Actions |
|---|---|
| `notas_fiscais/actions.ts` | `emitirNotaAction`, `emitirNfeAction`, `emitirNfceAction`, `cancelarNotaAction`, `lancarNotaManualAction`, `criarProdutoAction` |
| `clientes/actions.ts` | `createClienteAction`, `updateClienteAction`, `softDeleteClienteAction` |
| `contador/aberturas/actions.ts` | `avancarProcessoAction`, `concluirAberturaAction`, `decidirAlteracaoAction`, `gerarMinutaAction`, `revisarDocumentoAction` |
| `contador/honorarios/actions.ts` | as cinco do CRUD v2 |
| `contador/actions.ts` | criar cliente pelo contador; convites de equipe |
| `(onboarding)/onboarding/abertura/actions.ts` | `submitAberturaAction` |

**Nunca bloqueia** — obrigação legal com prazo (decisão nº 1):

| Arquivo | Actions |
|---|---|
| `impostos/actions.ts` | `gerarDasMeiAction`, `gerarDasSimplesAction`, `iniciarApuracaoAction`, `consultarDeclaracoesAction`, `consultarDasnSimeiAction`, `previewDeclaracaoAction`, `registrarDeclaracaoAnualAction`, `marcarGuiaPagaAction`, `salvarFolhaAction`, `marcarSincronizacaoInicialAction` |
| `contador/clientes/actions.ts` | `registrarDeclaracaoAnualContadorAction` |

**Nunca bloqueia** — direito do titular. Herda literalmente a regra que o `assertAceitesEmDia` já carrega: *"NUNCA usar em ações de direito do titular (exportar/excluir dados) — bloquear o exercício de direito LGPD seria o oposto do que a lei exige."* Alcança `conta/actions.ts` inteiro (`exportarMeusDadosAction`, `deleteAccountAction`, nome/e-mail/senha, preferências) e `exportNotasCsvAction`.

**Nunca bloqueia** leitura, listagem e preparação (`listarProdutosAction`, `listarCnaesEmpresaAction`, `listarTiposEmissaoAction`, `prepararEmissaoAction`, `prepararNotaManualAction`, `lookupCnpjAction`, `atualizarStatusNotaAction`, `loadAberturaAtual`).

O bloqueio mora **no ato**, não no formulário que leva até ele: `prepararEmissaoAction` passa, `emitirNotaAction` barra. Barrar antes deixaria o usuário diante de uma tela quebrada em vez de uma mensagem que explica.

### 5.4 Contra o esquecimento

Um teste enumera as actions que **devem** ter gate e falha se alguma perder — e falha também se uma action da lista de "nunca bloqueia" ganhar gate por engano. É o discriminante que o Bloco 3 provou necessário: sem ele, os testes de bloqueio passariam mesmo com um gate que barra tudo.

## 6. Módulo `src/lib/billing/`

Lógica pura separada de I/O, para ser testável sem rede e sem banco.

### 6.1 `status.ts` — status efetivo calculado na leitura

**O estado é derivado no momento da pergunta, nunca lido cru da coluna.** Uma coluna que só está correta se um cron rodou é uma bomba: o cron falha e o app libera quem devia bloquear — ou pior, bloqueia quem pagou.

```ts
statusEfetivo(a: {status, trial_termina_em, proxima_cobranca_em}, hoje: string): 'liberado' | 'bloqueado'
```

`cortesia` e `ativa` liberam. `trial` libera até `trial_termina_em` inclusive, e bloqueia depois — mesmo que nenhum job tenha rodado. `inadimplente` e `cancelada` bloqueiam.

Datas em **BRT**, via o `tempo-brt.ts` que já existe. O Bloco A e o Bloco 3 já erraram fuso aqui (a nota de 31/12 22h caindo no ano errado); um trial que vence "hoje" tem de vencer no dia do usuário, não em UTC.

### 6.2 `titular.ts` — resolução por origem

Recebe a `company` e devolve quem responde pela assinatura. Puro, sem I/O; quem busca a linha é o chamador.

### 6.3 `faixa.ts` — plano do escritório por nº de clientes

Recebe a contagem de clientes e a lista de planos de escritório, devolve o plano. Trata explicitamente contagem zero e contagem acima de toda faixa; nunca devolve `undefined` implícito.

### 6.4 `eventos.ts` — tradução do vocabulário do Asaas

Mapeia evento do Asaas → efeito no nosso estado. Testado com payloads reais do sandbox como fixture. Evento desconhecido é **ignorado com log**, nunca tratado como pagamento nem como inadimplência — um vocabulário novo do provedor não pode virar bloqueio silencioso de cliente adimplente.

## 7. Integração com o Asaas

### 7.1 Cliente `src/lib/clients/asaas.ts`

Espelha `focus-nfe.ts`: `import 'server-only'` (`focus-nfe.ts:3`), base por env, e o mesmo `call<T>` com retry exponencial em 502/503/504 e timeout (`focus-nfe.ts:55-114`). Diferença: auth por header `access_token`, não Basic.

```
ASAAS_ENV=sandbox → https://api-sandbox.asaas.com
ASAAS_ENV=prod    → https://api.asaas.com
```

Superfície mínima: `criarCliente`, `criarAssinatura`, `cancelarAssinatura`, `consultarAssinatura`, `consultarCobranca`, `listarCobrancas`. Entra no barrel `src/lib/clients/index.ts`.

Env novas, também no `.env.example`: `ASAAS_ENV`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`. **Armadilha conhecida deste repo:** o `.env.example` no disco já foi uma cópia do `.env.local` com segredos reais e foi commitado por engano em 22/07. Inspecionar o conteúdo antes de qualquer `git add` nele.

Sem chave configurada, o cliente **falha explicitamente** na chamada, e não no import — o app tem de subir e funcionar inteiro sem billing enquanto a chave não chega.

### 7.2 Webhook `src/app/api/webhooks/asaas/route.ts`

Mesma forma do da Focus (`api/webhooks/focus/route.ts`): rate-limit por IP (`limitar`/`ipDe` de `lib/security/rate-limit.ts`) → validação de segredo → **sempre HTTP 200**, inclusive na rejeição, porque o Asaas reenfileira em 4xx/5xx.

### 7.3 Extração do módulo de segredo — **refatoração obrigatória**

O `segredoOk` de hoje (`api/webhooks/focus/segredo.ts:6`) lê da query `?s=` e tem `FOCUS_WEBHOOK_SECRET` **hardcoded por dentro**. O Asaas manda no header `asaas-access-token`. Não dá para reusar como está.

Extrair para `api/webhooks/segredo.ts` duas funções — uma por query, uma por header — ambas com `timingSafeEqual` e a comparação de comprimento **antes** (sem ela, `timingSafeEqual` lança em tamanhos diferentes). O `focus/segredo.ts` continua existindo e passa a delegar, com assinatura e comportamento idênticos. O teste que já existe (`focus/segredo.test.ts`) é a prova de que a Focus não quebrou — e é por isso que a extração é segura.

O PRD supunha um módulo compartilhado em `api/webhooks/segredo.ts`; ele **não existe**. É criação, não reuso.

### 7.4 Idempotência

O Asaas reenvia eventos. Duas camadas: `cobrancas.asaas_charge_id UNIQUE` (upsert em vez de linha nova) e ignorar evento cujo efeito já está aplicado. Mesmo princípio da chave de idempotência do Bloco 1.

## 8. Crons

### 8.1 Reconciliação diária

Varre assinaturas com vínculo Asaas, compara com a API e corrige divergência. É a rede contra o webhook perdido — fecha a janela em no máximo 24h. **Não é requisito de correção**: o status efetivo (§6.1) já é calculado na leitura.

### 8.2 Recálculo mensal da faixa do escritório

Conta os clientes da carteira, escolhe a faixa (§6.3) e atualiza a assinatura no Asaas se mudou. Roda antes do ciclo de cobrança.

### 8.3 Avisos de cobrança

Trial acabando e cobrança vencida entram como `notifications` pelo motor do Bloco 1 — sem canal novo. Depende da ampliação do CHECK (§4.6).

### 8.4 **Armadilha de plataforma: o limite de crons da Vercel**

`app/vercel.json` já tem **dois** crons (`honorarios-recorrentes` e `obrigacoes`). O plano **Hobby da Vercel permite exatamente dois**. Antes de criar um terceiro, o plano de implementação tem de **confirmar o tier do projeto `balu-contabil`**. Se for Hobby, a reconciliação e os avisos entram **dentro** do `/api/cron/obrigacoes`, que já roda diário — não viram cron novo. Descobrir isso no deploy seria descobrir tarde.

## 9. Interface

- **`/conta/assinatura`** (empresário autosserviço) e **`/contador/assinatura`** (escritório): plano, estado, dias de trial restantes, histórico de cobranças com link e Pix, e **cancelar sem barreira** — CDC art. 39: um clique, não um contato com suporte.
- **Faixa de aviso** no topo quando o trial está acabando ou há cobrança vencida. Avisa, não bloqueia.
- **Mensagem do bloqueio**: quando uma action é barrada, o erro diz o que aconteceu e leva à página de assinatura. Nunca um "não autorizado" seco.
- Empresa com `contabilidade_id` **não vê nada disso** — ela não paga (decisão nº 3.2). Mostrar cobrança a quem não deve nada é um bug de produto.

## 10. Testes

**Puros, sem rede** — é onde mora a regra:
- `statusEfetivo`: trial vigente, trial vencido ontem, cortesia, ativa, inadimplente, cancelada; e as fronteiras de BRT.
- `titular`: com e sem `contabilidade_id`.
- `faixa`: contagem zero, dentro da faixa, nas bordas, acima de toda faixa.
- `eventos`: pagamento, vencimento, estorno, cancelamento, e **evento desconhecido não muda nada**.

**Cobertura do gate** — a enumeração de §5.4, nos dois sentidos.

**Discriminantes** — sem eles a suíte passa com um gate errado:
- titular **inadimplente** consegue gerar DAS e registrar declaração anual;
- titular **inadimplente** consegue exportar dados e excluir conta;
- empresa **com** `contabilidade_id` emite nota mesmo com o escritório inadimplente.

**Segredo do webhook** — o teste existente da Focus tem de continuar verde após a extração; mais os casos do header do Asaas, incluindo comprimento diferente.

**Smoke contra o sandbox**, no fechamento, quando a chave chegar: criar cliente → assinatura → simular pagamento → conferir que o webhook mudou o estado → simular vencimento → conferir que o gate barra o comercial e libera o fiscal.

## 11. Premissas a confirmar com o Michel

Registradas agora porque são baratas de mudar antes da implementação e caras depois — mesma disciplina das sete premissas do Bloco 3.

| # | Premissa | Por que importa |
|---|---|---|
| 1 | **Preços e faixas** de cada plano | Semeados na migration. Trocar valor é UPDATE; trocar o **desenho das faixas** é migration nova |
| 2 | **Trial de 3 dias** | Definido nesta sessão; 3 dias é curto para um SaaS contábil. Fica em `planos.trial_dias`, mudável sem deploy |
| 3 | Escritório inadimplente **não** trava a carteira | Decisão nº 3. Se ele discordar, muda o alcance do gate |
| 4 | Honorários **fora** do bloco | Decisão nº 2. Se ele quiser o escritório cobrando pelo app, entra subconta e o bloco dobra |
| 5 | Conta Asaas — **titularidade e CNPJ** | Quem é o titular da conta que recebe. Trava a virada para produção, não a construção |
| 6 | **Cobrança avulsa ficou fora** | Ele pediu na q1.3. Precisa de duas respostas antes de virar código: o que se cobra avulso, e quanto |

## 12. Ordem de implementação

1. Migration `0050` (tabelas + cortesia + CHECK de `notifications`) — aplicada e verificada no banco antes de qualquer TS.
2. `src/lib/billing/` puro, com os testes — a regra antes da integração.
3. Extração do segredo + teste da Focus verde.
4. Cliente Asaas.
5. Webhook + idempotência.
6. Gate nas actions + teste de cobertura + discriminantes.
7. Crons (depois de confirmar o tier da Vercel, §8.4).
8. Telas.
9. Smoke em sandbox no fechamento.

Os passos 1–8 não dependem de credencial nenhuma — o bloco fica inteiro construído, testado e mergeável sem o Asaas. O passo 9 é o único que espera a chave, e é validação, não construção.
