# Spec — Bloco 7: domínio próprio + SLA de atendimento + conciliação bancária

> **Data:** 2026-08-12 · **Origem:** `PRD-MASTER-Balu-2026-07-24.md` §4, Bloco 7
> (pilares 4 e 8). Última frente do roadmap que não depende de credencial do
> Michel para começar.
> **Estado:** desenho fechado, pronto para virar plano
> **Depende de:** nada bloqueia a escrita do código. Duas fronteiras externas
> ficam atrás de adapter com default seguro (princípio 3.7 do PRD): a **API de
> domínios da Vercel** (o usuário fornece o token depois) e o **provedor de
> Open Finance** (não existe ainda — a rodada inteira roda contra mock).

---

## 1. Objetivo

Três entregas independentes que o PRD agrupou por serem o que falta dos
pilares 4 e 8:

1. **Domínio próprio.** O Bloco A entregou co-branding (logo, nome, WhatsApp
   de suporte). Falta o escritório poder atender a carteira dele em
   `app.escritoriodofulano.com.br` em vez de um caminho dentro do domínio da
   Balu.
2. **SLA de atendimento.** O escritório configura em quantas horas se
   compromete a responder, o cliente vê essa promessa, e o motor do Bloco 1
   avisa **o escritório** quando o prazo estoura.
3. **Conciliação bancária.** Hoje a baixa de pagamento é 100% manual
   (`marcarGuiaPagaAction`). O pilar 4 pede confirmação automática: o extrato
   entra por Open Finance, casa com a guia e dá baixa sozinho — e avisa quando
   passou do vencimento sem pagamento detectado.

---

## 2. As cinco decisões que moldam o desenho

### 2.1 Host é pintura, não autorização — e por isso não precisa de middleware

O PRD sugere host-routing em `src/middleware.ts`. **Não vamos criar
middleware**, por dois motivos.

O primeiro é que não há o que rotear: o app servido em
`app.escritoriodofulano.com.br` é o **mesmo app**, com as mesmas rotas. O host
não decide *qual página*, decide *qual marca aparece* e *qual SLA é exibido*.
Isso um Server Component resolve lendo `headers()` no layout — que é onde o
co-branding do Bloco A já é montado.

O segundo é risco. O projeto não tem middleware nenhum hoje (confirmado: não
existe `src/middleware.ts` em lugar algum). Introduzir um significa colocar
código no caminho de **toda** requisição, incluindo os fluxos de auth do
Supabase — para uma feature de marca. O ganho não paga o risco.

**A regra que fica, e que precisa estar em teste:** o host **nunca** amplia
nem restringe o que alguém vê. Quem decide isso é a RLS, exatamente como
hoje. Um cliente da contabilidade A que abra o domínio da contabilidade B faz
login normalmente e vê **os dados dele**, com a marca de B na tela. Feio, mas
correto — e infinitamente melhor que a alternativa, que seria o host virar uma
segunda fonte de autorização, divergente da RLS.

### 2.2 A verificação do domínio é por HTTP, não por DNS

Para o domínio virar "ativo" é preciso provar que ele aponta para o nosso app.
Duas formas:

- **Registro TXT no DNS.** Prova posse do domínio, mas não prova que o
  apontamento chegou até nós, e exige resolver DNS de dentro da função
  serverless.
- **Token servido pelo próprio host.** O escritório cadastra o domínio, o app
  gera um token, e o servidor faz `GET https://<host>/api/dominio/verificacao`.
  Se a resposta trouxer o token daquele escritório, está provado de uma vez:
  o DNS aponta para nós, o TLS está de pé e é o app da Balu que responde ali.

Fica a segunda. É estritamente mais forte, e é exatamente o estado que
interessa — "esse domínio serve este app agora".

### 2.3 O provisionamento na Vercel é um adapter, e o modo manual é completo

Sem `VERCEL_API_TOKEN` (o caso de hoje), o provedor de domínios é `null` e a
tela entra em **modo manual**: mostra o CNAME a cadastrar, o token de
verificação, e o botão "verificar agora" — que roda a checagem do §2.2. O
fluxo funciona inteiro; só o passo de "adicionar o domínio no projeto da
Vercel" é você quem faz à mão.

