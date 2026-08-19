# Balu — descrição completa da plataforma

> Documento de contexto para apresentações. Escrito em 19/08/2026 a partir do
> código real (`app/src`, 91 migrations, banco de produção), não de material
> promocional. Cada afirmação aqui é verificável no repositório.
>
> **Como ler o status:** ✅ funciona em produção · 🟡 funciona parcialmente ou em
> homologação · 🔒 construído, mas esperando credencial/contrato de terceiro ·
> ⬜ não existe.

---

## 1. Em uma frase

O Balu é uma plataforma de gestão fiscal para **MEI e Simples Nacional** que
serve dois clientes ao mesmo tempo: o **empresário leigo**, que emite nota e
entende o que deve pagar em português simples, e o **escritório de
contabilidade**, que coloca a carteira inteira dentro dela, acompanha todo mundo
num painel único e atende com a própria marca.

A promessa central não é "software de contabilidade". É **"você não vai perder
prazo"** — e é isso que a arquitetura persegue: um motor que sabe o que cada
empresa deve, quando vence, avisa antes, e confirma quando foi pago.

---

## 2. O problema que ele resolve

**Do lado do empresário.** Quem abre um MEI ou uma empresa do Simples não sabe o
que deve, para quem, nem quando. Descobre em atraso, com multa. Os aplicativos
existentes ou falam a língua do contador (DAS, PGDAS-D, DASN-SIMEI, Fator R,
Anexo III) ou simplesmente emitem nota e param aí.

**Do lado do escritório.** Um contador com 80 clientes de Simples não tem como
saber, numa segunda-feira de manhã, quais deles estão irregulares. A informação
existe espalhada — no portal do Simples, no e-CAC, na planilha, na cabeça de
alguém. Ele descobre o problema quando o cliente liga.

O Balu junta os dois: o empresário tem um painel que fala português, e o contador
tem **um semáforo por cliente**, calculado por regra fiscal escrita, não por
palpite.

---

## 3. Os dois públicos, e o que cada um recebe

### 3.1 O empresário (MEI ou Simples Nacional)

- Emite **NFS-e, NF-e e NFC-e** por uma tela só, sem escolher código de
  tributação na mão (o sistema sugere a partir do CNAE).
- Vê **quanto vai pagar de imposto** e por quê, com o cálculo aberto: qual anexo,
  qual alíquota efetiva, qual RBT12, qual Fator R.
- Recebe **aviso antes do vencimento** — no sino do app, por e-mail e por
  WhatsApp — com a **linha digitável do DAS** já no aviso.
- Acompanha a **abertura da própria empresa**, etapa por etapa, com checklist de
  documentos, quando é esse o caso.
- Vê a **situação fiscal** dele: em dia, atenção, irregular — com o motivo escrito.

### 3.2 O escritório de contabilidade

- **Painel único** com a carteira inteira e um semáforo por cliente.
- **Marca própria**: logo, nome e WhatsApp de suporte do escritório aparecem para
  os clientes dele; e-mails de autenticação seguem sendo do Balu.
- **Equipe**: vários usuários no mesmo escritório, todos com o mesmo poder.
- **Honorários**: lançamento manual, recorrência automática e cobrança pela
  própria conta do escritório.
- **Abertura de empresa** como esteira de trabalho, com fila e etapas.
- **SLA configurável** de atendimento, com escalação quando estoura.

### 3.3 O AdminBalu (operação interna)

Aprova escritórios (validação de CRC), acompanha métricas, edita os **parâmetros
fiscais** (tetos, salário mínimo, faixas), gerencia planos e assinaturas, e
revisa as explicações geradas por IA.

---

## 4. Os 8 pilares × o que existe hoje

A visão original do produto tem 8 pilares. Estado real em 19/08/2026:

