# PRD — Balu App (excluviapainel)

> Plataforma SaaS brasileira de gestão fiscal e contábil. Permite que empresas (Empresa) e contadores (Contador) administrem cadastros de clientes, emitam notas fiscais (NFe, NFCe, NFSe), calculem e declarem tributos (PGDAS-D, DAS) e mantenham configurações fiscais de múltiplas empresas. Construído originalmente em Bubble.io com backend em Supabase (Postgres + Auth + Storage), automações em n8n e integrações com Focus NFe e API Serpro Integra Contador.

---

## 1. Visão geral do produto

### 1.1 Objetivo
Permitir que pequenas empresas e contadores realizem em um único painel:
1. Cadastro e gestão multiempresa.
2. Cadastro e manutenção de clientes.
3. Emissão e cancelamento de NFe, NFC-e e NFS-e.
4. Cálculo, geração e consulta de guias de imposto (DAS) e declarações (PGDAS-D).
5. Upload e custódia de certificado digital A1 para uso fiscal automático.
6. Solicitação de abertura de novas empresas (com upload de documentação).
7. Gestão de honorários cobrados pelo contador aos clientes.

### 1.2 Personas / papéis
Definidos no option set **Role_user**:
- **Empresa** — dono/operador de uma ou mais empresas.
- **Contador** — escritório/profissional contábil que atende várias empresas como clientes.

A `current_company` no perfil do usuário define o contexto ativo. Todas as buscas, listagens e ações são filtradas por esse contexto.

### 1.3 Stack lógica esperada por uma reconstrução
- Frontend: app responsivo (desktop + mobile), idioma `pt-BR`, paleta primária teal `#03B4C6`, cores secundárias azul-marinho `#091747` e destrutivo `#D62755`.
- Auth e DB principal: **Supabase** (`https://llykzqnugdpojwnlontj.supabase.co`).
- DB do "motor fiscal" (apurações/guias/declarações): **Supabase secundário** (`https://envsirumquqpmkcayncr.supabase.co`).
- Automações fiscais: **n8n** em `https://webhooks.envia.click`.
- Emissão de NF: **Focus NFe** (`https://api.focusnfe.com.br` produção, `https://homologacao.focusnfe.com.br` homologação).
- Consulta de CNPJ: **Focus NFe** `/v2/cnpjs/{cnpj}`.
- Declarações fiscais: **API Serpro Integra Contador** (`https://gateway.apiserpro.serpro.gov.br/integra-contador`, e ambiente trial `…/integra-contador-trial`).
- Storage de certificados A1: **Supabase Storage**, bucket `company-certificates`.

---

## 2. Mapa de navegação (páginas)

Páginas públicas:
- `/login` — autenticação por e-mail e senha.
- `/cadastro` — criação de conta.
- `/reset_pw` — redefinição de senha (link enviado por e-mail).
- `/404` — erro/rota inexistente.

Páginas protegidas (exigem usuário autenticado e empresa ativa):
- `/` (index) — Painel/Início.
- `/clientes` — cadastro de clientes.
- `/notas_fiscais` — lista e busca de notas emitidas.
- `/notas_fiscais_emissao` — fluxo de emissão NFe/NFCe/NFSe.
- `/notas_fiscais_detalhes` — detalhe, download (XML/PDF/DANFE) e cancelamento.
- `/impostos` — visão consolidada de guias e declarações.
- `/impostos_new` — criação/cálculo de nova guia/declaração.
- `/configuracoes` — configurações da empresa, regime, certificado, dados fiscais.
- `/teste_up_file_up` — utilitária de teste de upload (não vai para produção).

Mobile: existe a view nativa **Home** (`bTHDZ`).

### 2.1 Controle de acesso de página
- Cada página protegida deve, no carregamento, verificar `CurrentUser.access_token` e `expired_at`. Se vencido, executar o fluxo de refresh (ver §6.2).
- Se não houver usuário logado, redirecionar para `/login`.
- Se logado mas sem empresa selecionada (`current_company` vazia), forçar o popup de criação/seleção de empresa antes de liberar o conteúdo.

---

## 3. Modelo de dados

### 3.1 Tabelas Supabase (inferidas dos endpoints)

**`profiles`** (1:1 com `auth.users`)
- `id` (uuid, PK = auth user id)
- `current_company` (uuid) — empresa ativa atualmente
- demais metadados (logo, preferências)