Quando o token chegar, o mesmo botão passa a criar o domínio na Vercel antes
de verificar. Nenhuma tela muda. É o padrão que `sendEmail` (no-op sem chave) e
`configDeEnv` do uazapi já estabeleceram — princípio 3.7 do PRD.

### 2.4 O SLA mede a escalada do WhatsApp, e por isso a fila precisa de tela

Um SLA só existe se algo for cronometrável. O único evento de atendimento que
o app registra hoje é a **escalada para humano** do Bloco 6B
(`whatsapp_atendimentos`, notificação `whatsapp_escalado`): a IA não soube
responder e passou para o escritório.

O cronômetro começa aí. Ele para quando alguém do escritório marca a escalada
como **atendida** — e é por isso que a **fila de escaladas entra no escopo
deste bloco**. Sem tela, ninguém marca nada, e o alerta de SLA estourado
dispararia para sempre sem ter como ser fechado: um alarme que não se desliga
é pior que nenhum alarme. A `whatsapp_atendimentos` foi criada como
"service_role apenas, sem tela nesta rodada" (comentário na `0061`); esta é a
rodada em que ela ganha tela.

**Horas corridas, não horas úteis.** Hora útil exige calendário de feriados
municipais/estaduais e jornada configurável — peça inteira, sem valor
proporcional agora. O campo é `sla_resposta_horas` em horas corridas, e o
texto exibido ao cliente diz isso com todas as letras. Evolução documentada,
não construída.

### 2.5 Conciliação: um único ponto de escrita para "guia paga"

Hoje quem dá baixa é a action. Amanhã são dois caminhos (action + conciliação),
e a sessão 22 já mostrou o que acontece quando o mesmo fato tem dois donos:
os filtros de "guia paga" foram esquecidos em três consumidores seguidos, um
de cada vez.

Então a baixa vira **uma RPC só**: `registrar_pagamento_guia(guia, data,
origem, transacao)`. Ela atualiza `guias_fiscais`, resolve as notificações da
guia (a `resolver_notificacoes_guia` da `0067`) e grava `audit_log`. A action
manual passa a chamá-la, e a conciliação chama a mesma. `origem` distingue
`manual` de `conciliacao` para a auditoria — e para o cliente saber por que a
guia dele apareceu paga sozinha.

**Falso-positivo é o risco real da conciliação**, não falso-negativo. Um
pagamento não detectado só mantém o aviso que já existe; uma baixa errada faz
o cliente achar que pagou o que não pagou e tomar multa. Então a baixa
automática exige **match inequívoco**:

- crédito (não débito), valor **exatamente igual** ao da guia em centavos;
- data do lançamento dentro da janela `[vencimento − 30, vencimento + 60]`;
- **exatamente um** candidato de cada lado (uma transação para uma guia).

Empate, valor divergente ou mais de um candidato **não dá baixa**: vira
*sugestão*, que aparece na tela para um humano confirmar — e confirmar chama a
mesma RPC, com `origem = 'conciliacao_confirmada'`.

---

## 3. Modelo de dados

Migrations novas (numeração a confirmar na hora: `0069`+).

### 3.1 Domínio e SLA — colunas em `contabilidades`

| coluna | tipo | nota |
|---|---|---|
| `dominio_customizado` | `text UNIQUE` | host normalizado: minúsculo, sem esquema, sem porta, sem barra |
| `dominio_status` | `text` | `pendente` \| `ativo` \| `erro`, default `pendente` |
| `dominio_token` | `text` | token de verificação (§2.2), gerado no cadastro |
| `dominio_verificado_em` | `timestamptz` | |
| `dominio_erro` | `text` | última falha de verificação, para a tela explicar |
| `sla_resposta_horas` | `int` | `NULL` = escritório não promete SLA; nada é exibido nem alertado |

### 3.2 Branding por host — RPC pública mínima

O visitante **não autenticado** que abre o domínio próprio precisa ver a marca
antes de logar. Logo, uma leitura sem sessão. Ela é uma RPC `SECURITY DEFINER`
com superfície mínima, não um `select` na tabela:

```
branding_por_host(p_host text) → (contabilidade_id, nome, logo_url, sla_resposta_horas)
```

Só devolve linha se `dominio_status = 'ativo'` **e** `status = 'aprovada'`.
Nunca devolve CNPJ, CRC, chave Asaas ou qualquer coluna de `contabilidades`
fora dessas quatro. `GRANT EXECUTE` para `anon` e `authenticated`.

