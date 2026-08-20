# Plano — canal de WhatsApp por escritório (multi-tenant do atendimento)

> **STATUS: EXECUTADO em 19/08/2026 (sessão 29).** Fases 1 e 2 concluídas, com
> os quatro critérios de aceite provados contra produção. A task 14 (retirar o
> caminho legado) foi CANCELADA pela decisão D8 — a instância da plataforma
> permanece, com o número oficial do Balu. Ver o bloco da sessão 29 no
> CHECKPOINT.
>
> **Spec:** `docs/superpowers/specs/2026-08-20-canal-whatsapp-por-escritorio-design.md`
> **Escrito em:** 2026-08-19 · **Execução prevista:** 2026-08-20
> **Lançamento:** 24/08 (segunda). Ver §"Ordem de corte" no fim — o que sai se
> o tempo apertar já está decidido aqui, e não no meio da execução.
>
> Regra do projeto: **cada task termina com verificação executada**, e nenhuma
> task depende de credencial que ainda não temos.

---

## Fase 0 — os dois furos de isolamento (independentes, entram já)

### Task 1 — o número duplicado deixa de "escolher o primeiro"

**Arquivo:** `app/src/app/api/webhooks/uazapi/route.ts` (busca de `profiles`).

Hoje: `.limit(2)`, `console.warn` se vier mais de um, e usa `perfis?.[0]`.

Fazer: quando restar mais de um candidato, **não atender** — gravar em
`audit_log` (`acao: 'uazapi.numero_ambiguo'`, meta com a quantidade e o telefone
mascarado, **nunca** a mensagem) e responder a frase neutra de não-identificação.

Por quê: adivinhar entre dois perfis significa que uma das duas respostas leva
dado da empresa errada. Não responder é o único desfecho seguro.

**Verificar:** teste novo em `route.test.ts` — dois perfis casando com o mesmo
número ⇒ `gerarTexto` não é chamado, nenhum dado fiscal sai, `audit_log` recebe
uma linha.

### Task 2 — histórico escopado, não só por telefone

**Arquivo:** `route.ts`, função `lerHistorico`.

Fazer: aceitar um escopo (`companyId` quando houver, `contabilidadeId` quando o
canal for de escritório) e filtrar por ele além do telefone.

**Verificar:** teste que injeta trocas antigas do mesmo telefone com outra
empresa e prova que elas **não** entram no prompt.

---

## Fase 1 — MVP multi-tenant

### Task 3 — migration 0091: instância por escritório

**Arquivo:** `app/supabase/migrations/0091_whatsapp_por_escritorio.sql`

Colunas em `contabilidades` (todas `IF NOT EXISTS`, aditiva e idempotente):
`uazapi_instancia_id`, `uazapi_token_cifrado`, `uazapi_numero`, `uazapi_status`
(default `'desconectado'`, CHECK nos três valores), `uazapi_webhook_token`
(**UNIQUE**), `uazapi_conectado_em`.

`GRANT` por coluna, no padrão da 0076: `authenticated` só `SELECT` de
`uazapi_numero` e `uazapi_status`. **Nenhum grant** sobre `uazapi_token_cifrado`
e `uazapi_webhook_token` — nem SELECT.

⚠️ Aplicar pelo runner do scratchpad (`SUPABASE_PASSWORD` do `.env.local`),
nunca pelo MCP — ver a memória do projeto sobre isso.

**Verificar:** releitura das colunas e dos grants no banco; provar com
`SET ROLE authenticated` que o token **não** é legível.

### Task 4 — resolver a config da instância a partir do escritório

**Arquivo novo:** `app/src/lib/uazapi/instancia.ts`

- `configDoEscritorio(admin, contabilidadeId): Promise<ConfigUazapi | null>` —
  lê a linha, decifra com `decifrarCampo`, devolve `null` se não houver instância
  conectada.
- `configDaPlataforma(): ConfigUazapi | null` — o `configDeEnv()` atual, renomeado
  para o nome dizer o que ele é.
- `escritorioPorWebhookToken(admin, token)` — a busca do tenant na entrada.

Por quê separado: `cliente.ts` continua "um texto entra, uma mensagem sai"; quem
sabe de tenant é este módulo.

**Verificar:** unitários com mock de Supabase — token cifrado volta decifrado;
escritório sem instância devolve `null`; token inválido devolve `null` (e não
lança).

### Task 5 — a entrada identifica o escritório

**Arquivos:** `route.ts`, `lib/uazapi/payload.ts`.

- Ler `t` da query. Com `t` → `escritorioPorWebhookToken`; sem `t` → caminho da
  plataforma pelo `s` de hoje (compatibilidade declarada na spec §3.2).
- `t` presente e desconhecido → `{ok:false, reason:'canal_desconhecido'}`, HTTP
  200 (contrato do arquivo), com `audit_log`.
- `normalizarEntrada` passa a devolver também `instanciaOwner` quando o payload
  trouxer — usado só como conferência opcional, **nunca** como fonte de verdade.

**Verificar:** testes de rota para os quatro casos (t válido, t inválido, sem t
com s válido, sem t e sem s).

### Task 6 — a trava de isolamento

**Arquivo:** `route.ts`.

