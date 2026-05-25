# Balu — V2 (entregas amarelas)

> **Escopo**: funcionalidades marcadas em **🟡 amarelo** no `planejamento-balu.pdf`, que ficam para a **v2** do projeto.
> Cada item foi enriquecido com aprendizados do `ANALISE-CONTABILIZEI.md`.
>
> **Tema dominante da v2**: **camada de IA conversacional + integração WhatsApp Business API**. Enquanto a v1 entrega o app funcional via web/PWA, a v2 entrega a **experiência diferenciadora** — interação por linguagem natural via WhatsApp, IA que reduz erros fiscais e atendimento híbrido (bot → contador humano).
>
> **Pré-requisitos arquiteturais da v2** (não são features, mas infraestrutura):
> 1. **WhatsApp Business API oficial** (Meta) ou via BSP (Zenvia, Twilio, 360dialog) — requer aprovação e número verificado
> 2. **LLM provider** estável (Anthropic Claude para conversação + Embeddings para busca semântica) — adicionar billing + observabilidade
> 3. **Conciliação bancária** (Open Finance via Belvo/Pluggy ou parsing OFX) para detectar pagamentos automaticamente
> 4. **Sistema de filas** (Inngest, Trigger.dev ou Supabase pgmq) para processar conversas WhatsApp assíncronas
>
> **Legenda de status**: igual à v1 (✅ pronto / 🚧 parcial / 🆕 a fazer).

---

## 1. Onboarding com IA leiga

> Estende §1 da v1 com a camada de "tradução simultânea" para o vocabulário fiscal.
> **Referência Contabilizei**: o site usa **linguagem extremamente acessível** ("contabilidade que cabe no bolso", "tudo do CNPJ resolvido", "sem termos técnicos") e tem **Contabilizei Responde** (FAQ/help center) com explicações em português simples — mas o onboarding em si ainda usa termos contábeis. Balu vai além: zero jargão.

### 1.1. IA traduz em linguagem leiga
**Status**: 🆕 a fazer

**Descrição**: camada de pós-processamento sobre QUALQUER texto técnico que o app gera (mensagens de erro da Receita/Focus, explicações fiscais, notificações). A IA reescreve para vocabulário do usuário comum. Ex:
- **Antes**: "Rejeição 401: CPF do destinatário inválido (dígito verificador)"
- **Depois**: "O CPF do seu cliente parece estar errado. Confere se digitou direito (deve ter 11 números)?"

E inversamente: o usuário escreve "minha venda" → o sistema entende "receita bruta operacional".

**Implementação**:
- Helper `translateForLeigo(termoOuMensagem: string, contexto?: 'erro'|'instrucao'|'explicacao'): Promise<string>` em `src/lib/ai/translator.ts`
- Cache em Redis/Upstash (mesmas entradas → mesma saída) — termos fiscais são finitos
- Wrapper em todas as `useToast('error', mensagem)` chamadas: usa `translateForLeigo` quando `mensagem.length > 80` ou contém palavras técnicas
- Modelo: Claude Haiku ou Sonnet via OpenRouter (custo baixo, latência <1s)
- Adicionar `OPENROUTER_API_KEY` no `.env.example` (já listado na v1 §1.2)

---

## 3. Emissão inteligente assistida por IA

> Estende §3 da v1: a IA fica entre o usuário e o emissor, prevenindo erros antes que aconteçam.

### 3.1. IA ajuda escolher serviço correto e evitar erro de imposto
**Status**: 🆕 a fazer

**Descrição**: ao começar a digitar a descrição do serviço, a IA sugere:
- **Código de tributação nacional do ISS** (Lei Complementar 116) mais adequado
- **Item da lista de serviços municipal** (varia por município)
- **Tributação especial aplicável** (ex: ISS retido na fonte, ISS fora do município)

Previne erro comum: cliente emite serviço de "consultoria" com código de "marketing" e paga ISS errado, abrindo passivo fiscal.

**Implementação**:
- Server action `sugerirCodigoServicoAction(descricao: string, empresaFiscalId: string): Promise<Sugestao[]>`
- Lookup em `municipios_nfse` para pegar `padrao_nfse` + lista de itens municipais
- Chama LLM com prompt: "Atividade: '<descricao>'. Município: '<x>'. CNAE da empresa: '<y>'. Sugira os 3 códigos LC 116 mais adequados, com justificativa."
- Componente `<CodigoServicoAutocomplete value onChange descricao />` que mostra sugestões com confidence + justificativa
- Aprende com confirmações: tabela `sugestoes_aceitas` retroalimenta priorização

