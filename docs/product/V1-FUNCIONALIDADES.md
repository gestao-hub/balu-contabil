# Balu — V1 (entregas verdes)

> **Escopo**: funcionalidades marcadas em **🟢 verde** no `planejamento-balu.pdf`, que devem ser entregues na **v1** do projeto.
> Cada item foi enriquecido com aprendizados do `ANALISE-CONTABILIZEI.md` (engenharia reversa do site da Contabilizei).
>
> **Como ler**: cada feature tem (1) um **status** indicando onde estamos no `app/`, (2) uma **descrição rica** com o que precisa fazer + referência ao que a Contabilizei faz, e (3) **bullets de implementação** prontos para um LLM executar sob supervisão humana.
>
> **Legenda de status**:
> - ✅ **pronto** — implementado e testado no `app/`
> - 🚧 **parcial** — base existe (schema, cliente API ou componente), mas falta a UI completa do behavior
> - 🆕 **a fazer** — nada construído ainda; precisa ser feito do zero

---

## 1. Onboarding Guiado com IA Educacional

> **Visão**: o usuário leigo chega sem entender termos contábeis. Em vez de um wizard frio de "preencher CNPJ/IE/IM", ele responde 3-5 perguntas em linguagem natural ("O que você faz?", "Já tem CNPJ?", "Emite nota?") e o Balu monta o perfil tributário automaticamente.
>
> **Referência Contabilizei**: a Contabilizei usa um **quiz de 4 perguntas** (atividade, sócios/funcionários, autonomia, canal de atendimento) que recomenda plano e mostra economia. Tem também **consultoria de CNAE** humana que orienta escolha de CNAE, tipo societário, regime tributário e certificado. Para o Balu, a meta é replicar a etapa de CNAE/regime via IA, sem humano no loop.

### 1.1. Fluxo conversacional ("O que você faz?", "Já tem CNPJ?", "Emite nota?")
**Status**: 🆕 a fazer

**Descrição**: um chat dirigido (ou wizard com tom conversacional) que, em 4–6 perguntas curtas, descobre:
- A atividade real do usuário (ex: "vendo bolos pela internet")
- Se já tem CNPJ (ramificação 1: importar; ramificação 2: abrir empresa via §2)
- Se emite nota hoje (ramificação: ativar emissor agora vs depois)
- Volume estimado de faturamento mensal
- Se atende presencialmente, online ou ambos

Cada resposta atualiza o `profiles` e a `companies.cnae_principal` em background. A UI nunca pede "selecionar CNAE" — o sistema sugere.

**Implementação**:
- Nova rota `app/(public)/onboarding/page.tsx` (server) + `OnboardingChat.tsx` (client)
- Server action `processOnboardingStep(stepId, answer)` que persiste em `onboarding_sessions` (tabela nova ou JSONB em `profiles.onboarding_state`)
- Integração com LLM (OpenRouter/Claude) para extrair entidades das respostas livres
- Quando concluído: redireciona para `/configuracoes` ou `/clientes` conforme estado
- Substitui o `CreateCompanyDialog` atual como porta de entrada para usuários sem `current_company`

### 1.2. Geração automática de: Perfil empresa, CNAE sugerido, Regime tributário
**Status**: 🚧 parcial

**Descrição**: a partir da descrição livre da atividade ("vendo bolos pela internet"), uma chamada LLM deve devolver:
- **CNAE principal** sugerido (ex: `1091-1/00 — Fabricação de produtos de panificação`)
- **CNAEs secundários** plausíveis
- **Regime tributário recomendado** (MEI / Simples Anexo I / Anexo III / etc.) baseado em faturamento estimado + atividade
- **Anexo do Simples** e **uso de Fator R** quando aplicável

Hoje o `CreateCompanyDialog` busca dados via Focus NFe (`lookupCnpjAction`) quando o usuário **já tem** CNPJ — traz razão social, endereço, atividade real do CNAE registrado. Falta a camada de **sugestão IA pra quem ainda não tem CNPJ**.