| # | Pilar | Estado | Observação |
|---|---|---|---|
| 1 | Onboarding guiado com IA educacional | ✅/🟡 | fluxo guiado pronto; a camada conversacional de IA existe e é configurável |
| 2 | Abertura de empresa digital | ✅ | fila do contador, etapas, checklist de documentos, notificação a cada transição, minuta de contrato social por template |
| 3 | Emissão de NFS-e simplificada | 🟡 | funciona ponta a ponta **em homologação**; produção depende de contrato Focus + certificado A1 do cliente |
| 4 | Apuração automática de impostos | ✅/🟡 | cálculo real (MEI e Simples); transmissão do PGDAS-D é **assistida**, não automática |
| 5 | Painel leigo do empresário | ✅ | com explicação em português simples |
| 6 | WhatsApp como canal | 🔒 | construído inteiro; parado por falta de um token (decisão, não defeito — ver §5.9) |
| 7 | Gestão de obrigações | ✅ | o motor diário existe e roda |
| 8 | Área white-label do contador | ✅ | co-branding (logo, nome, WhatsApp de suporte) e SLA configurável |

---

## 5. O que a plataforma faz, área por área

### 5.1 Motor de obrigações e notificações ✅

O coração do produto. Um **cron diário** que, para cada empresa da base:

1. Deriva quais obrigações existem naquela competência (declarar, pagar, vencida,
   paga) a partir do regime, das declarações e das guias.
2. Materializa o que está pendente e **cria a notificação** correspondente.
3. Envia por e-mail, por WhatsApp e no sino do app.
4. Roda a apuração automática, a varredura de pagamentos na Receita e o billing.

Os **16 tipos de aviso** que ele sabe emitir:

`das_a_vencer` · `das_vencido` · `pgdas_pendente` · `dasn_pendente` ·
`defis_pendente` · `pagamento_confirmado` · `pagamento_nao_detectado` ·
`limite_faturamento` · `cert_a_vencer` · `cert_vencido` · `honorario_a_vencer` ·
`abertura_etapa` · `assinatura_trial_acabando` · `assinatura_cobranca_vencida` ·
`sla_estourado` · `whatsapp_escalado` · `parametro_fiscal_desatualizado`

A ordem de execução dentro do cron é deliberada: o que tem prazo legal roda
primeiro, e cada etapa tem orçamento de tempo próprio, porque a janela é de 60
segundos. Isso não é detalhe de implementação — é o que impede que um blip de
rede num destinatário derrube a apuração fiscal do dia inteiro.

### 5.2 Emissão de notas fiscais 🟡

- **NFS-e** (serviço), **NF-e** (produto) e **NFC-e** (consumidor), pelo provedor
  **Focus NFe**.
- Sugestão automática do código de tributação a partir do CNAE.
- Cancelamento, consulta de status e webhook de retorno do provedor.
- Controle de limite de emissão e vigilância do certificado A1 (avisa 30 dias
  antes de vencer, porque certificado vencido para a emissão).

**Onde está a trava:** o ambiente está fixo em **homologação** no código. Ligar
produção depende de três coisas de terceiros — contrato de produção com a Focus,
certificado A1 de cada empresa e procuração na Receita. O desenho já prevê
`ambiente_atual` por empresa, com padrão seguro, para que a virada seja
**cliente a cliente**, nunca global.

### 5.3 Apuração de impostos ✅

Cálculo determinístico, escrito e testado, para **MEI** e **Simples Nacional**:

- RBT12, alíquota efetiva, **Fator R**, resolução de anexo, segregação de
  receitas, parcela a deduzir.
- Geração da guia **DAS** (via SERPRO — PGMEI para MEI, PGDASD para Simples),
  com linha digitável, código de barras e PDF.
- Prévia do imposto antes de emitir a nota.
- Tetos e alíquotas vivem em **tabela versionada no banco** (`parametros_fiscais`),
  nunca no código — e o sistema **avisa quando um parâmetro está desatualizado**
  em vez de calcular errado em silêncio.

### 5.4 Declarações anuais ✅ (fluxo assistido)

