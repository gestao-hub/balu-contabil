# Canal de WhatsApp por escritório — multi-tenant do atendimento com IA

> **Data:** 2026-08-19 · **Status:** APROVADA — decisões fechadas na §0, em execução
> **Origem:** pedido do usuário em 19/08/2026, verificado contra o código no
> mesmo dia. **Lançamento marcado para 24/08 (segunda-feira).**
> **Seams principais:** `lib/uazapi/cliente.ts`, `lib/uazapi/payload.ts`,
> `app/api/webhooks/uazapi/route.ts`, `lib/atendimento/prompt.ts`,
> `app/api/cron/obrigacoes/route.ts`, tabela `contabilidades`.

---

## 0. Decisões tomadas com o usuário (19/08/2026)

Fechadas antes da implementação, porque ele **não estará na sessão**. Nenhuma
delas se rediscute amanhã; se algo aqui se mostrar impossível, para-se e
registra-se, em vez de escolher sozinho.

| # | Decisão | Consequência no código |
|---|---|---|
| D1 | **Executar na ordem do plano, parando em ponto seguro** — rápido e assertivo, mas nunca deixando algo pela metade | Cada task termina verde e deployável (§ordem de corte do plano) |
| D2 | **Escritório sem canal conectado → o aviso NÃO sai por WhatsApp** | Cron conta `whatsapp_sem_canal`; e-mail e sino continuam cobrindo o cliente. Aviso fiscal de número desconhecido parece golpe |
| D3 | **Modo ESCRITÓRIO entra agora**, não na fase 2 | Task 11 sobe para a fase 1 (§3.5) |
| D4 | **Carteira completa no modo escritório**: agregados, lista com nomes e consulta a um cliente específico — sempre escopada ao escritório do canal | É a maior superfície de vazamento da frente; exige o teste de isolamento mais rigoroso |
| D5 | **A IA pode dizer:** nome do escritório, prazo de resposta (SLA) e WhatsApp de suporte. **Nunca:** CNPJ, CRC, credenciais, e-mail, **nem o nome do contador responsável** (dado pessoal de funcionário) | Allowlist da §3.4 fechada nesses três campos |
| D6 | **Provisionamento self-service**: o próprio contador conecta pela tela | ⚠️ Cada instância é um recurso no servidor uazapi. Se houver cobrança por instância, o custo cresce por escritório **sem teto** — levantar com o fornecedor antes de abrir para todos |
| D7 | **O número pessoal do usuário fica conectado durante a implementação** e é desconectado ao fim, junto com o desligamento do webhook e a limpeza das conversas de terceiros | Sem isso, a frente iria a produção sem nenhuma mensagem real ter passado pela trava nova |
| D8 | **A instância da plataforma permanece.** O número oficial do Balu (o do admin) entra nela antes do lançamento | O `?s=` legado deixa de ser "transição" e vira o canal permanente das empresas **sem escritório** |

**Leitura de D8 registrada para não virar suposição amanhã:** a instância da
plataforma atende as empresas **sem escritório** (self-service). Cliente que TEM
escritório e escrever nela recebe orientação para procurar o número do escritório
dele — não recebe dado fiscal, pelo mesmo motivo da trava da §3.3. Se essa
leitura estiver errada, é uma constante a mudar, não um redesenho.

## 1. O pedido, na frase do usuário

> "A IA precisa reconhecer o escritório logado e os clientes do escritório. Ela
> nunca pode buscar dados de um escritório diferente daquele em que o
> atendimento está sendo feito. Cada escritório vai cadastrar seu número de
> WhatsApp para receber mensagens dos seus clientes. Se uma empresa perguntar a
> qual escritório está linkada, a IA verifica no sistema e responde com o nome
> do escritório e informações pertinentes, nunca dados sensíveis."

---

## 2. O que existe hoje (verificado no código, 19/08/2026)

### 2.1 🔴 O canal é UM número para a plataforma inteira

`lib/uazapi/cliente.ts:27-31` — `configDeEnv()` lê `UAZAPI_BASE_URL` e
`UAZAPI_TOKEN` de variável de ambiente. Um token, uma instância, um número. Não
há coluna de instância em `contabilidades`; as colunas de canal que existem lá
são `whatsapp_suporte` (exibição), `dominio_*`, `asaas_*` e `sla_resposta_horas`.

`contabilidades.whatsapp_suporte` **não é canal de entrada**: é o contato que
aparece na sidebar do cliente (`app/(auth)/layout.tsx:103-113`), texto na tela.

### 2.2 🔴 Não existe "conta logada" no WhatsApp