**`companies`**
- `id` (uuid, PK), `user_id` (uuid, dono)
- `nome`, `razao_social`, `cnpj`
- `inscricao_estadual`, `inscricao_municipal`, `codigo_municipio` (IBGE)
- Endereço: `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `uf`, `cep`
- Contato: `telefone`, `email`
- `created_at`

**`clientes`**
- `id` (uuid), `owner_user_id` (uuid), `company_id` (uuid)
- `person_type` ("PF" ou "PJ")
- `razao_social`, `document` (CPF ou CNPJ)
- `inscricao_estadual`, `indicador_inscricao_estadual` (0–9), `inscricao_municipal`
- `codigo_municipio` (IBGE), `email`, `telefone`
- Endereço completo (idem companies) + `pais`
- `status` ("active"/"inactive") + `deleted_at` (soft delete)

**`empresas_fiscais`** (configuração fiscal/NFS-e de cada empresa)
- `id`, `empresa_id` (FK companies), `municipio_id`
- `cnpj`, `regime_tributario`, `Code_regime_tributario`
    Descrição / Code / Type_empresa
    Simples Nacional / 1 / Simples
    Simples Nacional — Excesso de sublimite de receita bruta / 2 / Simples
    Regime Normal (Lucro Real ou Presumido) / 3 / Simples
    Simples Nacional — MEI / 4 / mei
- `anexo_simples` (Anexo I–V) — input "Faixa de atividade econômica" (option set; visível só quando regime ≠ MEI, Code ≠ 4):
    Atividade / Anexo
    I Comércio / Anexo I
    II Indústria / Anexo II
    III Serviços comuns / Anexo III
    IV Serviços com folha relevante / Anexo IV
    V Serviços especializados / Anexo V
- `cnae_principal`, `usa_fator_r` (bool — só faz sentido p/ serviços, Anexo III/V)
- `inscricao_municipal`, `serie_rps`, `numero_rps_inicial`
- Credenciais portal municipal: `login_responsavel`, `senha_responsavel`, `token_portal`
- Flags por município: `requer_liberacao_rps`, `requer_liberacao_webservice`, `requer_aidf`, `requer_cadastro_homologacao`, `emitir_nota_homol_antes_producao`, `credenciais_por_ambiente`, `requer_token_portal`, `im_zeros_esquerda`, `requer_cadastro_tomador`, `valor_iss_obrigatorio`, `cancelamento_so_portal`, `serie_rps_so_numeros`
- Autenticação NFSe: `nfse_autenticacao_tipo`, `nfse_usuario_login`, `nfse_senha_login`, `nfse_token_api`, `nfse_frase_secreta`, `nfse_chave_api`
- URLs: `nfse_url_portal_producao`, `nfse_url_portal_homologacao`
- `empresa_fiscal_ativada` (bool), `unique_id_bubble` (correlação app)

**`notas_fiscais`**
- `id`, `company_id`, `tipo_nf` (nfe/nfce/nfse)
- `numero_nf`, `serie`, `chave_acesso`, `protocolo_autorizacao`
- `data_emissao`, `valor_total`
- `status` (Status_nfs: pendente, ativa, cancelada)
- Links de XML, PDF/DANFE, QR (NFC-e), `cancelled_at`
- Payload bruto de resposta da Focus

**`apuracoes_fiscais`**
- `id`, `empresa_id`, `competencia` (YYYYMM)
- Receitas por origem (interno/externo), tributos calculados, deduções, total

**`declaracoes_fiscais`**
- `id`, `empresa_id`, `competencia`, `tipo_declaracao` (PGDASD, GIAS, etc.)
- `data_envio`, `status` (Status_declaracoes)
- `protocolo`, links de XML/PDF

**`guias_fiscais`**
- `id`, `empresa_id`, `competencia`, `tipo_guia` (DAS, ISS, ICMS…)
- `data_vencimento`, `valor_total`
- `status` (status_guias_impostos: gerando, gerada, paga, vencida, erro)
- Link de PDF / linha digitável

**`arquivos_auxiliares`** (custódia de certificados)
- `id`, `unique_id_empresa`, `unique_id_bubble`
- `supabase_file_path` (path em `company-certificates/...`)
- `cert_password` (criptografada/segredo)

**`municipios_nfse`** (catálogo de prefeituras suportadas)
- `codigo_ibge`, `nome_municipio`, `uf`
- `padrao_nfse`, `provedor_nfse`
- `url_producao`, `url_homologacao`
- `requer_certificado`, `requer_login`, `campo_serie_rps` etc.

**`abertura_empresas`** (solicitações de abertura de novo CNPJ)
- ~49 campos, divididos em: dados do titular (RG, CPF, mãe, naturalidade, estado civil), endereço do titular, dados da empresa pretendida (3 opções de razão social, nome fantasia, tipo societário, capital social, objeto social, CNAE, regime), endereço da sede, anexos (RG frente/verso, CNH, CPF, comprovantes), `processo_etapa` ("recebido", ...).

**`honorarios`**
- `id`, `cliente_id`, `company_id`
- `mes_referencia` (YYYYMM), `valor`, `data_vencimento`, `data_pagamento`
- `status` (pendente/pago/vencido), `observacao`

### 3.2 Data types no app (Bubble) que devem existir no novo build
- **User**: `username`/`uuid_supabase`, `access_token`, `refresh_token`, `expired_at`, `current_company`, `empresa_fiscal_id`, `user_role` (Role_user), `logo`, `background_color`.
- **Aux_produtos** (cache local para itens recorrentes de NF): `codigo`, `descricao`, `ncm`, `cfop`, `tipo_nf` (TipoNF), `unidade_comercial`, `quantidade_comercial`, `valor_unitario_comercial`, `id_company`, `finalizado` (bool).

### 3.3 Regras de privacidade obrigatórias
- `User`: leitura/escrita restrita ao próprio usuário (`Current User is This User`); ninguém mais enxerga `access_token`, `refresh_token`, `expired_at`.
- `clientes`, `companies`, `empresas_fiscais`, `notas_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais`, `guias_fiscais`, `honorarios`: visíveis somente quando `company_id` ∈ empresas do usuário logado.
- `arquivos_auxiliares`: o campo `cert_password` nunca deve ser exposto ao front; usado só por backend/n8n.
- `municipios_nfse`: leitura pública para usuários autenticados.

---

## 4. Option sets (regras de negócio fiscais)

Todos os códigos seguem o padrão da SEFAZ/Receita Federal. Reconstruir como enums.

### 4.1 Role_user
`Empresa`, `Contador`.

### 4.2 TipoNF
`NFe`, `NFCE`, `NFSe`.

### 4.3 Tipo_documento
`0 – Nota Fiscal de Entrada`, `1 – Nota Fiscal de Saída`.

### 4.4 Finalidade_emissão
`1 – Normal`, `2 – Complementar`, `3 – Nota de ajuste`, `4 – Devolução`.

### 4.5 Consumidor_final
`0 – Normal`, `1 – Consumidor final`.

### 4.6 Presenca_comprador
`0 – Não se aplica`, `1 – Presencial`, `2 – Internet`, `3 – Teleatendimento`, `4 – NFC-e com entrega em domicílio`, `9 – Outros`.

### 4.7 Local_destino
`1 – Interna`, `2 – Interestadual`, `3 – Exterior`.

### 4.8 Modalidade_frete
`0 – Por conta do emitente`, `1 – Por conta do destinatário`, `2 – Por conta de terceiros`, `9 – Sem frete`.

### 4.9 Frete_Nfe
`0 – Emitente`, `1 – Destinatário`, `9 – Sem frete`.

### 4.10 Forma_pagamento (10 valores)
`01 Dinheiro`, `02 Cheque`, `03 Cartão de Crédito`, `04 Cartão de Débito`, `05 Crédito Loja`, `10 Vale Alimentação`, `11 Vale Refeição`, `12 Vale Presente`, `13 Vale Combustível`, `99 Outros`.

### 4.11 Forma_pagamento_nfe
`01 Dinheiro`, `02 Cheque`, `03 Cartão de Crédito`, `04 Cartão de Débito`, `05 Crédito Loja`, `99 Outros`.

### 4.12 Unidade_comercial
`UN`, `KG`, `L`.

### 4.13 Inclui_no_total
`0 – Não`, `1 – Sim`.

### 4.14 Type_itens
`Empresa`, `PF`.

### 4.15 Regime_tributario_empresa
- `1` – Simples Nacional (Simples)
- `2` – Simples Nacional – excesso de sublimite de receita bruta (Simples)
- `3` – Regime Normal – Lucro Real ou Presumido (Simples)
- `4` – Simples Nacional – MEI (mei)

### 4.16 Faixas_atividades_economicas (Anexo Simples Nacional)
`Anexo I — Comércio`, `Anexo II — Indústria`, `Anexo III — Serviços comuns`, `Anexo IV — Serviços com folha relevante`, `Anexo V — Serviços especializados`.

### 4.17 ICMS_origem (8 valores)
`0` Nacional · `1` Estrangeira (importação direta) · `2` Estrangeira (mercado interno) · `3` Nacional com mais de 40% de conteúdo estrangeiro · `4` Nacional via processos básicos · `5` Nacional com menos de 40% de conteúdo estrangeiro · `6` Estrangeira (importação direta) sem similar nacional · `7` Estrangeira (mercado interno) sem similar nacional.

### 4.18 ICMS_modalidade_base_calculo
`0 – Margem de valor agregado (%)` · `1 – Pauta (valor)` · `2 – Preço tabelado máximo (valor)` · `3 – Valor da operação`.

### 4.19 ICMS_situacao_tributaria (CST/CSOSN completo)
CST Regime Normal: `00, 10, 20, 30, 40, 41, 50, 51, 60, 70, 90`.
CSOSN Simples Nacional: `101, 102, 103, 201, 202, 203, 300, 400, 500, 900`.
Cada item carrega texto completo da SEFAZ (ex.: `00 – Tributada integralmente`). Reaproveitar também os códigos de PIS/COFINS (01–09, 49, 50–56, 60–67, 70–75, 98, 99) que o app armazena junto deste set por conveniência.

### 4.20 COFINS_situacao_tributaria (33 valores)
Códigos `01–09, 49, 50–56, 60–67, 70–75, 98, 99` com as descrições oficiais.

### 4.21 Natureza_operacao_nfe (CFOPs principais)
`5102/6102 Venda de produto`, `5405/6404 Venda a consumidor final`, `5201/6201 Devolução de compra`, `5411/6411 Devolução de venda`, `5152/6152 Transferência`, `5915/6915 Remessa p/ conserto`, `5916/6916 Retorno de conserto`, `5912/6912 Remessa p/ demonstração`, `5913/6913 Retorno de demonstração`, `5923/6923 Remessa por conta e ordem`, `5190/6190 Brinde/bonificação`, `5910/6910 Doação`.

### 4.22 Natureza_operacao_nfse
`1 Tributação no município` · `2 Tributação fora do município` · `3 Isenção` · `4 Imune` · `5 Suspensa por decisão judicial` · `6 Suspensa por procedimento administrativo`.

### 4.23 Status_nfs (status da nota)
`pendente`, `ativa`, `cancelada`.

### 4.24 Status_declaracoes
`pronta para enviar`, `enviando`, `enviada`, `erro`.

### 4.25 Status_guias_impostos
`gerando`, `gerada`, `paga`, `vencida`, `erro`.

---

## 5. Design system

- Tema claro com primária teal `rgba(3,180,198,1)`.
- Cores semânticas: sucesso (verde do alerta), destrutivo `rgba(214,39,85,1)`, info (azul), warning.
- Tipografia única (`font_default`), pesos 400 e 600, escalas 12/14/16/18 (body) e 6 níveis de heading.
- Componentes padronizados:
  - Botões: `Filled Dark Primary`, `Outline`, `Link`, variantes Light/Dark, Primary/Destructive, e o `Btn_padrão` global da marca.
  - Inputs: `In_primary` para campos de formulário; `standard_input` para mocks.
  - Dropdowns: `dp_buscas` (filtros), `dp_nf` (formulário de nota).
  - DatePickers: `date_picker_nf` e variante reutilizável.
  - Alerts (Info/Success/Warning) — usados via componente Mensageria.
  - Repeating groups: `Dividers` (lista com separador) e `Transparent`.
  - Popups e FloatingGroups padronizados (`Filled`, `Shadow`).
- Layouts responsivos com breakpoints 320/480/800/992/1200/1360px.
- Status bar/spinner em teal (`#03B4C6`).