**Implementação**:
- Estender `lookupCnpjAction` em `src/app/(auth)/onboarding/actions.ts` com fallback IA
- Nova action `suggestCnaeFromActivity(descricaoLivre: string, faturamentoEstimado: number)` em `src/app/(public)/onboarding/actions.ts`
- Tabela `cnae_catalog` (popular com CSV oficial Receita: ~1300 CNAEs)
- Calls LLM via OpenRouter ou Anthropic — adicionar `OPENROUTER_API_KEY` em `.env.example`
- Validação: dropdown editável mostra a sugestão + 2 alternativas, usuário confirma

---

## 2. Abertura de Empresa Digital

> **Visão**: usuário sem CNPJ abre uma ME 100% online dentro do Balu. Sem cartório, sem ir presencialmente em junta comercial.
>
> **Referência Contabilizei**: usa fluxo de 4 passos (cadastro → análise → orientação de pagamento de taxas → CNPJ emitido), com **integração à RedeSim / Balcão Único / Junta Comercial / Prefeitura**. Confeccionam contrato social, requerimento de empresário, DBE. Tem **calculadora de cenário do MEI** (inputs: ramo, mês/ano de abertura, faturamento) que recomenda "desenquadrar" ou "dar baixa". Variante: **desenquadramento MEI → ME**.

### 2.1. Abertura 100% online (MEI + ME sem sócio)
**Status**: 🚧 parcial

**Descrição**: o usuário escolhe o tipo da empresa (`empresa_tipo` no banco ∈ `{MEI, EI, LTDA}`): **MEI** (mais simples, apenas RedeSim), **EI** (empresário individual) ou **LTDA** (envolve contrato social digital e Junta Comercial). O fluxo apresenta no início qual caminho cabe melhor pelo perfil capturado em §1, mas permite escolher manualmente.

**Implementação**:
- A tabela `abertura_empresas` **já existe no banco real** (fonte da verdade — não usar o desenho da migration `0001`, que diverge). São ~50 colunas flat agrupadas por prefixo:
  - `titular_*` — dados pessoais e endereço do titular (`titular_nome_completo` NOT NULL, `titular_cpf` varchar(14) NOT NULL **UNIQUE**, RG, nascimento, estado civil, nome da mãe, telefone, e-mail, nacionalidade default `brasileiro(a)`, naturalidade, CEP/logradouro/número/complemento/bairro/cidade/UF)
  - `empresa_*` — `empresa_razao_social_1/2/3` (3 opções), `empresa_nome_fantasia`, `empresa_tipo` ∈ `{MEI, EI, LTDA}`, `empresa_capital_social` numeric(15,2), `empresa_objeto_social`, `empresa_cnae_principal`, `empresa_cnaes_secundarios` text[], `empresa_regime_tributario` ∈ `{MEI, Simples Nacional, Lucro Presumido, Lucro Real}`
  - `sede_*` — `sede_mesmo_que_titular` bool, `sede_tipo_endereco` ∈ `{Residencial, Comercial, Virtual}` + CEP/logradouro/número/complemento/bairro/cidade/UF
  - `doc_*` — caminhos de upload (texto), não jsonb: `doc_rg_frente`, `doc_rg_verso`, `doc_cnh_frente`, `doc_cnh_verso`, `doc_cpf`, `doc_comprovante_titular`, `doc_comprovante_sede`, `doc_declaracao_uso`
  - `processo_*` — `processo_etapa` (ver §2.4), `processo_protocolo`, `processo_cnpj_emitido` varchar(18), `processo_observacoes`, `processo_atualizado_por`
  - meta: `criado_em`/`atualizado_em` (timestamptz, nomes PT; trigger `trg_abertura_atualizado` → `set_atualizado_em`), `user_id` (FK `auth.users`), `company_id` (FK `companies`)
- Nova rota `app/(auth)/abertura/page.tsx` com wizard de 5 etapas mapeadas aos grupos: (1) dados do titular → (2) endereço do titular → (3) dados da empresa → (4) endereço da sede (`sede_mesmo_que_titular` copia do titular) → (5) documentos (`doc_*`)
- Server action `submitAberturaAction(payload)` que insere com `processo_etapa = 'recebido'`; tratar a violação de `UNIQUE(titular_cpf)` com mensagem amigável ("já existe uma solicitação de abertura para este CPF")
- Para **MEI** (`empresa_tipo='MEI'`): integração com Portal do Empreendedor (gov.br) — viable via n8n + RPA ou redirect com pré-preenchimento
- Para **EI/LTDA**: integração RedeSim — via n8n webhook (já existe `n8n` client; criar novo endpoint)

