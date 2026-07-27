# Spec — Bloco 4B: O escritório cobrando (subconta Asaas)

> **Data:** 2026-07-27 · **Status:** **design fechado — os 5 pontos do §7 estão decididos, pronto para o plano** · **Bloco:** 4B de 7+ do `PRD-MASTER-Balu-2026-07-24.md`
> **Depende de:** Bloco 4A (`2026-07-27-bloco-4a-assinatura-balu-design.md`) — cliente Asaas, webhook, módulo de segredo e tabela `cobrancas` nascem lá e são reusados aqui.
> **Natureza:** 🟡 construível e testável no **sandbox** do Asaas. A virada para produção depende de **aprovação comercial do Asaas** para criação de subcontas, não só de uma chave.
> **Base factual:** auditoria do código real em 2026-07-27 (migrations até `0049`, `src/`).

---

## 1. Objetivo e princípio

Dar ao **escritório** uma ferramenta de cobrança dentro da Balu: honorários recorrentes e serviços avulsos cobrados do cliente dele, com boleto e Pix.

Tudo aqui decorre de um princípio, decidido pelo usuário em 2026-07-27:

> **A Balu não pode intermediar dinheiro de terceiro.**

O honorário é dinheiro do escritório. Se a cobrança nascesse na conta Asaas da Balu, o dinheiro passaria por ela antes de chegar ao destino — repasse manual, exposição regulatória e contábil. **Split numa cobrança da Balu tem o mesmo defeito**, porque a cobrança pertence à conta dela.

## 2. Modelo escolhido — subconta criada pela Balu

Três modelos foram avaliados:

| | Como funciona | Por quê / por que não |
|---|---|---|
| **A** | O escritório abre a própria conta Asaas e cola a API key na Balu | Menor superfície regulatória possível, mas atrito alto no onboarding e sem caminho para comissão |
| **B** ✅ | A Balu cria a subconta pela API, passando os dados do escritório; o Asaas faz o KYC; a subconta recebe apiKey e walletId próprios | **Escolhido.** A cobrança é emitida **pela subconta** — o credor é o escritório, o dinheiro liquida na conta dele, a Balu nunca é dona do recurso. Onboarding dentro da Balu, e deixa a porta aberta para comissão por split depois |
| **C** | Cobrança na conta da Balu com split para o escritório | **Descartado.** A cobrança pertence à Balu e o dinheiro passa por ela — é exatamente a intermediação que o princípio proíbe |

## 3. O risco central deste bloco

A Balu passa a guardar uma credencial que **movimenta dinheiro na conta de um terceiro**. É o segredo mais valioso do sistema — mais que a `SERVICE_ROLE_KEY`, porque o dano é financeiro, imediato e de outra pessoa.

Controles, todos obrigatórios:
- **Cifra em repouso** com `cifrarCampo` (`src/lib/crypto/envelope.ts:44`, AES-256-GCM sobre `CERT_ENC_KEY`), já construído e testado no Bloco E. *Nota:* o CHECKPOINT registra que `decifrarCampo` **não tem uso em runtime hoje** e foi sinalizado como landmine — este bloco lhe dá o primeiro uso legítimo de ida e volta, e o teste tem de provar o ciclo completo.
- A chave **nunca** sai para o cliente, nunca entra em log (inclusive log de erro) e nunca aparece em mensagem de exceção.
- Todo uso registrado em `audit_log` via `registrarAuditoria`.
- Cobrança emitida **sempre server-side**, nunca por caminho que aceite a chave vinda do navegador.

## 4. Escopo

**Dentro:**
- Migration `0051` — `contabilidades` ganha vínculo de subconta (id, walletId, apiKey cifrada, status de KYC); tabela `servicos_avulsos`; `cobrancas` ganha o vínculo com honorário/avulso.
- Onboarding de subconta: tela no painel do contador que coleta os dados exigidos pelo Asaas e acompanha o status do KYC.
- Cobrança de **honorário** pela subconta — consome enfim `honorarios.asaas_charge_id` / `asaas_customer_id` (`0032:9-10`).
- **Catálogo de serviços avulsos** gerido pelo escritório nas configurações do contador, e cobrança avulsa a partir dele.
- Webhook: rotear eventos de cobrança de subconta para o honorário/avulso certo.

**Fora, de propósito:**
- Comissão da Balu por transação (o modelo B deixa a porta aberta; ligar é decisão comercial posterior).
- Conciliação bancária automática — é o Bloco 7.
- Emissão de nota fiscal do escritório sobre o honorário.

## 5. Catálogo de serviços avulsos

O escritório cadastra o que cobra fora da mensalidade. Levantamento do que de fato é avulso numa contabilidade brasileira, para servir de seed sugerido (editável, não imposto):

| Categoria | Serviços |
|---|---|
| **Societário** | Abertura de empresa · Alteração contratual (endereço, capital, sócios, CNAE) · Baixa/encerramento · Enquadramento e desenquadramento de regime (MEI→ME, opção pelo Simples) |
| **Fiscal** | Parcelamento e regularização de débitos · Emissão de certidões negativas · Recuperação de crédito tributário · Declarações fora do pacote |
| **Pessoa física** | IRPF do sócio · Declaração de bens |
| **Trabalhista** | Admissão e demissão · Folha ou pró-labore avulso · Rescisão |
| **Outros** | Certificado digital A1/A3 (venda e renovação) · Hora técnica de consultoria · Taxa de urgência · Registro de marca no INPI |