---

## 6. Reusables e regras transversais

### 6.1 `Menu(i)` — navegação principal
- FloatingGroup lateral. Estados `open_` (bool), `selecionado_` (texto).
- Itens condicionados a `User_role` (algumas seções só para Contador).
- Selecionar empresa → executa `Change Company` (PATCH em `/profiles`), atualiza `CurrentUser.current_company`, força `RefreshPage`.

### 6.2 `re_authentication` — refresh automático de sessão
- Trigger: PageLoaded.
- Condição: `CurrentUser.expired_at < Current Date/Time`.
- Ação única: dispara custom event `Refresh` que chama **Supabase Refreshtoken** com `CurrentUser.refresh_token`.
- Sucesso: atualiza `access_token`, `refresh_token`, `expired_at` no usuário corrente.
- Falha: redireciona para `/login` e apaga tokens.

### 6.3 `Mensageria` — notificações
- Custom event `Trigger_BEP(Tipo, Mensagem)`.
- Tipo = `Success` → alerta verde (3 s).
- Tipo = `Error` → alerta vermelho (3 s).
- Usado por toda criação/edição/erro de API.

### 6.4 `Create_client`
Form com 16+ campos (pessoa física/jurídica, contato, endereço completo, IEs).
Regra crítica: antes do POST, custom event `Check_duplicate` busca em `clientes` por `document = X AND owner_user_id = current user`. Se existe, exibe `Você já possui um cliente com esse cpf/cnpj cadastrado!` e termina o workflow. Depois cria via `POST /rest/v1/clientes`, reseta o form, fecha o popup e sinaliza ao pai (`novo_cliente_criado_ = yes`).

