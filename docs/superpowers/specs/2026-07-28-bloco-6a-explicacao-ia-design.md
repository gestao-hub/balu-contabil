# Spec — Bloco 6A: Explicação de imposto com IA

> **Data:** 2026-07-28 · **Origem:** Bloco 6 do Master PRD (pilar C3, feature 1)
> **Estado:** desenho fechado, pronto para virar plano
> **Depende de:** uma chave de API de provedor de IA — e **só para gerar rascunhos**,
> nunca para exibir.

---

## 1. Objetivo e princípio

O Balu calcula imposto com um motor determinístico e mostra o número. Quem não é
contador olha "R$ 66,60" e não sabe o que aquilo é, por que é aquele valor, nem se
muda no mês que vem.

**Objetivo:** explicar, em português simples, o que o painel já calculou.

**O princípio que governa o bloco:** *a IA nunca calcula, nunca transmite, nunca
emite.* Ela redige texto sobre uma **situação**, não sobre um contribuinte. Todo
número que aparece na tela veio do motor determinístico, não do modelo.

Isto não é cautela genérica sobre IA. É a fronteira do DL 9.295/46 (orientação
contábil) e do CTN art. 121 (a responsabilidade tributária é do contribuinte).
Um texto que erra ao explicar é um problema; um número inventado por um modelo é
outra ordem de grandeza.

---

## 2. A decisão que muda tudo: só a FORMA sai da Balu

A pergunta que abriu o desenho foi *o que sai daqui e vai para o provedor de IA*.

A resposta escolhida: **a forma da situação, nunca os dados do contribuinte.**

```
VAI:      { tributo: 'DAS-MEI', regime: 'MEI',
            componentes: ['INSS', 'ICMS', 'ISS'] }

VOLTA:    "O DAS do MEI reúne {inss} de INSS, {icms} de ICMS e
           {iss} de ISS. Esse valor é fixo por mês e não varia
           com o seu faturamento."

A BALU:   troca {inss} por R$ 61,60 na hora de exibir.
```

Nenhum CNPJ, nenhum nome, nenhum valor, nenhuma competência atravessa a fronteira.
Não há transferência internacional de dado pessoal, não há base legal nova a
declarar, não há aviso ao titular a redigir — porque não há dado de titular
envolvido.

**A consequência que reorganizou o bloco inteiro:** se a explicação descreve uma
*situação* e não um *cliente*, então a explicação de "DAS-MEI com INSS+ICMS+ISS"
é **idêntica para todo MEI do país**. Ela não precisa ser gerada por acesso —
precisa ser gerada **uma vez**.

---

## 3. Arquitetura: um catálogo, não uma chamada

Isto deixa de ser "IA no caminho da requisição" e vira "IA gera conteúdo, o app
renderiza".

### O caminho do usuário (sem rede externa, sem IA)

```
1. DERIVAR      guia de R$ 66,60 do MEI
                  → { tributo:'DAS-MEI', componentes:['INSS','ICMS','ISS'] }
                  → chave "das-mei:icms+inss+iss"

2. BUSCAR       chave → texto APROVADO no catálogo (uma leitura no banco)

3. PREENCHER    "{inss} de INSS" → "R$ 61,60 de INSS"

4. EXIBIR       texto + disclaimer fixo da tela
```

### O caminho do AdminBalu (assíncrono, com IA)

```
5. GERAR        admin vê situação sem texto → manda gerar rascunho
6. REVISAR      lê, corrige, aprova → só então clientes veem
```

### O que cada peça faz

| Peça | Responsabilidade | Depende de |
|---|---|---|
| `lib/fiscal/situacao-fiscal.ts` | Derivar a chave canônica | nada (puro) |
| tabela `explicacoes_fiscais` | chave → texto, status, autoria | — |
| `lib/explicacoes/renderizar.ts` | Trocar marcador por valor, ou recusar | nada (puro) |
| `lib/ai/` | Falar com o provedor, atrás de interface | provedor configurado |
| tela de impostos | Exibir + disclaimer | catálogo |
| `/admin/explicacoes` | Gerar, revisar, aprovar | `lib/ai/` |
| `/admin/configuracoes` (IA) | Escolher provedor, chave, modelo | cofre do Bloco E |

