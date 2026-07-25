# Spec — Bloco 3: DASN-SIMEI assistida + DEFIS

> **Data:** 2026-07-25 · **Status:** aprovada (design) · **Bloco:** 3 de 7 do `PRD-MASTER-Balu-2026-07-24.md`
> **Pré-requisito de leitura:** §3 (princípios anti-bug) e §4 Bloco 3 do Master PRD; spec do Bloco 1 (motor de obrigações), de que este bloco depende.
> **Natureza:** 🟢 buildável agora. Nenhuma dependência externa nova — as credenciais SERPRO de produção foram validadas em 2026-07-25 (ver `CHECKPOINT.md`, Sessão 7).
> **Base factual:** auditoria do código real em 2026-07-25 (migrations até `0047`, `src/`). Todo seam citado abaixo é arquivo real.

---

## 1. Objetivo

Assistir as duas **declarações anuais** do Simples Nacional que hoje o app não cobre:

- **DASN-SIMEI** — declaração anual do MEI, prazo 31/05 (Res. CGSN 140/2018, art. 109; multa mínima R$ 25 pelo art. 111).
- **DEFIS** — declaração de informações socioeconômicas e fiscais de ME/EPP do Simples, prazo 31/03 (Res. CGSN 140/2018, art. 72).

Assistir significa: o app **calcula a sugestão** a partir das notas, **valida**, **avisa** de divergência e de limite, **guarda o comprovante** e **cala o alarme** quando a obrigação é cumprida. A entrega em si é feita no portal da Receita.

### 1.1 Fronteira inegociável — a Balu não transmite

O SERPRO Integra Contador **consulta** declarações (`CONSULTIMADECREC152`); o serviço de transmissão da DASN (`TRANSDECLARACAO151`) consta como "ainda não disponível para contratação". Para o DEFIS não existe serviço de transmissão nenhum. **O fluxo é assistido por definição, não por limitação temporária.**

Consequência prática: o texto atual de `DeclaracoesMeiSection.tsx:32` — *"A transmissão automática pela Balu chega quando a Receita liberar a API"* — promete algo que o produto não vai entregar e **precisa ser corrigido** neste bloco (§6.3). Ver **PREMISSA 6**.

## 2. Escopo

**Dentro:**
- Migration `0048` — colunas novas em `declaracoes_fiscais` + bucket `declaracoes-comprovantes`.
- Migration `0049` — bloco `defis_pendente` na RPC `materializar_obrigacoes`.
- `lerReceitasAnoCalendario` em `receitas-source.ts` (janela de ano-calendário, separada por tipo de documento).
- Módulos `lib/fiscal/dasn/`, `lib/fiscal/defis/` e a costura `lib/fiscal/declaracoes-anuais/`.
- Duas Server Actions de registro (empresário e contador) sobre um núcleo comum.
- Tela assistida da DASN em `/impostos` (MEI) e do DEFIS em `/impostos` (Simples não-MEI).
- Card "Declarações anuais" no painel do contador (`VisaoCliente.tsx`).
- Script de seed de empresa MEI para teste ponta a ponta.

**Fora, de propósito:**
- Transmissão automática de qualquer declaração (§1.1).
- Importação de folha, estoque ou contas a pagar — esses dados **não existem** no app; os campos do DEFIS que dependem deles são digitação manual.
- Retificadora automática (a retificação é o mesmo registro sobrescrito — §5.5).
- Geração de PDF da declaração (guardamos o comprovante do portal, não emitimos um).
- E-mail — o motor de e-mail é do Bloco 1; aqui só há notificação in-app.

## 3. Modelo de dados

### 3.1 Nenhuma tabela nova

DASN e DEFIS são anuais e cabem em `public.declaracoes_fiscais` (criada em `0025_declaracoes_fiscais.sql`) com `competencia_referencia = '<ano>'` e `tipo` em `'DASN-SIMEI'` / `'DEFIS'`. A constraint `declaracoes_fiscais_company_comp_tipo_uniq UNIQUE (company_id, competencia_referencia, tipo)` (`0025:29`) dá idempotência de graça: reenviar o comprovante é upsert, não duplica.

`tipo` **não** tem CHECK constraint — os dois valores novos entram sem alteração de schema.

### 3.2 Migration `0048_declaracoes_anuais.sql`

Aditiva e idempotente, no espírito da `0025`.