O webhook não tem sessão. A identidade vem do **número de quem escreveu**:
`route.ts` busca `profiles` por `whatsapp_numero` (com `variantesDoNumero`, que
tolera o 9º dígito e o formato E.164) e chega à empresa por
`profiles.current_company`. O escritório só entra na **escalação**
(`escalarParaContador`), via `companies.contabilidade_id`.

Quem tem número cadastrado hoje é o **empresário** (opt-in em Conta →
Notificações, `profiles.whatsapp_numero` + `whatsapp_habilitado_em`, migration
0061). O escritório não tem número de entrada nenhum.

### 2.3 🔴 A IA não recebe nada sobre o escritório

`EntradaAtendimento` (`lib/atendimento/prompt.ts`) tem exatamente seis campos:
`pergunta`, `situacaoFiscalTexto`, `contextoJuridico`, `historico`,
`tipoPergunta`, `primeiraInteracao`. O nome do escritório existe no banco
(`companies.contabilidade_id` → `contabilidades.nome`) e **não chega ao prompt**.

Consequência prática: "a qual escritório eu estou vinculado?" hoje é
classificada como `especifica`, não encontra dado, e vira escalação — quando a
resposta está a um join de distância.

### 2.4 🔴 A entrada descarta a identidade da instância

`normalizarEntrada` (`lib/uazapi/payload.ts:97-114`) extrai apenas
`{messageId, from, text, fromMe}`. Mesmo com um número por escritório, o webhook
não saberia **em qual número** a mensagem caiu.

⚠️ E o cabeçalho do próprio módulo registra que **o envelope do webhook não tem
contrato conhecido** ("a documentação é um SPA que não expõe contrato"). Isso
proíbe apostar num campo de instância dentro do corpo — ver §3.2.

### 2.5 🟡 O isolamento é por empresa, com dois furos reais

O caminho do WhatsApp roda com `createAdminClient()` — **service_role, RLS
desligada**. A garantia de isolamento é o filtro escrito no código, não o banco.
Dois pontos concretos:

**Furo A — número duplicado escolhe o primeiro perfil.** A busca faz `.limit(2)`,
e se dois perfis casarem com o mesmo número o código registra `console.warn` e
usa `perfis?.[0]`. Dois clientes de escritórios diferentes com o mesmo número —
ou um número reaproveitado — fazem a resposta sair com dados da empresa errada.
Hoje é improvável; com número por escritório, vira rotina.

**Furo B — histórico escopado só por telefone.** `lerHistorico` busca as últimas
4 trocas do mesmo telefone, sem filtrar empresa ou escritório. Se o número trocar
de empresa, a conversa antiga entra no prompt da nova.

### 2.6 🟢 O que já está pronto e será reaproveitado

- Provisionamento de instância na uazapi: `POST /instance/init`,
  `POST /instance/connect` (paircode), `GET /instance/status`, `POST /webhook`
  — **os quatro validados ao vivo em 19/08/2026**.
- Cifra de credencial: `lib/crypto/envelope.ts` (`cifrarCampo`/`decifrarCampo`,
  AES-256-GCM), já usada para a chave da subconta Asaas.
- `whatsapp_atendimentos.contabilidade_id` **já existe** (migration 0070) —
  hoje preenchido só na escalação.
- Classificação determinística (`lib/atendimento/classificar.ts`), saudação fixa
  (`SAUDACAO_INICIAL`), retentativa do provedor de IA e leitura tolerante da
  resposta — todos de 19/08/2026.

---

## 3. O desenho

### 3.1 Modelo de dados

Migration **0091**, aditiva, em `contabilidades`:

| coluna | tipo | para quê |
|---|---|---|
| `uazapi_instancia_id` | `text` | id da instância na uazapi |
| `uazapi_token_cifrado` | `text` | token da instância, **sempre** `enc:v1:` |
| `uazapi_numero` | `text` | número conectado, só dígitos (exibição e conferência) |
| `uazapi_status` | `text` | `desconectado` \| `conectando` \| `conectado` |
| `uazapi_webhook_token` | `text` | segredo **por escritório** que identifica o canal |
| `uazapi_conectado_em` | `timestamptz` | quando pareou |

- `uazapi_webhook_token`: `UNIQUE`, 32 bytes aleatórios em hex, gerado no
  provisionamento. É ele que identifica o tenant na entrada (§3.2).
- **`GRANT` por coluna**, no padrão da 0076: `authenticated` recebe `SELECT` de
  `uazapi_numero` e `uazapi_status` (a tela precisa mostrar), e **nunca** de
  `uazapi_token_cifrado` nem de `uazapi_webhook_token`. Escrita só por
  `service_role`.

### 3.2 Como a entrada identifica o escritório — e por que não pelo payload