### O que a arquitetura compra

- **Custo perto de zero por visualização** — uma geração serve todos os clientes
  daquela situação, para sempre.
- **Latência zero** — a tela lê do banco.
- **Provedor fora do ar é indiferente** — nada no caminho do usuário depende dele.
- **Nenhum texto sobre tributo chega ao cliente sem um humano ter lido.** Dado o
  DL 9.295/46, este é o ponto que mais importa: transforma geração
  irrevisável-por-acesso em catálogo de conteúdo revisável.

### O que custa

Situação nova nasce sem explicação, e fica sem até alguém gerar e aprovar. O §5
trata de como esse buraco é tornado visível em vez de silencioso.

---

## 4. Provedor de IA escolhido pelo admin

O AdminBalu escolhe o provedor numa tela, sem deploy.

**Isto é barato por causa das decisões dos §2 e §3, e não seria sem elas.** Como
nenhum dado do cliente sai, trocar de provedor não mexe no risco de privacidade —
o que trafega é uma pergunta genérica sobre tributo brasileiro. E como todo texto
passa por revisão humana, um provedor ruim produz um rascunho ruim que é
rejeitado: o portão de aprovação absorve a diferença de qualidade.

### Dois adaptadores cobrem a lista

A chamada de que precisamos é a mais simples que existe — um texto entra, um texto
sai. Sem streaming, sem ferramentas, sem imagem. Por isso **não** há um adaptador
por provedor:

| Adaptador | Cobre |
|---|---|
| **OpenAI-compatível** (URL base + chave + modelo) | OpenRouter, Groq, DeepSeek, Mistral, Together, OpenAI, Gemini (endpoint compat), Ollama local |
| **Anthropic** (formato próprio) | Claude |

### A tela

```
Provedor de IA
  ├ Anthropic (Claude)
  ├ Google Gemini
  ├ OpenAI
  ├ OpenRouter
  ├ Groq
  ├ DeepSeek
  ├ Mistral
  └ Personalizado…      → URL base + modelo

Modelo         [ claude-sonnet-4-6 ]
Chave de API   [ ••••••••••••• ]   ( Testar conexão )
```

**"Personalizado" não é enfeite:** é a saída que permite um provedor novo sem
deploy. Mesmo espírito do "Outro" que já existe no seletor de código de serviço.

**"Testar conexão" também não:** sem ele, o admin só descobre que a chave está
errada ao tentar gerar um texto, e o erro chega travestido de "falha ao gerar".

### A chave

Guardada **cifrada no banco**, pelo cofre que o Bloco E construiu e o 4B provou em
produção com a apiKey da subconta Asaas: `guardarCredencial`/`lerCredencial`,
prefixo `enc:v1:`, AES-256-GCM.

Regras herdadas, todas obrigatórias:
- nunca volta para a tela (o campo só aceita **substituir**, nunca ler);
- nunca entra em log, **inclusive log de erro** — a mensagem é redigida com
  `mascarar` antes de sair, como a varredura do 4B passou a fazer;
- a leitura lança em gravação corrompida, em vez de devolver o valor cru.

---

## 5. Modos de falha, e como cada um é fechado

### 5.1 A chave de situação: nem grossa, nem fina

Grossa demais, a explicação vira genérica e inútil. Fina demais, o catálogo
explode e nunca fica completo.

**A régua:** a chave carrega só o que muda a **explicação**, nunca o que muda o
**número**. No DAS-MEI, o que muda a explicação é quais componentes existem —
R$ 61,60 e R$ 75,00 se explicam igual. No PGDAS-D, é o anexo e se o Fator R se
aplica.

Isso dá uma dúzia de chaves, não milhares. A derivação é **função pura e
testada**: a mesma situação cai na mesma chave hoje e daqui a um ano. Chave
instável significaria catálogo com buracos que ninguém entende.