### 2.2. Checklist automático de documentos
**Status**: 🆕 a fazer

**Descrição**: lista dinâmica de documentos necessários conforme o tipo societário escolhido. Para MEI: só CPF + comprovante de endereço. Para SLU: + RG, contrato social a ser gerado, DBE, requerimento. Cada item mostra ✅/⏳/❌ e botão "Enviar agora".

**Implementação**:
- Componente `<ChecklistAbertura tipo={tipoSocietario} />` que renderiza lista a partir de constante `DOC_REQUIREMENTS` em `src/lib/abertura/requirements.ts`
- Upload usa `src/lib/clients/supabase-storage.ts` (bucket `abertura-docs` — criar)
- Cada doc enviado grava o **caminho do arquivo na coluna `doc_*` correspondente** (texto), conforme o schema real — não há coluna `anexos` jsonb. Ex.: RG frente → `doc_rg_frente`, comprovante do titular → `doc_comprovante_titular`, comprovante da sede → `doc_comprovante_sede`, declaração de uso de endereço → `doc_declaracao_uso`

### 2.3. Geração/envio: Contrato social, solicitações Receita/Junta/Prefeitura
**Status**: 🆕 a fazer

**Descrição**: o sistema **gera o contrato social** em PDF a partir dos dados coletados (template Jinja-like com placeholders) e o cliente **assina digitalmente** dentro do Balu (Clicksign ou D4Sign). Depois orquestra automaticamente: emissão DBE na Receita → registro Junta Comercial → inscrição municipal (prefeitura).

**Implementação**:
- Template de contrato social em `src/lib/abertura/templates/contrato-social-slu.html`
- Geração PDF: `puppeteer-core` + `@sparticuz/chromium` (serverless) ou serviço externo (ex: DocRaptor)
- Assinatura digital: integração Clicksign (criar novo client em `src/lib/clients/clicksign.ts`)
- Submissão Receita/Junta: n8n workflow disparado na transição de `processo_etapa` para `enviado_receita` → `enviado_junta` → `enviado_prefeitura` (estados reais do banco). Obs.: o schema atual **não** tem estado dedicado de "contrato assinado"; se for necessário rastrear a assinatura como etapa própria, adicionar via migration aditiva ao check `abertura_empresas_processo_etapa_check`

### 2.4. Status em tempo real
**Status**: 🆕 a fazer

**Descrição**: timeline visual mostrando em que etapa do processo está (recebido → em análise → docs pendentes → enviado à Receita → enviado à Junta → enviado à Prefeitura → concluído). Etapas concluídas em verde, atual em azul pulsante, futuras em cinza. Cada mudança gera notificação por e-mail/WhatsApp.

**Implementação**:
- Componente `<AberturaTimeline etapa={processo_etapa} />` reusável
- Realtime via Supabase channels: `supabase.channel('abertura:'+id).on('postgres_changes', ...)`
- Estados canônicos (check constraint `abertura_empresas_processo_etapa_check` no banco real): `recebido | em_analise | pendente_documentos | enviado_receita | enviado_junta | enviado_prefeitura | concluido | cancelado` (default `recebido`). O CNPJ resultante grava em `processo_cnpj_emitido`.

---

## 3. Emissão de Notas Fiscais Simplificada

> **Visão**: emitir uma NFS-e em ≤ 3 cliques, sem entender ISS, alíquota, código de serviço, regime de tributação. O sistema sabe tudo isso pela configuração da empresa.
>
> **Referência Contabilizei**: tem **emissor ilimitado gratuito**, **autopreenchimento de notas recorrentes** (replica notas de meses anteriores com 1 clique), **cálculo automático de ISS por município**, **preenchimento simplificado sem termos técnicos**, **integração com a contabilidade** (notas alimentam apuração), **validação de Certificado A1**, **orquestração de cadastro nas prefeituras**. No plano Experts, a própria Contabilizei emite as notas pelo cliente.

### 3.1. Emissor NFS-e integrado (ou via proxy)
**Status**: 🚧 parcial