**Decisão: URL de webhook por escritório**, `\?t=<uazapi_webhook_token>`.

O caminho óbvio seria ler a instância do corpo da mensagem. Está proibido pelo
que já sabemos: o envelope da uazapi não tem contrato conhecido (§2.4), e o
projeto já pagou uma vez por apostar em formato de payload — em 12/08 a mensagem
chegava e o webhook não produzia nem linha de auditoria.

A URL é nossa, não deles. `POST /webhook` é configurado por nós no
provisionamento, com o token do escritório embutido, e o escritório nunca vê
essa URL.

**Compatibilidade durante a virada:** o `\?s=<UAZAPI_WEBHOOK_SECRET>` global
continua válido e serve a instância da plataforma (a que está pareada hoje).
Precedência: se vier `t`, é canal de escritório; senão, canal da plataforma.
A retirada do caminho legado é task de fase 2, não do lançamento.

**Reforço opcional (defesa em profundidade):** quando o payload trouxer o
`owner`/número da instância, conferir contra `uazapi_numero`. Divergência →
recusa + `audit_log`. **Não pode falhar fechado quando o campo estiver ausente**,
porque a presença dele não é garantida.

### 3.3 A trava de isolamento — o coração desta spec

Depois de identificar o escritório **E** pelo token e o telefone do remetente:

```
candidatos = profiles onde whatsapp_numero ∈ variantesDoNumero(telefone)
             E (empresa do perfil pertence a E  OU  perfil é membro de E)
```

Três desfechos, todos determinísticos:

1. **Um candidato, empresa de E** → modo CLIENTE. Responde com a situação fiscal
   daquela empresa. Escala para E quando não resolver.
2. **Um candidato, membro de E** → modo ESCRITÓRIO (§3.5).
3. **Nenhum candidato** → responde só dúvida geral (comportamento atual), e a
   frase de "não identificamos sua conta" **não confirma nem nega** cadastro em
   outro escritório.

E a regra que dá nome à spec:

> **Se o perfil existe mas a empresa dele NÃO pertence a E, o atendimento é
> recusado como se não houvesse cadastro.** Nunca se responde com dado de uma
> empresa por um canal que não é o do escritório dela — e a recusa não revela
> que a pessoa é cliente de outro escritório.

**Mais de um candidato depois do filtro por escritório → recusa + auditoria.**
Substitui o `perfis?.[0]` de hoje (furo A). Adivinhar qual dos dois é pior que
não responder: uma das duas respostas seria dado da empresa errada.

### 3.4 O que a IA passa a saber do escritório

Campo novo e **opcional** em `EntradaAtendimento`:

```ts
escritorio?: {
  nome: string;
  slaHoras: number | null;
  whatsappSuporte: string | null;
};
```

**Allowlist explícita — o que pode ser dito:** nome do escritório, prazo de
resposta (SLA), contato de suporte, e o fato de a empresa estar vinculada a ele.

**Nunca, nem se perguntado:** CNPJ e CRC do escritório, e-mail de membros,
credenciais, dados de subconta/banco, quantidade ou identidade de outros
clientes, valores de outros clientes. A instrução vai no prompt **e** o dado
sensível não é carregado — a garantia é a ausência, não a boa vontade do modelo.

Com isso, "a qual escritório eu estou vinculado?" passa a ser `geral` do ponto de
vista de dado sensível e é respondida na hora, sem escalar.

### 3.5 Modo ESCRITÓRIO (quem escreve é membro do escritório)

Quando o telefone casa com um membro de E (`contabilidade_membros` + o
`whatsapp_numero` do perfil dele), o assistente ganha um contexto de carteira:

- total de clientes ativos, quantos em situação irregular, quantas guias vencidas
  — **agregados**, calculados pelo mesmo `painel_contador` que a tela usa;
- consulta a UM cliente específico **exige** que a empresa seja da carteira de E.

Isso é o item "ela visualizará todas as empresas que o escritório presta
serviço". ⚠️ É a parte mais cara da frente e a que menos bloqueia o piloto —
proposta como **fase 2** (§6).

### 3.6 Saída: cada aviso pela instância certa

Hoje o cron manda tudo pelo número global (`configDeEnv()` em
`api/cron/obrigacoes/route.ts:16`). Com número por escritório, o aviso de DAS de
um cliente tem de sair **pelo número do escritório dele** — senão o cliente
recebe cobrança de um número desconhecido, que é exatamente o que destrói a
confiança no canal.

Regra: resolver a instância por `company → contabilidade`. Sem instância
conectada, cai para a instância da plataforma se houver; sem nenhuma, **pula e
conta** (`whatsapp_sem_canal` na resposta do cron), nunca manda pelo número
errado.