**Decisão de modelagem:** o catálogo aceita **valor fixo ou percentual** desde o começo. Recuperação de crédito tributário é cobrada como percentual do valor recuperado, e taxa de urgência costuma ser percentual sobre o serviço-base; um catálogo só-valor-fixo não comporta esses dois e a migration para consertar depois seria cara.

## 6. Interface

- **Configurações do contador → Serviços avulsos:** CRUD do catálogo (nome, categoria, valor fixo ou percentual, ativo).
- **Ficha do cliente na carteira → Cobrar:** escolhe do catálogo ou digita um valor, gera a cobrança pela subconta, mostra link e Pix.
- **Honorários:** o CRUD v2 que já existe ganha "gerar cobrança" no honorário recorrente, populando as colunas `asaas_*`.
- **Onboarding da subconta:** enquanto o KYC não aprova, as telas de cobrança dizem o que falta em vez de oferecer um botão que falharia.

## 7. Pontos fechados (2026-07-27, sessão 13)

Os cinco pontos que faltavam foram resolvidos: o nº 1 contra o sandbox, os outros
quatro por decisão do usuário.

### 7.1 Campos exigidos pelo Asaas — levantado no sandbox

`node app/scratchpad/_probe-subconta.mjs` (POST com corpo vazio, só para ler o validador —
não cria subconta):

- **A conta-mãe já opera subcontas em sandbox:** `GET /accounts` → HTTP 200, zero existentes.
  A aprovação comercial da premissa 2 do §8 vale para **produção**; a construção e o teste do
  bloco não dependem dela.
- **Obrigatórios mínimos:** `cpfCnpj`, `name`, `birthDate`.
- **`birthDate` só é exigido para CPF.** Com `companyType: LIMITED` o validador deixa de pedir —
  o que separa, no formulário, escritório PJ de contador autônomo PF. São **dois** conjuntos de
  campos, não um.
- Com payload de PJ plausível (`email`, `mobilePhone`, `incomeValue`, endereço completo com
  `postalCode`), a única recusa restante foi o CNPJ fictício: esse conjunto **basta** para criar.
- **A confirmar na implementação:** se o KYC exige upload de documento depois da criação, e em
  que estado a subconta fica enquanto isso.

### 7.2 Escritório sai da Balu com cobranças em aberto → **a Balu não toca nelas**

A Balu apenas para de exibir; as cobranças seguem vivas na subconta e o cliente paga
normalmente. É o próprio princípio do §1 aplicado à saída: **o crédito é do escritório**, e
cancelar cobrança de terceiro seria a Balu decidindo sobre dinheiro que não é dela. Bloquear a
saída até quitar foi descartado por prender o escritório à plataforma por dívida de terceiro
(exposição pelo CDC art. 39).

*Consequência de implementação:* desvincular **não** dispara nada no Asaas. O que existe é o
registro de que a subconta deixou de ser gerida pela Balu — e as telas de cobrança somem.

### 7.3 O cliente final **vê** as cobranças dentro do app

Tela com as cobranças do escritório, link de pagamento e Pix. Boleto que só chega por e-mail se
perde, e inadimplência por esquecimento é a mais comum — mostrar no app onde o cliente já está é
o que a evita.

*Fronteira herdada do 4A:* essa tela é do **escritório cobrando**, não da Balu. Nada nela pode
sugerir que a Balu condiciona acesso ao pagamento do honorário — o gate de inadimplência do 4A
continua valendo só para a assinatura da Balu, nunca para dívida com o escritório.

### 7.4 Semáforo do painel do contador — **automático onde houver cobrança, manual onde não**

Onde a cobrança nasceu pela subconta, o status vem do Asaas; onde não houver, segue a marcação
manual que já existe. Substituir o manual por completo tiraria o controle de quem cobra por fora
do app, e no primeiro dia **ninguém** terá tudo cobrado por dentro.

*Consequência de modelagem:* o status do honorário precisa distinguir **"pago segundo o Asaas"**
de **"marcado como pago pelo contador"**. Um campo só, sobrescrito pelos dois caminhos, esconde
qual dos dois falou por último.

### 7.5 Comissão da Balu — **não agora, porta aberta**

Fica fora do 4B, como o §4 já previa. O modelo de subconta permite ligar split de comissão depois
sem migration nova, e a receita da Balu hoje é a assinatura do 4A. Segue como pergunta comercial
ao Michel (premissa 3 do §8).

### 7.6 Correção de numeração

O §4 fala em migration `0051` — número **já usado** pela liberação manual do 4A. A `0052` também
(comprovante obrigatório). A migration do 4B é a **`0053`**.

## 8. Premissas para o Michel

| # | Premissa |
|---|---|
| 1 | O escritório aceita abrir subconta Asaas (KYC) para cobrar pelo app |
| 2 | Aprovação comercial do Asaas para criação de subcontas pela conta-mãe da Balu |
| 3 | A Balu cobra ou não comissão sobre a cobrança do escritório |
| 4 | O catálogo de avulsos sugerido (§5) bate com o que ele cobra na prática |