```sql
ALTER TABLE public.declaracoes_fiscais
  ADD COLUMN IF NOT EXISTS dados               jsonb,
  ADD COLUMN IF NOT EXISTS comprovante_path    text,
  ADD COLUMN IF NOT EXISTS origem              text,
  ADD COLUMN IF NOT EXISTS registrado_por      uuid,
  ADD COLUMN IF NOT EXISTS divergencia_receita numeric;

DO $$ BEGIN
  ALTER TABLE public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_origem_chk
    CHECK (origem IS NULL OR origem IN ('serpro','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

| coluna | conteúdo |
|---|---|
| `dados` | payload declarado. DASN: `{receitaComercio, receitaServico, possuiEmpregado}`. DEFIS: os campos do art. 72 (§4.4). Uma coluna jsonb em vez de 20+ colunas — os *shapes* divergem demais e quem valida é o Zod, não o banco. |
| `comprovante_path` | chave no storage do recibo baixado do portal. |
| `origem` | `'serpro'` quando o registro veio da consulta Integra Contador; `'manual'` quando foi digitado. `NULL` nas linhas legadas. |
| `registrado_por` | `auth.users.id` de quem registrou (contador ou empresário). Complementa a auditoria, não a substitui. |
| `divergencia_receita` | `declarado − apurado`. `NULL` = não aplicável; `0` = confere. |

**Sem `deleted_at`** — a `0025` deliberadamente não tem, e declaração entregue não se apaga: corrige-se com retificadora, que é o mesmo `(company_id, ano, tipo)` sobrescrito.

### 3.3 Bucket `declaracoes-comprovantes`

Privado, criado na mesma migration:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('declaracoes-comprovantes', 'declaracoes-comprovantes', false)
ON CONFLICT (id) DO NOTHING;
```

Path determinístico `${companyId}/${tipo}-${ano}.pdf`, com `upsert: true` — a retificadora substitui o recibo anterior. Acesso **exclusivamente** pela service role (upload na action, leitura por signed URL), espelhando `abertura-documentos`. Nenhuma policy em `storage.objects`, porque nenhum cliente toca o bucket direto. Reusa `uploadToBucket` / `downloadFromBucket` de `src/lib/clients/supabase-storage.ts:53,66`.

### 3.4 RLS — zero mudança

Verificado no schema real:

- `declaracoes_fiscais_owner` (`0025:37-39`) — `FOR ALL TO authenticated USING (owner_user_id = auth.uid())`. **O empresário já escreve o que é dele.**
- `declaracoes_select_contador` (`0033_rls_contador.sql:26-28`) — **SELECT apenas**. O contador não tem caminho de escrita no nível do banco, e isso é o invariante "o painel do contador é de visualização".

O contador escreve pela Server Action com service role, provando a permissão na aplicação (§5.1). Nenhuma policy é criada ou afrouxada neste bloco.

### 3.5 Migration `0049_defis_pendente.sql`

Acrescenta o bloco `defis_pendente` à RPC `materializar_obrigacoes`. Como `CREATE OR REPLACE FUNCTION` exige o corpo inteiro, a migration reproduz a função completa da `0047` mais o bloco novo — mesmo procedimento e mesmo cuidado da `0047_dasn_janela_janeiro.sql`, incluindo a reafirmação do ACL ao final:

```sql
REVOKE ALL ON FUNCTION public.materializar_obrigacoes(date) FROM public;
GRANT EXECUTE ON FUNCTION public.materializar_obrigacoes(date) TO service_role;
```

O bloco espelha o da DASN (`0047:121-151`), com quatro diferenças:

| aspecto | DASN (existe) | DEFIS (novo) |
|---|---|---|
| público | `code = '4'` | `code IN ('1','2')` — **PREMISSA 2** |
| janela | `month BETWEEN 1 AND 6` | `month BETWEEN 1 AND 4` — **PREMISSA 3** |
| severidade | `danger` a partir de junho | `danger` a partir de março — **PREMISSA 3** |
| `agendada_para` | `make_date(ano, 5, 31)` | `make_date(ano, 3, 31)` |
| norma | art. 109 | art. 72 |

Predicado de supressão idêntico em forma:

```sql
AND NOT EXISTS (SELECT 1 FROM public.declaracoes_fiscais d
  WHERE d.company_id = b.company_id AND d.tipo = 'DEFIS'
    AND d.data_transmissao IS NOT NULL
    AND d.competencia_referencia = b.ano::text)
```

`notifications.tipo` **já aceita** `'defis_pendente'` — o CHECK da `0045_notificacoes.sql:11` previu os dois tipos. Nada a alterar lá.

## 4. Módulos de domínio

Arquitetura escolhida: **dois módulos irmãos sobre uma costura mínima**. Alternativas descartadas: motor genérico parametrizado por descritor (as duas declarações são desproporcionais — 3 campos contra 26 — e o descritor viraria um mini-framework de formulário para servir dois casos) e formulário dirigido por metadados (maquinaria que o repo não tem, tipagem fraca, desproporcional).