### 3.2. Templates prontos ("Prestação de serviços padrão")
**Status**: 🆕 a fazer

**Descrição**: biblioteca de **templates de nota** que o usuário pode escolher em vez de preencher do zero. Ex:
- "Consultoria por hora trabalhada"
- "Mensalidade de serviço continuado"
- "Projeto único entregue"

Cada template já vem com: código de serviço, descrição-modelo (com placeholders `{{periodo}}`, `{{quantidade}}`), tributação correta, condições de pagamento.

**Implementação**:
- Tabela `notas_templates` (id, company_id, nome, descricao_template, codigo_servico, valor_padrao, tributacao_jsonb, uso_count, created_at)
- Templates globais (Balu sugere) + templates do próprio usuário
- Componente `<NotaTemplatesPicker onPick />` no início do form de emissão
- Suporte a snippets dinâmicos: `{{cliente.razao_social}}`, `{{periodo:mes_atual}}`, `{{quantidade}}`

### 3.3. IA sugere código de serviço baseado na descrição em linguagem natural
**Status**: 🆕 a fazer

**Descrição**: variação de 3.1 mas mais profunda — busca semântica em embeddings. Usuário digita "fiz um site pra um restaurante" e o sistema sugere LC 116 item 1.07 (Suporte técnico em informática). Diferente de 3.1 (que pede texto formal), aqui aceita gírias e linguagem coloquial.

**Implementação**:
- Tabela `lc116_itens_embeddings` (item_codigo, descricao_oficial, embedding `vector(1536)`)
- Popular com extensão `pgvector` no Supabase (built-in)
- Function `pesquisarLc116(textoLivre: string, limit=5): Promise<{codigo, descricao, similarity}[]>`
- Embedding via OpenAI `text-embedding-3-small` ou Voyage AI
- Componente reusa o `<CodigoServicoAutocomplete>` de 3.1 + flag `mode='nl' | 'formal'`

### 3.4. Busca por cliente, valor, período (Google-like)
**Status**: 🆕 a fazer

**Descrição**: barra de busca global (Cmd+K / Ctrl+K) onde o usuário digita em linguagem natural:
- "notas do João em outubro" → filtra notas
- "guias pagas em 2025" → filtra guias
- "clientes que devem mais de mil" → query agregada
- "abrir nota nova" → ação direta

Inspirado em Linear/Raycast.

**Implementação**:
- Componente `<CommandPalette />` global (escuta Cmd+K)
- Server action `searchAction(query: string): Promise<SearchResult[]>` que:
  1. Parser leve (regex + heurísticas) detecta intents óbvios ("notas", "guias", "clientes")
  2. Se ambíguo, chama LLM com schema fixo de retorno (`{type: 'notas'|'guias'|'clientes'|'acao', filtros: {}}`)
  3. Executa query Supabase e retorna top 10
- Embeddings opcional para busca textual em descrições de notas (`notas_fiscais.descricao_servico`)

---

## 4. Pagamento e cobrança via WhatsApp + conciliação bancária

> Estende §4 da v1 com o canal WhatsApp + automação financeira.
> **Referência Contabilizei**: tem **atendimento WhatsApp 9h-22h** + **débito automático de impostos e mensalidade** via Contabilizei.bank (conta PJ própria), o que dá conciliação trivial. Balu não tem conta própria → conciliação precisa vir de **Open Finance** ou conector com banco do cliente.

### 4.1. Aviso WhatsApp: "Seu imposto vence dia 20. Clique para pagar"
**Status**: 🆕 a fazer

**Descrição**: 7 dias antes do vencimento de cada guia, o sistema envia template WhatsApp Business para o número cadastrado do usuário:

> "Olá, {{nome}}! 👋
> Seu DAS de **{{competencia}}** vence em **{{dias}} dias** (R$ {{valor}}).
> [💳 Pagar agora via Pix]
> [👀 Ver detalhes]"

Aprovação prévia do template pela Meta é necessária.

**Implementação**:
- Provider WhatsApp Business API: 360dialog ou Twilio (cliente `src/lib/clients/whatsapp.ts`)
- Templates aprovados na Meta: `lembrete_imposto_7d`, `lembrete_imposto_d0`, `imposto_pago_confirmacao`, etc.
- Cron diário pega guias com `data_vencimento BETWEEN now() AND now() + interval '7 days'` AND `status != 'paga'` AND `notificacoes->'whatsapp_7d_sent' IS NULL`
- Envia + marca `notificacoes.whatsapp_7d_sent = now()` (campo jsonb em `guias_fiscais`)
- Botão CTA usa **link curto** que abre `/g/<token>` (rota pública que valida token e mostra a guia pagável — não exige login)

