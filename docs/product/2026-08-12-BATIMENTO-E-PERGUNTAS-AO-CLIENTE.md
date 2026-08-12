# Batimento geral × o que falta para o Michel operar — e as perguntas a fazer a ele

> **Data:** 2026-08-12 · **Para:** reunião com o cliente (Michel)
> **Fontes cruzadas:** `planejamento.pdf` (os 8 pilares e a marcação verde/amarela) ·
> `BATIMENTO-PLANEJAMENTO-VERDE.md` (o batimento de junho, agora refeito) ·
> `devolutiva-dev-preenchido.html` (**respostas reais do Michel**, extraídas do
> seed JS embutido — os checkboxes do arquivo estão em branco, as respostas
> estavam em `prefill()` e em `window.__BALU_SEED__`) · `PRD-MASTER-Balu-2026-07-24.md` ·
> código real em `app/src` e migrations até `0070`.
>
> **Como ler:** ✅ entregue · 🟡 parcial · 🔴 não entregue · 🔒 travado por
> credencial/terceiro (o código pode estar pronto).

---

## 1. O placar do VERDE (o que foi prometido na entrega)

O `planejamento.pdf` marcou **22 itens em verde** = comprometidos no escopo. Em
junho, o batimento deu 8 ✅ / 5 🟡 / 9 🔴. Refeito hoje:

| § | Item verde | Jun/26 | **Hoje** | Observação |
|---|---|:---:|:---:|---|
| 1 | Fluxo conversacional com IA no cadastro | 🔴 | **🔴** | Segue por cards + formulários. **O Michel marcou "essencial para lançar"** (6.1) |
| 1 | Perfil/CNAE/regime automáticos | ✅ | ✅ | Autofill por CNPJ (Focus) + IBGE por CEP |
| 2 | Abertura 100% online (MEI + ME) | 🟡 | **🟡** | Coleta completa (Bloco 2). Sem RedeSim — **mas ele respondeu que a equipe abre manualmente** (4.2) |
| 2 | Checklist automático de documentos | 🟡 | **✅** | `lib/abertura/checklist.ts`, com status por documento |
| 2 | Contrato social + envio aos órgãos | 🔴 | **🟡** | **Minuta gerada** (`lib/abertura/minuta/`). Envio aos órgãos segue manual, por decisão dele |
| 2 | Status em tempo real | 🟡 | **✅** | Etapa muda → notificação (`abertura_etapa`) no motor do Bloco 1 |
| 3 | Emissor NFS-e integrado | ✅ | ✅🔒 | Falta ligar produção (contrato Focus + cert A1) |
| 3 | Histórico simples e exportável | ✅ | ✅ | CSV com BOM UTF-8 |
| 3 | Preview do imposto antes de emitir | ✅ | ✅ | |
| 3 | Alerta de limite de faturamento | ✅ | ✅ | MEI 81k / Simples 4,8M |
| 3 | XML + PDF automáticos | ✅ | ✅ | |
| 4 | DAS mensal e DAS-MEI automáticos | ✅ | ✅ | |
| 4 | Geração da guia | ✅ | ✅🔒 | Depende de procuração RFB por CNPJ |
| 4 | Explicação em português simples | 🔴 | **✅** | Bloco 6A: catálogo aprovado pelo admin, IA redige o rascunho |
| 7 | Entrega automática DASN-SIMEI / Simples | 🟡 | **🟡** | PGDAS-D **transmite de verdade**; DASN-SIMEI e DEFIS são **assistidas** (o cliente entrega). ⚠️ Ele respondeu "o app transmite oficialmente" (5.1) |
| 7 | Alertas automáticos | 🟡 | **✅🔒** | Bloco 1 completo (cron, e-mail, WhatsApp, sino). Os dois canais externos estão bloqueados por credencial |
| 7 | Zero ação manual do cliente | 🔴 | **🟡** | Melhorou muito, mas a declaração anual ainda pede ação |
| 8 | Logo do escritório | 🔴 | **✅** | Bloco A |
| 8 | Nome da contabilidade | 🔴 | **✅** | Bloco A |
| 8 | WhatsApp do escritório | 🔴 | **✅** | Bloco A |
| 8 | SLA configurável | 🔴 | **✅** | Bloco 7, Frente 2 (hoje) |
| 8 | Painel: clientes, irregulares, inadimplentes | 🔴 | **✅** | Bloco A: semáforo de 5 critérios + honorários |