**DASN-SIMEI** (MEI) e **DEFIS** (Simples): o sistema monta a declaração a partir
dos dados que já tem, mostra o que vai ser declarado, orienta a transmissão e
registra o comprovante. A transmissão oficial é **assistida**, por decisão —
ver §9.

### 5.5 O semáforo de regularidade ✅

A regra que resume um cliente inteiro em uma cor. **Vermelho** quando:

| Critério | Norma |
|---|---|
| Guia de DAS vencida sem pagamento registrado | LC 123/2006, art. 21 |
| PGDAS-D do mês anterior não transmitida (prazo dia 20) | Res. CGSN 140/2018, art. 38 |
| DASN-SIMEI do ano anterior não entregue, após 31/05 | Res. CGSN 140/2018, art. 109 |

**Amarelo** quando:

| Critério | Norma |
|---|---|
| Faturamento do ano já usou 80% ou mais do limite do regime | LC 123/2006, art. 18-A §1º (MEI) / art. 3º, II (Simples) |
| Certificado A1 vence em menos de 30 dias, ou já venceu | ICP-Brasil, MP 2.200-2/2001 |

Cada motivo aparece para o usuário **em português simples com a norma ao lado**.
Honorário atrasado é coluna separada — dívida com o escritório não é
irregularidade fiscal, e misturar as duas seria errado.

### 5.6 Abertura de empresa ✅

Esteira completa: coleta de dados, **checklist de documentos com status**,
etapas com transição notificada, acompanhamento em tempo real pelo empresário,
fila de trabalho para o escritório e **geração de minuta de contrato social** por
template a partir dos dados coletados. A equipe revisa e protocola; não há
assinatura eletrônica no lançamento.

### 5.7 Painel do contador e white-label ✅

- Carteira com semáforo, drill-down por cliente e visão financeira.
- **Somente leitura, garantido no banco**: as políticas de segurança do contador
  não têm regra de escrita. Não é uma promessa da interface — é uma ausência no
  banco de dados.
- **Co-branding**: logo, nome e WhatsApp de suporte do escritório na experiência
  dos clientes dele.
- **SLA configurável** de atendimento, com fila de escalação quando o prazo
  estoura.
- Cadastro de escritório passa por **aprovação do AdminBalu**, com validação de
  CRC (DL 9.295/46).

### 5.8 Honorários e cobrança 🔒 (pronto, em sandbox)

Dois fluxos de dinheiro, deliberadamente separados:

**A Balu cobra do cliente** (assinatura da plataforma) — via Asaas, com trial,
cobrança recorrente, liberação manual e registro de comprovante.

**O escritório cobra da carteira dele** — pela **subconta Asaas do próprio
escritório**. A cobrança nasce na conta dele, o credor é ele, o dinheiro liquida
com ele. A Balu não intermedia dinheiro de terceiro, e essas cobranças moram em
tabela separada da receita da Balu, sem coluna em comum que possa ser confundida.

Honorários têm lançamento manual, recorrência por cron, cobrança avulsa e visão
tanto para o escritório quanto para o empresário.

**Estado:** a integração autentica e funciona em **sandbox**. Produção depende de
configurar as credenciais e o webhook.

### 5.9 WhatsApp 🔒

Canal completo: consentimento por número (informado pelo próprio cliente, nunca
herdado de um telefone genérico de cadastro), envio dos avisos, **linha
digitável do DAS na mensagem**, atendimento com IA, classificação de intenção e
**escalação para humano** com SLA.

Há um cuidado que vale mencionar em apresentação: os avisos são **coalescidos por
guia**, de modo que um acúmulo de pendências não vire uma rajada de mensagens
para o mesmo cliente.

**Estado:** parado por um token ausente — e isso foi uma **decisão**, não um
esquecimento: o número em uso era pessoal e foi retirado de propósito em 12/08.

### 5.10 Inteligência artificial ✅ (com guard-rail rígido)

A IA faz três coisas, e só três:

1. **Explica** o imposto e a situação fiscal em português simples.
2. **Sugere** — por exemplo, o código de serviço da nota — sempre com confirmação
   humana.