**Descrição**: emissor real integrado à Focus NFe (gateway que abstrai +500 prefeituras). Suporta NFS-e (serviços), NF-e (produtos/comércio) e NFC-e (varejo). A complexidade técnica das diferentes APIs municipais fica escondida do usuário.

**Implementação**:
- Cliente já pronto: `src/lib/clients/focus-nfe.ts` (emit + status + cancel + download)
- Rota a implementar: `app/(auth)/notas_fiscais/emissao/page.tsx` (hoje stub)
- Server action `emitirNotaAction(payload)` em `app/(auth)/notas_fiscais/actions.ts`:
  1. Gera `ref` via `generateRef(empresaId)`
  2. Insere `notas_fiscais` com `status='pendente'`
  3. Chama `focus.emitirNfse(ref, payload)`
  4. Atualiza `notas_fiscais` com `status='ativa'` + chave/protocolo OU `status='erro'` + msg
- Form com 3 campos visíveis: **Cliente** (autocomplete em `clientes`), **Descrição do serviço**, **Valor**. Tudo restante (CNAE, tributação, código serviço) puxado de `empresas_fiscais`
- Webhook receiver já pronto: `app/api/webhooks/focus/route.ts`

### 3.2. Histórico simples e exportável
**Status**: 🆕 a fazer

**Descrição**: lista cronológica de todas as notas emitidas (filtros: período, cliente, status, valor), com botão "Exportar CSV/XLSX" para o cliente fazer DRE/fluxo de caixa fora do app. Cada linha clicável abre o detalhe.

**Implementação**:
- Rota `app/(auth)/notas_fiscais/page.tsx` (hoje stub)
- Server query: `supabase.from('notas_fiscais').select('*, clientes(razao_social)').eq('company_id', currentCompanyId).order('data_emissao desc')`
- Component `<NotasFiscaisList />` com `<FilterPeriodo>` já pronto + busca textual + filtro tipo (NFe/NFCe/NFSe)
- Export CSV: server action `exportNotasCsv(filtros)` retorna `Response` com `Content-Type: text/csv`
- Detalhe: `app/(auth)/notas_fiscais/[id]/page.tsx` (hoje stub) com botões "Baixar XML", "Baixar PDF/DANFE", "Cancelar"

### 3.3. Preview do imposto ANTES de emitir
**Status**: 🆕 a fazer

**Descrição**: ao preencher valor + descrição da nota, mostrar **em tempo real** um card lateral: "Você vai pagar **R$ X de ISS** sobre esta nota (alíquota Y% do município Z)" + "Sua receita acumulada do mês ficará em R$ W de R$ 6.750/mês (limite MEI)". Evita surpresa fiscal.

**Implementação**:
- Function `calculatePreviewImpostos(valor, empresaFiscalId)` em `src/lib/fiscal/preview.ts`
- Para MEI: alíquota fixa (DAS mensal cobre tudo)
- Para Simples Nacional: lookup em `apuracoes_fiscais` para pegar `rbt12` atual → calcular alíquota efetiva via tabela anexo
- Componente `<PreviewImpostoCard valor={form.valor} />` reativo, sem chamar API a cada keystroke (debounce 500ms)
- Mostra também margem para o teto do regime (MEI: 81k/ano; Simples: 4.8M/ano)

### 3.4. Alerta se o cliente estiver próximo do limite de faturamento
**Status**: 🆕 a fazer

**Descrição**: banner persistente no topo do dashboard quando o `rbt12` (receita bruta últimos 12 meses) passar de 70% do teto do regime. Cores: <70% nada, 70-85% amarelo "Atenção", 85-95% laranja "Importante", >95% vermelho "Risco de desenquadramento — fale com o contador".

**Implementação**:
- Lê `apuracoes_fiscais` da empresa atual, pega o `rbt12` mais recente
- Conhece os tetos do regime via `empresas_fiscais.Code_regime_tributario`:
  - 1 (Simples) → R$ 4.800.000/ano
  - 4 (MEI) → R$ 81.000/ano
- Componente `<LimiteFaturamentoBanner empresaId={…} />` no `app/(auth)/layout.tsx`
- Server function `getLimiteStatus(empresaId): { regime, teto, rbt12, percentual, severity }`
- Notificação push/e-mail quando cruza 85% (cron diário ou trigger Postgres)

### 3.5. XML + PDF gerados automaticamente
**Status**: 🚧 parcial