**Placar novo: 17 ✅ · 4 🟡 · 1 🔴** (era 8 ✅ / 5 🟡 / 9 🔴).

O único **🔴 puro** é o onboarding conversacional com IA — e é justamente um
item que ele marcou como **essencial para lançar**.

---

## 2. O que ele respondeu que ainda não bate com o que existe

Extraído das respostas dele. São os pontos que **precisam de conversa**, não de código imediato.

### 2.1 "Não é o que eu esperava" — duas telas
Ele reprovou explicitamente **duas** telas, e depois explicou o que queria:

**Painel inicial (2.2).** Ele espera: *"saldo disponível real, faturamento do
mês, impostos a pagar, notas emitidas, alertas de vencimento, pendências e
resumo financeiro"*.
Hoje o dashboard tem 4 cartões: Receita do mês, Próxima obrigação, Última nota,
Notas no mês. **Falta:** saldo disponível real, pendências consolidadas e resumo
financeiro. E "saldo disponível real" é o item que ninguém definiu ainda — ver
pergunta **P1**.

**Honorários (2.11).** Ele espera: *"cobrança do contador contra o cliente, com
valor, vencimento, status pago/em aberto/atrasado, cliente vinculado e
recorrência mensal"*.
Isso **está entregue** desde o Bloco A (honorários v2 + cron de recorrência).
A reprovação é de **junho**, anterior à entrega — provavelmente já está resolvida,
mas ele nunca viu. Ver **P2**.

### 2.2 "N vimos funcionar" — 9 dos 12 itens
Em nove itens da seção 2 ele escreveu *"n vimos funcionar"* / *"não chegamos a
ver"*. Isso **não é reprovação de escopo, é falta de demonstração.** É o achado
mais importante deste batimento: **boa parte do que existe nunca foi mostrada ao
cliente.** Ver **P3**.

### 2.3 Transmissão oficial × fluxo assistido
Ele marcou **"o app transmite oficialmente (automático)"** (5.1). Nós entregamos
o PGDAS-D com transmissão real, mas **DASN-SIMEI e DEFIS assistidas** — o app
pré-preenche e o cliente entrega. Foi decisão de produto nossa (registrada no
Bloco 3), tomada porque a SERPRO não expõe serviço de transmissão para DASN-SIMEI.
**Ele pode não saber disso.** Ver **P4**.

### 2.4 Domínio próprio: construímos algo que ele não pediu
Em 3.4 ele marcou logo, nome, WhatsApp e **e-mails com a marca do escritório**.
**Não marcou "domínio próprio" nem "cores da marca".**
Hoje entregamos o domínio próprio (Frente 1 do Bloco 7) e o SLA. Nenhum dos dois
estava na lista dele — o SLA veio do pilar 8 do planejamento, e o domínio, do PRD
Master. Já está feito e não se perde, mas **"e-mails com a marca do escritório",
que ele pediu, está só parcialmente entregue**: as notificações usam o nome do
escritório como remetente, mas os e-mails de autenticação continuam Balu (decisão
do Bloco A). Ver **P5**.

### 2.5 Conflito não resolvido sobre abertura de empresa
Em 4.1 marcou "essencial para lançar" e em 4.2 "o app coleta, minha equipe abre".
Em 4.3, para "quais tipos de empresa o Balu vai abrir", marcou **"não vou abrir
empresas pelo app"**. O próprio formulário já sinalizou o conflito. Ver **P6**.