### 6.5 `Edit_client`
Mesma UI sem deduplicação; envia `PATCH /rest/v1/clientes?id=eq.{id}`. Ao concluir, marca `editado_ = yes`.

### 6.6 `Delete_client`
Soft delete: `PATCH /rest/v1/clientes?id=eq.{id}` setando `status="inactive"` e `deleted_at=now`. Atualiza estado `deletado_ = yes` que faz o pai recarregar a lista.

### 6.7 `Create_company`
Fluxo em múltiplas etapas:
1. Usuário informa CNPJ → consulta **Focus NFe** `/v2/cnpjs/{cnpj}` → preenche razão social, fantasia, endereço.
2. Usuário pode editar e informa CEP → busca de endereço (provedor de CEP — usar ViaCEP ou equivalente, baseado na assinatura `bTMZJ`).
3. Confirma → cria registro em `companies` (`POST /rest/v1/companies`).
4. RPC `add_company_to_profile(p_user_id, p_company_id)` vincula empresa ao perfil.
5. Atualiza `CurrentUser.current_company` e fecha popup com `RefreshPage`.
6. Estado `possui_empresa_` impede criação duplicada quando o usuário já é dono de uma empresa.

> **Implementação atual (Next.js — diverge do Bubble):**
> - A busca de CNPJ na Focus foi **removida** do cadastro de empresa (passou a existir só no cadastro de cliente). Aqui o CNPJ é digitado e **validado pelos dígitos verificadores** (`CompanyCreateSchema` + `src/lib/validators/cnpj.ts`).
> - **Endereço obrigatório**: `logradouro` (rua), `numero`, `municipio` (cidade) e `uf` (estado) são exigidos. Exceção do `numero`: o checkbox **"Sem número"** trava o campo e grava `sem_numero=true` (coluna em `companies`, default `false`). `cep` e `bairro` seguem **opcionais** (há endereços sem CEP). Busca por CEP (ViaCEP) disponível para autopreencher.
> - Validação por `CompanyCreateSchema` no `createCompanyAction` e no `<CreateCompanyDialog>` (asteriscos de obrigatório em rua/cidade/UF).

### 6.8 `Filter_periodo`
Date range com estados `data_inicial_` e `data_final_`. Disparo de custom event `Filtered(start, end)` para o pai aplicar filtro nas listas.

### 6.9 `PU_padrao`
Popup template (Cancel / Reset / Confirm). Reutilizado para confirmações genéricas.

### 6.10 `Loading` e `loading` (Floating)
Componentes puramente visuais; controlados pelos workflows que iniciam e finalizam chamadas longas.

---

## 7. Fluxos de autenticação

### 7.1 Cadastro (`/cadastro`)
1. Captura `email`, `senha` e `nome_completo`.
2. Validação local: e-mail válido, senha ≥ 6 caracteres, nome obrigatório.
3. `POST {SUPABASE}/auth/v1/signup` (call **Supabase signin**).
4. Resposta retorna `access_token`, `refresh_token`, `expires_in`, `user.id`.
5. Atualiza `CurrentUser`: `username = user.id`, `access_token`, `refresh_token`, `expired_at = Current Date + expires_in`.
6. Cria registro em `profiles` (`id = user.id`, `current_company = null`).
7. Mostra popup `Create_company`.
8. Após criar empresa, redireciona para `/`.

### 7.2 Login (`/login`)
1. Captura e-mail/senha.
2. `POST {SUPABASE}/auth/v1/token?grant_type=password` (call **Login Supabase**).
3. Em erro → exibe mensagem ("Credenciais inválidas").
4. Em sucesso → grava tokens em `CurrentUser` e redireciona para `/`.

### 7.3 Reset de senha (`/reset_pw`)
- Tela A (não autenticado): captura e-mail → `POST /auth/v1/recover` com `{email}`. Mostra confirmação "Enviamos um link...".
- Tela B (chegou pelo link, já com `access_token` na URL): captura nova senha → `PUT /auth/v1/user` com `{password}` (header `Authorization: Bearer {token}`).

### 7.4 Refresh de sessão
Ver §6.2. Toda página protegida deve incluir o reusable `re_authentication`.

---

## 8. Fluxo: Configurações (`/configuracoes`)