```
src/lib/fiscal/
  dasn-simei.ts              (existe — payload SERPRO; permanece, ganha caller)
  receitas-source.ts         (+ lerReceitasAnoCalendario)
  declaracoes-anuais/
    tipos.ts                 DeclaracaoAnualTipo, RegistroInput, ResultadoRegistro
    divergencia.ts           calcularDivergencia(declarado, apurado)
    registrar.ts             upload + upsert + auditoria + supressão de aviso
  dasn/
    campos.ts                schema Zod dos 3 campos
    resumo.ts                sugestão pré-preenchida + teste do limite de R$ 81.000
  defis/
    grupos.ts                os blocos do art. 72 declarados como dados
    campos.ts                schema Zod montado a partir de grupos.ts
    resumo.ts                pré-preenchimento do que existe (receita bruta)
```

### 4.1 Fonte de receita

`lerReceitasParaApuracao` (`receitas-source.ts:12`) **não serve**: a janela é de 13 meses terminando numa competência, e a DASN precisa do ano-calendário fechado. Acrescenta-se ao **mesmo arquivo** — preservando a regra do docblock de que toda leitura de receita passa por ali:

```ts
export async function lerReceitasAnoCalendario(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<{ comercio: number; servico: number; total: number; qtdNotas: number }>
```

Mesma tabela (`notas_fiscais`), mesmos filtros (`status IN ('ativa','lancada')`, `tipo_documento IN ('NFSe','NFe','NFCe')`), janela `[ano-01-01, ano+1-01-01)` em BRT. Separação: **NFSe → serviço; NFe e NFCe → comércio** (**PREMISSA 4**). Não se infere pelo CNAE — o `tipo_documento` é o campo confiável na base.

### 4.2 `dasn/`

`campos.ts` valida três campos (`receitaComercio`, `receitaServico`, `possuiEmpregado`). `resumo.ts` devolve a sugestão pré-preenchida e o teste do limite de R$ 81.000 (LC 123/2006, art. 18-A): abaixo, no limite, acima, e acima de 20% (caso em que o desenquadramento é retroativo ao início do ano).

O módulo chama `montarDasnSimei` (`dasn-simei.ts:13`), que hoje **tem teste e nenhum caller** — este bloco fecha esse elo. `dasn-simei.ts` **permanece onde está**: é o irmão de `serpro-pgdasd.ts` (builder de payload SERPRO), já testado; movê-lo geraria churn sem ganho.

### 4.3 `declaracoes-anuais/` — a costura

Exatamente o que é idêntico nos dois tipos:

- **`registrar.ts`** → `registrarDeclaracaoAnual(client, input)`: valida o arquivo, sobe ao bucket, faz o upsert em `declaracoes_fiscais`, registra auditoria e marca como lidas as notificações pendentes do par `(company_id, ano)`. Recebe `tipo` como parâmetro.
- **`divergencia.ts`** → `calcularDivergencia(declarado, apurado)`: serve à DASN e ao campo de receita bruta do DEFIS.
- **`tipos.ts`** → os tipos compartilhados.

Nada além disso é compartilhado: as regras de um tipo não aparecem no arquivo do outro.

### 4.4 `defis/` — os grupos do art. 72

`grupos.ts` declara os blocos como dados; `campos.ts` monta o Zod a partir deles; a UI renderiza por grupo. **A lista abaixo é PREMISSA 1 — a confirmar com o Michel antes da implementação.**

| # | grupo | campos |
|---|---|---|
| 1 | Identificação e evento | ocorrência de cisão/fusão/incorporação/extinção e data; ganhos de capital; doações a campanha eleitoral |
| 2 | Empregados | quantidade no início do ano; quantidade no fim do ano |
| 3 | Receitas | receita do mercado interno; receita do mercado externo; receita bruta total |
| 4 | Despesas e resultado | total de despesas no ano; estoque inicial; estoque final; saldo em caixa/banco no início; saldo em caixa/banco no fim |
| 5 | Aquisições | aquisições no mercado interno; aquisições no mercado externo; créditos de ICMS/ISS retido |
| 6 | Sócios *(grupo repetível)* | CPF; nome; % de participação; pró-labore; lucro distribuído; imposto retido |

O grupo de sócios é o único ponto que quebra a simetria com a DASN: array dentro do `dados` jsonb, com validação de que os percentuais somam 100%.

**Dito com todas as letras:** quase tudo aí é digitação manual. O app não tem folha, contas a pagar nem estoque. Só **receita bruta total** e **mercado interno** saem pré-preenchidos das notas; o resto é campo em branco com a norma ao lado.