Implementar §3.3 da spec: filtrar candidatos por escritório **antes** de decidir
o modo; recusar quando a empresa do perfil não pertence ao canal; recusa
**indistinguível** de "número não cadastrado" (não revelar vínculo com outro
escritório).

⚠️ Esta é a task que não pode ser cortada. Ela protege inclusive o modelo atual.

**Verificar:** teste com cliente do escritório B escrevendo no canal do A ⇒
nenhuma chamada de IA com dado fiscal, resposta neutra, `audit_log` gravado.

### Task 7 — dados do escritório no prompt

**Arquivos:** `lib/atendimento/prompt.ts`, `route.ts`.

Campo `escritorio?: { nome, slaHoras, whatsappSuporte }` em `EntradaAtendimento`,
bloco novo no prompt com a **allowlist** e a proibição explícita (CNPJ, CRC,
e-mail, credenciais, outros clientes).

**Verificar:** testes de prompt (o bloco aparece quando há escritório e some
quando não há; a proibição está no texto) + um teste de rota provando que a
pergunta "qual escritório cuida da minha empresa?" chega à IA com o nome.

### Task 8 — provisionamento pela tela do contador

**Arquivos:** `app/(auth)/(gated)/contador/configuracoes/whatsapp/` (page +
client + actions), item no `MenuLateral` (seção que já existe).

Fluxo da spec §3.7: conectar → paircode → polling de status → conectado →
desconectar. Nome da instância **sempre** prefixado `balu-` (o servidor é
compartilhado com 37 instâncias de terceiros).

Guards: só `contador` do próprio escritório; `UAZAPI_ADMIN_TOKEN` só no servidor;
token da instância nunca volta ao cliente.

**Verificar:** teste das actions com mock da uazapi (criar, parear, status,
desconectar) + teste de guard (contador de outro escritório recebe recusa).

### Task 9 — saída pela instância certa

**Arquivos:** `api/cron/obrigacoes/route.ts`, `lib/uazapi/instancia.ts`.

Resolver a instância por `company → contabilidade`; cair para a plataforma se não
houver; sem nenhuma, **pular e contar** (`whatsapp_sem_canal` no resumo). Cache
por execução para não reler a mesma contabilidade a cada notificação.

**Verificar:** teste do cron com duas empresas de escritórios diferentes ⇒ cada
mensagem sai pela config certa; empresa sem canal incrementa o contador e não
envia.

### Task 10 — verificação de ponta a ponta

- `npx tsc --noEmit && npx vitest run && npm run build`, **a partir de `app/`**.
- Os 8 critérios de aceite da spec, um a um, com evidência colada no CHECKPOINT.
- Smoke real: parear uma instância `balu-teste`, mandar mensagem de um número
  cliente e de um número estranho, conferir os dois desfechos.

---

## Fase 2 — depois do lançamento (não entra em 24/08)

- **Task 11** — modo escritório com carteira (spec §3.5).
- **Task 12** — aviso ao escritório quando a instância cair (24 das 37 instâncias
  do servidor estão desconectadas agora; isso vai acontecer).
- **Task 13** — rate-limit por (escritório, telefone).
- **Task 14** — retirar o caminho legado `?s=` quando todos migrarem.
- **Task 15** — linha nova no inventário de dados (LGPD).

---

## Ordem de corte (decidida agora, não no meio da execução)

Se o tempo apertar, corta-se **de baixo para cima**:

| Prioridade | Tasks | Se cair, o que acontece |
|---|---|---|
| **Inegociável** | 1, 2, 6 | Sem elas o risco de vazamento entre carteiras existe **hoje** |
| **Alta** | 3, 4, 5 | Sem elas não há multi-tenant; o canal segue único (funciona) |
| **Média** | 7 | A IA continua sem saber o escritório — pedido do usuário fica devendo |
| **Baixa** | 8, 9 | Sem 8, provisionamos na mão (fizemos isso hoje em 10 min). Sem 9, avisos saem pelo número da plataforma |

**Plano B, se a fase 1 não fechar até domingo:** lançar com o número único da
plataforma — que já está de pé, pareado e testado — com as tasks 1, 2 e 6
aplicadas. É um lançamento honesto: um canal, isolamento provado, e o
multi-tenant entra na semana seguinte sem retrabalho, porque as tasks 1/2/6 são
as mesmas nos dois caminhos.

---

## Armadilhas registradas antes de começar

1. **Não apostar no payload da uazapi.** O envelope não tem contrato conhecido; a
   identidade do canal vem da URL. Já perdemos uma rodada por isso em 12/08.
2. **`service_role` no webhook.** RLS não vai salvar filtro esquecido — por isso
   as tasks 1, 2 e 6 exigem teste executado, não revisão de código.
3. **Servidor compartilhado.** Criar instância nova, jamais reaproveitar; nome
   com prefixo `balu-`.
4. **O paircode expira em minutos.** A tela precisa do botão "gerar outro" desde
   a primeira versão — descobrimos isso na prática hoje.
5. **`enviarMensagem` não distingue "sem credencial" de "erro de rede"** no log.
   Com multi-tenant, um escritório sem instância vira ruído; daí o contador
   `whatsapp_sem_canal` em vez de log solto.
6. **Migration 0091 pelo runner**, nunca pelo MCP do Supabase (conta errada).