1. Carrega `companies?id=eq.{current_company}` para preencher cabeçalho.
2. Carrega `empresas_fiscais?empresa_id=eq.{current_company}` ou cria registro vazio.
3. Carrega `municipios_nfse` para o dropdown de municípios suportados em NFSe.
4. Seções editáveis:
   - **Dados da empresa**: razão social, fantasia, IE, IM, endereço, contato → PATCH em `companies`.
   - **Regime tributário**: dropdown com `Regime_tributario_empresa`. Se MEI → bloqueia campos não aplicáveis. Se Simples → libera `anexo_simples` e `usa_fator_r`.
   - **CNAE principal** (formato `XXXX-X/YY`).
   - **NFS-e**: município (atrelado a `municipios_nfse`), série RPS, número inicial, credenciais do portal municipal, flags específicas do município (carregadas do `municipios_nfse`).
   - **Certificado digital A1**: upload `.pfx` + senha.
     - Upload do arquivo para Supabase Storage (`POST /storage/v1/object/company-certificates/{filename}`).
     - Insere em `arquivos_auxiliares` (`POST /rest/v1/arquivos_auxiliares`) com `supabase_file_path` e `cert_password`.
     - Notifica n8n: `POST /webhook/upload-certificado` com `file_base64`, `unique_id_empresa`, `unique_id_bubble`, `cert_password`.
   - **Credenciais Serpro/Integra**: usuário/contador envia `Consumer_key` + `Consumer_Secret` → `POST /webhook/post-autenticacao`.
5. Salvar usa **Empresa fiscal editar_novo** (`PATCH /rest/v1/empresas_fiscais?unique_id_bubble=eq.{id}`) com até 40+ campos.
6. Após salvar com sucesso, dispara `Mensageria.Trigger_BEP("Success", "Configurações salvas")`.

> **Implementação atual (Next.js):**
> - Cada aba abre em **modo leitura** (campos bloqueados + botão **Editar**); ao editar, o rodapé vira **Salvar** + **Cancelar** (Cancelar reverte aos valores salvos e re-bloqueia; salvar com sucesso re-bloqueia). O form remonta por `company.id` ao trocar de empresa (evita estado stale).
> - **Dados da empresa** (✅ `DadosEmpresaForm` + `updateCompanyAction`): **CNPJ sempre bloqueado** (não editável); endereço (rua/número/cidade/estado) é **obrigatório também na edição** — valida o `CompanySchema` completo (não `.partial()`). `numero` tem o checkbox **"Sem número"** (trava o campo + grava `sem_numero=true`); CEP/bairro opcionais.
> - **Regime tributário** (✅ `RegimeTributarioForm` + `upsertEmpresaFiscalAction` — PR 1.4): dropdown CRT (`Code_regime_tributario` 1-4 → `regime_tributario` `simples`/`mei`); "Faixa de atividade econômica" → `anexo_simples` (visível só se ≠ MEI); `usa_fator_r` (só Anexo III/V); `cnae_principal`. Upsert em `empresas_fiscais` por `empresa_id` (cria no 1º save, escopado por `owner_user_id`).
> - **NFS-e** e **Certificado A1**: ainda stub (PRs 1.5 e 1.6).

---

## 9. Fluxo: Clientes (`/clientes`)

1. PageLoad: chama **Buscar_clients** (`GET /clientes?company_id=eq.{current_company}`), filtra `status<>"inactive"`.
2. Repeating group lista clientes (nome, documento, e-mail, telefone, cidade/UF). Linha clicável abre menu com Editar / Excluir.
3. Botão "Novo cliente" abre `Create_client`.
4. Ao concluir criar/editar/excluir, recarrega a lista.
5. Busca local: input `texto_busca` filtra a lista por `razao_social`, `document`, `email`.
6. `Filter_periodo` filtra por `created_at` se aplicado.

---

## 10. Fluxo: Notas fiscais (`/notas_fiscais`)

1. PageLoad: **Get-Nfs** (`GET /notas_fiscais?company_id=eq.{current_company}`). Default ordenado por `data_emissao desc`.
2. Filtros: período (Filter_periodo), tipo (TipoNF), status (Status_nfs), texto (número/chave).
3. Cada linha: número, tipo, cliente, data, valor, status. Clique abre `/notas_fiscais_detalhes?id=...`.
4. Botão "Emitir nova" → `/notas_fiscais_emissao`.

### 10.1 Detalhes (`/notas_fiscais_detalhes`)
- Carrega registro por id.
- Mostra cabeçalho (chave de acesso, protocolo, status), itens, totais, links de download (XML e PDF/DANFE), QR Code (NFC-e).
- Ação "Cancelar nota":
  - Só disponível se `status="ativa"` e (para NFS-e) o município permitir cancelamento via API (campo `cancelamento_so_portal=false`).
  - Confirma motivo (texto livre, mínimo 15 caracteres pela regra SEFAZ).
  - PATCH `notas_fiscais?id=eq.{id}` setando `status="cancelada"`, `cancelled_at=now`.
  - Idealmente também chama endpoint Focus de cancelamento (não consta como call ativa; backend/n8n deve cuidar).

### 10.2 Emissão (`/notas_fiscais_emissao`)
1. Usuário escolhe `TipoNF`.
2. Form muda conforme o tipo:

**NFe** (`POST {FOCUS}/v2/nfe?ref={gerado-uuid}`):
- Emitente é a `current_company` (com regime, IE, endereço).
- Destinatário: selecionar cliente existente (`clientes`) ou digitar manualmente.
- Operação: `natureza_operacao` (Natureza_operacao_nfe), `tipo_documento`, `finalidade_emissao`, `local_destino`, `presenca_comprador`, `modalidade_frete`.
- Itens (repeating group): `descricao`, `ncm`, `cfop`, `quantidade`, `valor_unitario`, `valor_total = qtd * unit`. Adicionalmente por item: `icms_origem`, `icms_situacao_tributaria` (CST/CSOSN), alíquota; `pis_situacao_tributaria`, `cofins_situacao_tributaria`.
- Pagamento (array): forma + valor; soma = total dos itens − descontos + frete.
- `ref` deve ser único por nota (UUID Bubble) — chave de idempotência.

**NFC-e** (`POST /v2/nfce?ref=...`):
- Versão simplificada da NFe. `modalidade_frete="9"`, `presenca_comprador="1"`.
- Sem destinatário obrigatório, mas pode informar CPF (consumidor identificado).
- Resposta inclui `qrcode` e `url_consulta_nfce`.