## 5. Fluxo, actions e permissões

### 5.1 Dois pontos de entrada, um núcleo

| action | arquivo | como prova permissão | client |
|---|---|---|---|
| `registrarDeclaracaoAnualAction` | `impostos/actions.ts` | sessão do empresário; policy `declaracoes_fiscais_owner` cobre a escrita | sessão |
| `registrarDeclaracaoAnualContadorAction` | `contador/.../actions.ts` | `requireEscritorio()` + guarda de carteira (a company pertence à contabilidade do ator) + `registrarAuditoria` | service role |

O padrão do contador é o do `aberturaDaCarteira` em `contador/aberturas/actions.ts`, incluindo o **403 genérico** que não revela se a empresa existe. Ambas convergem em `registrarDeclaracaoAnual` (§4.3).

### 5.2 Caminho feliz da DASN

1. A seção abre no ano-calendário anterior com o resumo apurado (comércio / serviço / total / nº de notas).
2. Os três campos vêm **pré-preenchidos e editáveis** — o usuário corrige para o que vai de fato declarar.
3. Divergência entre declarado e apurado → **alerta**, nunca bloqueio: *"você declarou R$ 90.000, mas as notas de 2025 somam R$ 62.000"*. Grava em `divergencia_receita`.
4. Total acima de R$ 81.000 → alerta de excesso (art. 18-A), com a nota de que acima de 20% o desenquadramento é retroativo.
5. Salvar grava `dados` **sem** `data_transmissao` — é rascunho.
6. Link do portal (já existe: `PORTAL_DASNSIMEI`, `DeclaracoesMeiSection.tsx:11`) + botão "copiar resumo" para digitar lá fora.
7. O usuário volta e registra comprovante + `numero_declaracao` + `data_transmissao`. **Só agora o alarme cala.**
8. O botão de consulta SERPRO já existente (`ConsultarDasnSimeiButton`) confirma na Receita e carimba `origem = 'serpro'`.

O DEFIS segue o mesmo fluxo **sem a etapa 8** — o Integra Contador não consulta DEFIS.

### 5.3 Rascunho e entregue são o mesmo registro

Discriminados por `data_transmissao IS NULL`. **Não se cria coluna de status:** o predicado da RPC (`0047:135`) já é exatamente esse, e estado duplicado é onde nasce a divergência entre o sino e a tela.

### 5.4 Supressão do aviso — o passo fácil de esquecer

A RPC apenas deixa de **criar** o aviso; as notificações `dasn_pendente` / `defis_pendente` já criadas continuam no sino até serem lidas. Por isso `registrarDeclaracaoAnual` marca como lidas, na mesma operação, as notificações não lidas daquele `(owner_user_id, company_id, tipo-de-aviso, ano)`. Sem isso o usuário entrega a declaração e o alarme continua tocando.

### 5.5 Caminhos infelizes

| situação | comportamento |
|---|---|
| empresa não-MEI abre a seção da DASN | a seção não renderiza (comportamento atual de `DeclaracoesMeiSection`) |
| empresa MEI abre a seção do DEFIS | idem, invertido |
| zero notas no ano | sugestão zerada + *"nenhuma nota encontrada em 2025; preencha manualmente"*. Não é erro |
| comprovante inválido | a action valida MIME e tamanho (PDF/PNG/JPG, ≤ 5 MB) **antes** de tocar o storage |
| já existe declaração entregue | é retificadora: sobrescreve, e a auditoria guarda os valores anteriores no `meta` |
| upload ok, gravação falha | arquivo órfão no bucket, tolerável — o path é determinístico e o próximo upsert o substitui |
| contador fora da carteira | 403 genérico, sem revelar existência |
| percentuais dos sócios ≠ 100% | erro de validação no Zod, bloqueia o salvamento do DEFIS |

## 6. Interface

### 6.1 Casca comum

`DeclaracaoAnualShell` — cabeçalho (tipo, ano-calendário, prazo, norma), badge de estado (`Rascunho` / `Entregue` / `Em atraso`), slot do formulário, rodapé com "Registrar comprovante". DASN e DEFIS diferem apenas pelo conteúdo do slot.

### 6.2 `/impostos` do MEI

`DeclaracoesMeiSection` deixa de ser um cartão informativo e passa a ser a seção assistida: card do resumo apurado, `DasnAssistidaForm` (3 campos + os dois alertas), o link do portal que já existe, "copiar resumo", e o `RegistrarComprovanteDialog` (compartilhado com o DEFIS). A tabela de histórico permanece, ganhando coluna **Origem** e o badge rascunho/entregue.