### 3.3 Fila de escaladas — colunas em `whatsapp_atendimentos`

| coluna | tipo | nota |
|---|---|---|
| `contabilidade_id` | `uuid` | preenchido na escalada, via `profile → company → contabilidade` |
| `atendido_em` | `timestamptz` | para o cronômetro do SLA |
| `atendido_por` | `uuid` | membro do escritório |
| `sla_alertado_em` | `timestamptz` | idempotência do alerta, mesmo espírito de `enviada_email_em` |

A tabela hoje é `service_role` apenas (`REVOKE ALL FROM anon, authenticated`).
Ganha RLS de **membro do escritório**: `SELECT` e `UPDATE` restritos a
`contabilidade_id` do usuário, via o helper `minha_contabilidade_membro()` que a
`0035` já criou. O cliente final **não** lê esta tabela — o conteúdo é a
conversa dele, mas a tela é do escritório.

### 3.4 Conciliação — tabelas novas

**`conciliacao_conexoes`** — o consentimento de Open Finance de uma empresa.
`company_id`, `provedor`, `consentimento_id_externo`, `status`
(`pendente`/`ativa`/`expirada`/`revogada`), `consentida_em`, `expira_em`,
`credencial_cifrada` (mesmo `CERT_ENC_KEY`/`lib/crypto` do certificado A1),
`criada_por`. RLS por dono da empresa.

**`conciliacao_transacoes`** — o extrato importado, mínimo necessário:
`company_id`, `conexao_id`, `id_externo` (UNIQUE com `conexao_id` — idempotência
da importação), `data`, `valor_centavos bigint`, `tipo` (`credito`/`debito`),
`descricao`, `guia_id` (preenchida quando concilia), `conciliada_em`,
`conciliacao_origem`. **Não guardamos saldo, nem histórico além da janela
necessária** — LGPD: dado bancário é sensível por consequência, e o mínimo
necessário é o princípio (art. 6º III).

**`conciliacao_extrato_mock`** — a fonte do adapter mock, `service_role`
apenas, populada por seed no smoke. Existe para o mock ser **explícito**: um
mock que derivasse transações das próprias guias em aberto daria baixa em tudo
e provaria nada.

### 3.5 Tipos novos de notificação

`sla_estourado` e `pagamento_nao_detectado` entram no `CHECK` de
`notifications.tipo`. **A constraint tem que ser recriada com a lista inteira
viva** — a `0061` registra o acidente: recriar com a lista do plano teria
apagado silenciosamente `assinatura_trial_acabando`/`assinatura_cobranca_vencida`
e quebrado o cron de billing.

---

## 4. Fluxos

### 4.1 Domínio próprio
1. Escritório digita o domínio em `/contador/configuracoes` → normaliza, valida
   formato, grava `pendente` + gera token.
2. Tela mostra CNAME + token + instruções. Com `VERCEL_API_TOKEN`, o passo de
   registrar na Vercel é automático; sem, é manual.
3. "Verificar agora" → `GET https://<host>/api/dominio/verificacao` → token
   confere → `ativo`. Não confere → `erro` + motivo legível na tela.
4. Layout lê `x-forwarded-host` (Vercel) com fallback para `host`, normaliza,
   chama `branding_por_host` e pinta a marca. Host desconhecido = marca Balu,
   silenciosamente.

### 4.2 SLA
1. Escritório configura `sla_resposta_horas` na mesma tela.
2. O cliente vê a promessa ("respondemos em até N horas") onde o suporte é
   oferecido.
3. Escalada do 6B grava `contabilidade_id`; a fila em
   `/contador/atendimentos` lista as não atendidas com o relógio correndo.
4. Cron do Bloco 1: escalada sem `atendido_em` com idade > `sla_resposta_horas`
   → notificação `sla_estourado` para **os membros do escritório**, uma vez
   (`sla_alertado_em`).

### 4.3 Conciliação
1. Empresa conecta a conta (consentimento) — contra o mock, é um formulário que
   registra a conexão.
2. Cron diário importa transações novas da janela; idempotente por
   `(conexao_id, id_externo)`.