Ordenação canônica dos componentes (alfabética) para que `INSS+ICMS` e
`ICMS+INSS` sejam a mesma chave — senão o catálogo duplica sozinho.

### 5.2 Situação sem explicação: a tela não mostra nada

**Falha fechada.** Silêncio é melhor que explicação errada sobre tributo.

Mas o buraco não pode ser invisível: toda situação **vista sem texto aprovado** é
contada. A tela do admin lista as mais vistas sem explicação, e o catálogo cresce
por **demanda real** em vez de adivinhação.

É o mesmo princípio do contador de boletos órfãos que entrou na varredura do 4B:
buraco silencioso é pior que buraco.

### 5.3 Marcador órfão: recusado na aprovação, não na tela

Se o texto aprovado disser `{iss}` e a situação não fornecer ISS, a tela
renderizaria `{iss}` cru na cara do cliente.

**A validação é no ato de aprovar:** os marcadores do texto têm de estar contidos
nos campos que aquela situação fornece. Aprovar é impossível enquanto não bater.

É a lição do 4A — validar na escolha, não no envio. Lá era o `.exe` que ficava
listado como aceito e só era recusado no "Confirmar".

O renderizador ainda assim recusa exibir texto com marcador não resolvido, como
rede de baixo: duas travas, e a de cima é a do servidor.

### 5.4 O disclaimer é da tela, não do texto

DL 9.295/46. O aviso de que aquilo é informação educativa e não substitui o
contador **não pode depender de a IA tê-lo escrito**, e o admin não pode editá-lo
para fora. Fica no componente, fixo, fora do alcance do catálogo.

### 5.5 Como se garante que a IA nunca vê um número

**Por tipo, não por disciplina.** A função que fala com o provedor aceita
`SituacaoFiscal` — só enums e strings. Passar o objeto da guia **não compila**.

Somado a isso: o prompt é montado por função pura, com teste que falha se um
campo numérico aparecer na entrada, e sabotagem provando que morde.

Garantia de servidor não pode depender de quem escreve o código lembrar da regra.

### 5.6 Texto aprovado que é editado volta a rascunho

Senão "aprovado" para de significar alguma coisa. Fica registrado quem aprovou e
quando; **editar derruba a aprovação** e o texto sai do ar até nova aprovação.

### 5.7 Falha do provedor não derruba a tela do admin

Gerar rascunho é operação que pode falhar (chave errada, provedor fora, limite).
O erro aparece na tela de quem pediu, com o motivo, e nada é gravado pela metade.

---

## 6. Escopo

### Entra

- Migration, com três tabelas e nenhuma ambiguidade:
  - `explicacoes_fiscais` — `chave` (única), `texto`, `status`
    (`rascunho`/`aprovado`), `aprovado_por`, `aprovado_em`, timestamps.
  - `config_ia` — **linha única** (`CHECK (id = 1)`), com `provedor`, `modelo`,
    `base_url` (só para "Personalizado"), `chave_cifrada`, `atualizado_por`,
    `atualizado_em`. Linha única e não chave-valor: são campos que só fazem
    sentido juntos, e um deles inválido invalida os outros.
  - `explicacoes_faltando` — `chave` (única) e `vistas` (contador), incrementado
    quando uma situação sem texto aprovado é exibida. É o que torna o buraco do
    §5.2 visível.

  As três com RLS ligada. `config_ia` **sem policy nenhuma** e com `REVOKE` para
  `anon`/`authenticated` — é a lição da 0055: o `ALTER DEFAULT PRIVILEGES` do
  Supabase concede tudo em `public` para essas roles, calado, em toda tabela nova.
  `explicacoes_fiscais` é legível pela sessão **apenas com `status = 'aprovado'`**.
- `situacao-fiscal.ts`: derivação pura da chave, cobrindo **DAS-MEI** e **PGDAS-D**.
- `renderizar.ts`: substituição de marcadores, com recusa em marcador não
  resolvido.
- `lib/ai/`: interface + adaptador OpenAI-compatível + adaptador Anthropic + duplo
  para teste.