3. **Conversa** no atendimento, classificando e escalando quando não é caso dela.

E há uma **busca em base jurídica** com ranking, para fundamentar as respostas.

O provedor é configurável pelo AdminBalu (Anthropic, Gemini, OpenAI, OpenRouter,
Groq, DeepSeek, Mistral ou endpoint próprio).

> **O guard-rail, que vale repetir em qualquer apresentação:** a IA **nunca**
> calcula imposto, nunca transmite declaração e nunca emite documento fiscal. O
> determinístico decide; a IA explica. Uma alucinação no Balu produz, no pior
> caso, um texto ruim — nunca um imposto errado.

### 5.11 Confirmação de pagamento ✅

Como o sistema sabe que o cliente pagou:

- **Varredura na Receita** (SERPRO PAGAMENTOS71), que encontra o pagamento do DAS
  e dá baixa sozinha — para MEI e para Simples.
- **Webhook do Asaas**, para o que foi cobrado pela plataforma.
- **Baixa manual** com comprovante.
- Conciliação bancária por Open Finance existe **atrás de um adaptador**, rodando
  contra mock explícito. Não foi contratada: o provedor de mercado custa a partir
  de R$ 2.500/mês e a demanda não veio do cliente. O dia em que fizer sentido, é
  uma variável de ambiente — não um refactor.

### 5.12 Segurança e LGPD ✅

Não é um checkbox; é um bloco inteiro de trabalho:

- **90 políticas de RLS** no banco — a autorização vive no banco, não na tela.
- Cifra **AES-256-GCM** das credenciais sensíveis (NFS-e, chave de subconta).
- Rate-limiting em login, cadastro, convite, reset e webhooks.
- Anti-SSRF nos downloads, webhooks com segredo em comparação de tempo constante,
  proteção contra open-redirect.
- **Aceite versionado** de termos e política, com bloqueio de escrita até o
  re-aceite.
- **Exportação** dos dados do titular e **exclusão que anonimiza** — retendo o que
  a legislação fiscal obriga a reter, e banindo o login.
- Trilha de auditoria.
- Auditoria de IDOR feita dos dois lados (contador e empresário), com ataques
  reais executados contra o sistema e recusados.

---

## 6. Integrações externas

| Fornecedor | Para quê | Estado |
|---|---|---|
| **Focus NFe** | emissão de NFS-e, NF-e, NFC-e | 🟡 homologação |
| **SERPRO — Integra Contador** | PGMEI (DAS do MEI), PGDASD (Simples), DASN, PAGAMENTOS71 (baixa de pagamento) | ✅ produção validada; depende de procuração por CNPJ |
| **Asaas** | assinatura da Balu + subconta de cobrança do escritório | 🔒 sandbox |
| **uazapi** | WhatsApp | 🔒 falta token |
| **Resend** | e-mail transacional e de autenticação | ✅ ligado em 19/08 |
| **Supabase** | banco, autenticação, storage | ✅ |
| **Vercel** | hospedagem e cron | ✅ |
| **BrasilAPI / IBGE** | CNPJ, CEP, municípios | ✅ |
| **Open Finance** (Pluggy/Belvo) | conciliação bancária | ⬜ não contratado, atrás de adaptador |

---

## 7. Modelo comercial

Valores **provisórios**, editáveis pelo AdminBalu sem tocar em código:

| Plano | Público | Valor/mês | Trial |
|---|---|---|---|
| Empresário | empresa | R$ 49,90 | 7 dias |
| Escritório até 50 clientes | escritório | R$ 199,00 | 7 dias |
| Escritório 51 a 200 | escritório | R$ 399,00 | 7 dias |
| Escritório 201 ou mais | escritório | R$ 799,00 | 7 dias |

O plano do escritório é escolhido **pela quantidade de clientes na carteira**, e a
faixa é reavaliada automaticamente. Além da assinatura, o escritório cobra os
próprios honorários pela subconta dele — receita que é dele, não da Balu.

---