### 4.2. Pagamento direto pelo WhatsApp (PIX Copia e Cola)
**Status**: 🆕 a fazer

**Descrição**: o template WhatsApp inclui o **código Pix Copia e Cola** direto na mensagem. Usuário copia, abre app do banco, cola, paga. Sem precisar abrir o Balu.

**Implementação**:
- Mesma cron de 4.1, mas template adicional `imposto_pix_copia_cola` que inclui:
  > "📋 Copie e cole no seu banco:
  > `00020126580014BR.GOV.BCB.PIX...`"
- O Pix Copia-e-Cola vem da Serpro (campo `linha_digitavel` já mapeado em `guias_fiscais`, mas precisa virar QR/Pix string — verificar API Serpro)
- Para guias que não tenham Pix nativo (DARFs antigos), gerar via gateway próprio (Pagar.me, Stark Bank)

### 4.3. Confirmação automática de pagamento (via conciliação bancária)
**Status**: 🆕 a fazer

**Descrição**: assim que o pagamento cai na conta do usuário, o Balu detecta automaticamente (sem ele precisar marcar manualmente) e:
- Muda `guias_fiscais.status` para `'paga'` + `data_pagamento`
- Envia WhatsApp: "✅ Recebemos a confirmação do seu pagamento de R$ X. Comprovante salvo."
- Atualiza dashboard

**Implementação**:
- Open Finance via Belvo, Pluggy ou Direct Connect com bancos top 5
- Cliente `src/lib/clients/openfinance.ts`
- Cron 4x/dia: para cada usuário com banco conectado, busca transações últimas 24h → match valor + data ± 2 dias com `guias_fiscais.valor_total` pending → marca paga
- Alternativa para v2.1: parsing manual de OFX/extrato bancário enviado pelo usuário
- Requer fluxo de **consentimento Open Finance** (tela dedicada `app/(auth)/configuracoes/banco/page.tsx`)
- Tabela `bank_connections` (id, user_id, provider, account_id, last_sync_at, status, consent_expires_at)

### 4.4. Alerta se passou da data e não detectou pagamento
**Status**: 🆕 a fazer

**Descrição**: D+1 do vencimento, se ainda `status != 'paga'`:
- WhatsApp: "⚠️ {{nome}}, seu imposto venceu ontem e não detectei pagamento. Já pagou? [Sim, já paguei] [Pagar agora]"
- Botão "Sim, já paguei" abre fluxo de **upload de comprovante** (PDF/imagem) para validação humana ou OCR

Evita falsos negativos (pagamento feito em banco não conectado).

**Implementação**:
- Template `imposto_vencido_d1` aprovado na Meta
- Webhook de resposta do WhatsApp (rota `app/api/webhooks/whatsapp/route.ts`)
- Server action `submeterComprovanteAction(guiaId, file)` que faz upload no Storage bucket `comprovantes-guias` + cria registro pendente de revisão humana
- Painel do contador (§8.5 da v1) ganha aba "Comprovantes a validar" com OCR sugerindo match

### 4.5. Histórico de guias pagas (comprovante sempre acessível)
**Status**: 🚧 parcial

**Descrição**: rota `/impostos/historico` lista todas as guias pagas com:
- Competência, valor, data de pagamento, comprovante (PDF da guia + comprovante bancário se houver)
- Filtros por ano/tipo
- Export CSV para o contador

**Implementação**:
- Schema já tem `guias_fiscais` com `status`, `data_pagamento`, `pdf_url`
- Adicionar campo `comprovante_pagamento_url` (text, nullable)
- Rota `app/(auth)/impostos/historico/page.tsx` (nova)
- Componente `<GuiasHistoricoTable />` com filtros e botão "Baixar Comprovante" (concat PDF guia + PDF comprovante via pdf-lib)
- Compartilha lógica com §5.4 da v1 (repositório de documentos)

---

## 6. WhatsApp como Canal Único

> **Tema central da v2**. Hoje o Balu exige o usuário entrar no app web/PWA. A v2 permite que **toda interação aconteça pelo WhatsApp**: emitir nota, ver impostos, abrir empresa, falar com contador.
>
> **Referência Contabilizei**: tem **WhatsApp 9h-22h** como canal principal de suporte e **meta de resposta em 3 minutos** (comunicação Médicos), mas **não permite operação por WhatsApp** — só conversa. Balu vai além: o WhatsApp vira interface operacional.

### 6.1. Atendimento via WhatsApp com IA
**Status**: 🆕 a fazer