**Descrição**: assim que a Focus retorna a nota autorizada, o XML oficial (assinado digitalmente) e o PDF (DANFE para NF-e ou DPS para NFS-e) ficam disponíveis para download permanentemente, sem o cliente precisar pedir.

**Implementação**:
- Cliente Focus já tem `baixarDanfe(ref)`, `baixarXmlNfe(ref)`, etc.
- Backfill: rota `app/(auth)/notas_fiscais/[id]/page.tsx` puxa via `focus.baixarDanfe(nota.ref)` on-demand quando usuário clica "Baixar"
- **Otimização** (não-bloqueante para v1): cache em Supabase Storage bucket `notas-arquivos`, path `${companyId}/${ref}.pdf` e `.xml`. Server action `cacheNotaArquivos(ref)` rodada por webhook quando nota autoriza, ou lazy no primeiro download

---

## 4. Apuração Automática de Impostos

> **Visão**: todo dia 1º do mês o sistema **automaticamente** apura impostos do mês anterior, gera a guia DAS e notifica o usuário. Sem ele precisar abrir o app.
>
> **Referência Contabilizei**: faz **cálculo automático de DAS, INSS, ISS, ICMS, IRPJ, CSLL** conforme regime, **gera DARFs e boletos** dentro da plataforma, tem **simulador de impostos** ("simula o imposto a pagar por faturamento"), oferece **otimização tributária** (time tributário sugere economia via Fator R, anexo correto, regime ideal) e **resposta a notificações da Receita** com apoio humano. Tudo isso integrado ao calendário tributário ("agenda tributária por CNPJ").

### 4.1. Cálculo automático DAS mensal e DAS-MEI
**Status**: 🚧 parcial

**Descrição**: no fechamento de cada competência (mês), o motor consolida todas as receitas (notas emitidas + receitas externas declaradas), calcula RBT12, identifica alíquota efetiva pelo anexo do Simples (ou aplica DAS fixo do MEI: R$ 75,90 comércio, R$ 80,90 indústria/serviços, R$ 81,90 transporte — valores 2025), e emite a guia.

**Implementação**:
- n8n client pronto: `src/lib/clients/n8n.ts` com `consolidarReceitas`, `calcularRbt12`, `consultaDasMei`
- Schema pronto: `apuracoes_fiscais` (com colunas IRPJ, CSLL, COFINS, PIS, INSS, ICMS, ISS), `guias_fiscais`
- Falta a **orquestração de calendário**: cron job (Supabase Edge Function ou Vercel Cron) que no dia 1 de cada mês:
  1. Lista todas `empresas_fiscais` com `empresa_fiscal_ativada=true`
  2. Para cada uma, dispara `n8n.consolidarReceitas({empresa_id, competencia})`
  3. Aguarda webhook de retorno → atualiza `apuracoes_fiscais` + cria `guias_fiscais`
- Rota `app/(auth)/impostos/page.tsx` (hoje stub) lista as `guias_fiscais` recentes
- Rota `app/(auth)/impostos/novo/page.tsx` (hoje stub) permite recálculo manual com `<ApuracaoWizard />`

### 4.2. Geração da guia
**Status**: 🚧 parcial

**Descrição**: a guia DAS (boleto + código de barras + linha digitável + QR Pix) é gerada via Serpro Integra Contador. PDF fica disponível no app e link Pix Copia-e-Cola.

**Implementação**:
- Cliente Serpro pronto: `src/lib/clients/serpro.ts` com `emitirDas` + `SERPRO_SERVICES.GERAR_DAS`
- Server action `emitirGuiaAction(empresaId, competencia)`:
  1. Monta envelope via `buildEnvelope({cnpjContratante, cnpjContribuinte, idServico: GERAR_DAS, dados})`
  2. Chama `serpro.emitirDas('prod', envelope)`
  3. Persiste `guias_fiscais` com PDF URL + `linha_digitavel` + `status='gerada'`
- Component `<GuiaCard guia={...} />` mostra PDF embed + botão "Pagar via Pix" (copia linha)

### 4.3. Explicação em português simples
**Status**: 🆕 a fazer