### 2.6 O que ele deixou em branco (e trava o planejamento)
- **8.1** — os 3 itens mais importantes para o app ser "lançável". **Em branco.**
- **8.4** — quantas empresas-piloto no lançamento. **Em branco.**
- **8.5** — a definição de "pronto para lançar". **Em branco.**
- **8.3** — data-alvo: só *"o quanto antes, já está atrasado"*, sem data.
- **6.4** — qual recurso de IA "vende" o Balu. **Em branco.**

Sem 8.1 e 8.5 não existe critério objetivo de lançamento — é o que mais atrapalha
hoje.

---

## 3. O que falta para rodar numa contabilidade de verdade

Separado pelos três painéis, como você descreveu.

### 3.1 Painel do cliente final (empresário/MEI)
| Falta | Gravidade | Natureza |
|---|---|---|
| Saldo disponível real, pendências e resumo financeiro no dashboard | Alta — ele reprovou a tela | Produto: **precisa de definição** (P1) |
| Onboarding conversacional com IA | Alta — ele marcou "essencial" | Desenvolvimento (~1 bloco) |
| IA sugerindo código de serviço na emissão (6.3, "essencial") | Média | Desenvolvimento |
| Emissão de NFS-e em **produção** | Bloqueante para uso real | 🔒 Contrato Focus + cert A1 |
| Avisos por e-mail chegando de fato | Bloqueante | 🔒 Verificar domínio no Resend |
| Avisos e atendimento por WhatsApp | Bloqueante para o pilar 6 | 🔒 Instância uazapi |

### 3.2 Painel do contador
| Falta | Gravidade | Natureza |
|---|---|---|
| Nada do que ele listou em 3.2 | — | **Tudo entregue** (lista, irregulares, honorários, faturamento, resumo) |
| Cobrar o cliente final pela subconta do escritório | Média | 🔒 Asaas: `ASAAS_WEBHOOK_SECRET` + aprovação comercial |
| Conciliação bancária (baixa automática) | Baixa para o lançamento | Frente 3 do Bloco 7 + 🔒 provedor Open Finance |

O painel do contador é, hoje, **a área mais completa em relação ao que ele pediu** —
exatamente o oposto de junho, quando era o maior buraco.

### 3.3 Painel admin (o que o Michel usa para operar)
Existe: visão geral, escritórios (com aprovação), empresas, usuários, assinaturas,
catálogo de explicações e configurações.

| Falta | Gravidade | Natureza |
|---|---|---|
| Um AdminBalu para o **Michel** | Bloqueante operacional | Falta o UUID do usuário dele — pendência antiga (P7) |
| Métricas de operação (quantos clientes por escritório, receita, inadimplência da plataforma) | Média | Não especificado — ver P8 |
| Separação de ambiente (staging × produção) | Alta em risco | Dívida de infra: **um único Supabase**, produção e desenvolvimento no mesmo banco |

### 3.4 Credenciais e contratos que travam o lançamento
1. **Asaas**: `ASAAS_WEBHOOK_SECRET` (≥32 chars) + `ASAAS_ENV=prod` + aprovação comercial para subcontas.
2. **WhatsApp**: instância uazapi (`UAZAPI_BASE_URL`, `UAZAPI_TOKEN`).
3. **Resend**: verificação do domínio de e-mail.
4. **Focus**: contrato de produção + certificado A1 de cada piloto.
5. **SERPRO**: credenciais validadas ✅, mas falta **procuração eletrônica RFB por CNPJ**.
6. **Open Finance**: provedor não escolhido (só afeta a conciliação).

---

## 4. Perguntas para o cliente

Ordenadas por impacto. As 5 primeiras destravam decisões que hoje estão paradas.

### Bloqueiam o planejamento
**P1. "Saldo disponível real" no painel — o que é exatamente?**
Ele reprovou o painel inicial e pediu esse item. Não sabemos se é (a) saldo em
conta bancária (exigiria Open Finance), (b) faturamento menos impostos previstos,
(c) o que sobrou depois das obrigações do mês, ou (d) outra coisa. É a diferença
entre uma conta simples e uma integração bancária inteira.