**NFS-e** (`POST /v2/nfsen?ref=...`):
- Exige dados do prestador (CNPJ + município IBGE).
- Tomador: cliente PJ ou PF (CPF/CNPJ + endereço + município IBGE).
- Serviço: `codigo_tributacao_nacional_iss` (5 dígitos LC 116), `descricao_servico`, `valor_servico`, `valor_iss`.
- Tributação: `tributacao_iss`, `tipo_retencao_iss`, percentuais federais/estaduais/municipais (IBPT), `situacao_tributaria_pis_cofins`.
- Se Simples Nacional: enviar `regime_tributario_simples_nacional=1` e `codigo_opcao_simples_nacional`.

3. Validações antes do POST:
   - Empresa precisa de `empresa_fiscal_ativada=true`.
   - Certificado A1 carregado.
   - Para NFS-e: município deve estar em `municipios_nfse` e `requer_*` flags atendidas.
   - Soma dos pagamentos = total da nota.
4. Em caso de sucesso: armazena retorno em `notas_fiscais` (`POST /notas_fiscais`), com `status="ativa"`, chave de acesso, número, série, links de XML/PDF.
5. Em erro: salva mesmo assim com `status="pendente"` ou exibe erro detalhado da Focus.
6. Estados-chave: `selected_client`, `invoice_items_list`, `total_value`, `is_draft`.

---

## 11. Fluxo: Impostos (`/impostos` e `/impostos_new`)

### 11.1 Dashboard `/impostos`
1. `Get_empresa_fiscal` (`GET /empresas_fiscais?empresa_id=eq.{current_company}`).
2. Lista de declarações: `GET /declaracoes_fiscais?empresa_id=eq.{current_company}` (ordem decrescente por competência). Mostra status (Status_declaracoes).
3. Lista de guias: `GET /guias_fiscais?empresa_id=eq.{current_company}`. Mostra status (status_guias_impostos), vencimento, valor.
4. Cards "competência atual": `apuracao atual`, `declaracao_atual`, `guia atual` (queries filtradas por `competencia = current YYYYMM`).
5. Ações em cada linha:
   - Guia paga / não paga (toggle PATCH).
   - Baixar guia (link armazenado).
   - Re-emitir guia (chama PGDAS-D emit, ver 11.3).

### 11.2 `/impostos_new` — cálculo e geração
Etapa 1 — Consolidar receitas:
- `POST {n8n}/webhook/consolidar_receitas_fiscais` com `{empresa_id, competencia}`.
- Lê todas as notas emitidas no período, agrupa por anexo/atividade, salva em `apuracoes_fiscais`.

Etapa 2 — Calcular RBT12 (Simples):
- `POST {n8n}/webhook/calcular_rbt12` com `{empresa_id, competencia}`.
- Calcula receita bruta acumulada dos últimos 12 meses, define alíquota efetiva conforme Anexo do regime.

Etapa 3 — Calcular PGDAS-D:
- `POST {n8n}/webhook/consulta_das_mei` (para MEI) ou rota equivalente para Simples.
- Devolve breakdown por tributo (IRPJ, CSLL, COFINS, PIS, INSS, ICMS, ISS) e valor da guia.

Etapa 4 — Transmitir declaração (produção):
- `POST {SERPRO}/integra-contador/v1/Declarar` com `idSistema=PGDASD`, `idServico=TRANSDECLARACAO11`, `tipoDeclaracao` 1 (entrada) ou 2 (saída).
- Atualiza `declaracoes_fiscais` com `status=enviada`, `protocolo`.

Etapa 5 — Emitir DAS:
- Em produção real: `POST /integra-contador/v1/Declarar` com serviço `GERARDAS12`.
- No trial/sandbox: `POST /integra-contador-trial/v1/Emitir` com `idServico` em `GERARDAS12` / `GERARDASCOBRANCA17` / `GERARDASAVULSO19`.
- Para `GERARDASAVULSO19`, monta `ListaTributos` (códigos: 1010 IRPJ, 1001 CSLL, etc.).
- Salva guia em `guias_fiscais` com `status="gerada"` e link de PDF.

Etapa 6 — Consultas auxiliares (apenas leitura):
- `CONSDECLARACAO13` — declarações por ano-calendário.
- `CONSULTIMADECREC14` — última declaração de um mês.
- `OBTERDECLARACAO` — declaração específica.

Regras importantes:
- Cada chamada Serpro precisa de envelope `contratante/autorPedidoDados/contribuinte` com `{numero: cnpj14, tipo: 2}`.
- O CNPJ é enviado **sem máscara**, 14 dígitos com zeros à esquerda.
- `pa` (período de apuração) = inteiro `AAAAMM`; `anoCalendario` = string `AAAA`.
- Em sandbox/trial usar sempre CNPJ `00000000000100`.

---

## 12. Fluxo: Honorários (Contador)

- Aba visível somente para `User_role = Contador`.
- Lista global de honorários: `GET /honorarios`.
- Filtros: cliente, mês, status.
- Criar honorário: `POST /honorarios` com `{cliente_id, company_id (do contador), mes_referencia, valor, data_vencimento, status}`.
- Marcar como pago: PATCH setando `status="pago"` e `data_pagamento=now`.

---

## 13. Fluxo: Abertura de empresa

- Acessível pela área "Solicitar abertura".
- Formulário em múltiplas etapas:
  1. Dados do titular (RG, CPF, mãe, naturalidade, estado civil, contato).
  2. Endereço do titular.
  3. Dados pretendidos da empresa (3 opções de razão social, fantasia, tipo societário — LTDA/SA/EI etc., capital, objeto social, CNAE, regime desejado).
  4. Endereço da sede (com toggle "Mesmo do titular").
  5. Anexos: RG frente/verso, CNH frente/verso, CPF, comprovante de endereço do titular, comprovante de endereço da sede, declaração de uso.