**Descrição**: cada guia/apuração vem com um **resumo conversacional** ao lado dos números: "Em outubro você faturou R$ 8.500. Como você é MEI Serviços, vai pagar R$ 80,90 fixos. Sua receita acumulada do ano está em R$ 67.230 (83% do teto)." Substitui colunas de "IRPJ R$ 12,40 / CSLL R$ 3,21 / ..." por linguagem que o leigo entende.

**Implementação**:
- Function `explicarApuracao(apuracao: ApuracaoRow): string` em `src/lib/fiscal/explicacoes.ts`
- Templates por regime (MEI / Simples / Lucro Presumido)
- Para Simples: cita o anexo, a alíquota efetiva ("seu negócio paga 6,2% sobre o faturamento, dentro do Anexo III Serviços")
- Pode opcionalmente chamar LLM para casos atípicos (ex: mudança de anexo entre meses)
- Componente `<ResumoApuracao />` no detalhe da apuração e no card da guia

---

## 5. Painel Leigo do Empresário *(inferido — sem checks no PDF)*

> **Visão**: a tela `/` (home/dashboard) precisa ser desenhada para o leigo, não pra contador. Tudo grande, em português simples, com 3-4 cards principais e zero jargão.
>
> **Referência Contabilizei**: o dashboard logado da Contabilizei tem **"visão 24/7 da contabilidade em tempo real"** + lista **"O que você precisa fazer"** com ações pendentes (enviar extrato, validar dados, pagar imposto vencendo). Combina **acesso rápido ao emissor de notas, à cobrança e à conta PJ** num único hub.

### 5.1. Dashboard 24/7 da empresa em tempo real
**Status**: 🆕 a fazer

**Descrição**: rota `/` mostra cards grandes:
- **Receita do mês atual** (com comparação ao mês anterior)
- **Próxima obrigação fiscal** (DAS de outubro vence em 5 dias — botão Pagar)
- **Limite de faturamento** (barra de progresso)
- **Última nota emitida** (com botão "Emitir nova")

**Implementação**:
- Rota `app/(auth)/page.tsx` (hoje stub)
- Server queries paralelas (Promise.all): apuração mês atual + próxima guia + última nota + agregado receita do mês
- Componente `<DashboardCard title icon value subtitle action />` reusável
- Atualização live via Supabase Realtime ou polling 60s

### 5.2. Lista "O que você precisa fazer"
**Status**: 🆕 a fazer

**Descrição**: card persistente que combina:
- Guias vencendo nos próximos 7 dias
- Notas em status `pendente` que falharam ao emitir
- Documentos do onboarding pendentes
- Validações de dados (CNPJ desatualizado, certificado A1 vencendo)

Cada item tem CTA direto ("Pagar agora", "Reemitir nota", "Enviar documento").

**Implementação**:
- Server function `getPendingActions(userId, currentCompanyId): PendingAction[]`
- Pesquisa cross-table com União em SQL ou em código
- Componente `<PendingActionsList />` no dashboard
- Badge no `MenuLateral` mostrando contagem total de pendências

### 5.3. Visualização e pagamento de impostos em poucos cliques
**Status**: 🆕 a fazer

**Descrição**: clique em "Pagar DAS de outubro" abre modal com:
- PDF da guia embed
- Linha digitável (com botão copiar)
- QR Code Pix
- Botão "Marcar como pago" (manual) + indicação que conciliação automática vai detectar quando cair (futuro v2)

**Implementação**:
- Componente `<PagarGuiaModal guiaId />` que carrega `guias_fiscais` por id
- Server action `marcarGuiaPagaAction(id)` que muda `status='paga'` + `data_pagamento=now()`

### 5.4. Repositório de documentos
**Status**: 🆕 a fazer

**Descrição**: aba "Documentos" com tudo organizado por tipo: contratos sociais, certidões negativas, declarações entregues (DASN, DCTF), notas, guias pagas. Tudo baixável.

**Implementação**:
- Rota `app/(auth)/documentos/page.tsx`
- Lê de múltiplas tabelas (`notas_fiscais`, `guias_fiscais`, `arquivos_auxiliares`, `declaracoes_fiscais`) + Supabase Storage bucket `documentos`
- Agrupamento client-side por tipo + período

---

## 7. Gestão de Obrigações Básicas