**P2. Os 3 itens que tornam o app "lançável" (8.1) e a definição de "pronto" (8.5).**
Ficaram em branco. Sem eles não há critério objetivo — e ele diz que já está atrasado.

**P3. Podemos marcar uma demonstração guiada do que já existe?**
Em 9 dos 12 itens ele escreveu "não vimos funcionar". Grande parte do que ele
acha que falta pode já estar pronto há semanas. Isso muda a conversa inteira.

**P4. DASN-SIMEI e DEFIS: ele aceita o fluxo assistido?**
Ele marcou "o app transmite oficialmente". A SERPRO não expõe transmissão de
DASN-SIMEI; o app pré-preenche, o cliente confere e entrega, e registramos o
comprovante. Precisa saber se isso atende — ou se ele espera algo que não é
tecnicamente possível hoje.

**P5. "E-mails com a marca do escritório" — até onde?**
Hoje as notificações saem com o nome do escritório como remetente, mas os
e-mails de autenticação (confirmação, redefinição de senha) continuam Balu.
Ele quer o pacote inteiro sob a marca do escritório? Isso exige domínio de
e-mail verificado **por escritório**.

### Escopo
**P6. Abertura de empresa: abre ou não abre pelo app?**
Em 4.1 é "essencial para lançar", em 4.2 "minha equipe abre manualmente", e em
4.3 "não vou abrir empresas pelo app". As três não fecham.

**P7. Qual é o e-mail/usuário do Michel para virar AdminBalu?**
Pendência antiga. Sem isso ele não consegue aprovar escritórios nem operar a
plataforma. (O AdminBalu do Walace já existe.)

**P8. O que o painel admin precisa mostrar para ele "controlar tudo"?**
Hoje tem escritórios, empresas, usuários e assinaturas. Falta saber se ele quer
métricas de operação: receita da plataforma, inadimplência, uso por escritório.

**P9. Onboarding conversacional com IA é mesmo essencial para o lançamento?**
É o único item verde ainda 🔴, e ele detalhou 3 fluxos (cadastro de contador,
cadastro de empresa existente, solicitação de abertura). É cerca de um bloco de
trabalho. Fazer antes ou depois de lançar?

**P10. IA sugerindo o código de serviço na emissão (6.3) — antes ou depois?**
Marcado "essencial", não existe hoje. Precisa dizer se entra no lançamento.

**P11. Quantas empresas-piloto (8.4) e quais?**
Em branco. Define quantos certificados A1 e quantas procurações RFB precisamos
providenciar — que é o caminho crítico mais lento de todos.

**P12. Qual recurso de IA "vende" o Balu (6.4)?**
Em branco. Ajuda a priorizar entre onboarding conversacional, explicação em pt
simples e sugestão de código de serviço.

### Operação e risco
**P13. Ele tem conta/número de WhatsApp Business API?**
Ele marcou "sim" no formulário, mas nunca chegou credencial nenhuma. O canal
inteiro do Bloco 6B está pronto e inerte por causa disso.

**P14. Aprovação comercial do Asaas para subcontas em produção saiu?**
Sem ela, o escritório não consegue cobrar o cliente final pela subconta.

**P15. Quem responde pelo jurídico das minutas e quem é o DPO?**
Pendência do Bloco E: as minutas precisam de revisão jurídica, e a política de
privacidade precisa do nome/e-mail do DPO e da razão social/CNPJ do controlador.

**P16. Ele aceita rodar o piloto com produção e desenvolvimento no mesmo banco?**
Hoje existe um único projeto Supabase. Mudança de schema mexe no que o cliente
está usando. Separar custa tempo e dinheiro; não separar é risco. É decisão dele.

---

## 5. Sugestão de encaminhamento

1. **Demonstração guiada primeiro** (P3). Nove itens "não vistos" contaminam
   qualquer discussão de escopo.
2. **Fechar P1, P2 e P11 na mesma reunião** — são o que impede um cronograma real.
3. **Levar as credenciais como lista de compras** (P13, P14, Focus, Resend): é o
   caminho crítico mais lento, e nenhuma linha de código o encurta.