### 6.3 Correção de texto obrigatória

Substituir `DeclaracoesMeiSection.tsx:32` por: *"A Balu monta a declaração, confere com suas notas e guarda o comprovante. A entrega é feita no portal da Receita."* Ver §1.1 e **PREMISSA 6**.

### 6.4 `/impostos` do Simples não-MEI

Nova `DeclaracoesDefisSection`, irmã da `DeclaracoesSection` (PGDAS-D) já existente. `DefisForm` se desenha a partir de `grupos.ts` — um accordion por bloco, sócios como grupo repetível com adicionar/remover. Contador de progresso ("14 de 26 campos preenchidos"), que num formulário desse tamanho vale mais que qualquer refinamento visual.

### 6.5 Painel do contador

Card "Declarações anuais" em `contador/clientes/[companyId]/VisaoCliente.tsx`, com o estado de DASN/DEFIS do ano anterior e acesso ao **mesmo** formulário e à mesma dialog, apontando para a action do contador.

**Decisão registrada:** o formulário do DEFIS é **um único componente nos dois lados**, trocando apenas a action. Na prática quem tem despesas, estoque e dados dos sócios é o escritório — mas duplicar um formulário de 26 campos para servir dois perfis sai de sincronia em poucos meses, e a permissão já está resolvida na camada da action (§5.1).

## 7. Testes

### 7.1 Testes puros (vitest, `src/**/*.test.ts`)

- **`dasn/resumo.test.ts`** — separação NFSe→serviço / NFe+NFCe→comércio; bordas do ano-calendário (nota em 31/12 23:59 e 01/01 00:01 em BRT — o `competenciaReferenciaBrt` existe justamente por isso); zero notas; limite de R$ 81.000 abaixo, exato, acima e acima de 20%.
- **`declaracoes-anuais/divergencia.test.ts`** — declarado maior, menor, igual; apurado zero.
- **`defis/campos.test.ts`** — sócios somando 100%, somando 99,99%, lista vazia; valores negativos rejeitados; e um teste que afirma que **todos os seis grupos do art. 72 estão representados**, para que remover um grupo quebre o build em vez de sumir da tela em silêncio.
- **`dasn-simei.test.ts`** (existe) ganha um caso ligando `resumo` → `montarDasnSimei`.

### 7.2 Smoke com banco (`*.smoke.test.ts`)

Padrão da casa: snapshot antes, restauração **verificada por query** depois. O par que prova a regra central de §5.3:

1. registrar comprovante com `data_transmissao` → a RPC **deixa** de gerar `dasn_pendente`;
2. salvar apenas rascunho → a RPC **continua** gerando.

Mais o anti-IDOR: contador de outra carteira recebe 403.

### 7.3 Bloqueio de teste conhecido

**Não existe nenhuma empresa MEI na base** — as quatro linhas de `empresas_fiscais` têm `Code_regime_tributario = '1'`. Testar a DASN ponta a ponta exige semear uma empresa `code = '4'`, com script no molde de `app/scratchpad/seed-abertura-bloco2.mjs` (cria; `restore` desfaz). Isso é item do plano de implementação, não detalhe de execução.

## 8. Rollback

- `0048` é puramente aditiva (colunas nullable + bucket). Reverter é desnecessário; se preciso, `DROP COLUMN` das cinco colunas.
- `0049` é substituída reaplicando a `0047`, que contém o corpo íntegro anterior da função.

## 9. Premissas a confirmar com o Michel

Nenhuma delas bloqueia o início da implementação; todas afetam o resultado se estiverem erradas.

| # | premissa | onde impacta |
|---|---|---|
| 1 | Os seis grupos do art. 72 (§4.4) são a lista completa de campos do DEFIS | `defis/grupos.ts`, formulário inteiro |
| 2 | DEFIS vale para `Code_regime_tributario IN ('1','2')`; `'3'` é Regime Normal (não entrega) e `'4'` é MEI (entrega DASN) | migration `0049`, gating da UI |
| 3 | Aviso `defis_pendente` de janeiro a abril, `danger` a partir de março, prazo 31/03 | migration `0049` |
| 4 | Receita separada por `tipo_documento` (NFSe = serviço), não por CNAE | `lerReceitasAnoCalendario` |
| 5 | Divergência entre declarado e apurado alerta, nunca bloqueia | `DasnAssistidaForm` |
| 6 | A Balu não transmite declaração anual — o fluxo é assistido por definição, e a tela passa a dizer isso | §1.1, §6.3 |
| 7 | Retificadora sobrescreve o mesmo registro, com o valor anterior preservado na auditoria | §5.5 |