**Descrição**: usuário manda mensagem para o número Balu. Bot responde em ≤ 10 segundos com base em:
- Contexto da conta (qual empresa está logada, qual regime, faturamento, próximas obrigações)
- Base de conhecimento Balu (FAQ + PRD-Balu.md como RAG)
- Capacidades operacionais: emitir nota, gerar guia, consultar histórico, abrir ticket

Exemplo:
- Usuário: "qual meu imposto desse mês?"
- Bot: "Seu DAS de novembro é R$ 80,90, vence 20/12. Quer que eu mande o Pix Copia-e-Cola?"

**Implementação**:
- Webhook entrante: `app/api/webhooks/whatsapp/route.ts` recebe POST do provedor (Twilio/360dialog)
- Identifica usuário pelo `from` (E.164) → busca `profiles.whatsapp_number`
- Pipeline de processamento:
  1. Classify intent (consulta / ação / atendimento humano) — LLM rápido (Haiku)
  2. Route por intent → handler específico (toolkit)
  3. Gera resposta via LLM com contexto + tools disponíveis (function calling)
- Toolkit (Claude function calling ou LangChain-style): `get_imposto_atual`, `gerar_pix_copia_cola`, `emitir_nota`, `consultar_cliente`, etc. — cada um é uma server function
- Histórico de conversa em tabela `whatsapp_conversations` (mantém últimas N mensagens para contexto)
- Fila assíncrona (Inngest/Trigger.dev) para processamento — webhook responde 200 imediato

### 6.2. Respostas automáticas + fallback contador
**Status**: 🆕 a fazer

**Descrição**: nem tudo a IA resolve. Quando ela detecta:
- Pergunta ambígua que pediu esclarecimento 2x
- Tópico fora do escopo conhecido (ex: "minha sócia faleceu, como resolver?")
- Usuário pediu explicitamente "falar com humano"
- Erro fiscal complexo

...escala para o contador da contabilidade vinculada (§8 da v1). Bot avisa: "Vou pedir para a {{contabilidade.nome}} olhar isso e te respondo em até {{sla}} horas."

**Implementação**:
- Decision tree de escalação na pipeline (6.1)
- Notificação para o contador via:
  - Painel `/contador` com aba "Conversas escaladas"
  - E-mail/WhatsApp para o `support_whatsapp` da contabilidade
- Quando o contador responde no painel, a resposta é entregue ao cliente final pelo bot ("Olha o que a Maria, sua contadora, respondeu: …")
- Tabela `whatsapp_escalations` (conversation_id, escalated_at, contador_id, resolved_at, resolution_text)

### 6.3. Solicitação automática de documentos
**Status**: 🆕 a fazer

**Descrição**: quando o sistema precisa de algo (ex: foto do certificado A1 antigo, comprovante de endereço atualizado, novo contrato social), o bot pede via WhatsApp:

> "Oi! Pra continuar a abertura da sua empresa, preciso de uma foto do seu RG (frente e verso). Pode enviar aqui mesmo? 📷"

Usuário tira foto, manda. Bot recebe, valida com OCR/visão (Claude vision ou similar), confirma e atualiza o registro.

**Implementação**:
- Trigger no app gera "request de documento": tabela `document_requests` (id, user_id, doc_type, status, created_at, expires_at, attachment_path)
- Bot envia template aprovado com `doc_type` descrito
- Webhook de mídia recebida (rota WhatsApp já existe): identifica `document_request` aberto, baixa mídia, salva em Storage, marca como `received`
- Pipeline de OCR/validação (Claude vision): verifica se a foto é legível, se é o documento certo, extrai dados básicos (nome, CPF)
- Se válido: marca `status='approved'` + atualiza tabela alvo (`abertura_empresas.anexos`, `arquivos_auxiliares`, etc.)
- Se inválido: bot pede de novo com instrução específica ("Não consegui ler. Pode tirar de novo com mais luz?")

### 6.4. Contador só entra quando IA não resolve
**Status**: 🆕 a fazer (princípio + métrica)

**Descrição**: princípio operacional + métrica de produto. O contador é caro; cada escalação evitada pela IA é margem para o escritório. Meta: **≥ 80% de resoluções automáticas** sem precisar de humano.

**Implementação**:
- Métrica diária por contabilidade: % de conversas resolvidas só pela IA
- Dashboard do contador (§8.5 v1) ganha card "Automação: 84% das conversas deste mês"
- Função `should_escalate(conversation)` com lógica clara e auditável (não opaca)
- Loop de melhoria: revisão semanal de conversas escaladas → fine-tuning de prompts / adição de tools
- Permite o contador **marcar resposta como "podia ter sido automática"** → vira training data

