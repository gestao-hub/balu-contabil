# Spec — Base jurídica/contábil para apoio ao rascunho de IA

> **Data:** 2026-07-30 · **Origem:** pedido direto do usuário — dar à IA do
> catálogo de explicações (Bloco 6A) grounding jurídico/contábil atualizado,
> em vez de depender só do conhecimento de treino do modelo.
> **Estado:** desenho fechado, pronto para virar plano
> **Depende de:** nada bloqueia esta spec. Duas fronteiras externas (busca no
> DOU, scraping do portal RFB/Simples Nacional) precisam de sondagem contra a
> API/página real antes de código definitivo — mesmo princípio já usado nas
> Tasks 4/5 do Bloco 6B.

---

## 1. Objetivo e princípio

O catálogo de explicações do Bloco 6A (`explicacoes_fiscais`) já tem um botão
"Gerar com IA" que redige rascunho para o admin revisar e aprovar. Hoje esse
rascunho vem só do conhecimento de treino do modelo — sem nenhuma fonte
externa, sem nada que se atualize com o tempo. Se a legislação mudar (um novo
teto de faturamento do MEI, uma resolução nova do CGSN), o modelo não sabe,
porque seu treino tem uma data de corte fixa.

**Objetivo:** manter uma base de conteúdo jurídico/contábil (Diário Oficial da
União + portal da Receita Federal/Simples Nacional) atualizada diariamente, e
usá-la como contexto de apoio quando o admin gera um rascunho novo — para a
IA redigir com mais precisão sobre a regra vigente, não para inventar uma fonte
nova de verdade.

**O princípio que governa este desenho, herdado sem exceção do 6A:**
*grounding, nunca voz.* A base jurídica entra como **contexto interno** que
ajuda a IA a acertar a descrição da regra. Ela **não muda o que chega ao
cliente**: o texto aprovado continua sem citar lei, artigo, resolução ou
número de norma — a mesma regra que já existe em `montarPrompt` hoje, criada
por causa do DL 9.295/46 (quem orienta sobre tributo profissionalmente é
contador licenciado). Esta spec **não reabre essa decisão** — só alimenta o
rascunho com informação melhor, antes da revisão humana de sempre.

Consequência direta: **nada no caminho do cliente muda.** O webhook do
WhatsApp (Bloco 6B) e a tela `/impostos` continuam lendo só
`explicacoes_fiscais.texto` já aprovado — nenhum dos dois consulta a base
jurídica em tempo real, nem hoje nem depois desta feature.

---

## 2. As três decisões que moldam o desenho

### 2.1 Busca textual, não busca vetorial — por enquanto

RAG normalmente significa embeddings + busca por similaridade semântica
(pgvector). Esta primeira versão usa **busca textual nativa do Postgres**
(`tsvector`/`tsquery`), sem embeddings, por dois motivos: (a) o conjunto de
situações do catálogo é pequeno e conhecido (`das-mei:inss+iss`,
`pgdas:anexo-iii+fator-r`, etc.) — não é busca livre de cliente, é busca a
partir de uma chave que já sabemos o que significa, então mapear palavras-chave
por situação cobre bem os casos reais; (b) `lib/ai/` não tem nenhum cliente de
embeddings hoje, e adicionar um é uma peça nova inteira (provedor, custo por
chamada, extensão pgvector). Busca textual usa só o que o Postgres já tem.

**Caminho de evolução documentado, não construído agora:** se a busca por
palavra-chave se mostrar insuficiente (rascunhos citando a regra errada com
frequência), o próximo passo é habilitar `pgvector`, adicionar um cliente de
embeddings a `lib/ai/`, e trocar `buscarContextoJuridico` para busca por
similaridade — a tabela e o resto do pipeline de ingestão não mudam, só a
consulta.

### 2.2 Atualização diária via `pg_cron`, não via cron do Vercel

O plano Hobby da Vercel permite só 2 crons, e os dois já estão ocupados
(`obrigacoes`, `honorarios-recorrentes` — ver spec do 6B, §2.4). Em vez de
tentar embutir mais uma coisa num desses dois (que já fazem e-mail, WhatsApp e
billing), esta feature usa um mecanismo **já em produção e não relacionado ao
Vercel**: a extensão `pg_cron` (mais `pg_net` para a chamada HTTP), que já
agenda o job diário "Sincronizar municípios" (`sync-municipios`, meia-noite
UTC). Esta feature adiciona um **segundo job** `pg_cron`, independente,
chamando uma Edge Function nova (`sync-base-juridica`) no mesmo padrão.