## 8. Arquitetura e números

| | |
|---|---|
| Stack | Next.js (App Router) + TypeScript + Supabase (Postgres) |
| Telas | 48 |
| Migrations de banco | 91 |
| Tabelas | 44 |
| Funções/RPC no banco | 36 |
| Políticas de RLS | 90 |
| Linhas de código (app) | ~67.500 |
| Testes automatizados | **1.794**, todos verdes |

Princípios que atravessam o projeto: segurança no banco e não na interface;
determinístico decide e IA explica; fuso horário de Brasília sempre explícito;
idempotência do cron garantida por índice único; e dependência externa nunca no
caminho crítico do desenvolvimento — o que espera terceiro é construído atrás de
flag ou mock.

---

## 9. O que o Balu deliberadamente NÃO faz

Vale tanto quanto a lista de funcionalidades, e evita promessa que vira problema:

- **A IA não calcula, não transmite e não emite.** Nunca.
- **O painel do contador não escreve.** É somente leitura, garantido no banco.
- **Não transmite declaração automaticamente.** DASN-SIMEI e DEFIS são fluxos
  **assistidos**: o sistema monta, mostra e orienta; um humano transmite. Isso é
  escolha, não limitação técnica — transmissão é ato com consequência legal.
- **Não intermedia o dinheiro do escritório.** A cobrança nasce na conta dele.
- **O white-label é co-branding, não substituição de marca.** O escritório não
  atende num endereço próprio: os clientes dele acessam o Balu com a marca dele
  dentro, e os e-mails de autenticação continuam sendo do Balu.
- **Não faz e-assinatura** de contrato social no lançamento.
- **Não atende Lucro Presumido nem Lucro Real.** O público é MEI e Simples.
- **Não trata eSocial/SPED**, que são obrigações de outro público.
- **Reforma tributária (CBS/IBS) não entra em 2026** para Simples e MEI, então não
  há funcionalidade a construir agora por causa dela.

---

## 10. Estado de lançamento em 19/08/2026

**No ar:** o app roda em produção, com base de dados real, e-mail transacional
ligado, motor de obrigações rodando diariamente e a varredura de pagamentos na
Receita funcionando de verdade (comprovada em execução real do cron).

**O que falta para o piloto rodar de ponta a ponta:**

1. 🔴 **DNS do domínio** — `balucontabil.com.br` ficou sem registro de site em
   19/08; o app responde pelo endereço da Vercel. Depende de quem administra a
   zona.
2. 🔴 **Token do WhatsApp** — sem ele nada sai por WhatsApp.
3. 🟡 **Asaas em produção** — hoje em sandbox.
4. 🟡 **Emissão fiscal em produção** — contrato Focus, certificado A1 dos pilotos
   e procuração na Receita por CNPJ.

**A dependência mais estrutural**, que vale explicar em qualquer apresentação: a
consulta à Receita por conta de um cliente exige **certificado A1 daquela empresa
e procuração eletrônica**. Não é limitação do Balu — é como o Integra Contador
funciona. O fluxo previsto é o contador coletar o certificado e subir pela tela
do cliente.

---

## 11. Três frases que resumem o produto

1. **"O Balu não te lembra do imposto: ele sabe o que você deve, avisa antes, e
   confirma quando foi pago."**
2. **"O contador vê a carteira inteira numa cor só — e cada cor tem a norma
   escrita ao lado."**
3. **"A inteligência artificial explica; quem calcula é regra escrita e testada.
   No pior caso a IA erra um texto, nunca um imposto."**

---

## Fontes

- Código: `app/src` (562 arquivos TS/TSX), `app/supabase/migrations` (91)
- Banco de produção, consultado em 19/08/2026 (44 tabelas, 90 políticas)
- `Direcionamento/PRD-MASTER-Balu-2026-07-24.md` — visão e os 8 pilares
- `docs/product/PRD-Balu-V2.md` — enquadramento legal por bloco
- `CHECKPOINT.md` — histórico de 28 sessões de trabalho