### 3.7 Provisionamento (tela do contador)

Página nova `/contador/configuracoes/whatsapp`, na seção que já existe no menu:

1. **Conectar** → cria a instância (`/instance/init`, admin token, server-side),
   grava id/token cifrado/webhook token, configura o webhook com a URL do
   escritório e pede o **código de pareamento** para o número informado.
2. Mostra o código (expira em minutos, com botão "gerar outro") e faz *polling*
   de `/instance/status` até `conectado`.
3. Conectado: mostra o número, desde quando, e botão **Desconectar**.
4. `excludeMessages: ["wasSentByApi","fromMe","isGroup"]` **sempre** — grupo não
   entra, eco não volta.

O `UAZAPI_ADMIN_TOKEN` nunca sai do servidor e nunca aparece na tela.

---

## 4. Riscos e limites, declarados

1. **Cada instância é um WhatsApp real.** Exige um chip/aparelho do escritório e
   pareamento manual. Instâncias caem (`status: disconnected` é o estado de 24
   das 37 instâncias do servidor hoje) — precisa de aviso ao escritório quando
   cair, senão o canal morre em silêncio. Fase 2.
2. **Custo por instância** na uazapi não foi levantado. Antes de vender o
   recurso, confirmar o modelo de cobrança do servidor `grupoide.uazapi.com`.
3. **Servidor compartilhado.** Aquele servidor hospeda 37 instâncias, quase todas
   de clientes de outros produtos. O provisionamento cria instâncias novas e
   **jamais toca nas existentes** — nome sempre prefixado com `balu-`.
4. **O rate limit precisa ser por (escritório, telefone)**, não só por telefone:
   hoje `limitar('uazapi-webhook:' + from, 30, 60)` deixaria um número esgotar a
   cota dele em todos os canais.
5. **service_role continua no caminho.** Esta spec **não** troca o webhook para
   RLS — seria refatoração grande na véspera do lançamento. A contrapartida é
   teste de isolamento executado (§5), no padrão dos `idor-actions-*.spec.ts`.
6. **LGPD:** o conteúdo das conversas continua no nosso banco, agora segmentado
   por escritório. O inventário de dados precisa de uma linha nova.

---

## 5. Critérios de aceite

Cada um é verificável; nenhum é "olhar a tela e achar bom".

1. Mensagem no canal do escritório **A**, vinda de cliente do escritório **B**,
   **não** recebe dado fiscal e **não** revela vínculo com B. Auditada.
2. Mesmo número cadastrado em dois perfis do MESMO escritório → recusa +
   `audit_log`, sem resposta com dado de nenhum dos dois.
3. "Qual escritório cuida da minha empresa?" responde com o nome correto do
   escritório vinculado, em uma mensagem, sem escalar.
4. A resposta **nunca** contém CNPJ, CRC ou e-mail do escritório — teste com
   pergunta direta ("me passa o CNPJ do escritório").
5. O histórico injetado no prompt só traz trocas do mesmo telefone **no mesmo
   escritório**.
6. Aviso de DAS de cliente do escritório A sai pela instância de A; sem instância
   conectada, o cron conta `whatsapp_sem_canal` e não envia por outro número.
7. Token da instância nunca aparece em resposta HTTP, log ou tela — nem para o
   AdminBalu.
8. `tsc` 0 · `vitest` verde · `next build` limpo.

---

## 6. Faseamento (lançamento é 24/08)

**Fase 0 — os dois furos (independe do resto, entra já).** Furo A e Furo B da
§2.5. Pequenos, valem para o modelo atual.

**Fase 1 — MVP do multi-tenant, alvo do lançamento.** Migration 0091,
provisionamento, roteamento por token, trava de isolamento, dados do escritório
no prompt, saída pela instância certa.

**Fase 2 — depois do lançamento.** Modo escritório com carteira (§3.5), aviso de
queda de instância, retirada do caminho legado `?s=`, migração do rate-limit.

⚠️ **Avaliação honesta de prazo:** a fase 1 não é trabalho de um dia para uma
pessoa só. Se na terça o piloto começa com **um** escritório, a alternativa
defensável é lançar com o número único da plataforma (como está hoje, já
funcionando) e entregar o multi-tenant na semana seguinte. A trava de isolamento
da §3.3, porém, é barata e deve entrar **de qualquer forma** — ela protege
inclusive o modelo atual.

---

## 7. Fora de escopo, explicitamente

- Migrar o histórico de conversas já existente para o novo escopo.
- Múltiplos números por escritório.
- Atendimento humano dentro do app (a escalação continua sendo notificação).
- Envio de mídia (só texto, como hoje).
- Trocar `service_role` por RLS no webhook.
