# Roteiro de smoke — Bloco 7 (domínio próprio · SLA · conciliação)

> **Data:** 2026-08-12 · **Branch:** `feat/bloco-7-dominio-sla-conciliacao`
> **App rodando em:** http://localhost:3200
> **Cenário:** montado por `node scratchpad/seed-bloco7.mjs` (desfaz com `restore`)
> **Migrations aplicadas no banco:** 0069, 0070, 0071, 0072

## Contas do cenário

| Papel | Conta | O que ver |
|---|---|---|
| Contador | `testeefluxodeautomacao@gmail.com` | §1 domínio, §2 SLA, §3 fila de atendimentos |
| Empresário | `allanvalle@outlook.com` (AL PISCINAS LTDA) | §4 conciliação |

---

## ✅ Já verificado automaticamente (não precisa repetir na tela)

Rodei o cron de verdade contra o banco (`GET /api/cron/obrigacoes` com o
`CRON_SECRET`), e o resultado foi:

```json
{ "sla_avisos": 1,
  "conciliacao": { "conexoes": 1, "importadas": 3, "conciliadas": 1,
                   "sugestoes": 2, "alertas": 0, "erros": [] } }
```

O que isso prova, conferido depois direto nas tabelas:

- **Baixa automática aconteceu e foi só a certa:** a guia de R$ 1.234,56 ficou
  `paga`, com a transação `SMOKE7-exata` amarrada e `conciliacao_origem =
  'conciliacao'`. A guia de R$ 777,00 **não** foi tocada.
- **As duas entradas ambíguas viraram sugestão** (`sugestoes: 2`) e nenhuma deu
  baixa — que é o comportamento que protege o cliente de achar que pagou.
- **SLA alertou uma vez só:** `SMOKE7-velha` (4h de espera, SLA de 2h) foi
  alertada; `SMOKE7-nova` (10 min) não. As três escaladas antigas do 6B já
  tinham sido alertadas na rodada anterior e **não repetiram** — a idempotência
  por `sla_alertado_em` está de pé.
- **Endpoint de verificação de domínio:** host desconhecido → `404 {"erro":
  "dominio nao cadastrado"}`; `localhost` → `400 {"erro":"host ausente"}`
  (host reservado nunca vira domínio de escritório).

---

## §1 — Domínio próprio (contador)

1. Entrar como o contador → **Config. escritório** (`/contador/configuracoes`).
2. Rolar até **Domínio próprio**. Digitar `app.meuescritorio.com.br` → **Salvar**.
   - Esperado: mensagem de sucesso, o estado vira **Aguardando verificação**, e
     aparece o bloco "Como apontar o DNS" com o CNAME.
3. Clicar em **Verificar agora**.
   - Esperado: falha com frase de gente — algo como *"Não conseguimos acessar
     https://app.meuescritorio.com.br. Confira o apontamento de DNS…"*.
   - ⚠️ **Isso é sucesso, não bug.** O domínio não existe de verdade; o que está
     sendo testado é que a falha é explicada sem stack trace e que o estado vira
     "Não verificado" com o motivo na tela.
4. Testar formato inválido: digitar `http://` ou `intranet` → **Salvar**.
   - Esperado: recusa com "Domínio inválido…".
5. Clicar em **Remover**.
   - Esperado: some o bloco de status; o escritório volta a ser atendido só pelo
     domínio da Balu.

> **O que este smoke NÃO alcança:** o caminho feliz do domínio (verificar de
> verdade) precisa de um domínio real apontando para a Vercel — depende do
> cliente, está no card 🔒 "Vercel Domains API + domínio de escritório piloto".

## §2 — SLA configurável (contador)

1. Mesma tela, seção **Prazo de resposta (SLA)**. O campo já está em **2** (o
   seed colocou).
2. Trocar para `0` → **Salvar prazo**. Esperado: recusa ("entre 1 e 720 horas").
3. Voltar para `2` e salvar. Esperado: sucesso.
4. Apagar o campo (vazio) e salvar. Esperado: "SLA removido" — e, com isso,
   nenhum alerta de SLA passa a ser gerado.
   - **Deixar em 2 ao final**, para o §3 fazer sentido.

## §3 — Fila de atendimentos (contador)

1. Menu lateral → **Atendimentos** (`/contador/atendimentos`).
2. Esperado: 5 conversas aguardando, mais antiga primeiro. A `SMOKE7-velha`
   ("Meu DAS desse mes ja venceu?") deve aparecer com **borda vermelha** e
   "esperando há 4h · acima do prazo de 2h". A `SMOKE7-nova` aparece em amarelo,
   sem o aviso de prazo.
3. Clicar em **Marcar respondido** na `SMOKE7-velha`.
   - Esperado: some da lista (o relógio do SLA parou).
4. Abrir o **sino** de notificações.
   - Esperado: existe um aviso "Atendimento sem resposta além do prazo" que leva
     para `/contador/atendimentos`.

## §4 — Conciliação bancária (empresário)

1. Sair e entrar como `allanvalle@outlook.com`, com a empresa **AL PISCINAS
   LTDA** ativa.
2. Menu lateral → **Conciliação** (`/configuracoes/conciliacao`).
3. Esperado: **conta conectada** (o seed criou o consentimento), com o texto de
   quantas guias já foram baixadas por ali.
4. Na seção **Precisam da sua confirmação**: devem aparecer **2 sugestões**,
   ambas de R$ 777,00, com o motivo *"2 entradas batem com a mesma guia"*.
5. Clicar em **É esta guia** numa delas.
   - Esperado: sucesso; a guia de R$ 777,00 fica paga e **a outra sugestão some**
     (a guia deixou de estar em aberto).
6. Ir em **Impostos**: a guia de R$ 1.234,56 e a de R$ 777,00 devem aparecer
   como **pagas**.
7. Voltar em **Conciliação** e clicar em **Desconectar**.
   - Esperado: volta para a tela de consentimento; os lançamentos importados são
     apagados e **as guias continuam pagas** (o que já foi decidido não se
     desfaz).

## §5 — Marca por host (opcional, exige editar o hosts do Windows)

Só faz sentido se você quiser ver o co-branding por domínio funcionando de
verdade em local. Requer apontar um nome para 127.0.0.1 e cadastrar esse mesmo
nome como domínio do escritório, com status `ativo` no banco. Pulável — a
lógica está coberta por 6 testes automatizados, incluindo o de que **dois hosts
diferentes nunca compartilham entrada de cache**.

---

## Ao terminar

```bash
cd app
node scratchpad/seed-bloco7.mjs restore
```

Isso apaga as guias `SMOKE7`, as transações, o extrato mock, a conexão, as
escaladas de teste e zera o SLA/domínio do escritório.

**Depois do smoke:** o combinado é **não empurrar ainda** — o saldo/saque da
subconta Asaas entra na mesma leva, e o push+deploy acontece com tudo junto.