> **Visão**: o usuário **nunca** clica em "entregar DASN-SIMEI" — o sistema faz por ele e só avisa "entregue ✅". Zero atrito.
>
> **Referência Contabilizei**: faz **entregas automatizadas** de eSocial, DCTF, DCTFWeb, SPED, DEFIS, DASN, DIRF, EFD-Reinf, DIMOB, DMED, **calendário de obrigações fiscais por CNPJ**, **alertas automáticos**, e **resposta a notificações da Receita**.

### 7.1. Entrega automática DASN-SIMEI e obrigações Simples básicas
**Status**: 🆕 a fazer

**Descrição**: para MEI, a DASN-SIMEI (Declaração Anual do Simples Nacional do MEI) é entregue automaticamente até 31/maio de cada ano, baseada nas notas emitidas no app no ano anterior. Para Simples, é a DEFIS (anual) e PGDAS-D (mensal — já coberto na §4).

**Implementação**:
- Cron anual (1º de janeiro) que enfileira todas as MEIs ativas
- n8n workflow `entregar-dasn-simei` que: pega receita acumulada do ano via `apuracoes_fiscais`, monta XML/payload Serpro, envia, captura protocolo, atualiza `declaracoes_fiscais` com `tipo_declaracao='DASN-SIMEI'`, `status='enviada'`, `protocolo`
- E-mail/WhatsApp ao usuário: "Sua DASN de 2025 foi entregue. Protocolo: XYZ."

### 7.2. Alertas automáticos
**Status**: 🆕 a fazer

**Descrição**: notificações proativas por e-mail (e WhatsApp na v2) para:
- 7 dias antes do vencimento do DAS
- No dia do vencimento se não pago
- 1 dia após vencimento se não pago (com alerta de juros)
- 7 dias antes do vencimento do certificado A1
- Quando uma nota é cancelada com sucesso
- Quando uma declaração é entregue

**Implementação**:
- Tabela nova `notifications` (id, user_id, type, severity, title, body, action_url, read_at, created_at)
- Trigger Postgres / cron / Edge Function que insere conforme regras
- Componente `<NotificationsBell />` no `MenuLateral` mostra contagem
- E-mail via Resend (criar `src/lib/clients/resend.ts`) — adicionar `RESEND_API_KEY` em `.env.example`

### 7.3. Zero ação manual do cliente
**Status**: 🆕 a fazer (conceitual)

**Descrição**: princípio guia, não feature isolada. Garante que **toda obrigação que pode ser entregue automaticamente deve ser entregue automaticamente**. A UI só mostra ao usuário: "Entregue ✅ em DD/MM" + link para o comprovante. Nunca pede ação que o sistema poderia ter feito sozinho.

**Implementação**:
- Auditoria periódica: revisão de cada fluxo perguntando "isso poderia ser automático?"
- Critério de aceite para features novas: se exige clique do usuário pra algo previsível, justificar ou automatizar
- Métrica a monitorar: % de obrigações entregues sem intervenção do usuário (alvo: 95%+)

---

## 8. Área White-Label do Contador

> **Visão**: contadores parceiros usam o Balu sob a marca deles. Os clientes finais veem "Contabilidade ABC" em vez de "Balu". O contador tem painel próprio para gerir sua base.
>
> **Referência Contabilizei**: a Contabilizei **não tem white-label** público — ela é a marca final. Mas tem **área white-label do contador** que é exatamente o oposto do modelo dela: aqui o contador independente terceiriza a plataforma e mantém a marca. Para Balu isso é vantagem competitiva (SaaS B2B2C vs B2C).

### 8.1. Logo do escritório
**Status**: 🆕 a fazer

**Descrição**: upload de logo (PNG/SVG) que substitui o "Balu" no `MenuLateral` e no `<title>` quando o usuário pertence a uma contabilidade. Logo persistido em Supabase Storage.

**Implementação**:
- Nova tabela `contabilidades` (id, nome_fantasia, razao_social, cnpj, owner_user_id, logo_path, primary_color, support_whatsapp, support_email, support_sla_hours, slug, dominio_custom, created_at)
- `profiles` ganha FK `contabilidade_id` (nullable)
- Upload via `supabase-storage.ts` → bucket `contabilidades-logos` (público, com URL assinada opcional)
- Componente `<BrandLogo contabilidade={...} fallback="Balu" />` substitui o `<h1>Balu</h1>` em todo lugar
- Rota `app/(auth)/configuracoes/contabilidade/page.tsx` (só para `user_role='contador'`)