- Submit: `POST /rest/v1/abertura_empresas` com todos os campos + `processo_etapa = "recebido"` + `user_id` + `company_id` (opcional — escritório vinculado).
- Listagem para o contador: `GET /rest/v1/abertura_empresas` — visualiza solicitações e atualiza `processo_etapa` à medida que o processo avança.

---

## 14. Catálogo completo de endpoints

| Grupo | Call | Método | Endpoint |
|---|---|---|---|
| Supabase Auth | Supabase signin | POST | `/auth/v1/signup` |
| Supabase Auth | Login Supabase | POST | `/auth/v1/token?grant_type=password` |
| Supabase Auth | Refreshtoken | POST | `/auth/v1/token?grant_type=refresh_token` |
| Supabase Reset PW | Recover_password | POST | `/auth/v1/recover` |
| Supabase Reset PW | Reset_password | PUT | `/auth/v1/user` |
| Supabase Profile | get_profiles | GET | `/rest/v1/profiles?id=eq.{user}` |
| Supabase Company | get_Company | GET | `/rest/v1/companies?id=eq.{id}&select=*` |
| Supabase Company | Get Companys | GET | `/rest/v1/companies?user_id=eq.{user}` |
| Supabase Company | Change Company | PATCH | `/rest/v1/profiles?id=eq.{user}` body `{current_company}` |
| Supabase Company | Create_Company | POST | `/rest/v1/companies` |
| Supabase Company | Add_company_profile | POST | `/rest/v1/rpc/add_company_to_profile` |
| Supabase Company | Edit_company | PATCH | `/rest/v1/companies?id=eq.{id}` |
| Supabase Clients | Create_client | POST | `/rest/v1/clientes` |
| Supabase Clients | Create_update | PATCH | `/rest/v1/clientes?id=eq.{id}` |
| Supabase Clients | Soft_delete | PATCH | `/rest/v1/clientes?id=eq.{id}` body `{status, deleted_at}` |
| Supabase Clients | Buscar_clients | GET | `/rest/v1/clientes?company_id=eq.{id}` |
| Focus Consulta | Focus Nfe - Get empresa | GET | `https://api.focusnfe.com.br/v2/cnpjs/{cnpj}` |
| Emissão notas | Create NFE | POST | `{FOCUS}/v2/nfe?ref={ref}` |
| Emissão notas | Create NFCE | POST | `{FOCUS}/v2/nfce?ref={ref}` |
| Emissão notas | Create nfse | POST | `{FOCUS}/v2/nfsen?ref={ref}` |
| Supabase Nfs | Get-Nfs | GET | `/rest/v1/notas_fiscais?company_id=eq.{id}` |
| Supabase Nfs | Cancel NF | PATCH | `/rest/v1/notas_fiscais?id=eq.{id}` body `{status:"cancelada"}` |
| N8N Motor Fiscal | Consolidacao_receitas | POST | `https://webhooks.envia.click/webhook/consolidar_receitas_fiscais` |
| N8N Motor Fiscal | rbt12 | POST | `…/webhook/calcular_rbt12` |
| N8N Motor Fiscal | calcular_apuracao_pgdasd | POST | `…/webhook/consulta_das_mei` |
| N8N declara-imposto | Mandar credenciais | POST | `…/webhook/post-autenticacao` |
| N8N declara-imposto | Upload certificado | POST | `…/webhook/upload-certificado` |
| Supabase Storage | Adicionar_bucket | POST | `/storage/v1/object/company-certificates/{filename}` |
| Supabase Aux | Adicionar tabela_auxiliar | POST | `/rest/v1/arquivos_auxiliares` |
| Supabase Motor Notas | Buscar empresa fiscal | GET | `/rest/v1/empresas_fiscais?empresa_id=eq.{id}` |
| Supabase Motor Notas | Guias fiscais | GET | `/rest/v1/guias_fiscais?empresa_id=eq.{id}` |
| Supabase Motor Notas | Declarações fiscais | GET | `/rest/v1/declaracoes_fiscais?empresa_id=eq.{id}` |
| Supabase Motor Notas | apuracao atual | GET | `/rest/v1/apuracoes_fiscais?empresa_id=eq.{id}&competencia=eq.{aaaamm}` |
| Supabase Motor Notas | declaracao_atual | GET | `/rest/v1/declaracoes_fiscais?empresa_id=eq.{id}&competencia=eq.{aaaamm}` |
| Supabase Motor Notas | guia atual | GET | `/rest/v1/guias_fiscais?empresa_id=eq.{id}&competencia=eq.{aaaamm}` |
| Empresa fiscal | Criar empresa fiscal | POST | `/rest/v1/empresas_fiscais` |
| Empresa fiscal | Editar empresa fiscal | PATCH | `/rest/v1/empresas_fiscais?id=eq.{id}` |
| Empresa fiscal novo | Adicionar | POST | `/rest/v1/empresas_fiscais` (extended 30+ campos) |
| Empresa fiscal novo | Buscar_empresa_fiscal | GET | `/rest/v1/empresas_fiscais?unique_id_bubble=eq.{id}&select=*` |
| Empresa fiscal novo | Editar_novo | PATCH | `/rest/v1/empresas_fiscais?unique_id_bubble=eq.{id}` (40+ campos) |
| Municipios | get municipios | GET | `/rest/v1/municipios_nfse` |
| Honorários | Buscar_honorarios | GET | `/rest/v1/honorarios` |
| Honorários | Criar honorario | POST | `/rest/v1/honorarios` |
| Abertura empresa | Abrir_empresa | POST | `/rest/v1/abertura_empresas` |
| Abertura empresa | Buscar_solicitacoes | GET | `/rest/v1/abertura_empresas` |
| Serpro Integra | Entrada | POST | `/integra-contador/v1/Declarar` idServico=`TRANSDECLARACAO11` tipoDeclaracao=1 |
| Serpro Integra | Saída | POST | idem tipoDeclaracao=2 |
| Serpro Integra | Consultar Atividades | POST | `/integra-contador/v1/Declarar` idServico=`OBTERDECLARACAO` |
| Serpro Integra | Consultar Guias DAS | POST | idServico=`CONSDECLARACAO13` |
| Serpro Trial | Emitir DAS Padrão | POST | `/integra-contador-trial/v1/Emitir` idServico=`GERARDAS12` |
| Serpro Trial | Emitir DAS Cobrança | POST | `…/v1/Emitir` idServico=`GERARDASCOBRANCA17` |
| Serpro Trial | Emitir DAS Avulso | POST | `…/v1/Emitir` idServico=`GERARDASAVULSO19` (com `ListaTributos`) |
| Serpro Trial | Transmitir declaração | POST | `…/v1/Declarar` |
| Serpro Trial | Consultar Declarações Ano | POST | `…/v1/Consultar` idServico=`CONSDECLARACAO13` `anoCalendario` |
| Serpro Trial | Última Declaração do Mês | POST | `…/v1/Consultar` idServico=`CONSULTIMADECREC14` |
| Serpro Trial | Consultar Extrato DAS | POST | `…/v1/Consultar` idServico=`CONSDECLARACAO13` |