---

## 8. White-Label avançado

### 8.1. Domínio personalizado
**Status**: 🆕 a fazer

**Descrição**: cada contabilidade parceira pode apontar seu próprio domínio (ex: `app.contabilidadeABC.com.br`) para a instância Balu. URL com a marca dele em vez de `app.balu.com.br/contabilidade-abc`.

**Implementação**:
- Schema já preparado: `contabilidades.dominio_custom` (v1 §8.1)
- Roteamento multi-tenant: middleware `middleware.ts` lê `host` do request → lookup em `contabilidades` por `dominio_custom` → injeta `contabilidadeId` em headers/cookies
- Para deployment Vercel:
  - Programatic domain via Vercel API quando contador adiciona domínio
  - SSL automático
  - Instruções de CNAME para o contador apontar
- Alternativa: subdomínio padrão `<slug>.balu.com.br` (mais simples, menos branded)
- Setup wizard no painel do contador `/configuracoes/dominio` com validação DNS em tempo real

---

## Pré-requisitos & dependências externas para v2

| Pré-requisito | Necessário para | Bloqueador? | Estimativa de setup |
|---|---|:---:|---|
| WhatsApp Business API (Meta) | 4.1, 4.2, 4.4, 6.1, 6.2, 6.3 | 🔴 Sim | 2-4 semanas (verificação Meta, aprovação de templates, BSP onboarding) |
| LLM provider com billing | 1.1, 3.1, 3.3, 3.4, 6.1, 6.2 | 🔴 Sim | 1 dia (OpenRouter/Anthropic + monitoring) |
| pgvector no Supabase | 3.3, 3.4 | 🟡 Opcional na v2.0 | 1 hora (extensão built-in) |
| Open Finance (Belvo/Pluggy) | 4.3 | 🟡 Pode adiar | 2-3 semanas (KYC do provedor + sandbox + go-live) |
| Resend ou similar para e-mail | 4.4, 7.2 (v1) | 🟢 Pode usar SMTP | 1 dia |
| Vercel ou Cloudflare API (domínio custom) | 8.1 | 🟢 Adiar para v2.1 | 1-2 semanas |
| Sistema de filas (Inngest/Trigger.dev) | 6.1, 6.2 (escala) | 🟡 Começa sem; necessário em escala | 1 semana |
| OCR/Visão (Claude vision) | 4.4, 6.3 | 🟢 Já incluso no LLM provider | 0 dias |

---

## Ordem sugerida de implementação da v2

1. **Fase 0 — Infra**: contratar WhatsApp Business API + LLM provider, aprovar primeiros 3 templates
2. **Fase 1 — Notificações WhatsApp (4.1, 4.2, 4.4)**: caminho mais curto pra valor visível. Templates aprovados + cron diária. Sem IA conversacional ainda.
3. **Fase 2 — Bot conversacional básico (6.1)**: usuário consulta status, recebe explicações simples. Sem ações ainda.
4. **Fase 3 — IA emissão (3.1, 3.2)**: melhora UX dentro do app web/PWA. Não depende de WhatsApp.
5. **Fase 4 — Bot operacional (6.3, 6.2)**: bot emite notas, gera guias, solicita documentos. Escala para humano com fallback contador.
6. **Fase 5 — Conciliação bancária (4.3, 4.5)**: fecha o loop financeiro.
7. **Fase 6 — Busca natural + tradução (3.3, 3.4, 1.1)**: refinamento UX dentro do app.
8. **Fase 7 — Domínio personalizado (8.1)**: feature white-label avançada para contadores enterprise.

---

## Checklist macro de v2 (DoD)

- [ ] Todas as features acima implementadas
- [ ] WhatsApp Business API verificada e operando
- [ ] ≥ 5 templates de mensagem aprovados pela Meta
- [ ] LLM provider com observabilidade (custo por usuário, latência p95, taxa de erro)
- [ ] Pipeline assíncrono de WhatsApp processa 1000 mensagens/min sem perda
- [ ] Métrica "% de conversas resolvidas só pela IA" instrumentada e ≥ 70%
- [ ] Conciliação bancária ativa em pelo menos 1 banco (Itaú/Bradesco/Inter)
- [ ] Pelo menos 10 contadores parceiros usando white-label completo
- [ ] Pelo menos 1 contabilidade com domínio personalizado ativo
- [ ] Documentação dos prompts da IA (versionada com diffs)
- [ ] Política de privacidade atualizada para WhatsApp + dados bancários (LGPD)