### 8.2. Nome da contabilidade
**Status**: 🆕 a fazer

**Descrição**: nome fantasia exibido em toda UI, e-mails enviados, PDFs gerados, footer das notas (quando suportado).

**Implementação**:
- Já mapeado em `contabilidades.nome_fantasia` (item 8.1)
- Helper `getBranding(userId): { nome, logo, primaryColor, ... }` chamado em todo server component
- Templates de e-mail usam `{{branding.nome}}` em vez de literal "Balu"

### 8.3. WhatsApp do escritório
**Status**: 🆕 a fazer

**Descrição**: número de WhatsApp do contador exibido em "Suporte" + botão flutuante. Clientes que precisam de ajuda humana caem direto no escritório, não no Balu.

**Implementação**:
- Campo `contabilidades.support_whatsapp` (formato E.164)
- Componente `<SupportButton />` (FloatingGroup) com `wa.me/<numero>?text=Sou+cliente+da+<nome>`
- Configurável por contador: mensagem padrão, horário visível, fallback fora do horário

### 8.4. SLA configurável
**Status**: 🆕 a fazer

**Descrição**: cada contador define seu SLA (ex: "respondo em até 4h úteis"). Mostrado em telas de suporte e atendimento.

**Implementação**:
- Campo `contabilidades.support_sla_hours` (smallint, default 24)
- Campo `contabilidades.support_horario` (jsonb: `{seg_sex: '09:00-18:00', sab: '09:00-12:00', dom: null}`)
- Componente `<SlaCard sla={hours} horario={...} />` em widget de suporte
- Indicador "online agora / fora do expediente" calculado no client

### 8.5. Painel com: quantos clientes, quem está irregular, quem não pagou
**Status**: 🆕 a fazer

**Descrição**: dashboard exclusivo para `user_role='contador'`. Mostra:
- Total de clientes ativos / inativos
- Clientes com **guias vencidas não pagas**
- Clientes com **notas em erro**
- Clientes próximos do **limite de faturamento**
- Clientes com **certificado A1 vencendo** em <30 dias
- Receita mensal recorrente (MRR) do escritório

Cada linha clicável abre a empresa específica (usa o mecanismo de troca de empresa no `MenuLateral`).

**Implementação**:
- Rota `app/(auth)/contador/page.tsx` — protegida por `userRole === 'contador'`
- Server queries agregadas (alguns CTEs Postgres + views)
- View materializada `mv_painel_contador` (refresh a cada 1h via cron) para performance
- Componente `<ContadorPainel />` com tabela ordenável + filtros
- Item no `MenuLateral` "Meus clientes" visível apenas para Contador (NAV já filtra por role)

---

## Apêndice — Itens já fora de escopo da v1

Os seguintes itens estão marcados como **🟡 amarelo** no `planejamento-balu.pdf` e foram movidos para `V2-FUNCIONALIDADES.md`:

- IA traduz em linguagem leiga (1)
- IA para escolher serviço / templates / busca Google-like (3)
- WhatsApp como canal de pagamento e notificação (4)
- WhatsApp como canal único de atendimento (6) — **todos** os 4 sub-itens
- Domínio personalizado para white-label (8)

Eles dependem em sua maioria de **integração WhatsApp Business API + camada de IA conversacional**, que vão num pacote separado na v2.

---

## Checklist macro de v1 (DoD — Definition of Done)

- [ ] Todas as features acima implementadas (≥ 30 features)
- [ ] `npm run typecheck` zero erros
- [ ] `npm run build` sucesso
- [ ] Suite Playwright cobre fluxos: cadastro → onboarding → criar empresa → abrir empresa → emitir nota → ver apuração → pagar guia
- [ ] Schema Supabase aplicado em produção
- [ ] Variáveis de ambiente reais preenchidas (Focus token de produção, Serpro consumer key, n8n secret)
- [ ] Logs estruturados em todas as server actions externas (Focus/Serpro/n8n)
- [ ] Pelo menos 1 contador-parceiro real testando o painel white-label
- [ ] Documentação de onboarding para novos contadores escrita