Isso também resolve a ambiguidade do pedido original ("atualizar no momento
que o sistema for iniciado pelo usuário"): não há esse gatilho num app
serverless sem um usuário logado o tempo todo, e amarrar a atualização a
alguém abrir o app deixaria a base desatualizada em dias sem acesso. Um
horário fixo diário, independente de ação humana, é mais confiável e mais
simples.

### 2.3 O escopo é amplo (tributário/contábil geral), mas a ingestão é filtrada

O usuário optou por escopo amplo — não só o que a Balu já calcula (Simples
Nacional/MEI), mas tributário/contábil em geral. Isso não significa ingerir o
Diário Oficial inteiro: a maior parte de uma edição do DOU não tem nada a ver
com tributo ou contabilidade. A ingestão do DOU é **filtrada por
palavra-chave** (Simples Nacional, MEI, CGSN, Receita Federal, tributário,
contábil — lista inicial, ajustável sem migração) no momento da busca, não
depois de baixar tudo.

O portal da Receita Federal/Simples Nacional (FAQ oficial, resoluções do
CGSN já consolidadas) muda com pouca frequência — a ingestão diária dele é
principalmente para pegar o que mudou, não para reprocessar tudo todo dia; a
Edge Function decide isso comparando data de publicação/hash de conteúdo
contra o que já está gravado, evitando reescrever linha que não mudou.

---

## 3. Arquitetura

```
pg_cron (novo job, horário fixo diário)
   │  net.http_post
   ▼
Edge Function sync-base-juridica
   │  busca DOU (filtrado) + portal RFB/Simples Nacional
   │  upsert
   ▼
public.documentos_juridicos  (busca textual, tsvector)
   ▲
   │  buscarContextoJuridico(situacao)
   │
gerarRascunhoAction (admin/explicacoes) ──► montarPrompt(situacao, contexto) ──► gerarTexto (lib/ai/, já existe)
                                                                                       │
                                                                              rascunho (revisão humana, já existe)
```

Nenhuma seta nova chega em `ExplicacaoImposto.tsx` (tela do cliente) nem em
`api/webhooks/uazapi/route.ts` (webhook do 6B) — os dois continuam lendo só
`explicacoes_fiscais.texto` aprovado, sem saber que esta feature existe.

---

## 4. Componentes

### 4.1 Migration — tabela e agendamento

Nova tabela `public.documentos_juridicos`:

| coluna | tipo | notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `fonte` | text NOT NULL | `CHECK IN ('dou','receita_federal','simples_nacional')` |
| `url_origem` | text NOT NULL | chave natural do documento (uma publicação do DOU ou uma página do portal têm URL estável) — é o que identifica "é o mesmo documento" ao longo do tempo |
| `titulo` | text NOT NULL | |
| `texto` | text NOT NULL | conteúdo relevante extraído (não a página inteira) |
| `publicado_em` | date | data de publicação/vigência, quando a fonte informar |
| `hash_conteudo` | text NOT NULL | hash do `texto` — usado para PULAR reprocessamento (comparar hash antes de gravar), não é a chave do upsert |
| `busca` | tsvector GENERATED ALWAYS AS (...) STORED | `to_tsvector('portuguese', titulo \|\| ' ' \|\| texto)` |
| `created_at`/`updated_at` | timestamptz NOT NULL | padrão do projeto |

Índice GIN em `busca`. **`UNIQUE (fonte, url_origem)`** é a chave do upsert —
não `hash_conteudo`: se a chave fosse o hash, um documento que mudou de
conteúdo geraria um hash novo, o `UNIQUE` não bateria contra a linha antiga, e
o upsert **inseriria uma segunda linha em vez de atualizar a existente**,
acumulando versões obsoletas para sempre. Com `(fonte, url_origem)`, a mesma
publicação/página sempre atualiza a mesma linha; `hash_conteudo` só serve para
a Edge Function decidir se vale a pena regravar (comparar hash antes do
upsert) sem precisar comparar o texto inteiro. RLS habilitada, **sem policy
nenhuma + REVOKE explícito de `anon`/`authenticated`** — mesmo padrão de
`whatsapp_atendimentos` (0061) e de toda tabela nova deste projeto desde a
lição do `pg_default_acl` (migrations 0057-0059): só `service_role` lê, porque
só a Edge Function (grava) e `gerarRascunhoAction` (lê, via admin client) têm
motivo para tocar essa tabela.

Migration também adiciona o job `pg_cron` novo:

```sql
select cron.schedule(
  'sync-base-juridica',
  '0 6 * * *',  -- horário a confirmar com o usuário; diferente do sync-municipios p/ não competir
  $$ select net.http_post(
       url:='<SUPABASE_URL>/functions/v1/sync-base-juridica',
       headers:='{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
       timeout_milliseconds:=25000
     ); $$
);
```

(Mesmo padrão do job `sync-municipios` já existente — inclusive a mesma
observação de que o `Authorization` fica em texto plano em `cron.job.command`,
já uma característica aceita deste mecanismo, não uma regressão desta
feature.)

### 4.2 Edge Function `sync-base-juridica`

Mesmo molde de `sync-municipios/index.ts`: busca cada fonte, best-effort (uma
falhando não bloqueia a outra), upsert em lotes, devolve `200` com contagem ou
`207` se alguma fonte falhou parcialmente. Duas sub-rotinas:

- **DOU:** consulta filtrada por palavra-chave (mecanismo real a sondar contra
  `in.gov.br/consulta` ou a API que ferramentas como o Ro-DOU já usam — não
  suposto nesta spec).
- **Portal RFB/Simples Nacional:** busca páginas de FAQ/resoluções
  consolidadas conhecidas (lista curada de URLs, não crawling livre) e
  extrai o texto relevante (scraping de HTML — layout real a conferir na
  implementação).

### 4.3 `lib/base-juridica/palavras-chave.ts`

Função pura: `palavrasChaveDaSituacao(s: SituacaoFiscal): string[]`. Reaproveita
o mesmo tipo `SituacaoFiscal` do 6A/6B (a mesma garantia estrutural: não
carrega dado de contribuinte). Ex.: `das-mei` com componentes `inss+iss` →
`['MEI', 'DAS', 'INSS', 'ISS', 'Simples Nacional']`.

### 4.4 `lib/base-juridica/buscar.ts`

`buscarContextoJuridico(sb: SupabaseClient, s: SituacaoFiscal): Promise<{titulo: string; texto: string}[]>`.
Monta a query textual a partir das palavras-chave, busca top-N (a definir na
implementação, provavelmente 3-5) trechos mais relevantes em
`documentos_juridicos`. **Nunca lança** — qualquer erro (rede, RPC, tabela
vazia) devolve `[]`, e quem chama trata isso exatamente como "sem contexto
disponível", o mesmo estado de hoje sem esta feature.

### 4.5 Mudança em `montarPrompt`/`gerarRascunhoAction`

`montarPrompt(s: SituacaoFiscal, contexto?: {titulo:string; texto:string}[])`
— parâmetro novo, opcional, aditivo. Quando presente, o prompt ganha uma seção
extra:

```
CONTEXTO DE APOIO (uso interno seu, para redigir com precisão — NÃO cite
nem repita este texto, nem mencione lei/norma/resolução no rascunho):
- <titulo 1>: <texto 1>
- <titulo 2>: <texto 2>
```

As regras já existentes do prompt ("não cite lei", "não invente marcador",
etc.) continuam exatamente como estão — a seção nova só se soma, nunca
substitui nem afrouxa nenhuma regra atual. `gerarRascunhoAction` passa a
chamar `buscarContextoJuridico` antes de `montarPrompt`; se vier vazio (ou a
tabela ainda não tiver sido populada — estado do dia 1, antes do primeiro
`pg_cron` rodar), o prompt sai idêntico ao de hoje.

---

## 5. Tratamento de erro

- **Ingestão:** por fonte, best-effort — DOU falhando não impede a atualização
  do portal RFB/Simples Nacional, e vice-versa. Falha é logada; a Edge
  Function nunca lança de um jeito que derrube o `pg_cron` (mesma disciplina
  de `sync-municipios`).
- **Busca:** nunca lança, nunca bloqueia o admin — degrada para "gerar sem
  contexto extra", o comportamento de hoje.
- **Nenhuma mudança no tratamento de erro do caminho do cliente** — webhook e
  tela de impostos inalterados.

---

## 6. Testes

- `palavras-chave.test.ts` — mapeamento puro, por situação.
- `buscar.test.ts` — busca mockada (Supabase), incluindo o caminho de erro
  devolvendo `[]` sem lançar.
- `prompt.test.ts` (extensão dos testes já existentes) — com e sem contexto,
  confirmando que a regra "não cite lei" continua presente nos dois casos, e
  que o contexto aparece só na seção nova, nunca substituindo a `SITUAÇÃO`.
- Probe somente-leitura (`_probe-base-juridica.mjs`, mesmo molde de
  `_probe-6a.mjs`/`_probe-6b.mjs`, **não versionado** — mesma convenção de
  `scratchpad/` descoberta na Task 4 do 6B): confirma que `anon` não lê
  `documentos_juridicos`.
- Sem teste novo no lado do webhook/6B — nada muda lá.

---

## 7. O que fica fora desta rodada (registrado, não esquecido)

- **Busca vetorial (pgvector + embeddings)** — caminho de evolução descrito
  em §2.1, não construído agora.
- **Contrato exato de consulta ao DOU e estrutura real das páginas do portal
  RFB/Simples Nacional** — ambos exigem sondagem contra a fonte real antes de
  código definitivo, mesmo princípio das Tasks 4/5 do Bloco 6B. A primeira
  task do plano de implementação é essa sondagem, não a ingestão em si.
- **Horário exato do `pg_cron`** — o SQL acima usa `0 6 * * *` como exemplo;
  confirmar com o usuário se há preferência (ex.: evitar competir com
  `sync-municipios`, que já roda à meia-noite UTC).
- **Curadoria da lista de URLs do portal RFB/Simples Nacional** — a spec
  assume uma lista curada, não crawling livre; a lista inicial é definida na
  implementação, não nesta spec.