- Tela do cliente: a explicação na tela de impostos, com disclaimer fixo.
- Tela do admin: configuração do provedor (com "Testar conexão"), lista de
  situações, geração de rascunho, revisão e aprovação.
- Auditoria: geração, aprovação, edição e troca de provedor.

### Não entra

- **Sugestão de código de serviço** e **onboarding conversacional** (as outras duas
  features do C3). Viram blocos próprios.
- **Qualquer coisa de WhatsApp** (C2, vira o 6B).
- IA que calcula, transmite ou emite — proibido por princípio, não adiado.
- Explicação de tributo fora de DAS-MEI e PGDAS-D nesta rodada.
- Tradução ou múltiplos idiomas.

---

## 7. Dívida conhecida que este bloco NÃO resolve

Levantado ao explorar o terreno, e registrado para não se perder:

- **Não existe lista oficial de códigos de serviço no banco.** Há 10 códigos
  escritos à mão em `codigos-tributacao.ts` e um validador que só confere 6
  dígitos numéricos — `999999` passa. O PRD supõe validação "contra a lista
  oficial do município/LC 116", e ainda erra o padrão: o repo usa a **Lista de
  Serviços Nacional (6 dígitos)**, não a LC 116 (`X.XX`). **Importar a lista
  oficial é pré-requisito da feature de sugestão de código**, e é trabalho sem
  credencial nenhuma.
- **O PRD supõe que o SERPRO devolve o Pix Copia-e-Cola do DAS.** Nosso parser lê
  `numeroDocumento`, `dataVencimento`, `valores`, `codigoDeBarras` e `pdf` — não há
  campo de Pix, e o parser descarta em silêncio o que não lê. Ou o SERPRO manda e
  jogamos fora, ou não manda e "pagar o DAS pelo WhatsApp" precisa de outro
  desenho. **Sondar isso é pré-requisito do 6B.**

---

## 8. Critérios de aceite

1. Um MEI abre a tela de impostos e vê a explicação do DAS **com os valores dele**,
   e o disclaimer.
2. O provedor de IA é trocado pela tela do admin, com "Testar conexão"
   respondendo, **sem deploy**.
3. A chave do provedor está **cifrada** no banco, não volta para a tela e não
   aparece em log nenhum — inclusive de erro.
4. Uma situação sem texto aprovado **não exibe nada** ao cliente, e **aparece** na
   lista do admin com a contagem de quantas vezes foi vista.
5. Tentar aprovar um texto com marcador que a situação não fornece é **recusado**.
6. Editar um texto aprovado **derruba a aprovação**, e ele some da tela do cliente
   até nova aprovação.
7. Nenhum dado de contribuinte sai da Balu — provado por teste sobre a entrada da
   chamada, com sabotagem.
8. A suíte inteira roda **sem rede** e sem chave de provedor.

---

## 9. Testes

O caro aqui não é a IA — é a **derivação da chave** e a **renderização**. As duas
são puras e ganham teste que morde, com sabotagem provada:

- quebrar a ordenação canônica dos componentes → catálogo duplicaria;
- tirar a validação de marcador na aprovação → `{iss}` cru na tela do cliente;
- deixar um campo numérico entrar na entrada da IA → dado do contribuinte vazaria;
- fazer a tela exibir rascunho como se fosse aprovado.

Para o provedor, um duplo que devolve resposta fixa. **Nenhum teste da suíte fala
com rede**, e a suíte tem de passar sem chave configurada — mesma propriedade que
o resto do repo já tem (o `sendEmail` é no-op logado sem chave).

---

## 10. Base legal

- **DL 9.295/46** — fronteira da orientação contábil; daí o disclaimer ser da tela
  e não editável.
- **CTN art. 121** — responsabilidade tributária é do contribuinte; a IA não
  decide nada que vire obrigação.
- **LGPD** — o desenho do §2 evita o tema por construção: não havendo dado pessoal
  na chamada, não há tratamento por terceiro nem transferência internacional a
  fundamentar.