3. Matcher determinístico (§2.5, lib TS pura, centavos inteiros) roda sobre
   guias em aberto: match inequívoco → `registrar_pagamento_guia(..., origem
   'conciliacao')`; ambíguo → sugestão na tela.
4. Guia vencida há mais de 3 dias, empresa **com conexão ativa**, sem pagamento
   detectado → `pagamento_nao_detectado`. Sem conexão ativa não dispara: seria
   ruído duplicado do `das_vencido` que já existe.

---

## 5. O que este bloco NÃO resolve

- Múltiplos domínios por escritório (1 por escritório, como o PRD define).
- E-mails de auth sob o domínio próprio: continuam saindo com a marca Balu
  (decisão do Bloco A, não reaberta aqui). Login por senha no host próprio
  funciona; links de confirmação/reset voltam ao domínio Balu.
- Horas úteis / calendário de feriados no SLA.
- Emissão de boleto próprio do escritório (é Bloco 4).
- Conciliação de honorários (`cobrancas_escritorio`): o matcher é escrito
  genérico, mas esta rodada liga só as guias de DAS.

---

## 6. Landmines

1. **`headers().get('host')`** traz porta em dev e não atravessa o proxy da
   Vercel: usar `x-forwarded-host` primeiro. Normalizar sempre (minúsculo, sem
   porta) antes de comparar com o banco, senão `APP.Escritorio.com.br:443`
   nunca casa.
2. **Cache de RSC por host.** Ler `headers()` torna a rota dinâmica; qualquer
   `unstable_cache` de branding tem que ter o host na chave, senão um escritório
   vê a marca do outro — o pior bug possível desta feature.
3. **Redirect URLs do Supabase Auth** precisam incluir o host próprio se um dia
   quisermos os e-mails sob ele (não nesta rodada — ver §5).
4. **Unidade de `guias_fiscais.valor_total`** tem que ser confirmada contra o
   banco real **antes** de escrever o matcher: o PRD manda dinheiro em centavos
   inteiros, mas esta tabela é anterior a essa regra. Comparar reais com
   centavos daria zero match — ou, pior, match errado por fator 100.
5. **`CHECK` de `notifications.tipo`**: recriar com a lista viva completa (§3.5).
6. **Novas tabelas nascem com privilégio para `anon`/`authenticated`** pelo
   `ALTER DEFAULT PRIVILEGES` do Supabase: `REVOKE ALL` explícito em toda tabela
   nova, lição das `0053`/`0055`/`0058`/`0061`.
7. **PostgREST precisa de reload** depois de tabela/RPC nova
   (`scratchpad/_reload-postgrest.mjs`).
8. **Domínio verificado pode morrer depois** (o escritório muda o DNS). A
   verificação é revalidada pelo cron; ao falhar, volta para `erro` e a marca
   cai para a Balu em vez de quebrar a tela.

---

## 7. Critérios de aceite

- Escritório cadastra domínio, verifica e a carteira abre nele com a marca
  dele; login por senha funciona sob o host próprio.
- Host desconhecido ou não verificado serve a marca Balu, sem erro.
- Cliente da contabilidade A abrindo o domínio de B vê **os dados dele**
  (teste explícito de que host não é autorização).
- SLA configurado aparece para o cliente; escalada não atendida além do prazo
  gera `sla_estourado` uma única vez; marcar como atendida para o relógio.
- Extrato mock com uma transação de valor exato dá baixa automática na guia, a
  notificação de DAS cala junto (via `resolver_notificacoes_guia`), e o
  `audit_log` registra `origem = 'conciliacao'`.
- Duas transações candidatas à mesma guia **não** dão baixa: viram sugestão.
- Guia vencida com conexão ativa e sem pagamento gera
  `pagamento_nao_detectado`; sem conexão ativa, não gera nada.

---

## 8. Dependências externas

| O quê | Trava o quê | Estado |
|---|---|---|
| `VERCEL_API_TOKEN` | só o provisionamento automático | usuário fornece depois; modo manual entrega o fluxo inteiro |
| Domínio real de um escritório piloto | smoke ponta a ponta do §4.1 | não existe ainda |
| Provedor Open Finance + credencial | trocar o mock por extrato real | **não existe**; rodada inteira roda contra mock |
| Consentimento LGPD do cliente para dados bancários | uso real da conciliação | texto de consentimento a redigir com o jurídico |