---

## 15. Regras de negócio críticas (resumo executivo)

1. **Multiempresa**: cada usuário pode possuir 1+ empresas. `profiles.current_company` é a empresa ativa; trocá-la força refresh global da UI e refaz buscas.
2. **Deduplicação de clientes**: não permitir dois clientes com o mesmo CPF/CNPJ sob o mesmo `owner_user_id`.
3. **Soft delete**: clientes (e por inferência empresas e notas canceladas) nunca são deletados; recebem `status=inactive` e `deleted_at`.
4. **Certificado A1**: obrigatório para emitir NF-e/NFC-e e maioria das NFS-e. Senha armazenada criptografada, jamais retornada ao front.
5. **Idempotência fiscal**: cada emissão Focus usa parâmetro `ref` único (UUID); reusos devem cair na mesma nota.
6. **Regime tributário governa o cálculo**:
   - MEI → DAS fixo + checagem de teto.
   - Simples Nacional → cálculo PGDAS-D com RBT12, anexo, fator R (se aplicável).
   - Lucro Presumido/Real → tributos via Receita (escopo futuro do motor).
7. **Códigos fiscais**: usar exclusivamente as listas dos option sets (§4). Reconstrução deve hard-codar todos os valores (eles são exigidos pela SEFAZ/Receita).
8. **Status das notas**: `pendente → ativa → cancelada` (com `cancelled_at`).
9. **Status das guias**: `gerando → gerada → paga | vencida | erro` (worker n8n é responsável pela transição).
10. **Status das declarações**: `pronta para enviar → enviando → enviada | erro`.
11. **Privacidade Supabase (RLS)**: ativa em todas as tabelas; políticas baseadas em `auth.uid()` e relação com `companies.user_id`.
12. **Tokens**: armazenados apenas no `User` do app; renovação automática quando `expired_at < now`.
13. **Página protegida sem empresa**: bloquear acesso (popup obrigatório de criar/escolher empresa).
14. **Permissões por papel**:
    - `Empresa` vê apenas as próprias empresas e clientes.
    - `Contador` vê empresas dos clientes que atende (modelagem futura via tabela ponte; hoje implementado pelo perfil do contador ter múltiplas `companies`).
    - Aba "Honorários" só para Contador.
    - Aba "Abertura de empresa" disponível para qualquer usuário autenticado, mas listagem completa só para Contador.

---

## 16. Requisitos não funcionais

- **Localização**: pt-BR (datas `DD/MM/AAAA`, moeda `R$`, milhar `.` e decimal `,`).
- **Ambientes**: separar `homologação` (Focus + Serpro trial) e `produção` (Focus produção + Serpro produção). Selecionar pelo ambiente da empresa fiscal.
- **Segurança**: secrets (Focus, Serpro, Supabase service_role, n8n) ficam no backend; o frontend usa apenas anon key + access_token do usuário. CNPJs, CPFs e tokens nunca podem aparecer em URLs públicas.
- **Auditoria**: cada `notas_fiscais`, `guias_fiscais`, `declaracoes_fiscais` precisa de `created_at`/`updated_at` automáticos.
- **Resiliência**: falha em chamada Serpro/Focus não pode bloquear UI; mensagens via Mensageria; itens fiscais ficam em `pendente`/`erro` para reprocessar.
- **Concorrência**: ações longas (emitir NF, calcular apuração) devem mostrar Loading floating e desabilitar o botão para evitar duplo envio.
- **Mobile**: replicar fluxo "Home" mobile e garantir que emissão de NFC-e (caso de uso de loja) funcione em tablet.

---

## 17. Roadmap de reconstrução sugerido

1. Setup base (Supabase + schemas + RLS + option sets em enum).
2. Autenticação (login, cadastro, reset, refresh).
3. Onboarding (criar empresa, vincular ao perfil, popular empresas_fiscais).
4. CRUD de clientes com deduplicação.
5. Configurações da empresa fiscal (regime, CNAE, anexo, certificado A1).
6. Emissão NF-e (mais simples) → NFC-e → NFS-e (depende de catálogo `municipios_nfse`).
7. Listagem/detalhes/cancelamento de notas.
8. Cálculo fiscal (consolidação + RBT12 + PGDAS-D) via n8n.
9. Transmissão de declarações e emissão de DAS via Serpro Integra.
10. Honorários (Contador).
11. Solicitação de abertura de empresa.
12. Refino de UX, mobile e relatórios.

---

Este documento contém todas as entidades, opções fiscais, regras transversais, integrações e fluxos necessários para reconstruir o Balu App preservando o comportamento atual.
