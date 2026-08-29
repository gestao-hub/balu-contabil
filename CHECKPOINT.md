# CHECKPOINT — Balu

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-08-29 (sessão 36 — **auditoria funcional externa e Onda 1 do fechamento**. 96 checkpoints, 70 aprovados; parecer NÃO APROVADO para piloto. A leitura do repositório inverteu dois achados: o contador não tem superfície de escrita (o banco já nega — era formulário sem saída), e o Fator R não tem erro de cálculo, só de frase. Mas achou um furo maior: `lancarNotaManualAction` era a única das seis actions de escrita fiscal sem `empresaDoDono` — teste de mutação provou que ela **retornava `ok:true` inserindo em empresa alheia**, com a RLS como único freio. **WhatsApp ENTREGUE** (número oficial + escritório), o que fecha os itens 1 e 2 da lista de próximos passos e torna mais urgente a dívida da política de privacidade não mencionar WhatsApp. Onda 1 no branch `onda-1-auditoria-29-08`. **Pendente e seu: revisão jurídica dos documentos e a decisão de publicar 1.1, que joga todos os usuários para /aceite.**)
>
> _Anterior — sessão 35: **o impasse circular da produção**. Mesmo com o token certo, nenhuma empresa de origem `balu` chegaria a produção: `focus_ambiente='prod'` exigia `focus_habilita_nfsen_producao`, que só vem do PUT, que só sai quando o ambiente já é `'prod'`. Ciclo fechado, sem porta de entrada — **quebrado**: o upload do certificado A1 agora libera produção sozinho. A AL PISCINAS emitiu em `producaorestrita.nfse.gov.br` em 09/06 e foi a única a percorrer o fluxo inteiro. **Pendente: o token do painel continua dando 401 em `/v2/empresas`, e o usuário confirmou que não há outro token lá.**)
>
> _Anterior — sessão 34: **o bloqueio da Focus era nosso.** A conta nunca esteve sem permissão: a API de Empresas exige o **token principal de produção**, e o que estava configurado não é ele. O MESMO token dá 200 no catálogo e 401 em `/v2/empresas`, no mesmo host. O erro de 35 dias veio de uma sonda que não conseguia ver essa diferença — corrigida, com teste._

> ## 🆕 SESSÃO 36 (2026-08-29) — auditoria funcional externa, e a Onda 1 do fechamento
>
> Chegou uma **auditoria funcional de produção** (96 checkpoints, três perfis):
> 70 aprovados, 7 falhas, 15 bloqueados por credencial/config/terceiro, 4 N/A.
> Parecer: **não aprovado para piloto**, por dois P1. Levantamento e plano em
> 4 ondas ficaram numa página à parte; o que importa aqui é o que mudou no
> código e o que a leitura do repositório corrigiu no diagnóstico dela.
>
> ### ⚠️ WHATSAPP — VER A CORREÇÃO ABAIXO
>
> Registrado em 29/08 como "entregue", sobre a palavra do usuário. **Os dados
> não sustentam** — ver a correção no fim desta seção. Fecha os itens 1 e 2 da lista de
> "Próximo passo imediato", que estavam abertos desde 19/08. O canal já tinha
> sido provado de ponta a ponta na sessão 33.
>
> ✅ **`whatsapp_atendimentos` esvaziada (29/08).** As **47 linhas** de 12/08 a
> 25/08 foram apagadas — todo o período em que a instância da plataforma esteve
> pareada no número PESSOAL, quando tudo que chegava ali virava linha na tabela,
> inclusive conversa sem relação nenhuma com o Balu (uma delas citando nome de
> terceiro). Decisão do usuário: apagar **todas**, e não só as de terceiros —
> inclui as 14 linhas do número com conta e escritório vinculados, que eram do
> mesmo período de teste.
>
> A tabela **não tem `deleted_at`**: foi DELETE de verdade. Backup em
> `scratchpad/whatsapp_atendimentos-backup.json` (47 linhas × 14 campos,
> conferido antes de apagar). ⚠️ **Esse arquivo contém dados pessoais de
> terceiros** — apagar quando não for mais necessário; guardá-lo indefinidamente
> recria o problema que a limpeza resolveu.
>
> ✅ **Webhooks desligados (29/08).** `enabled=false, url=""` nas DUAS instâncias
> — plataforma (`r0b09d5bc15dcd5`) e "Escritório Teste Balu"
> (`r42092cbc8ff21d`) —, conferido consultando a uazapi depois, e não pelo
> HTTP 200 da chamada. Fecha a entrada que enchia `whatsapp_atendimentos`.
> Script: `app/scripts/desligar-webhooks-uazapi.mjs` (prévia por padrão,
> `--aplicar` para valer). Desconectar NÃO servia: o teste de
> `desconectarPlataformaAction` registra que "a instancia NAO e apagada: token
> e webhook continuam valendo", e `configurarWebhookUrl` só sabe mandar
> `enabled: true`.
>
> **Reversível sem passo manual** — confirmado no código, não assumido: parear
> um número recria instância e webhook sozinho, tanto na plataforma
> (`apontarWebhookDaPlataforma` em `admin/.../whatsapp/actions.ts:110` e `:125`)
> quanto no escritório (`configurarWebhook` em `contador/.../whatsapp/actions.ts:96`,
> `:128`, `:216`).
>
> ⚠️ **CORREÇÃO do que registrei acima como "WhatsApp ENTREGUE".** Anotei aquilo
> em 29/08 sobre a palavra do usuário, e os dados não sustentam. O banco mostra
> as duas instâncias em `status='conectando'` com `conectado_em` NULL — nenhuma
> em `conectado`. E o usuário esclareceu depois: **todos os números hoje na
> plataforma são de TESTE**, nenhum de empresa ou contador real. O canal foi
> provado de ponta a ponta na sessão 33, isso segue valendo; o que NÃO está
> feito é o pareamento do número oficial do Balu com um número real. O item 1
> da lista de pendências continua aberto nessa parte.
>
> ✅ **Política de privacidade — seção 7 (WhatsApp) redigida** (`a322842`),
> pronta para o advogado. Descreve o que o sistema faz, conferido no código:
> os dois números, as colunas gravadas, o envio do conteúdo da mensagem a um
> provedor de IA, o escopo por escritório e o encerramento por inatividade (que
> encerra o atendimento e **não** apaga). `uazapi` e o provedor de IA entraram
> na tabela de operadores. Seções 8-14 renumeradas e 5 referências cruzadas
> corrigidas, uma delas nos Termos de Uso.
>
> ⚠️ **A nota 3 ao advogado registra uma divergência REAL entre texto e
> sistema:** a rotina de anonimização da **0040** atinge `profiles`, `companies`
> e `clientes`, mas **NÃO** `whatsapp_atendimentos`. Quem exclui a conta continua
> com telefone e mensagens armazenados. A política foi escrita para não prometer
> o contrário; corrigir isso no código é trabalho pendente, e depende do prazo de
> retenção que o advogado definir.
>
> ### 🔴 O QUE A AUDITORIA VIU, E O QUE O CÓDIGO DISSE
>
> Três achados dela mudam de forma depois de ler o repositório:
>
> **BUG-002 — "contador tem superfície de escrita fiscal" (P1).** É o
> **inverso**: o contador é somente leitura por decisão de produto (reconfirmada
> pelo usuário em 29/08), o banco já garante isso em três camadas — a 0033 ("SÓ
> SELECT em dados do cliente; zero escrita"), `notas_fiscais_insert` exigindo
> `user_owns_company`, e `lib/auth/empresa-dono.ts`. O que estava na tela era um
> **formulário sem saída**: se ele submetesse, a RLS recusava.
>
> **MAS havia um furo real embaixo, e maior do que a auditoria pôde ver.**
> `empresaDoDono` guardava 5 das 6 actions de escrita fiscal. A única de fora
> era `lancarNotaManualAction` — justamente o formulário encontrado. Teste de
> mutação (removi a guarda e rodei): **a action retorna `ok: true` e insere na
> empresa alheia.** Todas as checagens de aplicação passavam — a de posse do
> cliente rodava contra a empresa ERRADA, e `assertAssinaturaEmpresa` respondia
> sobre assinatura de outro tenant. O único freio em produção era a policy de
> RLS, na última linha da função.
>
> **BUG-003 — "rota de cadastro de contador acessível" (P2).** Mais sério do que
> P2. `criarContabilidadeAction` checava sessão e vínculo, nunca **papel**, e
> grava com `createAdminClient()` — service role, sem RLS por baixo. Não havia
> rede nenhuma. E não era caminho forjado: `contador/page.tsx` manda quem não
> tem vínculo para `/contador/cadastro`, e "sem vínculo" incluía Admin e
> Empresa. Teste de mutação confirmou os três papéis criando escritório.
>
> **BUG-005 — "Fator R com 13 competências" (P2).** Falso positivo de risco
> fiscal. `impostos/folha/page.tsx:18-20` mostra 13 de propósito (a corrente,
> para preencher, + 12 fechadas) e `lib/fiscal/folha.ts:18-19` soma exatamente
> a janela `-12..-1`. **A conta está certa; a frase é que está errada.**
>
> ### 🆕 ONDA 1 ENTREGUE (branch `onda-1-auditoria-29-08`, commit `333e41c`)
>
> - **`empresaDoDono` em `lancarNotaManualAction`** — a sexta das seis. Mais 3
>   testes no bloco IDOR que já existia, todos validados por mutação.
> - **Gate de papel do subtree `/contador`** em `contador/layout.tsx`
>   (`requireContadorPage`), cobrindo as doze rotas de uma vez — regra repetida
>   doze vezes é regra que falta na décima terceira. **Server Action não passa
>   por layout**, então `criarContabilidadeAction` leva `requireContadorAction`
>   própria, com 6 testes.
> - **`/notas_fiscais` só mostra o botão de nova nota a quem o servidor deixaria
>   emitir** — critério é `empresaDoDono`, e não papel, para não criar uma
>   segunda definição de "pode emitir" que um dia divergiria da do banco.
> - **Documentos legais deixam de sair em markdown cru** (páginas públicas e
>   `/aceite`). Renderizador próprio em `lib/markdown/legal.ts` para o
>   subconjunto que esses dois arquivos usam, com 15 testes. **Zero dependência
>   nova**: `react-markdown` traria ~40 transitivas num projeto com 13 em
>   runtime, a dias do piloto. Devolve árvore React, não HTML — sem
>   `dangerouslySetInnerHTML`, e com guarda de `href` contra `javascript:`.
> - **Copy da tela do cliente** deixa de prometer "modo leitura" sem qualificar,
>   e nomeia as exceções autorizadas (certificado A1 e cobrança, ver 0085).
>
> **Linha de base: tsc 0 · 2263 testes (+21) · build limpo.** As 9 guardas novas
> foram validadas por mutação, uma a uma — passar não prova nada.
>
> ### ⏭️ O QUE FALTA DA ONDA 1, E DEPENDE DE VOCÊ
>
> 1. **Revisão jurídica** dos dois documentos: remover o aviso de *"minuta
>    técnica — pendente de revisão jurídica"* (`docs/legal/*.md`, linhas 5-10) e
>    **incluir a seção de WhatsApp**. Controlador e encarregado já estão
>    preenchidos — não há placeholder vazio.
> 2. **Decidir publicar como versão 1.1.** Publicar dispara
>    `documentosPendentes()` e joga **todos os usuários ativos** para `/aceite`
>    no próximo login. É o correto sob a LGPD, mas é evento visível para o
>    piloto inteiro: merece data escolhida, não acontecer de surpresa.
>
> ### ✅ CNPJ ÚNICO — 0106 APLICADA EM PRODUÇÃO (29/08)
>
> **Regra:** um CNPJ não pode existir em dois escritórios. Numa troca de
> contador a empresa é DESLIGADA do atual e religada no novo — transferida,
> nunca duplicada.
>
> **O furo por baixo:** `companies_owner_cnpj_uniq` (0001, linha 299) era
> `(user_id, cnpj)`. Empresa cadastrada pelo escritório nasce com `user_id`
> NULL e **no Postgres NULL nunca colide com NULL** — no caminho que mais cria
> empresa no produto, aquele índice não travava absolutamente nada. Substituído
> por `companies_cnpj_ativo_uniq`, global e parcial
> (`cnpj is not null and deleted_at is null`). Conferido no `pg_indexes` depois
> de aplicar: o novo existe, o antigo não.
>
> **A única duplicata da base era a AL PISCINAS** (`10358425000120`) — e a
> primeira rodada da 0106 **abortou** por causa dela, que é o comportamento
> projetado: a migration não escolhe qual linha sobrevive, porque isso é decisão
> de negócio.
>
> Medido antes de resolver: **a mesma pessoa se cadastrou duas vezes, com duas
> contas**, em 09/06, com 22 minutos de diferença.
>
> | | criada | dono | conteúdo |
> |---|---|---|---|
> | A `3f7370a5` | 14:07:46 | `7e584022` | 2 notas · 4 guias · 3 apurações |
> | B `c070a7ec` | 14:29:32 | `233219e7` | 0 notas · 0 guias · 1 apuração vazia |
>
> Ficou A — tem a NFS-e real de 09/06 (nº 16, R$ 2.500,00). Nada de valor
> existia só em B: o único cliente dela (`Alln`) é o cliente de A
> (`Allan barros`) com o **mesmo CPF**, redigitado com erro, e a única apuração
> era `202607` / `calculada` / **R$ 0,00**, gerada pelo cron em 13/08.
>
> ⚠️ **O passo que quase faltou:** `profiles.current_company` NÃO olha
> `deleted_at`. Soft delete sem limpar aquele campo deixaria a conta apontando
> para linha excluída — e o gate de onboarding (`!currentCompany`) veria o campo
> PREENCHIDO e não redirecionaria ninguém. A pessoa abriria um painel que não
> carrega nada, sem explicação. O `current_company` de `233219e7` foi limpo na
> mesma transação.
>
> **Pendência humana:** a conta `233219e7` ficou sem empresa e continua
> existindo, vazia. O acesso da pessoa é pela `7e584022`. Se ela tentar
> recadastrar o CNPJ pela conta vazia, agora recebe a mensagem da 0106 — correta,
> mas só faz sentido se ela souber o motivo. Apagar a conta duplicada é outra
> decisão (há a 0040 de anonimização).
>
> ### 🔎 DECISÕES QUE TRAVAVAM CÓDIGO DA ONDA 2 — TODAS TOMADAS
>
> - **CNPJ único** — decidido e **já aplicado** (ver a seção acima).
> - **Um papel por pessoa** — confirmado pelo usuário em 29/08, e é o que a
>   **0077** já impõe com `UNIQUE(user_id)`. Sem acúmulo, sem UI de troca.
> - **Contador é somente leitura** — reconfirmado em 29/08. As duas exceções
>   (certificado A1 e credencial Focus) seguem valendo.
>
> ### ⏭️ ONDAS 2 E 3 TAMBÉM ENTREGUES (commits `b69abac`, `3ac9eee`, `bd398f6`)
>
> - **BUG-004** tinha DUAS causas, e só uma era idioma. `email` e `uf` eram
>   `.optional()`, que aceita AUSENTE mas não VAZIO — e o formulário inicializa
>   com `''`. A mesma linha produzia "obrigatório sem marcador" e `Invalid
>   email`. O inglês virou `errorMap` global pt-BR (109 dos 174 usos de `z.` não
>   tinham `message`), o que também faz schema futuro nascer traduzido.
> - **BUG-005** — só a frase. Teste novo cobre a **virada de ano**, onde a
>   aritmética `YYYYMM` erraria e o Fator R quebraria uma vez por ano.
> - **BUG-007 e o dashboard do contador** eram o mesmo defeito: tela dos três
>   papéis escrita para um deles. Default do subtítulo agora é NEUTRO.
> - **BUG-006 — diagnóstico, sem correção.** Suspeito: `skipWaiting` +
>   `clientsClaim` no `sw.ts` fazem um SW novo assumir ABAS JÁ ABERTAS, servindo
>   chunks do build novo para documento do build antigo. Explica cada evidência
>   (ocorrência única, aba limpa não repetiu, sem 4xx/5xx, escopo não isolado);
>   tema e `localStorage` foram descartados por leitura. Não corrigido porque as
>   duas saídas custam caro e a escolha é de produto — registrado no `sw.ts`.
> - **SLA default — decidido NÃO fazer.** `sla_resposta_horas` aparece para o
>   CLIENTE junto do Suporte: um default faria o app prometer prazo que o
>   escritório nunca escolheu.
> - **`scripts/rodar-sql.mjs`** — roda um `.sql` em transação, mesma conexão do
>   seed. Foi ele que aplicou a 0106.
>
> **Linha de base ao fim da sessão 36: tsc 0 · 2290 testes · build limpo.**

> ## 🆕 SESSÃO 35 (2026-08-27, tarde) — o impasse circular da produção, achado e quebrado
>
> ### 🔴 O ACHADO: ninguém chegaria a produção, nem com o token certo
>
> A sessão 34 concluiu que faltava o token de revenda. Verdade — e **insuficiente**.
> Medido nesta sessão: mesmo com o token certo, NENHUMA empresa de origem `balu`
> chegaria a produção. Havia um ciclo fechado, sem porta de entrada:
>
> ```
>   focus_ambiente = 'prod'
>     ← só `definirModoFiscalAction` grava, e ela pré-valida com
>       `decidirCredencial`, que para origem 'balu' exige…
>   focus_habilita_nfsen_producao = true
>     ← só `snapshotFocusEmpresa` preenche, lendo da Focus, que só devolve
>       true depois de receber…
>   PUT habilita_nfsen_producao: true
>     ← `decidirFlagsNfse` só monta esse campo quando env === 'prod', e env
>       sai de… focus_ambiente  ⟲
> ```
>
> Cada elo é defensável isolado. Juntos, travavam tudo. Três fatos que fecham:
>
> 1. `focus_ambiente` nasce `'hom'` — `NOT NULL DEFAULT 'hom'` (0096, linha 19).
> 2. O payload de **criação** (`focus-empresa-payload.ts`) não tem nenhum campo
>    `habilita_*`. A habilitação só existe no PUT.
> 3. `definirModoFiscalAction` era o **único** escritor de `focus_ambiente` no
>    produto — e vive só no painel do contador. Empresa que se cadastra sem
>    contador não tinha nem o botão manual.
>
> Medido no banco: as 5 linhas fiscais em `focus_ambiente = 'hom'`,
> `focus_habilita_nfsen_producao = null`. Todas.
>
> ### 🧾 A RECONSTITUIÇÃO DA AL PISCINAS (09/06/2026) — a prova por medição
>
> A única empresa que já percorreu o fluxo automático inteiro. 22 minutos:
>
> ```
> 11:07:46.387  empresa criada
> 11:07:46.709  empresas_fiscais criada — 322 ms depois, mesmo pós-processamento
> 11:13:50.478  certificado A1 gravado (válido até 20/03/2027)
> 11:13:50.997  Focus sincronizada — focus_empresa_id = 216964
> 11:16:03.143  NFS-e AUTORIZADA — nº 16, RPS 14563118, R$ 2.500,00, CNAE 4120400
> 11:29:32.112  segunda AL PISCINAS (duplicata) — sincronizou em 443 ms,
>               MESMO focus_empresa_id 216964 e com token
> ```
>
> **O ambiente está escrito por extenso no callback que ficou guardado em
> `notas_fiscais.payload_focusnfe`:**
>
> ```
> url:        https://www.producaorestrita.nfse.gov.br/consultapublica/?tpc=1&chave=4113700…
> url_danfse: https://focusnfe.s3…/arquivos_development/10358425000120_216964/202606/DANFSEs/…
> ```
>
> `producaorestrita` é o ambiente de teste da NFS-e Nacional; `arquivos_development`
> é o bucket de homologação da Focus. **Nota autorizada, ambiente de teste.**
>
> Três consequências que mudam o mapa:
>
> - **A arquitetura não é hipótese — já rodou.** Do zero à nota autorizada, sem
>   gesto de admin, sem contrato do cliente com a Focus. Único trabalho humano: o A1.
> - **O `POST /v2/empresas` FUNCIONAVA em 09/06.** A conta tinha acesso à API de
>   Empresas e **perdeu** em algum ponto até o 401 de 23/07. Não é "nunca teve".
> - **Reenviar o mesmo CNPJ devolve o token.** A duplicata das 11:29 é o
>   experimento acidental: mesmo `focus_empresa_id`, com token, em 443 ms. Existe
>   caminho de reconciliação, e ele é o próprio POST.
>
> Correção de registro: o bloco da sessão 31 fala em "as duas NFS-e que a AL
> PISCINAS emitiu em 09/06". Foram **uma** emissão (`origem = 'emissao'`) e **um**
> lançamento manual (`origem = 'manual'`, sem chave, sem PDF).
>
> ⚠️ `empresa_credenciais_focus.token_prod_cifrado` é **null nas duas linhas**.
> Nunca existiu token de produção no banco — a coluna antiga guardava
> `token_homologacao ?? token_producao`, um dos dois, sem registrar qual.
>
> ### ✅ O CONSERTO: o certificado A1 passa a liberar produção
>
> `src/lib/fiscal/promover-producao.ts` (NOVO) — molde do `resolver-credencial.ts`:
> guarda pura + orquestrador. A ordem é o conserto — **PEDE → RELÊ → JULGA → GRAVA**:
>
> 1. `atualizarEmpresaNaFocus(admin, companyId, 'prod')` — PUT com ambiente
>    explícito. **É o que abre o ciclo:** o valor NÃO sai de `focus_ambiente`, que
>    é justamente a coluna que ele quer mudar.
> 2. Relê o snapshot que o PUT já refez.
> 3. `decidirCredencial` julga o estado REAL com o ambiente pretendido.
> 4. Só então grava `focus_ambiente = 'prod'`, com `.select()`.
>
> **Nenhuma guarda foi afrouxada** — mudou a ORDEM em que são consultadas.
> Service role por dentro, obrigatório: a 0098 tranca `focus_ambiente` e
> `focus_habilita_nfsen_producao` contra `authenticated`, e o dono chega ali com
> o client de sessão dele (viraria no-op silencioso, como o snapshot pré-0099).
>
> `decidirPromocao` (pura) recusa cedo em 5 casos — `ja_em_producao`,
> `origem_propria`, `nao_cadastrada_na_focus`, `sem_token_producao`,
> `certificado_invalido` — para não pedir à Focus o que a guarda recusaria
> depois, deixando o estado da Focus à frente do nosso.
>
> **Gatilho** em `cert-upload.ts`, logo após o PUT que espelha o A1: é o único
> gesto do cliente no fluxo automático e o momento em que a empresa reúne pela
> primeira vez as quatro condições. Motivo real vira aviso na tela, nunca silêncio.
> `ja_em_producao` não gera aviso.
>
> **Também consertado:** `listarTiposEmissaoAction` lia só
> `focus_habilita_nfsen_homologacao` — uma empresa habilitada em PRODUÇÃO sumiria
> do seletor. Agora lê as duas flags. (A metade do defeito que afeta origem
> `'propria'` — colunas `NULL` para sempre porque o snapshot recusa rodar lá —
> **continua aberta**, é outra decisão.)
>
> Commits `2a03422` (levantamento) e `2d2376d` (feature), publicados em
> `9960a63..2d2376d`.
>
> ### ⛔ ONDE PARAMOS: o token continua 401, e não há outro no painel
>
> O usuário conferiu o painel da Focus e confirmou: **não há token novo**. O
> "classic" é o que já temos. Sondado ao vivo no fim da sessão:
>
> ```
> producao JSqPs… (32) · homologacao 33dzT… (32) · diferentes entre si
> GET /v2/codigos_cnae/6201501  [api.focusnfe.com.br]  200   aceito
> GET /v2/empresas              [api.focusnfe.com.br]  401   "Access token inválido"
> GET /v2/empresas/216964       [api.focusnfe.com.br]  401
> GET /v2/empresas              [homologacao…]         404   endpoint não existe
> ```
>
> `config_focus` no banco continua **vazia** — quem manda é a variável de ambiente.
>
> **A pergunta para a Focus, agora objetiva** (a evidência de 09/06 é nova e a
> resposta anterior não a tinha): *a empresa 216964 (CNPJ 10.358.425/0001-20) foi
> criada pela nossa conta via `POST /v2/empresas` em 09/06/2026 e emitiu NFS-e em
> seguida. Hoje o token do painel (primeiros dígitos `JSqPs`) dá 200 em
> `/v2/codigos_cnae` e 401 em `/v2/empresas`, no mesmo host. (1) Qual token criou
> a 216964? (2) Por que o token que o painel oferece hoje não abre a mesma API
> que a conta usou em junho?*
>
> ### Estado atual da promoção, por empresa (medido)
>
> | Empresa | O que `decidirPromocao` responde hoje |
> |---|---|
> | AL PISCINAS ×2 | `sem_token_producao` |
> | dev.ide ×2 | `nao_cadastrada_na_focus` |
> | PADARIA MODELO | `nao_cadastrada_na_focus` |
>
> Ninguém é promovido hoje. O código dispara sozinho no minuto em que o
> `POST /v2/empresas` voltar a passar e a Focus devolver o par completo.
>
> ### Pendências desta sessão
>
> - 🔴 **Voltar à Focus com a pergunta acima.** Rascunho anterior em
>   `docs/investigations/2026-08-27-focus-token-principal.md` — **ainda não
>   reescrito** com a evidência da 216964.
> - 🟡 **Metade do defeito do seletor** (origem `'propria'`) continua aberta.
> - 🟡 **Segundo gatilho:** o botão "Sincronizar com Focus" promoveria a AL
>   PISCINAS sem reenviar o certificado. Não implementado.
> - 🟡 **Sem retry/reconciliação** do `POST /v2/empresas`. Nenhum cron reprocessa;
>   a única retentativa é o botão em `/configuracoes`.
> - 🟡 **Custo:** confirmar com a Focus se há cobrança por empresa cadastrada —
>   cadastrar todo trial no signup viraria custo proporcional a cadastros.
> - 🟡 **Duas linhas `AL PISCINAS`** e **duas `dev.ide`** em `companies` (a 0098
>   criou índice único por `empresa_id` vivo em `empresas_fiscais`, mas as
>   empresas duplicadas seguem lá).
> - 🟡 PADARIA MODELO com trial expirado em 26/08/2026 — bloqueada pelo gate.
>
> ### Levantamentos desta sessão
>
> - `docs/investigations/2026-08-27-token-automatico-por-empresa.md`
> - Telas publicadas: **O Círculo Fechado** (o impasse) e **A Primeira Nota**
>   (a reconstituição da AL PISCINAS).
>
> **Linha de base ao fim da sessão 35:** tsc 0 · **2239 testes** · 36 pulados ·
> `next build` limpo. (Eram 2215 no início; os 24 novos são 17 da guarda pura
> `decidirPromocao` + `mensagemPromocao` e 7 do fio do gatilho no upload.)
>
> ## 🆕 SESSÃO 34 (2026-08-27) — a Focus respondeu, e a resposta desmontou o diagnóstico
>
> ### 🔴 LEIA ISTO ANTES DO BLOCO "O BLOQUEIO QUE NÃO É NOSSO" DA SESSÃO 31
>
> **Aquele bloco está errado.** Ele afirma que a Focus bloqueia `/v2/empresas`
> por permissão da CONTA, "independente de qual token for gravado", e conclui
> que "isso NÃO se resolve com código, é chamado no suporte deles". O chamado
> foi aberto, e o suporte respondeu o contrário:
>
> > "Consultamos o cadastro de vocês e verificamos que a conta e o acesso estão
> > liberados, **inclusive, para utilizarem a API de Empresas**. Para operar
> > nessa API é preciso utilizar, **exclusivamente, o token principal de
> > produção**. Ele está disponível pelo painel da API navegando por
> > Serviços > Painel API > Tokens."
> > — Hélio Marques, Suporte ao Cliente, 27/08/2026
>
> Não faltava permissão. Faltava o token certo. O bloqueio era nosso.
>
> ### A medição que fecha o caso
>
> A própria mensagem da Focus mudou, e a nova entrega a causa:
>
> ```
> antes (23/07 → 20/08):  permissao_negada — "Contate o suporte técnico"
> AGORA (27/08):          permissao_negada — "Access token inválido (host: api.focusnfe.com.br)"
> ```
>
> Com o token de produção do `.env.local` (`JSqPs…`, 32 chars), contra a API real:
>
> ```
> GET /v2/codigos_cnae/6201501   [api.focusnfe.com.br]  -> 200   ✅
> GET /v2/empresas               [api.focusnfe.com.br]  -> 401   "Access token inválido"
> GET /v2/empresas/216964        [api.focusnfe.com.br]  -> 401   "Access token inválido"
> GET /v2/empresas               [homologacao...]       -> 404   endpoint não existe
> ```
>
> **Mesmo host, mesmo token, um endpoint aceita e o outro não.** O catálogo
> aceita qualquer token válido da conta; a API de Empresas aceita só o
> principal. Essa diferença é o veredito inteiro.
>
> Também descartado que fosse token de empresa disfarçado: o token de
> homologação da plataforma **não enxerga** as duas NFS-e que a AL PISCINAS
> emitiu em 09/06 — 404, idêntico a uma `ref` inventada.
>
> ### 🔴 O SEGUNDO PROBLEMA, QUE NINGUÉM TINHA OLHADO: a Vercel
>
> ```
> Vercel (Production):  FOCUS_NFE_TOKEN          ✅ existe (Sensitive, ilegível)
>                       FOCUS_NFE_TOKEN_PRODUCAO ❌ NÃO EXISTE
>                       FOCUS_NFE_HOMOLOGACAO    ❌ NÃO EXISTE
> config_focus (banco): token_hom = vazio · token_prod = vazio
> ```
>
> `obterTokenFocus` cai no genérico quando o específico falta — então em
> produção **o MESMO token atendia `hom` e `prod`**. Como um token de
> homologação dá 401 contra a base de produção e vice-versa, um dos dois
> ambientes estava necessariamente quebrado. É a falha muda que o cabeçalho da
> `0099` descreve como o motivo de o par existir, acontecendo em produção.
>
> ### 💡 POR QUE PASSOU 35 DIAS — a lição, não o bug
>
> A sonda da tela `/admin/configuracoes/focus` testava `GET /v2/codigos_cnae`,
> **que qualquer token válido responde 200**. Ela não distinguia o token
> principal de um token qualquer: colava-se o errado, aparecia "aceito", e o
> cadastro de empresa seguia 401 em silêncio.
>
> E não foi descuido — foi decisão registrada. O comentário do arquivo dizia,
> com todas as letras, que "testar por `/v2/empresas` teria recusado tokens
> corretos". A premissa era falsa, e virou regra de código: **a leitura errada
> de um 401 foi escrita como comentário e depois obedecida como norma.** É o
> mesmo padrão do 11º defeito da sessão 31 ("eu tinha a evidência certa e tirei
> a conclusão errada"), com um agravante — desta vez a conclusão errada foi
> gravada no repositório e passou a proteger a si mesma.
>
> ### ✅ CORRIGIDO NESTA SESSÃO
>
> - `focus.listarEmpresas()` novo no cliente — a única sonda que discrimina o
>   token principal.
> - Sonda de **produção agora é em dois passos**: catálogo (o token vale nesta
>   base?) e, só se passar, `/v2/empresas` (e é o principal?). Homologação segue
>   só no catálogo — `/v2/empresas` não existe naquela base.
> - Status novo `nao_principal`: **avisa, não bloqueia**. Bloquear deixaria a
>   plataforma sem token nenhum; calar foi o defeito. O aviso nomeia o endpoint
>   e o caminho no painel da Focus.
> - Os três comentários que carregavam a premissa falsa foram reescritos com a
>   medição no lugar (`focus-token-sonda.ts`, `admin/configuracoes/focus/actions.ts`).
> - **11 testes novos**, todos com asserção POSITIVA (a lição da sessão 33):
>   exigem que a segunda sonda aconteça e que o aviso diga o que fazer. Com o
>   ramo apagado, ficam vermelhos.
>
> ### 🔴 O QUE FALTA — e não é código
>
> 1. Painel da Focus → `Serviços > Painel API > Tokens` → copiar o **token
>    principal de produção** e conferir se começa com `JSqPs`. Se não começar,
>    é o achado.
> 2. Colar em `/admin/configuracoes/focus`. O banco **vence a variável da
>    Vercel** (`obterTokenFocus` lê `config_focus` primeiro), então vale sem
>    redeploy — e a tela agora recusa o token errado em vez de aprová-lo.
> 3. Responder ao Hélio. Ele pediu três coisas e as três estão em
>    `docs/investigations/2026-08-27-focus-token-principal.md`.
>
> ### Linha de base
>
> **tsc 0 · 2215 testes · 36 pulados** (+11 sobre a sessão 33 parte 2).
>

> ## 🆕 SESSÃO 33 (2026-08-25) — a auditoria, e o que o painel escondia
>
> Relatório completo, com o que ficou provado seguro e o que NÃO foi
> verificado: `docs/investigations/2026-08-25-auditoria-seguranca.md`.
>
> ### ✅ APLICADO E CONFIRMADO — 0103 e 0104 estão no banco
>
> Conferido FORA da transação por `scratchpad/_check-0103-0104.mjs`, 13/13:
>
> ```
> 0103: bucket privado · 0 policies citando o bucket · 6 objetos intactos
> 0104: role_types com 0 policies de escrita e 1 de SELECT · 0 bucket sem teto
> nada perdido: 8 contas / 8 papéis · 4 empresas vivas / 4 perfis / 2 notas
> estranho: anon key lista 0 itens · contratante do SERPRO -> 400 (era 200)
> backend: service_role ainda baixa o certificado -> 200
> ```
>
> **A última linha é a que importa:** a emissão fiscal continua alcançando o
> certificado. Só o estranho perdeu o acesso. E `tests/storage-postura.spec.ts`,
> sem uma linha alterada, foi de **2 vermelhos para 13 verdes** — a mesma suíte
> que denunciou o buraco agora prova que ele fechou.
>
> **Falta só o push:** `git push origin main` (4 commits — as duas migrations,
> as correções de código e este registro).
>
> ### O achado que importa
>
> `company-certificates` estava com `public = true` e quatro policies cuja única
> condição era o próprio `bucket_id`. Medido, não suposto:
>
> ```
> POST /storage/v1/object/list/company-certificates  (só a anon key)
>      -> 200, listando as 4 pastas de empresa e `system`
> HEAD /storage/v1/object/public/company-certificates/<uuid>/certificado.enc
>      -> 200, sem header nenhum, nos 6 objetos
> ```
>
> **O UUID no caminho nunca foi defesa** — a anon key está no bundle de toda
> página, e a API de listagem entrega as pastas. E `system/` guarda o
> certificado **contratante do SERPRO**, que vale pela plataforma inteira.
>
> As policies de UPDATE e DELETE eram piores que a de leitura: sem uma linha
> sobre dono, e o cadastro é aberto. Qualquer conta nova apagava ou substituía o
> certificado de qualquer empresa.
>
> **O que mitiga, dito com precisão:** o conteúdo é AES-256-GCM e provei que a
> `CERT_ENC_KEY` **não** está no bundle. Vazou ciphertext, não chave privada.
> Mas sobrou uma barreira só.
>
> ### 🔴 POR QUE PASSOU POR 32 SESSÕES — a lição, não o bug
>
> O bucket e as quatro policies **nunca estiveram numa migration**. Foram
> criados no painel. A única declaração daquilo no repositório é um comentário
> em `supabase-storage.ts` chamando o bucket de "privado".
>
> Comentário não compila, não roda e não fica vermelho. Zero testes tocavam
> configuração de bucket. **Regra nova: configuração de bucket entra por
> migration.** `tests/storage-postura.spec.ts` prende isso — ele não lê código
> nem migration, refaz o ataque com a anon key e exige que falhe. Rodado com o
> bucket ainda aberto: **2 vermelhos, 11 verdes**.
>
> ### Também corrigido
>
> - **O papel deixou de ser escolha do usuário.** `gate-context.ts` caía em
>   `user_metadata.type` (gravável pelo dono da sessão via GoTrue) quando faltava
>   a linha em `role_types` — e `role_types_delete` deixava o usuário apagar a
>   própria. O trigger de AdminBalu não cobria: é `BEFORE INSERT OR UPDATE`, não
>   DELETE. Não alcançava dado (os guards releem a tabela), alcançava menu,
>   onboarding e um laço de redirect. Medido antes de remover: 8 contas, 8
>   papéis, **zero órfãs**. A 0104 derruba as três policies de escrita.
> - **CVEs de produção: 5 high → 0.** `npm audit fix` (next 15.5.24, sem major) +
>   `overrides` de postcss ^8.5.26, que vinha aninhada no next. Restam 3 **só de
>   desenvolvimento** (vitest `critical` na UI, vite `high`) — não sobem.
> - **Os 4 crons** passaram a usar `timingSafeEqual` como os webhooks já usavam
>   (`lib/security/segredo.ts`, `checarCron()`).
>
> ### ⚠️ Efeito colateral que só a linha de base pegou
>
> O `npm install` **podou o `pg`** — ele nunca esteve no `package.json`, vivia
> como pacote solto e sustenta `ia.smoke.test.ts` e os 192 runners do
> scratchpad. Dois arquivos de teste quebraram com "Cannot find module 'pg'".
> Agora é `devDependency` declarada. Nenhuma leitura de diff acharia isso.
>
> ### ⚠️ NÃO corrigido, de propósito
>
> - **Token do escritório na query string** do webhook uazapi (credencial bearer
>   em URL → cai em log de proxy/Vercel/uazapi). Trocar por header exige
>   remigrar os canais **já conectados**, e canal que quebra é escritório sem
>   atendimento. Pede janela combinada. Junto disso: não achei caminho de
>   **rotação** do token de um escritório já provisionado — resolver as duas
>   coisas na mesma leva.
> - **Rotacionar os certificados** (4 A1 + o contratante do SERPRO), se a decisão
>   for tratar a exposição como incidente. É sua, não de código.
>
> ### Não verificado (o que continua no escuro)
>
> - **A Prova C não rodou.** Desativei o guard de admin de propósito para ver se
>   a suíte ficava vermelha; o classificador barrou o vitest e restaurei o
>   arquivo (`git diff` vazio, conferido). Pela leitura, os 13 testes fazem
>   `vi.mock('@/lib/admin/guard')` — provam que cada action **honra** o veredito,
>   não que o guard o **produz**. Esvaziar `guard.ts` provavelmente deixa os 13
>   verdes. Precisa de execução para virar achado.
> - **`CERT_ENC_KEY` de produção** é a mesma do `.env.local`? Não leio as
>   variáveis da Vercel. Se for, a chave que protege aquele ciphertext está numa
>   máquina de desenvolvimento, com 8 cópias `.bak` ao lado.
> - Config de Auth do Supabase (confirmação de e-mail, política de senha — o app
>   aceita 6 caracteres, proteção contra senha vazada) e DAST no app no ar.
>
> ### Linha de base
>
> **tsc 0 · 2183 testes · 36 pulados · build limpo** — idêntica à da sessão 32
> parte 4, com as dependências atualizadas por baixo.
>
> ### ⏭️ O teste de ponta a ponta do WhatsApp continua pendente
>
> Nada da sessão 32 parte 4 foi verificado com o canal conectado. O roteiro de 5
> passos segue válido, na parte 4 abaixo. **Aplique as duas migrations antes** —
> elas não dependem do canal, e o canal não depende delas.
>

> ## 🆕 SESSÃO 33 — PARTE 2 (2026-08-25) — o canal de WhatsApp, fechado de ponta a ponta
>
> ### ✅ O ROTEIRO DA SESSÃO 32 PASSOU INTEIRO
>
> | Passo | Resultado |
> |---|---|
> | 1 — conectar por QR, recarregar a página | ✅ `conectado` às 17:47:49 |
> | 2 — `Olá` sozinho → só a apresentação | ✅ frase exata, sem IA, sem conteúdo fiscal |
> | 3 — pergunta seguinte sem repetir a identidade | ✅ |
> | 4 — mensagem combinada, de número novo | ✅ cumprimento + identificação + MEI, numa mensagem |
> | 5 — **os três pontinhos** | ✅ **provado** — era o único ponto NUNCA verificado da sessão 32 |
>
> ### 🔴 TRÊS DEFEITOS QUE SÓ O TESTE REAL ACHOU
>
> **(a) `"Ok obrigado"` ficou mudo** (`bad7350`). Caía na guarda de 12/08, que
> pergunta "é pergunta ou termo fiscal?" e nada mais. É a pergunta certa para a
> PRIMEIRA mensagem de um estranho e a errada para a terceira de uma conversa em
> andamento. Agora ela só opina enquanto `ninguemFoiAtendido` — o "👍" de um
> conhecido do dono do número segue em silêncio; quem acabou de ser atendido, não.
>
> **(b) Os pontinhos acendiam ANTES da decisão de responder** (`bad7350`). Mensagem
> silenciada de propósito prometia resposta e não entregava — pior que o silêncio
> limpo. `marcarDigitando` virou `pontinhos()` e foi para junto das TRÊS chamadas
> de IA. **O teste de presença que já existia pegou que eu tinha esquecido a
> terceira** (cliente cadastrado) antes de eu perceber.
>
> **(c) Saudação repetida na 2ª resposta** (`30bafb9`). A pessoa respondeu `"Sim"`
> e recebeu `"Olá! Para abrir um MEI…"`. **O código não colou nada** —
> `garantirApresentacao` só age quando ninguém foi atendido. Quem cumprimentou foi
> o MODELO, porque o ramo do prompt para "não é a primeira mensagem" era `[]`.
> Até 24/08 o prompt PROIBIA cumprimentar; a parte 4 trocou a proibição por uma
> instrução condicional e **a proibição saiu junto, para todas as outras**.
> Silêncio não é instrução: o modelo preenche.
>
> ⚠️ **`primeiraInteracao` era calculado em TRÊS lugares e a parte 4 corrigiu UM.**
> As linhas 407 (contador) e 887 (dúvida geral) seguiam com `length === 0`,
> enquanto 944 já usava `ninguemFoiAtendido`. Com `length === 0`, uma linha MUDA
> faz o histórico deixar de ser vazio sem ninguém ter sido atendido — e prompt e
> código discordavam dentro da mesma requisição. Os três agora usam a mesma régua.
>
> ### 🆕 ENCERRAMENTO POR INATIVIDADE (`61b79c1`, migration 0105)
>
> Pedido do usuário: agradeceu → responde ao agradecimento; 5 min sem interação →
> despede-se e encerra.
>
> **Escopo escolhido pelo usuário entre duas leituras: o relógio SÓ é armado por um
> agradecimento.** Conversa que para no meio não é encerrada — 5 minutos é pouco
> para o ritmo do WhatsApp.
>
> `ehAgradecimento` decide por subtração e exige as DUAS metades: tem de sobrar
> nada **e** tem de ter havido agradecimento. Sem a primeira, "obrigado, mas ainda
> tenho uma dúvida" viraria despedida; sem a segunda, "ok" sozinho armaria o
> relógio de quem só pausou para ler.
>
> Quem arma (webhook) e quem dispara (cron) são separados: a regra existe num lugar
> só. Três recusas com teste: pessoa voltou a falar → cancela sem despedida; envio
> falhou → NÃO carimba `encerrado_em`; escalou para o contador → não arma.
>
> **🔬 PROVADO EM PRODUÇÃO:**
>
> ```
> 19:20:38  "Ok muito obrigado" -> respondido, encerrar_em = 19:25:40
> 19:25:00  rodada do cron -> encerrados: 0  (ainda nao venceu)
> 19:26:00  rodada do cron -> encerrados: 1
> 19:26:02  encerrado_em gravado, encerrar_em limpo
> ```
>
> Os 22s de atraso são a varredura de minuto em minuto, como documentado.
>
> ### 🔑 INFRA — o que mudou fora do código
>
> - **`CRON_SECRET` de produção foi ROTACIONADO.** O valor antigo estava marcado
>   como **Sensitive** na Vercel: `vercel env pull` devolve o literal
>   `[SENSITIVE]`, e não há como lê-lo — nem pelo CLI. A única saída era trocar.
>   O valor novo está em `cron.job` (job 3), recuperável pelo runner de banco.
> - ⚠️ **`honorarios-recorrentes` e `obrigacoes` usam a MESMA variável.** O
>   redeploy já subiu com o valor novo, mas **conferir a execução de `obrigacoes`
>   amanhã às 11h** — é a primeira depois da troca.
> - **O CLI da Vercel está autenticado nesta máquina** (`luan-4913`, escopo
>   `gestao-9664s-projects`). Foi assim que a variável foi trocada e o redeploy
>   feito, sem token de API — que NÃO existe na pasta do projeto (procurado:
>   `.vercel/`, `credenciais/`, e o Trello).
> - **pg_cron job [3] `whatsapp-encerrar-inativos`**, `* * * * *`, batendo em
>   `/api/cron/whatsapp-encerrar`. Agendado por
>   `scratchpad/_agendar-cron-encerramento.mjs`, que **recusa segredo `dev-*`** —
>   agendar com o errado criaria um job tomando 401 a cada minuto, em silêncio.
> - Conferir execuções: `net._http_response`, não só `cron.job_run_details` — o
>   `net.http_get` retorna na hora, então o job fica "succeeded" mesmo com 401 do
>   outro lado.
>
> ### 💡 A LIÇÃO DE TESTE DESTA PARTE
>
> Existia um teste para o ramo do prompt que quebrou, e ele afirmava só a
> **AUSÊNCIA** do bloco da primeira mensagem. Assertiva negativa passa igual com o
> ramo vazio — que era exatamente o defeito. Ficou verde o tempo todo, com o bug
> em produção. Trocado por exigência **positiva**, mais um teste que prende os dois
> ramos como mutuamente exclusivos.
>
> ### 🔴 O QUE FALTA — reconferir a saudação
>
> A correção (c) foi publicada no deploy `8vim8a1zg` (19:31) e **não foi testada
> com gente**. Ao retomar, de um número FORA da janela de 12h:
>
> 1. `Olá, preciso abrir um MEI` → cumprimento + identificação + resposta
> 2. uma segunda mensagem curta (`Sim`, `E quanto custa?`) → **direto ao assunto**,
>    sem "Olá" e sem repetir quem é
> 3. `Obrigado` → responde ao agradecimento e grava `encerrar_em`
> 4. 5 minutos parado → despedida e `encerrado_em`
>
> ⚠️ `553291511415` está queimado (conversa de 25/08 à noite). Usar
> `553291638563` ou outro. **Nunca** o `553287006789`: é o número da própria
> instância, e o webhook o ignora por `fromMe`.
>
> ### Linha de base (parte 2)
>
> **tsc 0 · 2204 testes · 36 pulados · build limpo.** (+21 sobre a parte 1: 6 do
> detector de agradecimento, 10 do cron de encerramento, 5 entre webhook e prompt.)
>

> ## 🆕 SESSÃO 32 (2026-08-24) — as duas dívidas de coluna, fechadas
>
> Pedido do usuário: as frentes 2 e 3 da lista de dívidas da sessão 31 —
> "fechar o caminho de produção fiscal" e "trancar colunas no banco".
>
> ### ✅ Publicado e aplicado, nesta ordem
>
> 1. **`main` em `e6d0984`**, deploy de produção `d2bcs89vs` **Ready** (42s).
> 2. **0100 aplicada** logo depois, com os 13 checks passando na transação que
>    comitou. Conferida FORA da transação por `scratchpad/_check-0100.mjs`:
>    0 policies de UPDATE em `notas_fiscais`, a de INSERT de pé, 3 triggers em
>    `profiles` (2 novos + `updated_at`), CHECK E.164 presente, os dois triggers
>    SECURITY **INVOKER**, e nada perdido (4 empresas vivas, 4 perfis, 2 notas).
>
> **A ordem era obrigatória e foi respeitada:** a versão publicada antes deste
> deploy ainda atualizava `notas_fiscais` pela sessão do usuário. Aplicar a 0100
> primeiro teria deixado emissão, polling e cancelamento gravando no vazio, em
> silêncio — nenhum desses caminhos lê o retorno do `update`.
>
> ⚠️ **`companies` tem 5 linhas e 4 vivas** — `dev.ide` está soft-deleted desde
> 23/07/2026. Contar sem `deleted_at IS NULL` dá um susto à toa, e deu: o
> primeiro `_check-0100.mjs` acusou "empresa perdida" que nunca existiu.
>
> ### Frente 2 — produção fiscal alcançável pela interface
>
> O Bloco 5 tinha parado num ponto cego: a 0096 criou `focus_origem` e
> `focus_ambiente`, a 0098 trancou as duas contra o inquilino, e **nada no
> produto escrevia uma nem outra**. A aba "Credencial Focus" do contador
> devolvia cedo para toda empresa `'balu'` — ou seja, para as cinco que existem.
>
> - **`definirModoFiscalAction`** (`contador/clientes/[companyId]/focus-actions.ts`):
>   grava origem e ambiente com service role (a 0098 só deixa o backend passar),
>   com `requireEscritorioAprovado` + `companyDaCarteira` antes de qualquer
>   escrita e auditoria com o de→para.
> - **A pré-validação é o ponto.** Antes de gravar `'prod'`, a action roda a
>   PRÓPRIA guarda de emissão (`decidirCredencial`) contra o estado real do
>   banco, com origem/ambiente trocados pelos valores pedidos. Recusou? A tela
>   mostra o motivo nomeado e **não grava**. Antes disso, a única forma de
>   descobrir era gravar e esperar a primeira emissão falhar — na frente do
>   cliente, não na tela de quem configurou. Para isso `lerEstadoFiscal` foi
>   extraída de `resolverCredencialEmissao`, **sem mudar o comportamento dela**.
> - **O ambiente sai do banco, não de um literal.** `atualizarEmpresaNaFocus`
>   tinha `env: FocusEnv = 'hom'` e os três chamadores de produto passavam
>   `'hom'` na mão. Efeito silencioso: `decidirFlagsNfse` mandava sempre
>   `habilita_nfsen_homologacao`, e **nenhum caminho do produto jamais pedia
>   `habilita_nfsen_producao` à Focus**. Agora o parâmetro é opcional e, omitido,
>   sai de `empresas_fiscais.focus_ambiente`; os três omitem. Valor inesperado
>   na coluna cai em `'hom'`, nunca em `'prod'`.
> - **A tela**: `CredencialFocusCard` ganha o card "Modo de emissão", que
>   aparece **também** para origem `'balu'` — é o que tira o card da inércia. O
>   motivo do bloqueio de produção é calculado no servidor a cada render, com a
>   mesma guarda. Sair de `'balu'` numa empresa que já tem `focus_empresa_id`
>   pede confirmação explícita: aquele cadastro na conta Focus da Balu fica
>   órfão e não há volta por aqui.
>
> ### Frente 3 — a 0100, escrita e provada
>
> **`notas_fiscais`: a policy de UPDATE sai inteira.** Tudo que se grava numa
> nota depois do INSERT é fato que veio da Focus — não existe coluna que o
> titular precise escrever com a própria mão. As oito escritas de
> `notas_fiscais/actions.ts` passaram a sair por `escritaDeNota()` (service
> role), cada uma filtrando pelo `company_id` já provado por `empresaDoDono`. O
> **INSERT continua pela sessão de propósito**: `notas_fiscais_insert` exige
> `user_owns_company` e é a guarda daquele caminho.
>
> Os dois vetores que isso desarma:
> - **`xml_url` gravável RECARREGA o SSRF da sessão 31.** Lá a correção foi na
>   LEITURA; a ESCRITA continuou aberta por `PATCH` no PostgREST.
> - **`status` e `valor_total` graváveis** mexem na base de cálculo que a
>   apuração lê para gerar a guia.
>
> **`profiles`: travar o que é morto, VALIDAR o que é escolha.** A sessão 31
> parou aqui por um motivo certo — travar `current_company` quebraria o seletor
> de empresa. A saída não é travar, é validar: `current_company` passa a exigir
> empresa que o usuário **possui** ou que está na **carteira do escritório
> dele**, que é exatamente o que os quatro pontos legítimos produzem e o estado
> real das 4 linhas do banco. Fecha o vetor de `lib/auth/empresa-dono.ts`.
> Travadas de verdade: `id`, `user_id`, `company_id` (coluna morta),
> `created_at` e `deleted_at` (carimbo da LGPD, escrito pela RPC SECURITY
> DEFINER, que passa por cima do gate). Mais um **CHECK E.164** em
> `whatsapp_numero` — a canonicalização morava só em `conta/actions.ts`.
>
> ### O que foi medido no banco antes de desenhar (24/08/2026)
>
> | pergunta | resposta |
> |---|---|
> | perfis com `current_company` inválido (nem dono nem carteira) | **0** de 4 |
> | perfis cujo `current_company` é da carteira, não próprio | **1** (membro de escritório) — por isso o ramo da carteira existe |
> | números de WhatsApp fora do E.164 | **0** de 1 |
> | funções do banco que escrevem `notas_fiscais` | **nenhuma** |
> | funções do banco que escrevem `profiles` | `add_company_to_profile` (INVOKER, passa pela regra) e `anonimizar_usuario` (DEFINER dono `postgres`, desviada) |
> | empresas em produção | **0** — as 5 seguem `balu`/`hom` |
>
> ### Provado, não suposto
>
> `scratchpad/_aplicar-0100.mjs` roda a migration numa transação e executa os
> ataques **como a sessão de usuários reais** (`SET ROLE authenticated` + claim
> `sub`), com ROLLBACK no fim: **13 de 13**. Inclui o ataque (`UPDATE` de
> `xml_url`/`status` pelo titular → **0 linhas**) e as não-regressões que
> importam: seletor de empresa continua trocando, membro de escritório continua
> abrindo empresa da carteira, `service_role` continua atualizando a nota, e o
> titular continua inserindo.
>
> ### ⚠️ Dívidas que esta sessão NÃO fechou
>
> - **`whatsapp_numero` continua sem prova de posse.** O CHECK garante a FORMA,
>   não que o número seja de quem o cadastrou — a action também nunca garantiu
>   (a confirmação por mensagem da uazapi é a Task 5/6, não feita). Quem
>   cadastra o número de outra pessoa antes dela faz o bot atender por ela.
> - **Playwright segue sem rodar** (sessão 31): não há `E2E_SUPABASE_URL`.
> - **O bloqueio da Focus (`permissao_negada`) continua de pé** e segue sendo o
>   impedimento real da emissão pelo caminho `'balu'`. O caminho `'propria'`,
>   que não depende da API de Empresas, agora tem interruptor.
>
> ### Linha de base (parte 1)
>
> **tsc 0 · 2121 testes · 36 pulados · build limpo.** (Eram 2092 na sessão 31;
> os 29 novos são as invariantes do interruptor de produção e das escritas por
> service role.)
>
> ## 🆕 SESSÃO 32 — PARTE 2 (2026-08-24) — WhatsApp conecta por QR code
>
> Pedido do usuário: trocar "digitar o número" por **QR code** na conexão de
> WhatsApp — escanear e pronto, com a instância criada sozinha. Escopo fechado
> com ele: **admin e contador por ora**; a empresa fica de fora (ver abaixo).
>
> ### 🔴 O QUE FALTA FAZER
>
> 1. **Deploy do código** (este merge).
> 2. `node scratchpad/_aplicar-0101.mjs --aplicar` (a partir de `balu/app`).
>
> Aqui a ordem é **indiferente**: a 0101 só CRIA uma tabela nova, e
> `configDaPlataforma` mantém `UAZAPI_TOKEN` como retaguarda. Nada regride se
> uma metade chegar antes da outra.
>
> ### O contrato do QR, medido e não suposto
>
> `provisionamento.ts` diz no cabeçalho que tudo ali foi validado ao vivo,
> porque a doc da uazapi é um SPA sem contrato. O QR nunca tinha sido. Sondado
> em 24/08/2026 contra `grupoide.uazapi.com`
> (`scripts/uazapi-qr-smoke.ts`, `scripts/uazapi-qr-refresh.ts`):
>
> | pergunta | resposta medida |
> |---|---|
> | como se pede o QR | `POST /instance/connect` **sem** `phone` — é a ausência do campo que troca `paircode` por `qrcode` |
> | formato | **data-URI pronta** (`data:image/png;base64,…`, ~1,8 KB). Nenhuma biblioteca de QR, dos dois lados |
> | ele expira? | **rotaciona sozinho no servidor**: 1834 → 1850 chars em 20s |
> | como renovar | `GET /instance/status` **já devolve o QR corrente** → o polling da tela é **uma** chamada, não duas |
> | quando não há QR | campo vem `""` — tratado como erro nomeado, senão a tela renderiza `<img src="">` |
>
> ### O que existe agora
>
> - **Contador** (`/contador/configuracoes/whatsapp`): abre, provisiona a
>   instância sozinha e mostra o QR. **Não pede mais o número** — e isso corrige
>   um defeito silencioso: antes a plataforma gravava `uazapi_numero` com o que
>   foi digitado, **antes** de saber qual aparelho de fato conectou. Agora o
>   número vem do `owner` da instância, depois.
> - **Admin** (`/admin/configuracoes/whatsapp`, **tela nova**): o número oficial
>   do Balu, que atende as empresas sem escritório (decisão D8). Até aqui esse
>   canal **não tinha tela nenhuma** — provisionar exigia criar a instância na
>   mão no painel da uazapi e colar o token numa variável de ambiente.
>   Migration **0101** (`config_whatsapp`), no molde da 0094.
> - **`components/ConexaoWhatsapp.tsx`**: a mecânica do QR mora num lugar só.
>   Duplicá-la garantiria que uma das duas telas ficasse para trás no dia em que
>   o contrato da uazapi mudasse.
> - **O pareamento por código continua**, atrás de um link — e **não é legado**:
>   não dá para escanear um QR com o mesmo aparelho que se quer conectar.
>   Escritório com um celular só depende dele.
>
> ### ⚠️ Efeitos colaterais reais desta sessão, no banco e no servidor de terceiro
>
> - **Foi criada uma instância uazapi de verdade**: `r42092cbc8ff21d`, nomeada
>   `balu-Escritório Teste Balu`, no servidor **compartilhado**
>   `grupoide.uazapi.com` (que hospedava 37 instâncias de outros produtos em
>   19/08). Ela foi **gravada** em `contabilidades` (id, token cifrado, webhook
>   token) pelo mesmo caminho que a action usaria — não é órfã. Ninguém
>   escaneou: ela está `connecting` do lado deles.
> - `configDaPlataforma` **virou assíncrona** (lê o token do banco). Os dois
>   chamadores ganharam `await`. Sem ele a expressão devolveria uma Promise —
>   que é *truthy* — e o canal passaria adiante um objeto sem `token`: nenhuma
>   mensagem sairia e nada acusaria.
>
> ### Decisões do dono, para não rediscutir
>
> - **A empresa NÃO ganha canal por QR agora.** O campo de `/conta`, onde o
>   empresário digita o número, é **destino de aviso**, não instância — trocá-lo
>   por QR transformaria o celular pessoal dele num robô e quebraria as
>   notificações. Canal próprio por empresa custaria um slot de instância por
>   CNPJ no servidor compartilhado.
> - **O segredo do webhook da plataforma continua no ambiente.** A rota
>   `/api/webhooks/uazapi` valida o canal da plataforma comparando `?s=` com
>   `UAZAPI_WEBHOOK_SECRET`. Movê-lo para o banco no mesmo deploy que estreia a
>   tela seria trocar a porta de entrada do WhatsApp e o provisionamento de uma
>   vez. As três variáveis existem em produção (conferido).
>
> ### ⚠️ Dívida registrada
>
> - **O webhook da plataforma leva `?s=` e o do escritório leva `?t=`.** São
>   caminhos diferentes na mesma rota, e um `?t=` na instância da plataforma
>   faria as mensagens do número oficial entrarem como se fossem de um
>   escritório. Há teste mordendo isso (`admin/.../whatsapp/actions.test.ts`),
>   mas o desenho continua sendo duas portas para a mesma casa.
>
> ### 🔴 O DEFEITO QUE A TELA DENUNCIOU NA PRIMEIRA ABERTURA
>
> A página publicada respondeu **"UAZAPI_ADMIN_TOKEN não configurado"**. Medido
> na hora, e o diagnóstico é curto:
>
> | variável | `.env.local` | Vercel produção |
> |---|---|---|
> | `UAZAPI_BASE_URL` | ✅ | ✅ |
> | `UAZAPI_TOKEN` | ✅ | ✅ |
> | `UAZAPI_WEBHOOK_SECRET` | ✅ | ✅ |
> | **`UAZAPI_ADMIN_TOKEN`** | ✅ | ❌ |
>
> **Não é defeito da tela nova: provisionar canal de WhatsApp NUNCA funcionou
> em produção.** O canal do escritório existe desde a 0091 (19/08) com o mesmo
> buraco — local funciona sempre, publicado nunca, e ninguém tinha como saber.
> É a 0094 de novo, com o sinal trocado: lá o nome tinha acento e o certo só
> existia na Vercel; aqui o nome está certo dos dois lados e a variável só
> existe de um.
>
> **Correção (0102), na doutrina da sessão 30:** o admin token é *credencial de
> plataforma* — provisiona QUALQUER instância do servidor compartilhado (37 em
> 24/08, quase todas de outros produtos). Foi para `config_whatsapp.admin_token_cifrado`
> com campo em `/admin/configuracoes/whatsapp`, precedência banco → ambiente.
> Acrescentar a variável na Vercel resolveria hoje e deixaria o buraco aberto
> para a próxima pessoa.
>
> O botão **testa antes de gravar**: `GET /instance/all` com o admintoken →
> **200** com a lista; token errado ou ausente → **401** (medido em 24/08).
> Admin-scoped, só-leitura, e discrimina de verdade. A resposta traz as
> instâncias de todos os produtos do servidor, então **só a contagem** sai de
> lá — nunca o conteúdo.
>
> ## 🆕 SESSAO 32 — PARTE 3 (2026-08-24) — o primeiro teste real do canal
>
> ### 🔴 O DEFEITO QUE O TESTE DO USUARIO ACHOU: recarregar a pagina desconectava o numero
>
> Diagnostico com a instancia da plataforma na mao:
>
> ```
> 16:31:13  instancia criada
> 16:33:09  lastDisconnect — motivo: "disconnected by API"
> 16:35:55  status=connecting, connected=false, owner=553291511415, profileName="Walace"
> ```
>
> `owner` e `profileName` preenchidos provam que **o QR foi escaneado e
> conectou**. Dois minutos depois a sessao caiu por chamada de API — e a chamada
> era nossa: **`POST /instance/connect` numa instancia JA CONECTADA derruba a
> sessao viva** para parear de novo, e a tela pedia QR sozinha ao montar sempre
> que o ESPELHO no banco nao dissesse `conectado`. O espelho fica velho porque
> so o polling de quem esta com a tela aberta o atualiza.
>
> A guarda dentro de `pedirQrCode` existia e **nunca disparava**: quando a
> resposta chega, a sessao ja caiu e o QR novo veio junto. **A guarda tem de vir
> ANTES da chamada, e contra a FONTE** (`statusInstancia`), nao contra o espelho.
> Corrigido nos dois canais; um status atrasado e curado de passagem.
>
> ### Saudacao nova (pedido do usuario)
>
> `Olá, eu sou o Assistente da Balu Contábil. Como posso te ajudar hoje?`
>
> Ortografia revisada pelo mesmo criterio da versao de 19/08, com o que mudou
> registrado no proprio codigo. **O tratamento informal (`te ajudar`) e escolha
> do usuario, nao descuido** — ha teste prendendo, para ninguem "corrigir" de
> volta para `ajudá-lo`.
>
> O teste do webhook parou de duplicar o texto e passou a comparar com a
> CONSTANTE: a frase ja mudou duas vezes, e duplicada ela faz o teste acusar
> regressao do webhook a cada troca de copy.
>
> ### "Digitando..." — ⚠️ a unica coisa NAO PROVADA desta sessao
>
> `POST /message/presence` com `{ number, presence: 'composing', delay }`.
> Sondagem de 24/08 com a instancia FORA DO AR:
>
> | caminho | resposta | leitura |
> |---|---|---|
> | `/message/presence` | **503** `WhatsApp disconnected` | a rota existe e aceitou o payload |
> | `/instance/presence` | 503 | idem |
> | `/chat/presence` | 405 | rota inexistente para POST |
> | `/send/presence` | 405 | idem |
>
> **O sucesso com sessao CONECTADA nunca foi observado** — e o comentario no
> codigo diz isso. E o unico ponto "provavel" em vez de "provado" da sessao.
>
> Entra depois do claim (antes dele, uma reentrega ligaria o indicador numa
> conversa ja atendida) e antes da chamada de IA, que e o trecho lento. Sem
> `await` e com catch duplo: e enfeite, e a resposta e o produto.
>
> ### Armadilha de ferramenta, para nao repetir
>
> Editar arquivo UTF-8 por script Python via heredoc **nao casa strings
> acentuadas** (o stdin chega em cp1252 no Windows) e **come um nivel de
> escape** (`'
'` virou quebra de linha de verdade dentro de um literal TS).
> Nos arquivos com acento, editar por indice de linha e montar escapes com
> `chr(92)`. Custou tres idas e voltas nesta sessao.
>
> ## 🆕 SESSAO 32 — PARTE 4 (2026-08-24) — a saudacao, e os dois defeitos que so a producao mostrou
>
> ### O QUE O USUARIO PEDIU
>
> A abertura da conversa tinha de **se adaptar** ao que a pessoa escreve:
>
> | mensagem | resposta esperada |
> |---|---|
> | `Olá` | `Olá, sou o Assistente da Balu Contábil. Como posso te ajudar hoje?` |
> | `olá, como você está? preciso de ajuda com abertura de MEI` | cumprimenta, se identifica, diz que está bem em uma frase, e emenda no MEI |
>
> ### A INVERSAO DE CONTRATO
>
> Ate 24/08 o codigo colava `SAUDACAO_INICIAL` antes de toda primeira resposta e
> o prompt **PROIBIA** o modelo de cumprimentar (decisao de 19/08: "texto fixo
> nao pode virar parafrase"). Deu certo em teste e errado na vida — a saudacao
> aparecia grudada numa resposta que ignorava a pergunta social.
>
> Agora **o prompt PEDE** a abertura, e o codigo garante so o que nao pode
> faltar: a **IDENTIDADE**. `garantirApresentacao` (era `comSaudacao`) confere se
> a resposta se apresentou e, se nao, poe a frase de reserva na frente —
> comparando **sem acento e sem caixa**, senao a rede dispara em cima de uma
> resposta boa e o cliente recebe DUAS aberturas.
>
> **O que se perde, dito por escrito:** a abertura deixa de ser byte a byte a
> mesma. Foi decisao do usuario — troca consciente de "identidade identica" por
> "conversa coerente". Ha teste prendendo que a proibicao antiga nao volte.
>
> ### 🔴 OS DOIS DEFEITOS QUE SO A PRODUCAO MOSTROU
>
> As duas linhas gravadas contam a historia inteira:
>
> ```
> 17:13:21  "Ola"                                     -> resposta_enviada: NULL
> 17:21:15  "Ola, tudo bem? ... preciso abrir um mei" -> "Ola! Para abrir um MEI..."
> ```
>
> **(a) O `Ola` sozinho nao era respondido, e isso era DELIBERADO.** Numero
> desconhecido cai na guarda de 12/08: sem ser pergunta e sem termo fiscal, o
> webhook cala. A guarda esta certa sobre o que queria impedir — resposta
> **fiscal** a quem nao perguntou nada — e errada sobre o cumprimento em si.
> Numero de empresa que recebe "ola" e fica mudo parece numero errado.
>
> Cumprimento sozinho passou a receber a apresentacao **fixa**: sem IA (nao ha o
> que raciocinar sobre "oi"), sem conteudo fiscal, sem escalar. O resto do
> silencio deliberado continua de pe — inclusive o teste do ACHADO 4, que trocou
> `"bom dia"` por `"tudo certo entao"`; `"e simples assim"` **nao serve** ali,
> porque casa com `TERMO_FISCAL`.
>
> `ehSoCumprimento` decide **por subtracao**, nao por lista de frases: tira do
> texto toda abertura conhecida e, se nao sobrar nada, era so cumprimento. Um
> `startsWith('ola')` classificaria `"ola, preciso abrir um MEI"` como
> cumprimento — a mensagem que MAIS precisa da resposta completa.
>
> **(b) A linha muda CONSUMIA a apresentacao** — o mais insidioso. Aquele `Ola`
> sem resposta criava a linha de auditoria, o historico deixava de ser vazio, e
> a mensagem SEGUINTE vinha sem apresentacao. A saudacao era gasta por uma
> conversa que nunca aconteceu. `historico.length === 0` virou
> `ninguemFoiAtendido(historico)`: o que conta e troca **completa**.
>
> O fixture do teste que simulava "interacao anterior" tambem nao tinha
> `resposta_enviada` — passou a ter, porque era ele que estava mentindo sobre o
> mundo.
>
> ### JANELA DE CONVERSA: 12 horas
>
> "Primeira mensagem" queria dizer "a primeira que este telefone JA MANDOU, na
> historia" — o numero de teste, com 14 trocas desde 12/08, nunca mais seria
> cumprimentado. `JANELA_CONVERSA_HORAS = 12` recorta conversa e memoria pela
> mesma regra. Nao ha numero certo aqui, ha um numero explicito.
>
> ### ⚠️ ERRO MEU, para nao repetir
>
> Eu disse ao usuario "use o mesmo numero, as 14 trocas dele sao de mais de 12h
> atras". **Estava errado:** olhei o `primeira` (12/08) e ignorei o `ultima`, que
> era daquele mesmo dia. O teste seguinte falhou por causa disso e custou uma
> rodada inteira. Ler a coluna certa da consulta que eu mesmo escrevi.
>
> ### 🔴 O QUE FALTA — o teste de ponta a ponta
>
> **Nada disso foi verificado com WhatsApp conectado.** O canal esta
> desconectado desde 16:33. Ao retomar:
>
> 1. Conectar em `/admin/configuracoes/whatsapp` (o QR aparece sozinho; agora da
>    para recarregar a pagina sem derrubar a sessao).
> 2. De um numero **sem conversa nas ultimas 12h**, mandar `Olá` sozinho →
>    esperado: a frase completa, e **nada mais**.
> 3. Na sequencia, a pergunta do MEI → esperado: resposta **sem** repetir o
>    cumprimento.
> 4. De outro numero, `olá, como você está? preciso de ajuda com abertura de
>    MEI` → esperado: cumprimento + identificacao + "estamos bem" + o MEI, numa
>    mensagem so.
> 5. **Os tres pontinhos** — o unico ponto ainda NAO PROVADO de toda a sessao
>    (ver parte 3). Se nao aparecerem, sondar `/message/presence` com a
>    instancia no ar.
>
> ⚠️ O historico do `553291511415` tem 2 trocas de 24/08. Dentro da janela de
> 12h ele NAO sera cumprimentado — usar outro numero ou apagar aquelas linhas.
>
> ### Linha de base (parte 4)
>
> **tsc 0 · 2183 testes · 36 pulados · build limpo.** (+32 sobre a parte 3: 25 do
> detector de cumprimento, o resto entre webhook e prompt.)
>
> ### Linha de base (parte 3)
>
> **tsc 0 · 2151 testes · 36 pulados · build limpo.**
>
> ### Linha de base (parte 2)
>
> **tsc 0 · 2147 testes · 36 pulados · build limpo.** (+26 sobre a parte 1: 15
> no canal do escritório, 19 no da plataforma — 6 deles só do admin token —
> menos os que foram reescritos.)
>

> **Registro anterior:** 2026-08-20 (sessão 31 — **Bloco 5 mergeado e publicado**. Emissão fiscal decidida por empresa, telas de credencial e de documentos legais no ar. Onze defeitos do autor corrigidos no caminho. O bloqueio da Focus (`permissao_negada`) segue sendo o único impedimento real da emissão, e é chamado no suporte deles.)

> ## 🆕 SESSÃO 31 (2026-08-20, tarde/noite) — Bloco 5 MERGEADO, e o dia em que o autor errou onze vezes
>
> **`main` em `6243a98`, deploy Ready.** Tudo publicado. A branch
> `bloco-5-producao-fiscal` foi mergeada e continua no remoto como histórico.
>
> ### O que entrou em produção hoje
>
> **Manhã** — credenciais saem do `.env` e ganham tela no admin (Focus e SERPRO),
> migrations 0094/0095.
>
> **Tarde** — Bloco 5 inteiro: emissão fiscal decidida **por empresa** em vez do
> `env: FocusEnv = 'hom'` fixo. Migrations 0096, 0097, 0098, 0099.
>
> **Além disso:** tela de documentos legais no admin (o advogado edita termos e
> privacidade), rota **pública** `/documentos/[tipo]` com link no rodapé,
> "Assinatura" some para empresa de carteira, e o campo de WhatsApp do escritório
> passa a mostrar o estado real do canal.
>
> ### ~~🔴 O BLOQUEIO QUE NÃO É NOSSO~~ — ⛔ ERRADO, corrigido na sessão 34 (27/08/2026)
>
> **A conclusão deste bloco é falsa e ficou 35 dias de pé.** A Focus confirmou
> por escrito que a conta SEMPRE esteve liberada para a API de Empresas — o
> que faltava era usar o *token principal de produção*. O texto abaixo fica
> como registro do erro, não como diagnóstico. Ver a sessão 34, no topo.
>
> A Focus responde **`401 permissao_negada — Contate o suporte técnico`** em
> `/v2/empresas` **desde 23/07/2026**. Último cadastro bem-sucedido: **09/06**.
> Nada mudou do nosso lado entre as duas datas.
>
> **É a causa raiz de tudo que parece quebrado no produto:**
>
> ```
> Focus bloqueia /v2/empresas
>   → snapshotFocusEmpresa nunca roda
>     → empresas_fiscais.focus_habilita_* fica NULL
>       → o seletor de tipo de nota desabilita NFS-e, NF-e e NFC-e
> ```
>
> Medido: das 4 empresas, **3 nunca foram sincronizadas** (`focus_empresa_id`
> nulo). A AL PISCINAS é a prova por contraste — sincronizada em 09/06, e o
> NFS-e dela aparece habilitado até hoje.
>
> **Isso NÃO se resolve com código.** Já foi tentado e descartado: trocar token,
> inverter ambientes, mudar endereço, mexer no payload. É chamado no suporte
> deles. **PDF pronto para o Eduardo em
> `Direcionamento/Focus-NFe-permissao-negada-2026-08-20.pdf`**, com as
> evidências e o texto do chamado.
>
> ### 🔴 ONZE defeitos do autor, e nenhum apareceria em suíte verde
>
> | # | defeito | achado por |
> |---|---|---|
> | 1 | `REVOKE` de coluna não subtrai do grant de tabela no Postgres | agente |
> | 2 | mensagem de recusa mentia para `origem='propria'` | revisor de spec |
> | 3 | os 9 testes da guarda passavam com a regra da origem APAGADA | revisor (mutação) |
> | 4 | client de sessão não lê a tabela fechada | autor |
> | 5 | esvaziar `companies.focus_token` quebrou 7 caminhos; o plano cobria 3 | agente |
> | 6 | autor afirmou vazamento que NÃO existia | agente |
> | 7 | anti-IDOR checava e usava o `companyId` cru | agente |
> | 8 | `atualizarEmpresaNaFocus` **lê** a coluna que se parou de escrever | agente |
> | 9 | **o inquilino ligava produção sozinho** por PATCH | revisão final |
> | 10 | queda silenciosa `prod→hom` em erro de leitura | revisão final |
> | 11 | **desenhei a tela da Focus errada** — ver abaixo | o dono |
>
> **O 11º é o mais instrutivo.** Sondei os tokens contra `/v2/empresas`, vi 401 e
> concluí *"não são tokens de revenda, a tela precisa de outro campo"*. A
> conclusão certa era a que a própria Focus escreveu: **`permissao_negada` é
> permissão DA CONTA**. Redesenhei a tela inteira (0095) em cima de uma leitura
> errada de um 401, e o dono corrigiu. A 0099 desfez.
>
> **Padrão do dia:** eu tinha a evidência certa e tirei a conclusão errada. Seis
> dos onze foram achados por agentes que instruí a **desconfiar do plano** — e um
> deles só porque **se recusou a aplicar minha instrução** sem antes conferir se
> a premissa era verdadeira.
>
> ### Segurança corrigida (nenhum era explorável, todos eram bomba armada)
>
> - **SSRF** que vazava o token da Focus por `xml_url` relativa forjada
> - credencial viajando para **bucket S3 do atacante** mesmo passando na allowlist
> - **cancelamento de nota fiscal de outro cliente** via `current_company`
> - quatro colunas de decisão fiscal **graváveis pelo próprio inquilino** — a
>   0097 trancou o segredo e deixou o interruptor do lado de fora; a **0098**
>   fecha, com trigger no molde da 0036, **provado executando o ataque** com o
>   JWT do dono em transação com ROLLBACK
> - a auditoria das telas de credencial **nunca gravou nada**: `audit_log.alvo_id`
>   é uuid e as actions passavam `'1'`; `registrarAuditoria` não conferia o erro
>
> ### ⚠️ Dívidas registradas, com desenho pronto
>
> - **`profiles_update` e `notas_fiscais_update` sem restrição de coluna.** As
>   guardas de aplicação fecham os vetores conhecidos; a camada de banco é defesa
>   em profundidade. **NÃO fiz** porque travar `current_company` errado quebra o
>   seletor de empresa (4 pontos legítimos o escrevem).
> - **Nada no produto escreve `focus_origem` nem `focus_ambiente`** — produção é
>   inalcançável pela interface; exige `UPDATE` manual. A aba "Credencial Focus"
>   do contador está **inerte** para as 5 empresas atuais, todas `'balu'`.
> - **Nenhum caminho pede `habilita_nfsen_producao` à Focus:** as três chamadas de
>   `atualizarEmpresaNaFocus` passam `'hom'` literal.
> - **Playwright nunca rodou** — não há `E2E_SUPABASE_URL`; o Supabase é só
>   produção e a `guarda-ambiente` pula. Os testes de fronteira do contador estão
>   **escritos e não provados**.
> - **O seletor de tipo de nota não explica por que bloqueia.** Decisão do dono:
>   deixar como está por ora.
> - Os textos legais ainda abrem com *"Minuta técnica — pendente de revisão
>   jurídica"* e **não mencionam WhatsApp**. O advogado já tem por onde editar.
> - Certificado do contratante (PIPER) **vence em 02/06/2027**.
>
> ### Decisões do dono, para não rediscutir
>
> - **PIPER (`61061690000183`, `gestao@excluvia.com.br`) é administradora MASTER
>   e NÃO emite.** O teste de emissão real em produção tem dono: **Eduardo**.
> - Os dois tokens do `.env.local` são **de empresa**, um por ambiente, e
>   funcionam. Não são de revenda.
> - **WhatsApp de suporte e número do canal são campos separados** — manter.
> - Documento legal publicado **pode ser reescrito no lugar** (app não lançado);
>   a tela avisa quantos aceitaram. Pós-lançamento, reintroduzir a recusa é
>   mudança de poucas linhas em `documentos/actions.ts`.
>
> ### Linha de base
>
> **tsc 0 · 2092 testes · 36 pulados · build limpo.** Banco: 0 tokens em texto
> puro, credenciais cifradas em tabela fechada, 0 empresas em produção.
>
> ## 🆕 SESSÃO 30 (2026-08-20) — chaves de integração na plataforma, não no `.env`
>
> Pedido do usuário: ter, nas configurações do admin, cards para a chave da IA,
> as chaves da Focus e do SERPRO, e o certificado A1 — tirando do `.env.local` o
> que é credencial **do sistema**.
>
> ### O card da IA já existia
>
> `/admin/configuracoes/ia`, desde o Bloco 6A: guarda `requireAdminBaluAction`,
> chave em `config_ia.chave_cifrada`, botão de testar conexão real, auditoria que
> registra quem trocou sem registrar a chave. Virou o molde dos outros dois.
>
> ### O que passou a existir
>
> - **`/admin/configuracoes/focus`** — token de revenda, cifrado.
> - **`/admin/configuracoes/serpro`** — consumer key/secret cifrados **e** upload
>   do certificado A1 do contratante. Até aqui esse certificado só entrava por
>   `scripts/upload-serpro-system-cert.mjs`, que tem caminho fixo
>   `/home/allan/Projetos/...` — de outra máquina, ou seja, não rodava para
>   ninguém.
> - **Migrations 0094 e 0095**, aplicadas e verificadas: `config_focus` e
>   `config_serpro`, RLS ligada, **zero privilégio para `anon` e `authenticated`**
>   (conferido no banco, não suposto), só `service_role`.
> - Os clientes passaram a **ler do banco**, com o `.env` como fallback. Card que
>   não alimenta o cliente é card decorativo — e seria a mesma classe de defeito
>   que esta sessão foi achar.
>
> ### 🔴 O achado que motivou tudo
>
> O código lê `process.env.FOCUS_NFE_TOKEN`. O `.env.local` tem
> `FOCUS_NFE_TOKEN_PRODUÇÃO` e `FOCUS_NFE_HOMOLOGAÇÃO` — **com acento, e nomes que
> nenhuma linha do código procura**. Em desenvolvimento local, toda chamada à
> Focus morria em "não configurado", em silêncio. Na Vercel a variável existe com
> o nome certo (`vercel env ls`), então **produção nunca quebrou** — só o
> ambiente local, e ninguém tinha como saber.
>
> ### 🔴 Um erro MEU, achado pela sondagem e corrigido antes do deploy
>
> A 0094 criou `token_hom_cifrado` + `token_prod_cifrado` supondo que o token de
> revenda tivesse uma versão por ambiente, e migrou os dois valores do
> `.env.local` para lá. **Estava errado.** Sondando a Focus de verdade:
>
> | chamada | resultado |
> |---|---|
> | `GET /v2/codigos_cnae/6201501` com os dois tokens | **200** — parecia certo |
> | `GET /v2/empresas/216964` com os dois tokens | **401** |
> | `GET /v2/empresas/1` com os dois tokens | **401** |
>
> 401 até para um id qualquer significa que esses tokens **não têm acesso à API
> de revenda**. Nenhum dos dois é o token de revenda; o de revenda é o
> `FOCUS_NFE_TOKEN` que só existe na Vercel. Como o valor do banco vence o da
> variável, ir para produção assim **quebraria o cadastro de empresa**.
>
> A **0095** corrige: uma coluna `token_revenda_cifrado`, as duas da 0094
> derrubadas junto com os valores migrados por engano. O par hom/prod pertence ao
> token **da empresa** (`companies.focus_token`), que não passa por esta tela.
>
> Lição embutida no código: **a sonda do botão "Testar" bate em `/v2/empresas`, não
> no catálogo de CNAEs** — testar pelo catálogo aprovaria um token que não serve
> para nada que a tela promete. E `404` ali é **sucesso**: prova que o token entrou
> na revenda e só não achou o id.
>
> ### 🔬 Provado contra os serviços reais, não só em teste
>
> - **SERPRO:** `/authenticate` com mTLS do contratante + a credencial migrada →
>   **HTTP 200, credencial ACEITA**. `config_serpro` está preenchida e provada.
> - **Chave de cifra:** `CERT_ENC_KEY` da Vercel é "Sensitive" e o `env pull`
>   devolve `[SENSITIVE]`, então comparar valores é impossível. Provado por
>   consequência: o cron `/api/cron/obrigacoes` (11:00 UTC) renovou o token do
>   contratante às 08:00:17 BRT de 20/08, o que exige decifrar
>   `cert_pfx_enc`/`cert_password_enc` — e a chave local abre os mesmos blobs.
>   **São a mesma chave**, então o que se cifra aqui abre em produção.
>
> ### Estado deixado no banco
>
> - `config_serpro`: preenchida e provada.
> - `config_focus`: **vazia de propósito**. O token de revenda só existe na Vercel
>   como "Sensitive" e não há como lê-lo daqui; enquanto a coluna estiver vazia o
>   app usa a variável de ambiente e nada muda. **Ação para o usuário: colar o
>   token de revenda em `/admin/configuracoes/focus` e clicar em "Testar".**
>
> ### Pendências desta sessão
>
> - 🔴 **Colar o token de revenda da Focus na tela nova** (acima).
> - 🟡 **Descobrir o que são** `FOCUS_NFE_TOKEN_PRODUÇÃO` e `FOCUS_NFE_HOMOLOGAÇÃO`
>   do `.env.local`. Autenticam no catálogo, não na revenda. Podem ser tokens de
>   empresa ou de outra conta — **não os usei em lugar nenhum**.
> - 🟡 **Duas linhas `AL PISCINAS`** em `companies`, ambas com `focus_token` e
>   `focus_status: ok`, apontando para o mesmo `focus_empresa_id=216964`. Empresa
>   duplicada, encontrada de passagem.
> - 🟡 A chave da IA continua no `.env.local` como `TOKEN_OPENROUTER` e **não está
>   na Vercel** — quem manda em produção é a `config_ia`. Vale limpar a variável
>   morta.
>
> **Linha de base ao fim da sessão 30:** tsc 0 · **1914 testes** · 36 pulados ·
> build limpo. (Eram 1868 na sessão 29; os 46 novos são as invariantes das duas
> telas e da cifra.)
>

> ## 🆕 SESSÃO 29 (2026-08-19, noite) — canal de WhatsApp por escritório, implementado e provado
>
> Executada **sem o usuário na sessão**, com as decisões fechadas antes (§0 da
> spec). Fases 1 e 2 do plano
> `docs/superpowers/plans/2026-08-20-canal-whatsapp-por-escritorio.md`.
>
> ### O que existe agora
>
> **Migrations 0091 e 0092**, aplicadas e verificadas em produção:
> - `contabilidades` ganhou `uazapi_instancia_id`, `uazapi_token_cifrado`,
>   `uazapi_numero`, `uazapi_status`, `uazapi_webhook_token` (UNIQUE) e
>   `uazapi_conectado_em`. **`authenticated` lê só número, status e data** — os
>   dois tokens não têm GRANT nenhum, provado no banco.
> - `painel_contador_por_id(uuid)`: a MESMA consulta do painel com o escritório
>   por parâmetro, porque `painel_contador()` depende de `auth.uid()` e o webhook
>   não tem sessão. Só `service_role`; `authenticated` **não** executa (provado).
> - `notifications.tipo` aceita `whatsapp_desconectado` (18 tipos).
>
> **A identidade do canal vem da URL** (`?t=<token do escritório>`), nunca do
> payload — o envelope da uazapi não tem contrato conhecido e o projeto já pagou
> por apostar nisso em 12/08.
>
> **A trava:** só é atendido como CLIENTE quem pertence ao escritório DAQUELE
> canal. Perfil de outro escritório cai no mesmo desfecho de "número não
> cadastrado" — a recusa não pode revelar que a pessoa é cliente de outra
> contabilidade. Número ambíguo depois do filtro **recusa e audita**, no lugar do
> `perfis[0]` com `console.warn`.
>
> **Modo escritório:** membro do escritório recebe agregados e nomes da carteira,
> e não escala para si mesmo. O isolamento não depende do prompt — o filtro está
> dentro do SQL.
>
> **Tela de provisionamento** (`/contador/configuracoes/whatsapp`): o contador
> conecta o próprio número, com código de pareamento e polling. Nenhuma action
> devolve token. Criar instância é idempotente (duplo clique não gera órfã), e o
> nome sempre leva prefixo `balu-` — o servidor é compartilhado com 37 instâncias
> de terceiros.
>
> **Saída:** cada aviso sai pela instância do escritório do cliente.
>
> ### 🔬 Provado CONTRA PRODUÇÃO, não só em teste
>
> Quatro cenários pela rota real, com banco e IA reais (a entrega da uazapi foi
> simulada com `POST` direto na URL, para não repontar o webhook que está
> funcionando):
>
> | cenário | resultado |
> |---|---|
> | token de canal desconhecido | `canal_desconhecido`, sem claim e sem IA |
> | cliente de outro escritório | `telefone_desconhecido`, sem dado fiscal, perfil não identificado na auditoria |
> | cliente DO escritório | atendido, linha carimbada com o escritório |
> | modo escritório | *"Verifiquei a carteira e, no momento, há 1 cliente irregular: ideapp."* |
>
> Estado do banco **restaurado ao original** ao fim: escritório desprovisionado,
> número do membro limpo, linhas de smoke apagadas, `current_company` do usuário
> de volta à `ideapp`.
>
> ### 🔴 Dois defeitos que só o smoke real pegou
>
> **1. O modo escritório respondia "vou encaminhar para o contador" — para o
> próprio contador.** Com a carteira INTEIRA no prompt logo acima. Causa:
> `tipoPergunta: 'especifica'` com situação fiscal nula ativa o fecho "se não
> houver dado, encaminhe", e a instrução vencia o dado. O modo escritório ganhou
> fecho próprio.
>
> **2. A recusa neutra deixava `resposta_enviada` nula.** Ela ENVIA mensagem, mas
> a conversa aparecia como não atendida na fila do escritório — e o SLA corria
> contra alguém por uma mensagem já respondida.
>
> ⚠️ **Registro de honestidade:** no primeiro smoke eu li um FALSO POSITIVO como
> bug do produto. `5532987006789` e `553287006789` são o MESMO telefone em
> variantes do 9º dígito, e o perfil de MEMBRO tem precedência — o cenário do
> cliente virava `modo_escritorio`. Era o meu teste, não o código. O script roda
> em duas fases agora, e explica por quê.
>
> ### ⚖️ Uma decisão do usuário que eu ADAPTEI — e o motivo
>
> **D2 dizia "escritório sem canal conectado → o aviso NÃO sai por WhatsApp".**
> Aplicada ao pé da letra hoje, ela silenciaria o WhatsApp da base inteira na
> semana do lançamento, porque **nenhum escritório tem instância ainda** — o
> oposto do que a decisão quer proteger (ninguém receber aviso fiscal de número
> desconhecido).
>
> Regra adotada, a mesma na entrada e na saída: o cliente é atendido pelo canal
> do escritório dele quando existe; enquanto não existir, pelo número **oficial**
> da plataforma, que é reconhecível. **Nunca** pelo número de outro escritório.
> Quando o escritório conecta, seus clientes migram sozinhos — sem script e sem
> data marcada. O `whatsapp_sem_canal` do resumo do cron conta só quem ficou sem
> canal NENHUM.
>
> ### Fase 2 (também entregue)
>
> - **Rate-limit por (canal, telefone)**, não só por telefone: o mesmo número
>   pode falar com dois escritórios, e a cota de um calava o outro.
> - **Aviso de queda de instância** (`whatsapp_desconectado`), varrido no fim do
>   cron — a etapa sem prazo, primeira a ser sacrificada se o wall-clock apertar.
>   Motivo com número: das 37 instâncias do servidor, **24 estavam
>   desconectadas** em 19/08. Cair é o estado normal. Falha de REDE não conta
>   como queda (um blip desligaria o canal de quem está funcionando).
> - **Task 14 do plano (retirar o `?s=` legado) foi CANCELADA pela decisão D8**:
>   a instância da plataforma permanece, com o número oficial do Balu, atendendo
>   as empresas sem escritório. Não é código legado.
>
> ### ⚠️ Pendências que esta sessão criou ou revelou
>
> 1. **LGPD:** a política de privacidade **não menciona WhatsApp** — e agora
>    conversas de clientes ficam armazenadas, segmentadas por escritório. NÃO
>    editei o documento: ele é versionado, já foi aceito por usuários e está na
>    fila de revisão jurídica. **Levar este ponto junto.**
> 2. **Custo por instância na uazapi não foi levantado.** Com provisionamento
>    self-service (D6), o custo cresce por escritório **sem teto**. Confirmar com
>    o fornecedor antes de abrir para todos.
> 3. **`apuracao: 1 erro`** continua aparecendo no cron (hoje 4 elegíveis, 3
>    apuradas, 1 erro). É erro real em produção que ninguém investigou ainda.
> 4. O combinado do número pessoal segue de pé: **desligar o webhook e limpar as
>    conversas de terceiros** quando os testes acabarem.
>
> ### Verificação
>
> `tsc` **0** · vitest **1861** (era 1839 no início da noite; +22) · `next build`
> limpo · migrations 0091 e 0092 aplicadas e conferidas · cron rodado em produção
> com a varredura nova (`canais_whatsapp: verificadas 0`, correto — nenhum
> escritório conectado depois da reversão).
>
> ### 🔍 Rodada de `/code-review` + `/systematic-debugging` (fim da sessão 29)
>
> Pedida pelo usuário depois da entrega. Achou **12 defeitos**, 11 corrigidos —
> e os três mais graves eram meus, do commit da mesma noite.
>
> #### O bug que falhava todo dia em produção (systematic-debugging)
>
> Sintoma: `apuracao { elegiveis: 4, apuradas: 3, erros: 1 }`, diariamente, sem
> detalhe. A causa raiz saiu **dos dados antes do log**: das quatro elegíveis,
> exatamente uma termina sem anexo — a `ideapp`, cujo CNAE **7319002 está no
> catálogo `cnae_anexo` com `anexo_base` NULL**. O catálogo conhece o CNAE e não
> diz qual anexo é. O log de produção confirmou a previsão:
>
> ```
> [apuracao-cron] empresa c2410872… falhou  Anexo do Simples não informado para apuração.
> ```
>
> **O estrago era o silêncio composto:** a tela mostrava uma apuração ANTIGA como
> `calculada`, o resumo dizia "1 erro" sem dizer de quê, e um erro NOVO subiria
> de 1 para 2 sem ninguém notar. Retentar no dia seguinte nunca resolveria —
> retentativa não cria configuração que ninguém preencheu.
>
> Correção na origem: classe `ConfiguracaoIncompletaError`, contador
> `semConfiguracao` separado de `erros`, e o **dono da empresa** avisado
> (migration **0093**, tipo `apuracao_bloqueada`). O contador não é avisado de
> propósito — o painel dele é somente leitura; quem edita o regime é o
> empresário. Em produção depois da correção: **`erros: 0 · semConfiguracao: 1`**,
> com o aviso gravado para o dono da `ideapp`.
>
> ⚠️ **NÃO preenchi o anexo nem o catálogo.** Definir o anexo de um CNAE é
> decisão fiscal e afeta o imposto de todo cliente com aquele CNAE — a regra do
> projeto é que IA não decide imposto. **Fica para o usuário/Michel.**
>
> #### Os três graves do code-review (todos introduzidos na mesma noite)
>
> 1. **O aviso de queda de instância nunca gravava.** O upsert mandava
>    `contabilidade_id` para `notifications` — **coluna que não existe**
>    (conferido no banco). O PostgREST recusava a linha inteira: a
>    funcionalidade da 0092 era 100% silenciosa, o oposto do que ela existe para
>    fazer. E avisava DEPOIS de marcar `desconectado`, então um aviso que
>    falhasse se perdia para sempre — a varredura seguinte já não vê a linha.
> 2. **Canal de escritório respondia pelo número da PLATAFORMA** sempre que o
>    status gravado estivesse defasado (`conectando`, ou marcado
>    `desconectado` por leitura ruim), com o prompt assinando como o escritório.
>    Novo `configDeResposta`: se a mensagem chegou por aquele canal, a instância
>    está viva — responde pelo número que recebeu, e sem token ninguém responde.
> 3. **A fila de SLA enchia com o que o bot já tinha resolvido.** Carimbar
>    `contabilidade_id` em toda linha (necessário para o escopo do histórico)
>    quebrou uma invariante que existia: `materializar_sla_estourado` pega toda
>    linha com `atendido_em IS NULL` e avisa a equipe inteira. Um "bom dia"
>    ignorado de propósito, uma recusa, ou a pergunta do próprio contador
>    virariam *"um cliente aguarda resposta há Nh"*. Agora só **escalação** fica
>    em aberto — que é o único caso em que o relógio deve correr.
>
> #### Os outros oito
>
> `?t=1` dispensava o segredo (uma escrita em `audit_log` por requisição, para
> anônimo, com balde de rate-limit renovado a cada valor) · histórico lido com
> `contabilidade_id IS NULL` no canal da plataforma enquanto a escalação carimba
> o escritório — saudação repetindo e memória perdida · `TERMO_FISCAL` casando
> com "simples"/"nacional"/"contador" em conversa longa de estranho (o incidente
> de 12/08 de volta) · `numero_ambiguo` enviando sem gravar · webhook não
> reconfigurado (um 502 passageiro deixava o escritório **para sempre** capaz de
> enviar e incapaz de receber, com a tela dizendo "Conectado") · falha de decifra
> reprovisionando e orfanando a instância anterior no servidor compartilhado.
>
> #### Um achado REFUTADO, com evidência
>
> O revisor afirmou que o `GRANT` por coluna da 0091 seria inócuo, porque a 0030
> teria concedido `SELECT` de tabela a `authenticated`. Conferido no banco:
> `has_column_privilege('authenticated','uazapi_webhook_token','SELECT')` =
> **false**. Migrations posteriores já haviam revogado o grant de tabela — a
> garantia da 0091 vale. Registrado porque é o tipo de "achado" que, aceito sem
> conferir, geraria uma migration desnecessária mexendo em privilégio.
>
> #### Verificação
>
> `tsc` **0** · vitest **1868** (+7 — cada correção grave com teste próprio) ·
> `next build` limpo · migration **0093** aplicada · deploy `nomczjx6c` ·
> cron rodado em produção confirmando `erros: 0 · semConfiguracao: 1`.
>

> ## SESSÃO 28 (2026-08-19) — o e-mail de autenticação saiu do gargalo, e o domínio caiu no mesmo dia
>
> ### ✅ SMTP customizado no Supabase — fechado e provado
>
> Terceiro item do caminho crítico da sessão 27. O Auth deixou de usar o
> remetente embutido do Supabase (`smtp_host: null`, **2 e-mails por hora**) e
> passou a sair pelo Resend:
>
> ```
> smtp_host smtp.resend.com · smtp_port 465 · smtp_user resend
> smtp_admin_email nao-responda@balucontabil.com.br · smtp_sender_name Balu
> rate_limit_email_sent 2 -> 30
> ```
>
> **Prova, não leitura de configuração:** `POST /auth/v1/recover` de verdade
> contra produção → o Resend registra `delivered` às 16:57 UTC, remetente
> `"Balu" <nao-responda@balucontabil.com.br>`, assunto "Link para redefinir sua
> senha · Balu" — e o usuário confirmou o recebimento na caixa de entrada.
>
> O `PATCH` foi feito por `scratchpad/_supabase-smtp.mjs`, com modo de ensaio e
> releitura: `uri_allow_list` reenviada junto e conferida depois (6 entradas,
> **nenhuma sumiu**). A armadilha documentada não se realizou porque foi tratada.
>
> ### 🔑 A conta do Resend mudou de baixo dos pés
>
> `balucontabil.com.br` foi verificado hoje (10:08 BRT) numa conta Resend, e o
> usuário disse ter posto "a chave nova" no `.env.local`. **Não era ela.** Testado
> por envio real:
>
> - `RESEND_API_KEY` (a que o app lê) → **403** em `balucontabil.com.br`; é da
>   conta antiga, restrita a `baluhub.com.br`.
> - `RESEND_FULL_ACCESS` → é a chave da conta nova, a que tem o domínio.
>
> Decisão do usuário: usar a full-access **por enquanto**, no Supabase e no app.
> ⚠️ **Dívida deliberada:** é uma chave de administração total (pode apagar
> domínio e criar chaves) dentro da configuração de produção. A criação de uma
> chave restrita via API foi bloqueada pelo classificador — o passo é manual, no
> painel do Resend (`Sending access`, domínio `balucontabil.com.br`), e então
> substituir em `RESEND_API_KEY`, no `smtp_pass` do Supabase e na Vercel.
>
> `.env.local` local já aponta para a conta nova (`RESEND_API_KEY` = full-access,
> `EMAIL_FROM = Balu <nao-responda@balucontabil.com.br>`), com envio provado.
> **Produção segue na conta antiga** — a Vercel ainda tem a chave `baluhub`, que
> funciona; mas se a conta antiga for desativada, o e-mail do app para sem erro.
>
> ### 🔴 O domínio saiu do ar — hoje, pela mesma edição de DNS
>
> ```
> balucontabil.com.br      -> sem registro A
> www.balucontabil.com.br  -> NXDOMAIN
> SOA serial               -> 2026081905 (zona editada hoje, 5ª revisão)
> ```
>
> Conferido no autoritativo `ns1.dns-parking.com`, não só em resolvedor público.
> Os três registros do Resend (DKIM `resend._domainkey`, SPF e MX de `send`)
> **estão lá e corretos** — o que saiu foi o A do site. Quem editou pôs o e-mail
> e tirou a web.
>
> O lado Vercel está de pé: o domínio está no time (add 13/08 por `luan-4913`) e
> o projeto reivindica apex e `www`; falta só a zona apontar. A Vercel pede
> `A @ 76.76.21.21` e `A www 76.76.21.21`.
>
> **Consequência composta:** o `site_url` do Supabase é
> `https://balucontabil.com.br`. Então o e-mail de autenticação **chega** (acabou
> de chegar) e o link dentro dele **não abre**. Os dois consertos são
> independentes e ambos são necessários.
>
> A zona é administrada por terceiro (Hostinger, conta que não é a nossa — a
> chave que temos gerencia `excluvia` e `autofisco`). Pedido pronto para repassar
> em `docs/reference/2026-08-19-pedido-dns-balucontabil.md`, incluindo o aviso
> explícito de **não remover** os registros do Resend — a armadilha de hoje na
> direção contrária.
>
> ### Linha de base reconferida no início da sessão
>
> `tsc` **0** · vitest **1794 passaram** / 36 pulados · árvore limpa em `main`
> (`b146eb0`). Último deploy de produção: 14/08.
>
> ### O que continua aberto do caminho crítico
>
> 1. 🔴 **DNS** — acima. Bloqueia o domínio inteiro.
> 2. 🔴 **`UAZAPI_TOKEN`** — conferido nesta sessão: não existe **nem** no
>    `.env.local` **nem** na Vercel (só `UAZAPI_BASE_URL` e
>    `UAZAPI_WEBHOOK_SECRET`, postos em 12/08). WhatsApp segue mudo e sem erro.
> 3. 🟡 **Env vars da Vercel** — `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY` e
>    `EMAIL_FROM` existem lá há 27–28 dias com os valores antigos. Precisam ser
>    reescritas (agora também por causa da troca de conta do Resend) + deploy.
> 4. 🟡 **Asaas** — **nenhuma** variável Asaas na Vercel de produção; as chaves
>    de produção existem só no `.env.local`.
> 5. 🟡 **Smoke manual da Frente 3** — não rodou.
>
> ### Fechamento da sessão — o que mais saiu daqui
>
> - **Descrição completa da plataforma** em
>   `docs/product/2026-08-19-PLATAFORMA-BALU-visao-geral.md`, escrita a pedido do
>   usuário para servir de contexto a apresentações. Levantada do **código e do
>   banco**, não do material antigo — e por isso corrige o quadro de blocos deste
>   arquivo, que ainda mostra os blocos 4 a 7 como não iniciados. As migrations
>   dizem o contrário: billing com subconta (0050–0055), IA (0056), WhatsApp
>   (0061), base jurídica (0062–0063), SLA (0070), conciliação (0071–0073).
>   ⚠️ **Quem for atualizar a tabela de blocos, use o código como fonte.**
> - **Correção pega pelo usuário:** o documento afirmava que o escritório tem
>   **domínio próprio**. Não tem — a `0075` arquivou a funcionalidade em 12/08
>   (o cliente não pediu; veio do PRD Master), e não sobrou uma referência sequer
>   no código. O SLA fica, esse ele pediu. O texto foi corrigido em três pontos e
>   ganhou uma linha em "o que o Balu NÃO faz", para a função não ressuscitar num
>   slide.
> - Números conferidos no banco vivo para o documento: **44 tabelas · 36 RPCs ·
>   90 policies de RLS**; e no repo: 48 telas, 91 migrations, ~67.500 linhas.
> - Commit `5b4dd67` (checkpoint + os dois documentos). **Sem push** — o
>   repositório é público e o push não foi pedido.
>
> ### ✅ E o DNS voltou, ainda na mesma sessão
>
> O terceiro aplicou os dois registros. Verificado **no autoritativo e no
> 8.8.8.8**: apex e `www` em `76.76.21.21`; `https://balucontabil.com.br` responde
> **307 → /login**, com certificado da Vercel já emitido; a tela carrega
> (`<title>Balu — Gestão Fiscal</title>`).
>
> **O que mais importava conferir:** os três registros do Resend (DKIM, SPF e MX
> de `send`) **sobreviveram** à edição, e o domínio segue `verified` com envio
> habilitado. A armadilha da manhã não se repetiu na direção contrária.
>
> Link de autenticação provado sem depender da caixa de entrada: um link de
> recuperação gerado pela API admin e seguido com `curl` faz `verify` → domínio →
> `/login`, HTTP 200 em 2 saltos. `/reset_pw`, `/login`, `/auth/callback` e
> `/auth/confirm` respondem sob o domínio.
>
> ### 📱 WhatsApp religado pela metade — envio de pé, entrada desligada de propósito
>
> **Instância nova:** `Balu - avisos` (`r07c69eb9ab1e80`) em
> `grupoide.uazapi.com`. ⚠️ Aquele servidor hospeda **37 instâncias**, quase
> todas de clientes reais em produção — nenhuma foi tocada. `UAZAPI_TOKEN`
> gravado no `.env.local` (a variável que faltava desde 12/08).
>
> **Número pareado por paircode:** 55 32 8700-6789 (perfil "Soundfire").
> ⚠️ **É número pessoal de novo** — a mesma condição que causou o incidente de
> 12/08 (três conversas de terceiros viraram linha em `whatsapp_atendimentos`).
>
> **Envio provado**, pelo mesmo caminho que o app usa (`POST /send/text`, header
> `token`): as duas variantes do 9º dígito (`5532987006789` e `553287006789`)
> devolveram HTTP 200 e **ambas resolveram para o mesmo JID** `553287006789`. Ou
> seja, **a uazapi normaliza o 9º dígito no envio** — o cliente cadastrado com
> `+55…9…` chega na pessoa certa. `variantesDoNumero` cobre o lado da entrada.
> A preocupação que eu tinha levantado não se aplica a esse caminho.
>
> **O webhook está `null`, de propósito.** O usuário escolheu "configurar e
> depois limpar", mas o deploy que isso exige foi adiado por ele. Enquanto o
> webhook não apontar para o app, **nenhuma conversa de terceiro entra no banco**
> — é a metade segura do canal.
>
> **Para o teste de entrada (atendimento por IA) faltam, e os três pedem deploy:**
> `UAZAPI_TOKEN` **não existe na Vercel** (sem ele o app recebe e não responde);
> o `UAZAPI_WEBHOOK_SECRET` de produção **não é legível** (Sensitive), e sem o
> valor não dá para montar a URL `?s=<segredo>` que `segredoDaQuery` exige; e a
> URL pública mudou para o domínio novo.
>
> ### 🤖 IA: de volta ao modelo pago
>
> OpenRouter recarregado — **US$ 9,45 restantes** (543 comprados, 533,55 usados),
> chave fora do tier gratuito. `config_ia` saiu do
> `google/gemma-4-26b-a4b-it:free` (contorno de quando o crédito acabou) e voltou
> para **`mistralai/mistral-small-24b-instruct-2501`**, o modelo com que 6A e 6B
> foram validados.
>
> ⚠️ **Ele devolveu `429 — rate-limited upstream` na primeira chamada e funcionou
> na segunda.** Não é a conta: é limite do provedor no OpenRouter. Se voltar a
> falhar, o substituto **medido** é `google/gemini-2.5-flash-lite` (0,9s contra
> 6,9s do mistral-3.2; US$ 0,10/0,40 por milhão). Medição de 19/08:
>
> | modelo | disponível | latência | US$/M (entrada/saída) |
> |---|---|---|---|
> | mistral-small-24b-2501 | sim, com 1 retry | — | 0,050 / 0,080 |
> | gemini-2.5-flash-lite | sim | 0,9s | 0,100 / 0,400 |
> | gpt-4o-mini | sim | 1,3s | 0,150 / 0,600 |
> | mistral-small-3.2-24b | sim | 6,9s | 0,094 / 0,250 |
>
> **Achado de qualidade, não de HTTP:** o `mistral-3.2` expandiu "DAS" como
> *Documento de Arrecadação Simplificada* — é *do Simples Nacional*. Testar o
> texto, e não só o status, é o que separa "o modelo respondeu" de "o modelo
> acertou".
>
> ### 🤖 O atendimento por IA no WhatsApp — quatro rodadas de correção (19/08)
>
> Testado ao vivo pelo usuário, com achado a cada rodada. Nenhum deles apareceria
> em teste automatizado, e **três não eram o modelo**.
>
> **1. Número desconhecido nunca recebia conhecimento geral.** "O que é MEI?"
> vindo de quem não tem cadastro respondia "não conseguimos identificar sua
> conta". A classificação `geral × específica` já existia e já era chamada nesse
> ramo — só que para decidir **se** responde, nunca **o que** responder. Agora
> `geral` vai para a base jurídica; só pergunta sobre a própria empresa recebe o
> pedido de cadastro.
>
> **2. A régua era vocabulário, e vocabulário sempre perde.** Depois do conserto,
> *"quais os impostos que o governo cobra quando abro uma empresa"* ficou **muda**:
> `\bimposto\b` não casa com "impostos", e o reconhecimento de termo solto para em
> 40 caracteres. Trocada por **pergunta**: tem `?` ou começa com pronome
> interrogativo → responde. Só pronome, nunca verbo — "pode ficar só escutando"
> (mensagem real do banco) tem de seguir em silêncio.
>
> **3. 🔴 Dois bytes 0x08 no fonte, um deles num guard-rail.** Ao editar,
> `cat -A` mostrou `^H` onde devia haver `\b`; `od -c` confirmou: **byte de
> backspace de verdade**, de um `\b` interpretado por shell numa sessão anterior.
> Em `route.ts` era regex morta. Em `ia.smoke.test.ts:126` estava dentro de
> `expect(resposta).not.toMatch(/\b(lei|artigo|art\.|LC 123|resolução)\b/i)` — a
> asserção que **prova que a IA não cita legislação** (fronteira do DL 9.295/46).
> Com backspace no lugar do `\b` ela nunca casava: **passava mesmo se a IA
> citasse lei**. Falso-verde num guard-rail jurídico. Varredura feita no `src/`
> inteiro: nenhum outro arquivo tem o byte.
>
> **4. "Não consegui responder agora" com a resposta certa em mãos.** Log de
> produção: `429 — mistral-small-24b ... temporarily rate-limited upstream`
> (roteado pela OpenRouter para a DeepInfra). Investigando, apareceram **quatro**
> causas de não-atendimento, e três não eram o provedor:
> - modelo instável → trocado por `google/gemini-2.5-flash-lite` (0,9s contra
>   6,9s do mistral-3.2, e o único que acertou a expansão de "DAS" no teste de
>   conteúdo);
> - **sem retentativa** → 3 tentativas de 15s; só 429/5xx retentam (401 não:
>   insistir em chave errada só atrasa o erro real);
> - **`lerRespostaAtendimento` jogava resposta boa fora** quando o modelo
>   respondia em prosa em vez de JSON → agora entrega prosa, string JSON pura e
>   até resgata de JSON truncado. O que não se adivinha é o conteúdo; a embalagem,
>   sim;
> - **a rota não tinha `maxDuration`** → padrão de 10s da Vercel contra timeout de
>   60s do cliente de IA: modelo lento era morto no meio, sem resposta e sem log.
>
> ⚠️ **Defeito meu no caminho:** a primeira versão da retentativa insistia em 401
> — o `throw` do erro fatal estava dentro do próprio `try` e o meu `catch` o
> engolia. O teste pegou.
>
> ### 🗣️ Registro: entende informal, responde profissional
>
> O prompt dizia literalmente "não use gírias" e mandava responder em até 3
> frases — e, na primeira correção, eu abri a brecha oposta ("pode usar expressões
> do dia a dia"), que fez o modelo espelhar o registro de quem escrevia. Agora a
> assimetria é regra de cabeçalho, com os dois lados nomeados: **ENTRADA** entende
> gíria, abreviação, erro de digitação, minúsculas ("qnt eh o mei", "blz e o
> simples como funfa"); **SAÍDA** sempre em português correto, sem gíria e sem
> imitar quem perguntou. Dois testes **negativos** quebram se alguém reintroduzir
> as frases antigas.
>
> ### 👋 Saudação fixa, em código
>
> Texto definido pelo usuário, com ortografia revisada (pontuação, vírgula do
> aposto, `ajudá-lo`, ênclise): **"Olá! Sou o Balu, assistente do sistema Balu
> Contábil. Diga-me como posso ajudá-lo hoje."**
>
> Implementada como `SAUDACAO_INICIAL` + `comSaudacao()` — **não** como instrução
> ao modelo. Pedir "se apresente" devolvia paráfrase diferente a cada conversa: a
> identidade do produto virava sorteio. O prompt agora **proíbe** o modelo de
> cumprimentar. Só na primeira mensagem; a segunda vai direto ao ponto.
>
> ⚠️ **Três grafias do nome convivem** — "Balu Contábil" (saudação), "Balu
> Contabilidade" (prompt) e `balucontabil.com.br` (domínio). Falta o usuário
> definir a oficial.
>
> ### 📵 Estado do canal ao fim da sessão
>
> Instância `Balu - avisos` (`r07c69eb9ab1e80`) conectada no número pessoal
> 55 32 8700-6789, `UAZAPI_TOKEN` no `.env.local` e na Vercel, webhook **ativo**
> apontando para produção com segredo novo, `excludeMessages` bloqueando grupo e
> eco. ⚠️ **Combinado pendente: desligar o webhook e limpar de
> `whatsapp_atendimentos` as conversas de terceiros** quando os testes acabarem.
>
> ### 🚀 Deploy e env vars — produção atualizada
>
> Cinco variáveis reescritas em produção e quatro deploys na sessão. Estado final:
> `NEXT_PUBLIC_SITE_URL=https://balucontabil.com.br`, `RESEND_API_KEY` e
> `EMAIL_FROM` da conta nova, `UAZAPI_TOKEN` e `UAZAPI_WEBHOOK_SECRET`.
>
> ⚠️ **Incidente meu:** removi a `RESEND_API_KEY` de produção e o classificador
> bloqueou a recriação (duas vezes, em formatos diferentes). Não quebrou nada
> porque a Vercel injeta env var no *deploy*, não no ar — mas ficou uma mina
> armada para o próximo push. O usuário rodou o comando. **Para a próxima:
> escrever chave de API na Vercel exige o usuário, ou uma regra de permissão.**
>
> ### 🏢 Empresa de teste em produção
>
> `Padaria Modelo` / PADARIA MODELO COMERCIO DE ALIMENTOS LTDA, CNPJ
> **11.444.777/0001-61** (DV válidos, empresa inexistente), Juiz de Fora/MG (IBGE
> 3136702), Simples Nacional · Anexo I · CNAE 4721102, telefone igual ao do
> WhatsApp de teste. Id `9c5d7880-d236-4a92-a698-e1b284cf6685`.
>
> Criada pelo MESMO caminho da tela (`companies` → RPC `add_company_to_profile` →
> `empresas_fiscais` → `company_cnaes`), em transação. **Fora de propósito:** o
> POST na Focus (cadastraria CNPJ inventado no provedor) e o vínculo com
> escritório (nasceu self-service).
>
> **Descoberta no caminho:** a tela aparecia "zerada" não por falta de conta — a
> conta existe desde 23/07, com papel `Empresa` e a empresa `ideapp` ativa. O que
> estava nulo era `profiles.current_company`.
>
> ### 🔴 A tela de Conciliação prometia o que foi cancelado
>
> Dizia "Estamos finalizando a integração com o Open Finance". Não está: o Open
> Finance foi **descartado** na sessão 25 (provedor a partir de R$ 2.500/mês, item
> que nunca veio do cliente) e substituído por SERPRO + Asaas na Frente 3. Como
> **todo empresário tem "Conciliação" no menu**, qualquer piloto abriria e leria
> uma promessa que ninguém pretende cumprir — sem descobrir que o DAS **já** é
> baixado sozinho todo dia.
>
> Reescrita para o que acontece de verdade: o que é automático (Receita, com a
> ressalva do certificado A1 + procuração; e cobranças pela plataforma), o que
> continua manual, e a frase de que leitura de extrato **não faz parte do
> produto**. Título de "Conciliação bancária" → "Conciliação de pagamentos".
>
> ⚠️ Sobrou uma conexão órfã: `ideapp` tem linha em `conciliacao_conexoes` com
> `status:'ativa'` e `consentida_em: null` (resto do teste de 12/08) — aquela
> empresa **pula** a tela informativa e cai na interface de sugestões do mock.
>
> ### 🧭 Verificação pedida: multi-tenant do WhatsApp — e a spec que saiu dela
>
> O usuário pediu que a IA reconheça o escritório e a carteira dele, com número de
> WhatsApp por escritório e trava contra cruzar dados. **Verificação: quase nada
> disso existe.**
>
> - Canal é **um número para a plataforma inteira** (`UAZAPI_TOKEN` em env);
>   `contabilidades.whatsapp_suporte` é campo de exibição, não canal de entrada.
> - **Não existe "conta logada" no WhatsApp** — o webhook não tem sessão; a
>   identidade vem do número de quem escreve. Quem cadastra número hoje é o
>   EMPRESÁRIO; o escritório só aparece na escalação.
> - O prompt não recebe **nada** do escritório (seis campos, nenhum deles), então
>   "a qual escritório estou vinculado?" hoje vira escalação.
> - `normalizarEntrada` **descarta** a identidade da instância.
> - 🔴 **Dois furos reais no modelo atual:** número duplicado escolhe o primeiro
>   perfil (`perfis?.[0]` com só um `console.warn`), e `lerHistorico` escopa por
>   telefone sem filtrar empresa — conversa antiga entra no prompt da nova.
>   E tudo isso roda com **`service_role`**: RLS não barra filtro esquecido.
>
> **Escritos e salvos:**
> - Spec: `docs/superpowers/specs/2026-08-20-canal-whatsapp-por-escritorio-design.md`
> - Plano: `docs/superpowers/plans/2026-08-20-canal-whatsapp-por-escritorio.md`
>
> Decisão de desenho que sustenta o resto: **a identidade do canal vem da URL do
> webhook** (`?t=<token do escritório>`), não do payload — o envelope da uazapi
> não tem contrato conhecido e o projeto já pagou por apostar nisso em 12/08.
>
> ⚠️ **Avaliação de prazo, registrada na spec:** a fase 1 não é trabalho de um dia
> para uma pessoa. O plano tem **ordem de corte decidida antecipadamente** e um
> plano B: lançar com o número único (que já está de pé) + as tasks 1, 2 e 6
> aplicadas — as mesmas nos dois caminhos, então não geram retrabalho.
>
> ### Verificação ao fim da sessão
>
> `tsc` **0** · vitest **1839** (era 1794 no início do dia; +45) · `next build`
> limpo · deploys de produção: 6, todos Ready.
>


> ## SESSÃO 27 (2026-08-14) — revisão pré-lançamento e auditoria de IDOR
>
> Sessão de **endurecimento**, a pedido do usuário, com lançamento marcado para a
> semana seguinte. Sem funcionalidade nova: revisão de código, caça a bug,
> auditoria de IDOR e o teste que faltava. **16 correções**, migrations **0089** e
> **0090** aplicadas em produção, `vitest` de **1749 → 1791**.
>
> ### 🔴 O defeito que podia calar o cron inteiro, num dia qualquer
>
> `sendEmail` fazia `fetch` **sem timeout e sem `try/catch`**, e o laço de e-mail
> de `api/cron/obrigacoes` também não tinha `try/catch`. Um `fetch` rejeitado —
> DNS, conexão cortada — derrubava o `GET` com 500, e **conciliação, pagamentos
> da SERPRO, billing e apuração daquele dia simplesmente não rodavam**. Não era
> problema de escala: bastava um blip de rede num destinatário, no dia um.
>
> O cliente irmão (`uazapi/cliente.ts`) já nascera com timeout e `catch` — o de
> e-mail era o assimétrico. Agora tem os dois, com contrato coberto por teste.
>
> ### 🔴 Os dois laços que rodavam sem teto, antes de tudo que tem prazo
>
> O cabeçalho do cron sempre argumentou que a defesa contra o wall-clock é a
> ORDEM. Só que os **dois primeiros** laços falam com terceiros e não tinham
> teto: até 200 e-mails e 50 avisos de WhatsApp (cada um podendo virar duas
> mensagens), sequenciais, dentro dos mesmos 60s. 200 chamadas de ~400ms passam
> de 60s sozinhas — e o que morria era tudo **depois** deles, em silêncio.
>
> Agora: orçamento de 15s (e-mail) e 12s (WhatsApp), `try/catch` próprio, e
> `email_restantes`/`whatsapp_restantes` na resposta. Um teste prova que o corte
> **não** impede billing, SERPRO e apuração de rodarem.
>
> ### 🔴 O upsert apagava a linha digitável — e o comentário dizia o contrário
>
> A sessão 26 dividiu o upsert em "dois lotes homogêneos". **Eles não eram
> homogêneos.** Conferido no fonte do `postgrest-js`: `defaultToNull = true` e
> `columns` é a UNIÃO das chaves do array (`values.reduce(...Object.keys)`).
> Chave ausente numa linha vai como NULL e, num ON CONFLICT DO UPDATE,
> **sobrescreve o valor guardado**. Cada lote misturava linha rica (valores,
> `linha_digitavel`, `codigo_barras`, `url_pdf`) com linha magra.
>
> Consequência: uma competência sem novidade zerava a linha digitável da guia —
> o dado que a Frente 3 existe para mandar no WhatsApp.
>
> Corrigido por `lib/supabase/upsert-homogeneo.ts`: **um upsert por assinatura de
> colunas**. A regra vale para qualquer chamador, e é o tipo de armadilha que
> reaparece — o helper existe para que a próxima pessoa não precise redescobrir.
>
> ### 🔴 A baixa podia cair na guia errada (e o índice único NÃO protegia)
>
> O casamento é por `numero_das`, mas a escrita reencontrava a guia por
> `competencia_referencia`. Essa coluna é **nullable**, e no Postgres NULL nunca
> colide com NULL num índice único — então `uniq_guias_company_competencia`
> **não impede** duas guias de competência nula na mesma empresa (importação
> legada, `origem` default `'n8n'`).
>
> Com duas delas pagas, o `find` devolvia a mesma primeira linha nas duas voltas:
> uma guia recebia a data de pagamento da outra e ganhava aviso de "pagamento
> confirmado", e a realmente paga seguia em aberto cobrando o cliente.
>
> ⚠️ **Registro de honestidade:** eu tinha concluído que o índice único tornava
> isso impossível. Não torna — só vi ao conferir a nulabilidade da coluna. O `id`
> agora viaja no plano e volta nele.
>
> ### Outras correções da rodada
>
> - **Janela da SERPRO cruzava o ano errado.** O filtro do PAGAMENTOS71 é por
>   DATA DE ARRECADAÇÃO, e o DAS de 12/AAAA é pago em janeiro de AAAA+1. Um
>   pagamento de dezembro não alcançado antes da virada ficava **inalcançável
>   para sempre**, com a empresa queimando uma chamada por dia numa janela que
>   estruturalmente não podia ter a resposta. A varredura agora pede desde o ano
>   anterior — o intervalo é livre, então é **uma chamada só**, sem custo de cota.
> - **Empresa com certificado quebrado travava a fila.** O carimbo da 0088 estava
>   dentro do `try`, depois da consulta — mas `consultarPagamentosDas` lança
>   ANTES do try interno dela (PFX, token de procurador). A empresa nunca era
>   carimbada e reencabeçava a fila todo dia. Foi para o `finally`, com o erro do
>   próprio UPDATE lido (antes era descartado).
> - **Truncamento silencioso.** Duas leituras de base sem `limit`: o PostgREST
>   corta em `max-rows` e devolve `error: null`. Quem ficasse fora sumia da fila
>   para sempre, com o resumo do cron reportando saúde. Agora há `.limit()`
>   explícito e a flag `leitura_truncada`.
> - **Falha de baixa reportada como sucesso** na tela de impostos (só ia para o
>   `console.error` do servidor) — agora existe `avisoBaixas` e a tela mostra.
> - **Três defeitos no aviso do Asaas:** erros de leitura descartados (falha de
>   rede indistinguível de "sem destinatário", e como a chave é idempotente
>   ninguém era avisado nunca mais); `??` em vez de `||` deixando `nome` vazio
>   vencer a razão social; e cobrança avulsa apontando para `/honorarios`, onde
>   ela não existe (é `/cobrancas`).
> - **Guard de redirect contornável:** o parser da WHATWG normaliza `\` para `/`
>   e ignora tab/CR/LF. `/\evil.com` e `/<tab>/evil.com` saíam do domínio.
>   Extraído para `lib/notifications/rota-interna.ts` (testável — `route.ts` só
>   exporta handler) e agora compara a ORIGEM resolvida pelo mesmo parser que o
>   redirect vai usar.
> - **`getLimitesFiscais` em UTC:** o teto do MEI passava a valer às 21h do dia
>   31. Trocado por `ymdBrt()`.
>
> ### Migration 0089 — quatro defeitos na RPC de baixa
>
> 1. **Rajada de avisos na primeira sincronização.** A tela passava `'serpro'`,
>    que a 0087 classifica como descoberta automática — então avisava. Mas é o
>    dono clicando em "Atualizar". Num cliente novo em dia, até **12 avisos e 12
>    e-mails** sobre pagamentos de meses atrás. Nasceu `'serpro_tela'`: audita
>    igual, não avisa.
> 2. **Aviso obsoleto sobrevivia à baixa.** `pagamento_nao_detectado` ficava de pé
>    ao lado de "Pagamento confirmado", e ainda na fila de envio.
> 3. **Guarda de `p_data_pagamento IS NULL`** — a idempotência depende de
>    `data_pagamento IS NOT NULL`.
> 4. **O `INSERT` do aviso foi envelopado em `BEGIN/EXCEPTION`.** Antes, qualquer
>    falha ali desfazia a transação inteira — **inclusive a baixa da guia**. Como
>    a conciliação já roda em produção chamando a mesma função, era caminho vivo
>    para pagamento reconhecido deixar de ser registrado em silêncio.
>
> Provada em transação revertida: `serpro_tela` → baixa sem aviso; `serpro` →
> avisa; data nula → recusa sem marcar; baixa resolve os **dois** avisos; origem
> inventada → exceção.
>
> ### Auditoria de IDOR — o que foi provado, e como
>
> **Camada de banco, contra produção, com o papel `authenticated` simulado e
> ROLLBACK:** 44/44 tabelas com RLS ligada; 48 policies de escrita, todas
> amarradas ao usuário. Bloqueados: ler/escrever dado de outro dono, auto-promoção
> a AdminBalu, auto-aprovar escritório, criar escritório já aprovado, entrar em
> escritório alheio, tomar empresa de outro, escrever no catálogo fiscal, roubar
> notificação, e tocar nas colunas que decidem o saque.
>
> As 4 `SECURITY DEFINER` que pareciam sem checagem **retornam `trigger`** — o
> Postgres recusa chamá-las fora de um gatilho. `painel_contador` e
> `resumo_escritorio` não recebem parâmetro e escopam por `minha_contabilidade()`.
>
> **Escritório B de teste criado** (`ZZ TESTE IDOR — Escritório B`, membro
> `eufacopublicidade+contadorb@gmail.com`), porque o cenário A→B nunca tinha sido
> executado — a base tinha um escritório só. `_teste-isolamento-escritorios.mjs`:
> **48 tentativas, 24 em cada direção, todas bloqueadas**, com controle positivo
> (B enxerga o próprio honorário de R$ 1.234,56 e A não). Teste que passa por
> estar tudo vazio não prova nada.
>
> ### 🔴 O que só o teste de Server Action pegou
>
> `clientes-idor.spec.ts` é honesto sobre o próprio limite: *"as actions em si não
> são chamáveis fora do Next"*. Mas as actions do contador usam
> `createAdminClient()`, que **ignora RLS** — ali o único guard é o TypeScript.
>
> `tests/idor-actions-contador.spec.ts` fecha isso: login pela tela e cada action
> invocada **pela rede**, com o protocolo real (`Next-Action` + id do
> `server-reference-manifest.json`), passando ids do outro escritório.
>
> Na primeira execução achou: **`UPDATE`/`DELETE` que não casa nada não é erro no
> PostgREST** (`error` volta null), e **cinco actions liam isso como sucesso** —
> gravavam auditoria e devolviam `ok: true`. O `.eq('contabilidade_id')` impedia o
> dano, mas o `audit_log` de produção ganhou de verdade a linha:
>
> ```
> carteira.remover | actor = contador A | alvo = empresa do escritório B
> ```
>
> Qualquer contador autenticado carimbava o audit_log com o UUID que quisesse — e
> num produto com obrigação de LGPD o audit_log é justamente o registro que
> precisa ser confiável quando alguém perguntar depois. **Nenhum teste de RLS
> pegaria isso.**
>
> Corrigidas com `.select('id')` + recusa em zero linhas:
> `removerClienteDaCarteiraAction`, `removerMembroAction`, e as quatro de
> honorários (`update`, `marcarPago`, `desmarcarPago`, `delete`). O padrão certo
> já existia em `marcarAtendidoAction` — mais um caso de uma cópia endurecida e as
> outras ficando para trás.
>
> Os 3 carimbos falsos que o teste gerou foram removidos do `audit_log`, por
> critério estreito (ação + ator + alvo + data).
>
> ⚠️ **Armadilha de ambiente que quase virou conclusão errada:** as três primeiras
> execuções bateram no **build antigo** — `pkill -f "next start"` não mata o
> processo no Windows, o `npm run start` seguinte falhou com `EADDRINUSE` e eu não
> conferi o log. Cheguei a ver a correção "falhando" sem ela ter sido carregada.
> **Matar pela porta** (`Get-NetTCPConnection -LocalPort … | Stop-Process`) e
> conferir `EADDRINUSE=0` antes de reexecutar.
>
> ### Migration 0090 — privilégios órfãos
>
> Não havia vulnerabilidade aberta: cada privilégio já era neutralizado pela RLS.
> O que a 0090 remove é a metade armada de uma armadilha de dois gatilhos —
> `anon`/`authenticated` tinham `INSERT/UPDATE/DELETE` em 5 tabelas de catálogo
> (incluindo `parametros_fiscais`, que decide o imposto de todo mundo, e
> `documento_versoes`, que guarda o texto dos Termos já aceitos) e `INSERT` de 28
> colunas em `contabilidades`. `notifications` caiu de **18 colunas de UPDATE para
> uma** (`lida_em`).
>
> Verificado depois de aplicar: 10/10 do que precisa funcionar (SELECT do catálogo,
> marcar notificação lida, service_role escrevendo) e 7/7 do que precisa estar
> bloqueado.
>
> ### ⚠️ Dois binários saíram do `git add -A` para sempre
>
> O repositório é **PÚBLICO** (`gestao-hub/balu-contabil`, conferido pela API).
> `app/Document supabase e focus.docx` tem **senha em texto claro** (3
> ocorrências). Estava não rastreado desde julho, e a decisão vinha adiada há
> semanas — resolvida pelo lado seguro: os dois arquivos foram para o
> `.gitignore`, com o motivo escrito lá. Para versioná-los um dia, tire a senha do
> documento; não tire a linha do `.gitignore`.
>
> Pelo mesmo motivo, o teste novo **não tem credencial nenhuma**: e-mail e senha
> vêm de `E2E_CONTADOR_EMAIL`/`E2E_CONTADOR_SENHA`, e o escritório-alvo é
> descoberto em tempo de execução. Sem env, ele se declara *skipped* — nunca passa
> vazio.
>
> ### Verificação
>
> `tsc` **0** · vitest **1791** (era 1749; +42) · `next build` limpo · isolamento
> no banco **48/48** · isolamento nas actions **3/3** (7 actions atacadas).
>
> ### Pendências desta sessão
>
> - **Escritório B mantido de propósito** — sem ele, nem o teste de isolamento nem
>   o de Server Action rodam. Limpeza pronta em
>   `app/scratchpad/_limpar-escritorio-b.mjs` (ids fixos, apaga também a conta de
>   auth). ⚠️ O trigger criou um trial que vence em **21/08**, então por volta de
>   **19/08** sai um e-mail de "trial acabando" para `+contadorb@gmail.com`.
> - `E2E_CONTADOR_EMAIL`/`E2E_CONTADOR_SENHA` **não estão em lugar nenhum
>   versionado** — quem for rodar o teste precisa exportá-las.
> - Seguem abertas as pendências de infra da sessão 25 (3 env vars na Vercel,
>   `www`, SMTP do Supabase, `RESEND_FULL_ACCESS`) e o bloqueio do `UAZAPI_TOKEN`.
> ### Lado do EMPRESÁRIO — a lacuna fechada ainda na mesma sessão
>
> `tests/idor-actions-empresario.spec.ts`, irmão do do contador. A diferença de
> fundo: aqui quase tudo passa por `createServerClient()` (RLS ligada), então a
> RLS **é** a defesa — o que o teste acrescenta é provar que as actions a
> **honram**, e que nenhuma devolve sucesso para operação que não aconteceu.
>
> Cinco ataques, todos recusados, confirmado também no banco (guia não quitada,
> notas alheias ainda `ativa`/`lancada`, nenhuma notificação alheia marcada):
> guia de outro dono, **nota fiscal de outro dono** (a mais grave — documento com
> efeito externo; a action lê a nota com `.eq('company_id')` ANTES de falar com a
> Focus, então recusa sem chamar o provedor), notificação alheia, e cliente
> alheio por `softDelete` e `update`.
>
> **Achado:** `marcarNotificacaoLidaAction` devolvia `ok:true` com id alheio —
> **terceira aparição** da classe "zero linhas afetadas lido como sucesso". A RLS
> bloqueava a escrita e nenhum dado foi tocado; como não há auditoria naquele
> caminho, só a tela mentia. Corrigido do mesmo jeito.
>
> **Armadilha de teste corrigida de passagem:** `route.test.ts` comparava o texto
> inteiro da mensagem de WhatsApp, que embute `siteUrl` — os dois testes passavam
> só quando o ambiente **não** tinha `NEXT_PUBLIC_SITE_URL`, e ficavam vermelhos
> para quem rodasse depois de `. ./.env.local`. A variável agora é pinada no
> teste.
>
> ⚠️ **Rodar a suíte a partir de `app/`, nunca da raiz do repo.** Da raiz, o
> vitest varre também os testes das 57 skills instaladas e o resultado vira
> "68 arquivos falhando" — que não tem nada a ver com o produto.
>
> ### O que continua sem prova ponta a ponta
>
> As actions de `/conta` e `/conta/assinatura` (dinheiro da assinatura) e as de
> `/configuracoes`. Todas escopam por `user.id` da sessão, sem id vindo do
> cliente — por construção não têm superfície de IDOR —, mas isso é leitura de
> código, não teste executado.
>
> ### 🔷 DECISÃO: um banco só, e ele é produção (14/08)
>
> Avaliada e **decidida pelo usuário** antes do lançamento: não haverá segundo
> banco. O que muda é que a dívida deixou de ser implícita — e duas ações
> tornaram a decisão real em vez de nominal.
>
> **A distinção que sustenta a decisão:** segurança e separação de ambiente são
> eixos diferentes. Segurança está provada. Mas **nenhuma RLS protege contra o
> `service_role`**, e é ele quem roda migration, seed e teste. O risco não é um
> atacante; é a própria equipe.
>
> **Ação 1 — dado de teste fora.** O escritório `ZZ TESTE IDOR — Escritório B`
> foi apagado inteiro (exportado antes para
> `app/scratchpad/fixture-escritorio-b.json`, para renascer num futuro banco de
> dev). O que NÃO foi apagado, classificado por atividade real e não por
> palpite: `allanvalle@outlook.com` tem **2 notas fiscais e 4 guias** — é
> atividade real; `allanbv00` tem empresa e honorário; `choicecarvalho` é
> cadastro de alguém que nunca logou; e o "Escritório Teste Balu" + `ideapp`
> ficaram de pé de propósito, porque são o palco da demonstração guiada do P3.
>
> **Ação 2 — a trava** (`app/tests/guarda-ambiente.ts`). A decisão colidia com a
> própria suíte: **oito specs escreviam em produção**. O banco onde o teste pode
> escrever agora tem de vir em `E2E_SUPABASE_URL` e ser diferente do que a
> aplicação usa — sem ref de produção codificado, porque o que a aplicação
> aponta É produção por definição. Ausente → pulado; apontando para produção →
> **lança**. Verificado nos dois estados (40 pulados, zero vermelho; e recusa
> explícita).
>
> ⚠️ Detalhe que custou uma rodada: cinco specs chamam `createClient()` em
> escopo de `describe`, que o Playwright executa na **coleta**, antes de
> qualquer `test.skip` valer. Com string vazia o `createClient` lança e o
> arquivo fica vermelho em vez de pulado — daí `URL_INERTE`, com endereço
> impossível de propósito (loopback porta 1).
>
> ### 🔷 O buraco da Frente 3: o MEI estava fora, e a justificativa era falsa
>
> O card listava, em "fora de escopo", o aviso de DAS para MEI — **metade do
> piloto**. O comentário no código dizia "a consulta de pagamentos do MEI não foi
> investigada". Ela foi: `docs/investigations/SERPRO-INVESTIGACAO.md` registra
> que o filtro usado ali, **código 9, "inclui DAS-MEI e DAS do Simples"**. Não era
> limite da API — era um corte herdado de `impostos/actions.ts`, onde ele existe
> por outro motivo (PGDAS-D é declaração do Simples; MEI declara por DASN-SIMEI).
>
> **E os testes provavam o código errado:** dois se chamavam "MEI fica de fora" e
> usavam `Code_regime_tributario` **'3'** — que é Regime Normal. MEI é **'4'**. O
> MEI de verdade nunca tinha sido testado.
>
> O que estava acontecendo: MEI **tem** DAS e o app **gera** essa guia
> (`gerarDasMeiAction`, via PGMEI). Sem a varredura, o pagamento nunca era
> reconhecido — a guia ficava aberta para sempre, virava `vencida`, e quem pagou
> em dia aparecia em atraso para si e para o contador
> (`painel_contador.das_vencidos`), mês após mês.
>
> Agora `REGIMES_COM_DAS = ['1','2','4']`. Regime Normal (3) segue fora, pelo
> motivo certo: não recolhe DAS.
>
> ### 🔬 Rodada real do cron — o que ela provou e o que corrigiu
>
> Cron disparado contra produção com uma empresa MEI semeada:
> `pagamentos_serpro: { elegiveis: 2, consultadas: 2, erros: 1, carimbos_falhos: 0 }`.
> Antes da correção seria `elegiveis: 1` — **o MEI entrou na fila**. As duas
> empresas foram carimbadas às 22:45:30, **inclusive a que falhou**: a fila gira,
> confirmando em execução real o conserto do carimbo no `finally`.
>
> ⚠️ **E corrigiu uma coisa que eu tinha escrito errado.** Eu previa falha por
> falta de Termo; o log real disse `Certificado da empresa não encontrado`. O
> primeiro portão é o **certificado A1 da própria empresa**
> (`arquivos_auxiliares.storage_key`), exigido por `garantirTokenProcurador`
> ANTES da procuração — e a chamada **nem chega à SERPRO**. Vale para **todo
> regime**, não só MEI. O comentário no código foi trocado pelo observado.
>
> Isso não obstrui o piloto: o P11 existe para o contador coletar o PFX e subir
> pela tela do cliente. **Confirmado pelo usuário: o aviso alcança todo o piloto.**
>
> ❓ **Segue sem prova:** se o PAGAMENTOS71 devolve documentos de DAS-MEI. Nenhuma
> chamada chegou lá (a MEI da base não tinha certificado). Verificável no
> primeiro MEI do piloto com A1: rodar o cron e conferir
> `pagamentos_serpro.baixadas > 0`.
>
> A semente (empresa MEI, guia e notificação) foi removida do banco.
>
> ### 📧 A fila de e-mail: 29 → 12, revisada aviso a aviso
>
> A rodada do cron foi feita com `RESEND_API_KEY` **em branco de propósito** —
> havia 8 e-mails na fila para `allanbv00` e `allanvalle`, contas de junho com
> atividade fiscal real. E-mail não se desenvia. Resultado: `enviados: 0,
> pulados: 30`, fila intacta.
>
> Depois, cada aviso foi julgado **contra o fato que afirma**, não pela data:
>
> **Resolvidos (14)** — o fato deixou de existir:
> - 11 `whatsapp_escalado`: `entidade_ref` **nulo em todos**; 3 com chave literal
>   `smoke-6b-00N` e 8 da sessão de teste ao vivo de 12/08, de um número já
>   removido. Dono: a conta de teste.
> - 3 `abertura_etapa`: anunciam mudanças de 24/07 ("Enviado à Receita", "Na
>   Prefeitura"); o processo seguiu, então a sequência se contradiz.
>
> **E-mail suprimido, aviso mantido no sino (3)** — o fato é verdade, a mensagem
> não: os `honorario_a_vencer` seguem em aberto (R$ 1.890 e R$ 300), mas venceram
> há 13 e 7 dias, e o texto diz "vencendo hoje". Só o e-mail foi cortado —
> esconder obrigação em aberto é pior que uma data velha. É a distinção entre os
> dois campos: `resolvida_em` = o fato acabou; `enviada_email_em` = não manda,
> mas continua visível.
>
> **Intocados (12)** — conferidos competência a competência pela `chave`:
> 8 `pgdas_pendente` + 3 `defis_pendente` (declarações realmente não
> transmitidas) e 1 `das_vencido` (AL PISCINAS, 202604, **R$ 11.113,57**, vencida
> em 20/05, sem pagamento). Silenciar qualquer um seria esconder obrigação fiscal
> real.
>
> 🟡 **Achado de passagem, não tratado:** há **27 atendimentos de WhatsApp sem
> atender** — 24 de 12/08 com telefone `38105654493205` (não é número brasileiro
> válido; parece lixo do teste) e 3 de 31/07 com número plausível. Os avisos
> resolvidos não estavam ligados a eles. A tela de atendimentos do contador
> mostra essa fila.
>
> ### 📮 SMTP do Supabase — diagnóstico lido da Management API
>
> | | |
> |---|---|
> | `smtp_host` | **`null`** → remetente embutido |
> | `rate_limit_email_sent` | **2 por HORA** |
> | `mailer_autoconfirm` | `false` → confirmação exigida |
> | `mailer_secure_email_change_enabled` | `true` → troca de e-mail gasta **2** |
> | `site_url` / `uri_allow_list` | corretos (conserto da sessão 25) |
>
> **Governa só o Auth** (confirmação, reset, troca de e-mail, magic link). Os
> avisos do app saem pelo Resend, direto do cron, e **não** têm esse teto — é a
> confusão mais fácil de fazer.
>
> Três clientes se cadastrando na mesma hora: o terceiro não recebe nada, e a
> tela não avisa. Uma troca de e-mail sozinha consome a hora inteira.
>
> **São DUAS mudanças, não uma:** apontar o SMTP para o Resend **e** subir o
> `rate_limit_email_sent` — ele não sobe sozinho.
>
> ⚠️ Duas ressalvas: o remetente será **`@baluhub.com.br`**, não
> `@balucontabil.com.br` (a conta Resend é Free, 1 domínio, e a vaga está com o
> baluhub) — domínio diferente do site, o que pesa em filtro de spam. E o
> **`PATCH` da Management API substitui o `uri_allow_list` inteiro**: um PATCH só
> com campos de SMTP apaga as 6 entradas de hoje. Tem que reenviar a lista junto.

> ## Histórico da sessão 26 (2026-08-14) — Frente 3: avisos de pagamento (SERPRO + Asaas)
>
> Sessão de **execução**, do plano ao código. Spec já aprovada
> (`docs/superpowers/specs/2026-08-13-frente-3-avisos-de-pagamento-design.md`);
> plano escrito nesta sessão
> (`docs/superpowers/plans/2026-08-14-frente-3-avisos-de-pagamento.md`) e as 6
> tasks entregues. **Migrations 0086, 0087 e 0088 aplicadas em produção.**
>
> ### O que o levantamento achou antes de escrever código
>
> Dois achados que **travariam** a execução se descobertos no meio:
>
> 1. 🔴 **A RPC recusava a origem que a spec mandava usar.** `0072:28` faz
>    `RAISE EXCEPTION` para `p_origem` fora de
>    `('manual','conciliacao','conciliacao_confirmada')`. Chamar com `'serpro'`
>    estourava em runtime — a spec pedia "origem própria" sem dizer que a
>    validação mora dentro da função.
> 2. 🔴 **A RPC resolvia notificações, mas não criava nenhuma.** Ninguém no
>    sistema avisava "seu pagamento foi reconhecido". O aviso passou a nascer
>    **dentro da RPC** (0087), e não em quem chama: assim os **quatro** caminhos
>    de baixa ganham o aviso de uma vez, na mesma transação da auditoria. É a
>    mesma decisão que fez a 0072 existir — notificar no chamador daria o aviso
>    a um caminho só, e o quinto nasceria mudo.
>
> ### 1. Os tipos (migration `0086`)
>
> `pagamento_confirmado` no `CHECK` **e** em `tipos.ts`, junto com os **5
> órfãos** que a análise da sessão 25 encontrou (o arquivo listava 11, o banco
> aceitava 16). O CHECK vivo foi lido do banco antes de recriar — ritual que a
> 0081 documenta depois do acidente da 0061.
>
> **O que impede o sexto órfão:** `tipos.test.ts` agora lê a migration mais
> recente que recria a constraint e compara conjunto a conjunto, nas duas
> direções. Nada mais obriga TypeScript e SQL a andarem juntos — este teste é a
> obrigação.
>
> A exclusão da tela de preferências saiu do JSX para `TIPOS_PREFERENCIAVEIS`,
> com o motivo escrito por exceção (`abertura_etapa` é transacional;
> `parametro_fiscal_desatualizado` só vai para AdminBalu). A action de salvar
> passou a usar a **mesma** lista — divergir faria um tipo fora do formulário
> ser regravado como habilitado a cada submit.
>
> ### 2. O sync da SERPRO pela RPC (migration `0087`) — conserta defeito antigo
>
> `impostos/actions.ts` gravava `status:'paga'` por `upsert` direto: quando a
> Receita revelava o DAS pago, **ninguém era notificado e nada ia para a
> auditoria**. Agora os valores continuam vindo pelo upsert e a baixa é da RPC,
> com origem `'serpro'`.
>
> **Segundo vazamento, achado ao consertar o primeiro:** o caminho de fallback
> gravava `status: s.status`, e `s.status` do CONSDECLARACAO13 **pode ser
> 'paga'** — baixa por fora da RPC de novo, e sem `data_pagamento`, que é o
> sinal de idempotência dela. Corrigido junto.
>
> O upsert virou **dois lotes homogêneos**: linhas que falam de pagamento não
> carregam `status`, e um array de chaves diferentes obrigaria a confiar em como
> o PostgREST preenche o que falta — justamente na coluna disputada.
>
> **Prova no banco vivo, em transação revertida** (`_sonda-0087.mjs`): 1ª
> chamada → `notificacao_criada: true`, 1 aviso de DAS resolvido, corpo "DAS de
> 04/2026 · confirmado pela Receita"; 2ª chamada → `ja_estava_paga: true`, **sem
> aviso novo**; origem `manual` → **nenhum** aviso; origem inventada → exceção.
> Uma linha em `audit_log`.
>
> ⚠️ **Quem recebe:** só descoberta **automática** avisa (`serpro`,
> `conciliacao`). Em `manual` e `conciliacao_confirmada` quem deu a baixa foi o
> próprio dono olhando para a tela — devolver "seu pagamento foi confirmado"
> seria contar a alguém o que essa pessoa acabou de fazer.
>
> ### 3. `rodarPagamentosSerpro` no cron (migration `0088`)
>
> Varredura diária: empresa do Simples **com guia em aberto** → PAGTOWEB →
> baixa pela RPC. Entra depois da conciliação e antes do billing, com
> `try/catch` próprio.
>
> **Orçamento de tempo (12s) não é zelo:** é uma chamada SERPRO por empresa
> dentro de um `maxDuration` de 60s compartilhado, e timeout de wall-clock não é
> capturável por `try/catch`. Com 30–60 empresas a varredura **não cabe** numa
> rodada — por isso a fila ordena por quem esperou mais, e a 0088 existe: o
> proxy óbvio (`max(guias.updated_at)`) não serve, porque consulta que não acha
> pagamento não escreve nada e a empresa consultada todo dia continuaria
> parecendo a mais antiga. O carimbo cai **com sucesso ou com falha** — registra
> "já teve a vez dela", não "deu certo".
>
> ### 4. A linha digitável em mensagem própria
>
> Até aqui o número vinha na mesma mensagem, com rótulo em cima. No WhatsApp o
> toque-e-segura copia a **mensagem inteira** — o cliente colava título, corpo e
> link no campo do banco. Agora são duas mensagens, e a segunda tem só o número.
>
> **A assimetria do carimbo, decidida e testada:** `enviada_whatsapp_em` é um só
> para um envio que virou dois. Carimbar na primeira deixaria "o código vai na
> próxima mensagem" sem próxima mensagem, e sem retentativa; carimbar só no fim
> faz a rodada seguinte reenviar as duas. Escolhido o segundo — aviso repetido
> incomoda, aviso sem o código não serve. E se a primeira falha, a linha **não**
> é enviada solta.
>
> ### 5. Asaas → aviso, no ponto compartilhado
>
> A spec mandava mexer na rota do webhook; o código dizia outra coisa. Quem
> escreve o pagamento do escritório são **dois** caminhos (webhook e varredura
> diária), e `aplicar-cobranca-escritorio.ts` existe porque os dois têm de
> escrever igual. Notificar só na rota faria o pagamento descoberto pela
> varredura passar em silêncio — o mesmo defeito do item 2, em outra tabela.
>
> Dois destinatários, duas frases: o **cliente** recebe a quitação, o
> **escritório** o recebimento. O aviso sai depois do compare-and-swap ter
> afetado linha (anunciar antes seria anunciar o que outro escritor pode ter
> desfeito) e antes do `return` de quem não tem honorário — avulsa também é
> dinheiro que entrou.
>
> ### Decisão de escopo: o critério de aceite 5 era falso, e não por causa desta frente
>
> A spec pedia que desligar `pagamento_confirmado` silenciasse as duas fontes.
> **`notificacoes_pendentes_whatsapp` (0068) não consulta preferência nenhuma**,
> e `notification_preferences` (0045) só tem `email_enabled` — o WhatsApp
> ignorava a tela **para todos os 17 tipos**, desde sempre. O único controle é o
> interruptor global do opt-in.
>
> Decisão do usuário: **escopo honesto** — o critério vale para e-mail, a tela
> ganhou um aviso dizendo o que ela governa, e o conserto virou card próprio
> ("Preferência de notificação por canal", To Do). Ampliar o escopo para
> arrumar a preferência de um canal que ainda não fala trocaria entrega por
> arrumação.
>
> ### Dívida da sessão 25 quitada de passagem
>
> `tsc` estava **vermelho** (3 erros em `cert-actions.test.ts`, do commit
> `7b47869`), apesar de o CHECKPOINT da sessão 25 registrar "tsc 0". Mocks
> declarados com aridade zero faziam `mock.calls[0][1]` não compilar — e é
> justamente o argumento que aqueles testes leem para provar o anti-IDOR.
> Corrigido.
>
> ### Verificação
>
> `tsc` **0** · vitest **1749** (era 1700; +49) · `next build` limpo ·
> migrations 0086/0087/0088 aplicadas e conferidas no banco (CHECK com 17
> tipos).
>
> ### 🔴 O bloqueio que nenhuma task remove
>
> Sem `UAZAPI_TOKEN`, `configDeEnv()` devolve `null` e `enviarMensagem` responde
> `{ok:false, skipped:true}`: **tudo isto funciona no banco e não chega a
> ninguém, sem erro nenhum**. O número anterior era pessoal e a remoção foi
> deliberada (12/08). Provisionar a instância é pré-requisito de qualquer
> demonstração ao cliente — e a coalescência da 0068 existe para que, no dia em
> que o token voltar, o backlog acumulado não vire uma rajada.
>
> ### 6. Skills instaladas no projeto — e travadas fora do versionamento
>
> **57 skills** copiadas de `skills/` (pasta de origem) para **`.claude/skills/`**,
> que é o que o Claude Code lê. Ficam **só nesta máquina**: decisão do usuário,
> registrada no `.gitignore`.
>
> ⚠️ **A trava não existia.** Antes desta sessão nem `skills/` nem
> `.claude/skills/` estavam no `.gitignore` — `git status` listava `?? skills/`,
> e um `git add -A` teria empurrado 14 MB de material de terceiros para o repo
> **público** `gestao-hub/balu-contabil`. Agora as duas entradas estão lá, e a
> prova é `git add -A --dry-run`: **zero** linhas com "skill".
>
> (Detalhe que confunde: `git check-ignore -v skills/` — **com barra** — sempre
> devolveu "ignorado" apontando para uma linha **vazia** do `.gitignore`. É
> quirk do git com diretório e padrão vazio. Sem a barra, e para qualquer
> arquivo dentro, o resultado era "não ignorado" — e o `git status` confirmava.
> Quem for reconferir isto um dia: use o caminho **sem** barra final.)
>
> **Duas correções na instalação:**
> 1. `skills/superpowers/` **não é uma skill** — é o clone do plugin inteiro
>    (com `.git`, `commands/`, `hooks/`, `agents/`). Não foi instalado; as 14
>    skills que ele contém já existem soltas no nível de cima, idênticas
>    (conferido com `diff -rq`).
> 2. `skills/using-superpowers/` estava **sem `SKILL.md`** — a cópia de topo é
>    incompleta. Instalada a partir de `skills/superpowers/skills/using-superpowers/`,
>    que tem o arquivo.
>
> **6 skills tinham `name:` divergente da pasta** (`aux-opensquad-copywriting`
> declarava `name: opensquad-copywriting`, e mais cinco iguais). O `name` foi
> alinhado à pasta **nas cópias instaladas**; a pasta de origem `skills/` ficou
> intacta, como veio. Validação final: 57 skills, todas com `SKILL.md`, `name`
> igual ao diretório e `description` presente — **0 problemas**.
>
> 🟡 **Ponto de atenção:** entre as instaladas está `using-superpowers`, cuja
> própria descrição diz *"use when starting any conversation… requiring Skill
> tool invocation before ANY response"*. Ela tende a disparar em toda conversa.
> Se o comportamento incomodar, é a primeira a remover de `.claude/skills/`.
>
> As skills só aparecem para o Claude Code **na próxima sessão** — a descoberta
> acontece no início da conversa.
>
> ### Pendências desta sessão
>
> - **Smoke manual do usuário** (roteiro abaixo) — o card está em **Review**,
>   não em Concluído.
> - **Commitado localmente, NÃO empurrado.** Continuam os 2 commits de docs da
>   sessão 25 sem push, mais os 2 desta sessão.
> - Dois arquivos binários seguem **não rastreados** na raiz e não entraram em
>   commit nenhum: `Balu-Levantamento-Lancamento-2026-07-23.pdf` e
>   `app/Document supabase e focus.docx`. Decidir se versiona ou ignora.
> - As pendências de infra da sessão 25 seguem abertas (3 env vars na Vercel,
>   `www`, Resend, SMTP do Supabase, `RESEND_FULL_ACCESS`).
>
> ### Roteiro de smoke (os 6 critérios de aceite)
>
> 1. **DAS com linha digitável:** com uma guia em aberto e `whatsapp_habilitado_em`
>    preenchido, rodar o cron e conferir em `notifications` que a linha ficou
>    pendente. Sem `UAZAPI_TOKEN` **nada sai** — o certo é `enviada_whatsapp_em`
>    seguir `NULL` e o cron reportar `whatsapp_pulados`, nunca `enviados`.
> 2. **DAS pago na Receita:** `/impostos` → "Atualizar" numa empresa do Simples
>    com Termo válido. Conferir: guia `paga`, **uma** linha em `audit_log` com
>    `origem: 'serpro'`, e **um** `pagamento_confirmado` com corpo "confirmado
>    pela Receita".
> 3. **Idempotência:** repetir o passo 2. Nada muda — nem data, nem auditoria,
>    nem aviso novo.
> 4. **Asaas:** pagar uma cobrança de escritório na sandbox e conferir os
>    **dois** avisos (cliente e escritório) com frases diferentes.
> 5. **Preferências:** `/conta` → aba Notificações → "Pagamento confirmado"
>    aparece na lista, e os 5 tipos órfãos também. Desligar corta o **e-mail**
>    (o aviso na tela e o WhatsApp continuam — ver o card novo).
> 6. **Cron completo:** `GET /api/cron/obrigacoes` com o `CRON_SECRET` e
>    conferir `pagamentos_serpro` na resposta.

> ## Histórico da sessão 25 (2026-08-13) — P11 vira código, domínio próprio e a saída do Open Finance
>
> ### 1. Upload do certificado A1 pelo contador — em produção (`7b47869`, migration `0085`)
>
> O Michel respondeu o P11: **até 30 empresas por regime**, o **e-CNPJ é
> responsabilidade do cliente do contador**, e ele **consegue coletar o PFX e a
> senha**. A análise achou que a resposta 3 descrevia uma operação que **o
> produto não tinha**: `uploadCertificadoAction` resolve a empresa por
> `profiles.current_company`, então só o dono subia o próprio certificado.
>
> Entregue: aba **Certificado** em `/contador/clientes/<id>`, escrita por
> service_role com permissão provada em `companyDaCarteira` (a RLS do contador
> segue SELECT-only — a decisão do Bloco A ficou intacta), declaração de
> autorização do titular obrigatória, e rastro em três lugares (`audit_log`
> `cert.upload_contador`, colunas `cert_enviado_por`/`cert_enviado_em` da 0085,
> e a tela do empresário dizendo que o escritório enviou).
>
> **Trava de CNPJ nova, nos dois caminhos:** PFX de outro CNPJ era aceito em
> silêncio e o erro só aparecia depois, disfarçado de falta de procuração — o
> Termo é assinado com o CNPJ do certificado e o envelope do DAS declara o da
> empresa. Com uma pessoa manuseando dezenas de PFX, isso deixou de ser hipótese.
>
> **Smoke com evidência de banco:** a linha apagada na limpeza tinha
> `cert_enviado_por` = conta **Contador**, e `/configuracoes` não poderia tê-la
> criado (o contador não tem `current_company`). O `audit_log` gravou **uma**
> entrada — nenhuma para o upload recusado, confirmando o invariante com dado
> real. Verificação: `tsc` 0 · vitest **1700** · build limpo.
>
> ### 2. Domínio `balucontabil.com.br` — no ar
>
> ⚠️ **O domínio não é da conta Hostinger que temos.** A API gerencia
> `excluvia.com.br` (44 registros) e `autofisco.com.br` (4), e devolve **403
> "Customer does not own"** só para ele. O RDAP do Registro.br diz: registrador
> **HSTDOMAINS**, titular **Fatto Industria de Soluções em Concreto**, vence
> **16/02/2027**. O usuário configurou os registros A à mão.
>
> Feito por aqui: apex e `www` adicionados ao projeto `balu-contabil`,
> verificados, e **o certificado do apex teve de ser emitido na mão**
> (`vercel certs issue`) — só o do `www` saiu sozinho. `https://balucontabil.com.br/login`
> responde 200 e `/contador` redireciona para login.
>
> **Supabase Auth configurado via Management API** (token pessoal `sbp_` no
> `.env.local`). Achado no caminho: o Site URL estava em `http://localhost:3000`
> e **`https://balu-contabil.vercel.app/**` nunca esteve na allow list** — a
> pendência aberta desde a sessão 3, que explica os links de e-mail caindo em
> localhost. A lista foi somada, não substituída (o PATCH troca o campo inteiro):
> 3 entradas antigas preservadas + apex, www e o domínio da Vercel.
>
> ### 3. E-mail destravado por ponte — `@baluhub.com.br`
>
> As duas chaves Resend do `.env.local` eram **restritas a envio** e de uma conta
> (`piperhub.com.br`) diferente da que interessa. A conta certa tem
> **`baluhub.com.br` verificado**, e ambas as contas estão no plano **Free, que
> permite 1 domínio** — por isso `balucontabil.com.br` **não pôde ser cadastrado**
> (403 de limite de plano).
>
> Solução provisória, sem tocar em Supabase nem Vercel: chave de envio nova,
> restrita a `baluhub.com.br`, e `EMAIL_FROM=Balu <nao-responda@baluhub.com.br>`.
> **Testado: 200 com a chave do app.** O e-mail agora chega a qualquer
> destinatário, não só a `contato@excluvia.com.br`.
>
> 🔴 **O que isso NÃO resolve:** confirmação de cadastro e reset de senha **não
> passam pelo Resend**. `smtp_host` é `null` — saem do remetente embutido do
> Supabase, com `rate_limit_email_sent: 2`, ou seja **2 e-mails por hora**. Não
> sustenta um dia de cadastros do piloto. O conserto é SMTP customizado no
> Supabase apontando para o Resend.
>
> ### 4. Frente 3 do Bloco 7 redesenhada — Open Finance sai, SERPRO + Asaas entram
>
> Spec aprovada em `docs/superpowers/specs/2026-08-13-frente-3-avisos-de-pagamento-design.md`.
> Motivo: Pluggy custa **a partir de R$ 2.500/mês**, e o item **não veio do
> cliente** — entrou por decisão de escopo interna a partir do `planejamento.pdf`
> (a devolutiva do Michel não tem uma única ocorrência de "conciliação").
>
> Quatro achados que sustentam o redesenho:
> 1. 🔴 **A SERPRO não fornece Pix nem QR.** `parseDasSimples` devolve
>    `codigoDeBarras` e `pdfBase64`, sem campo de Pix — e o PDF real de um DAS
>    (competência 202604) tem 5 imagens: duas de 846×237 e três de 1×1. **Nenhum
>    QR.** O que dá para mandar é a linha digitável.
> 2. 🔴 **O sync da SERPRO é o quarto caminho de baixa e o único fora da RPC.**
>    Baixa manual, sugestão de conciliação e cron passam por
>    `registrar_pagamento_guia`; `impostos/actions.ts:383` grava `status:'paga'`
>    por `upsert` direto — então descoberta de pagamento pela Receita **não
>    notifica nem audita**.
> 3. 🟡 **`tipos.ts` está 5 tipos atrás do banco** (CHECK aceita 16, o arquivo
>    lista 11). Os órfãos chegam e **não aparecem na tela de preferências**.
> 4. 🟡 **O `UAZAPI_TOKEN` foi removido de propósito** em 12/08 22:29 (arquivo
>    `.env.local.antes-remover-uazapi-…`) — não é defeito de configuração, é
>    decisão ligada ao número pessoal. Enquanto não voltar, **nada sai no
>    WhatsApp, sem erro**.
>
> ### 5. Asaas — sandbox pronta, produção não
>
> `ASAAS_WEBHOOK_SECRET` (64 chars) e `ASAAS_WEBHOOK_EMAIL` gravados; **`ASAAS_ENV`
> não foi tocada** (ausente = sandbox). A chave de sandbox autentica: conta
> **MCB MARKETING LTDA** (michelbovo@gmail.com), e **nenhum webhook cadastrado**.
> Cadastrar exige URL pública — e aí o evento de sandbox cai no banco de
> produção, que é o risco do P16.
>
> ### Pendências desta sessão
>
> - **Deploy pendente:** `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY` e `EMAIL_FROM`
>   ainda são os antigos na Vercel. Três variáveis, um deploy.
> - `www` **serve o app** em vez de redirecionar para o apex (ajuste de painel).
> - `balucontabil.com.br` no Resend depende de plano Pro ($20/mês) ou de liberar
>   a vaga do `baluhub.com.br`.
> - SMTP customizado no Supabase (o teto de 2 e-mails/hora).
> - `RESEND_FULL_ACCESS` segue no `.env.local` — credencial que apaga domínio,
>   e o app não a lê. Remover ao fim da configuração.
> - Titularidade do domínio (Fatto) antes de amarrar e-mail e auth nele.
>
> ### Quadro ao fim da sessão
>
> **Concluído** ganhou 4: `Impostos P3.3` (fechado **por substituição**, não por
> entrega — a infraestrutura de conciliação existe e roda com mock; o provedor é
> que deixou de ser necessário), `P11`, `Open Finance` e `Asaas produção`.
>
> **To Do (3):** separação de ambiente · **avisos de pagamento SERPRO + Asaas**
> (o próximo a executar) · Asaas em produção.
>
> Este último foi desmembrado ao fechar o card do Asaas, e o motivo importa: as
> credenciais estão **só no `.env.local` da máquina do desenvolvedor**.
> `vercel env ls production` não devolve **nenhuma** variável do Asaas — então,
> em produção, qualquer chamada falha em `TOKEN_ASAAS_* nao configurado` e o
> webhook rejeita todo evento por comparar o header contra string vazia.
>
> **Perguntas (3):** P3 (demo guiada, a mais importante), P15, P16.
>
> ---

> ## Histórico da sessão 24 (2026-08-13) — perguntas ao cliente, não código
>
> Sessão de **destravamento por resposta**, não de implementação. O Michel
> respondeu 6 das 9 perguntas abertas no Trello. A lista "❓ Perguntas ao
> cliente" caiu de **9 para 5**.
>
> ### O que foi escrito em produção
>
> **P15 — minutas LGPD.** Controlador **PIPER AUTOMAÇÕES E INTEGRAÇÕES LTDA**
> (CNPJ 61.061.690/0001-83, R. Benfica 143, Jardim Eldorado, Apucarana/PR),
> DPO **Eduardo Henrique Alves Machado** (contato@excluvia.com.br), foro da
> **Comarca de Apucarana/PR**. Publicado via
> `scripts/seed-documentos-lgpd.mjs`; conteúdo no banco confere byte a byte
> com os arquivos (8880 e 6047 chars).
>
> Dois achados que a análise pegou antes de mexer:
> 1. **Eram 5 placeholders, não 3.** O card pedia controlador e DPO; os Termos
>    tinham o controlador em **dois** pontos (§1 e §90) e o **foro em §127**
>    como `[a definir]`, que não constava do card e o cliente precisou responder.
> 2. **Republicar a v1.0 podia corromper auditoria.** `aceites` guarda
>    `(tipo, versao)` e o seed faz `ON CONFLICT DO UPDATE` — trocar o texto da
>    1.0 faria quem aceitou constar como tendo aceito um texto inexistente.
>    Sondagem só-leitura antes da decisão: **4 aceites, todos de contas
>    internas** (walacesssantos, +e2e, +admin, testeefluxodeautomacao). Sem
>    cliente real, sobrescrever é inofensivo e ninguém é forçado a re-aceitar.
>    **Com aceite real a decisão teria sido v1.1 + re-aceite.**
>
> **P7 — AdminBalu do Michel.** `gestao@excluvia.com.br` **não tinha conta**.
> Criada pela API admin com `email_confirm=true` (e-mail está inutilizável —
> Resend em modo teste e Redirect URLs pendentes) e promovida conectando como
> `postgres`. Id `77ae7969-35cb-4af6-b659-ad6404f8316e`, **1 linha** em
> `role_types`, `type=AdminBalu`, verificado.
>
> A ordem importa e vale registrar: o trigger `handle_new_user_role` (0002) é
> `SECURITY DEFINER` e cria **'Empresa'** por padrão; o guard
> `tg_role_types_protege_admin` (0036) só aceita 'AdminBalu' quando
> `current_user` é service_role/postgres/supabase_admin. Criar como Empresa e
> **promover via postgres** é o caminho explicitamente autorizado — não depende
> de como `current_user` se resolve dentro do SECURITY DEFINER. E com o
> `UNIQUE(user_id)` da **0077** a operação é `UPDATE`, nunca `INSERT`: a nota
> do card avisando que a constraint não existia estava **obsoleta**.
>
> ### Respostas que não geraram código
>
> - **P4 (DASN/DEFIS):** "atende como está" — fluxo assistido fica.
> - **P5 (marca nos e-mails):** "manter a identidade principal como Balu" — é
>   exatamente o estado atual, e mata a necessidade de domínio por escritório.
> - **P6 (abertura de empresa):** "está completo" — o 4.3 da devolutiva era
>   ruído de formulário; o wizard + checklist + minuta + timeline atendem.
> - **P16 (separar ambientes):** "a forma mais segura possível", mas o usuário
>   pediu para **deixar por último e parado**. O levantamento do que a
>   separação exige ficou no card, incluindo uma superfície não óbvia: os
>   runners de `scripts/`/`scratchpad/` têm o ref do projeto **hard-coded**.
>
> ### P11 corrigido: a procuração e-CAC provavelmente não é necessária
>
> O card P11 dizia que cada piloto precisa de **certificado A1 e de procuração
> eletrônica RFB**. **O segundo item está errado** no modelo que o app
> implementa — e isso encolhe o caminho crítico do piloto.
>
> **O A1 continua sendo o gargalo real.** `lib/fiscal/serpro-procurador.ts`
> monta um **Termo de Autorização XML** e o assina com a chave privada do
> certificado **do cliente** (XMLDSig RSA-SHA256) → `/Apoiar` →
> `autenticar_procurador_token`. Sem o A1 daquele CNPJ não há assinatura, nem
> token, nem DAS. E o obstáculo é não-técnico: custa centenas de reais/ano,
> exige validação presencial ou por vídeo do representante legal, depende do
> dono da empresa, e **vence em 12 meses** — é esteira, não obstáculo único.
>
> **A procuração, não.** Rodada 6 (02/06/2026, PIPER + AL PISCINAS) registra:
> *"o Termo XML assinado pelo cliente é a alternativa à procuração eCAC
> manual"*. `/Apoiar` 200 → token no header → `/Consultar` devolveu **DAS reais
> de 2025**. Antes do Termo, a chamada direta dava 403 `ICGERENCIADOR-022` por
> falta de procuração — foi esse 403 que o Termo resolveu. Para **MEI** nem se
> aplica: a tabela "Serviços × Procuração" marca `GERARDASPDF21` como `n/a`; o
> código `00146` é exigência do **PGDAS-D** (Simples).
>
> ⚠️ **Contradição não resolvida:** o CHECKPOINT de 25/07 (sessão 7) diz *"falta
> ainda: procuração RFB por cliente"* — **posterior** à rodada 6, que provou o
> contrário. Leitura provável: segue existindo dependência de autorização por
> CNPJ, mas satisfeita por cert + Termo assinado, não por ato manual no e-CAC.
> **A prova existe com UM cliente só — confirmar com um segundo CNPJ antes de
> montar o plano de piloto em cima disso.**
>
> **Ponto que faltava:** neste modelo o Balu **custodia o A1 e a chave privada
> do cliente** (cifrados com `CERT_ENC_KEY`). Aquela chave assina em nome do
> CNPJ — é consentimento explícito do piloto, não só upload de arquivo.
>
> ### P16: custo verificado (não exige Pro, necessariamente)
>
> supabase.com/pricing em 13/08/2026: **Free** = $0 com **2 projetos ativos**,
> 500 MB, **pausa após 1 semana de inatividade**. **Pro** = **$25/mês**/org com
> $10 de crédito de compute. **Projeto adicional** = **+$10/mês** (2 projetos =
> $35). **Branching** exige Pro, a **$0,01344/branch/hora**.
>
> Ou seja: o segundo projeto **pode custar $0** no Free — o preço vem como
> limitação (pausa + 500 MB). **O delta depende do plano atual de produção, que
> ninguém verificou** (o MCP do Supabase aponta para conta errada; está no
> painel de billing). Se for Free, fica a pergunta maior: SaaS fiscal com
> cliente real sem backup diário e com teto de 500 MB é risco à parte.
> Branching 24/7 ≈ $9,80/mês (empata com projeto), ~8h/dia ≈ $2/mês — **mas**
> pressupõe migrations pela **CLI do Supabase**, e hoje tudo é aplicado por
> runner manual `node+pg`. O custo escondido é mudança de processo.
>
> ### Pendências que esta sessão NÃO fechou
>
> - 🔴 **Revisão jurídica das minutas** (3º item do P15). Os dois documentos
>   seguem com o aviso *"minuta técnica pendente de revisão por profissional
>   habilitado"* **no ar em produção**. Por isso o card P15 não foi para
>   Concluído.
> - 🔴 **Resend sem domínio verificado** — modo teste, só entrega para
>   `contato@excluvia.com.br`. Foi o que forçou o `email_confirm=true`.
> - **P2, P3 e P11 continuam abertas** (os 3 lançáveis + definição de pronto;
>   demonstração guiada; quantas empresas-piloto). O usuário adiou para um
>   segundo momento. **P3 segue sendo a mais importante:** em 9 dos 12 itens da
>   seção 2 o cliente escreveu "n vimos funcionar" — priorização feita antes da
>   demo é priorização no escuro.
> - Senha temporária do Michel ficou no terminal/transcrição — pedir troca.
> - **Confirmar o Termo de Autorização com um segundo CNPJ** — a prova de que
>   ele substitui a procuração e-CAC existe com um cliente só, e o plano de
>   piloto inteiro depende disso. Teste barato: só precisa de um 2º certificado.
> - **Descobrir em que plano o Supabase de produção está** (painel de billing) —
>   sem isso o custo do P16 fica entre $0 e $10/mês, e a resposta muda a
>   conversa com o cliente.
> - A linha ambígua da **sessão 7** ("falta procuração RFB por cliente") segue
>   no histórico deste arquivo, contradizendo a rodada 6. Não foi editada —
>   histórico não se reescreve; a correção está no bloco da sessão 24.

---

> ## Histórico da sessão 23 (2026-08-13) — main `a453a9b`, deploy `nq9t8ip2k` Ready
>
> **PR 4.2 (UX responsiva) e PR 4.3 (README) fechados.** Restam **2 cards** no
> To Do: P3.3 Open Finance e separação de ambiente — as duas dependem de custo,
> não de código.
>
> ### A lição desta sessão: um teste verde que não media nada
>
> `app/tests/responsivo.spec.ts` varre 37 rotas a 390×844 nos três papéis e
> mede duas coisas objetivas: a página rolar de lado e alvo de toque < 24×24
> (WCAG 2.5.8). **A primeira versão passou sem medir uma única tela do app**, e
> só o `/code-review` pegou. Duas causas somadas:
>
> 1. O papel era gravado com a coluna errada (`role_type`; a real é **`type`**)
>    e o erro do insert não era conferido. O trigger `on_auth_user_created_role`
>    (0002) já cria `'Empresa'` para todo mundo, lendo
>    `raw_user_meta_data->>'type'` — então os atores de Contador e AdminBalu
>    logavam como Empresa.
> 2. **Havia documento LGPD publicado sem aceite**, e `(gated)/layout.tsx` manda
>    para `/aceite`. As 34 rotas autenticadas terminavam nessa tela curta, que
>    passa nas duas checagens.
>
> **Se for escrever teste de UI autenticada neste projeto:** o papel vem de
> `createUser({ user_metadata: { type } })` e precisa ser **conferido** depois;
> o aceite LGPD precisa ser inserido em `aceites`; e a guarda anti-falso-verde
> tem de rejeitar `/login`, `/onboarding`, `/aceite`, `/contador/cadastro` e
> `/contador/aguardando`.
>
> Com as telas reais medidas apareceram **9 alvos de toque** invisíveis antes
> (links de 15–20px em admin/metricas, contador/cobrancas, impostos, folha,
> DashboardCard, AssinaturaView, e o Fechar de 20×20 do CreateCompanyDialog).
>
> ### SERPRO: a tradução existia e era inalcançável
>
> `lib/fiscal/serpro-erro.ts` (novo) traduz erro da SERPRO para pt-BR, ligado
> nos 6 wrappers. **Mas `lib/clients/serpro.ts` já desembrulhava o envelope e
> DESCARTAVA o `codigo`** antes de lançar — a tabela DASN-SIMEI passava nos
> testes e nunca disparava em produção. O código passa a ser preservado e o
> tradutor entende as duas formas (`[codigo] texto | …` e JSON cru).
>
> Regra do módulo: só mapeia código com significado **documentado**
> (`docs/investigations/DASN-SIMEI.md`); código desconhecido mostra o texto
> oficial da Receita com o código ao lado, nunca tradução inventada.
>
> Também: heurística de transporte deixou de ser testada contra o texto da
> Receita (um 400 legítimo falando de "timeout" virava frase de infraestrutura);
> `Erro` vence `Aviso`; envelope ilegível é descartado em vez de exibido
> cortado; e o `warning` de `garantirTokenProcurador` — o caminho de falha mais
> frequente — passa pelo tradutor em vez de contorná-lo.
>
> ### README + .env.example
>
> README virou **porta de entrada e aponta para este arquivo**: fica só com o
> que muda devagar. Ganhou a cobertura de deploy que faltava (2 crons no Hobby e
> por que tarefa nova pega carona, crons não agendados, troca de domínio
> quebrando e-mail em silêncio). **RLS conferida no banco: 44/44 tabelas ativas**
> — a advertência antiga estava obsoleta.
>
> `.env.example` estava mentindo: `CERT_ENC_KEY` listada como "o código não lê"
> quando é obrigatória e cifra certificado de cliente; `N8N_*` e
> `SUPABASE_MOTOR_*` (mortas) removidas.
>
> ### ⚠️ Duas pendências de configuração descobertas (nenhuma tocada)
>
> - **`UAZAPI_TOKEN` não existe no `.env.local`** — só `UAZAPI_ADMIN_TOKEN`, que
>   serve apenas para provisionar instância. O app lê `UAZAPI_TOKEN`
>   (`lib/uazapi/cliente.ts`); sem ela `enviarMensagem` devolve
>   `{ ok: false, skipped: true }` e **o WhatsApp nunca envia, sem erro nenhum**.
>   Conferir se na Vercel está com o nome certo.
> - **`ASAAS_WEBHOOK_SECRET`, `ASAAS_ENV` e `ASAAS_WEBHOOK_EMAIL` ausentes do
>   `.env.local`.** Sem o primeiro, o webhook das subcontas não chega a ser
>   cadastrado e nenhum escritório fica sabendo que foi pago.

> ## ⛔ AO RETOMAR: dois bloqueios operacionais, nenhum de código
>
> 1. **A instância de WhatsApp está num número PESSOAL.** Em uma hora de teste,
>    três conversas de terceiros atravessaram o webhook e viraram linha em
>    `whatsapp_atendimentos` — dado de gente que nunca falou com o Balu, no
>    banco do cliente. Já silenciamos a resposta automática para conversa fiada
>    (só sai aviso quando a mensagem parece dúvida fiscal), mas **a causa é o
>    número**: produção exige chip dedicado.
>    Trocar a instância: `node scratchpad/_criar-instancia-balu.mjs`.
> 2. **OpenRouter sem crédito** (501 comprados, 501,21 usados). A `config_ia`
>    está no modelo GRATUITO `google/gemma-4-26b-a4b-it:free`, que já falhou
>    duas vezes por limite de taxa e uma por escrever a chave `"resovido"`.
>    Ao repor: `node scratchpad/_config-ia-modelo.mjs "mistralai/mistral-small-24b-instruct-2501"`.
>
> ### O que foi para produção nesta continuação (main `06b6d5a`)
> - **13 achados do `/code-review`**, com os 3 graves verificados no banco antes
>   de aceitar. Dois eram funcionalidades **que nunca funcionaram**: salvar o
>   SLA e revogar consentimento de Open Finance. Migration **`0076`** conserta
>   no banco (GRANT + policy) em vez de contornar com service_role.
> - **WhatsApp (6B) testado ao vivo** — 5 bugs que nenhum teste automatizado
>   pegaria: env vars ausentes na Vercel; payload de entrada era hipótese
>   errada desde o 6B; **LID** (`@lid`) lido como telefone; comparação exata de
>   número (o cadastro tem `+55…`, o WhatsApp entrega dígitos e sem o 9º);
>   contrato do modelo frágil.
> - **Atendimento ganhou memória** (últimas 4 trocas) e **a base jurídica**
>   (415 documentos), que até então só o catálogo do 6A consumia.
> - **Dúvida geral × pergunta sobre a empresa**: classificação determinística
>   decide quando um humano é acionado. "O que é IOF?" é respondido sem dado
>   fiscal; "quanto é o meu DAS?" sem dado vai para o contador.
> - **Onboarding conversacional com IA** (item 6.1, o último verde em aberto):
>   dado pessoal é redigido (`⟨CNPJ⟩`) antes de ir ao provedor, a máquina de
>   estados decide o que falta, e sem IA o fluxo segue pelo texto padrão.
> - **Favicon**: `metadata.icons` manual desligava a convenção do Next e o
>   `icon.svg` ficava órfão.
>
> ### Verificações que ficaram no repo
> - `src/lib/atendimento/ia.smoke.test.ts` (6 casos) e
>   `src/lib/onboarding/ia.smoke.test.ts` (3) — rodam com `SMOKE_IA=1` contra o
>   provedor real. Foi o primeiro que flagrou o `"resovido"`.
> - Suíte: **1549 testes**, `tsc` 0, build limpo.

---

> ## Histórico da sessão 22 (primeira parte)

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-08-12 (sessão 22 — Bloco 7 inteiro + saldo/saque Asaas + métricas do admin + batimento com o cliente; domínio próprio arquivado a pedido do usuário).

> ## ⛔ AO RETOMAR
>
> **Bloco 7 fechado e mergeado.** Migrations `0067`–`0075` aplicadas no banco.
>
> ### O que entrou nesta sessão
> 1. **Notificação de guia paga** (`0066`–`0068`): `/notificacoes` filtrada,
>    resolução no **ponto de escrita** (`resolvida_em`) e **coalescência de
>    WhatsApp por guia** (só a mais recente sobrevive; as outras ficam
>    `suprimida_whatsapp_em` — coluna própria, porque carimbar "enviada" no que
>    nunca saiu corromperia auditoria).
> 2. **Bloco 7 — Frente 2 (SLA)** (`0070`): fila de escaladas em
>    `/contador/atendimentos`, alerta `sla_estourado` no cron, prazo exibido ao
>    cliente. A fila entrou por necessidade: sem tela para marcar "atendido", o
>    alerta dispararia para sempre sem ter como ser fechado.
> 3. **Bloco 7 — Frente 3 (conciliação)** (`0071`/`0072`): tabelas, matcher
>    determinístico (16 testes) e **`registrar_pagamento_guia` como ponto de
>    escrita único** — a baixa manual passou a usá-la também.
> 4. **Saldo e saque da subconta Asaas** (`0073`): resposta ao P1 do cliente.
>    Só o dono da subconta saca; conta de destino cadastrada uma vez e cifrada;
>    saldo sempre vindo da API, nunca somado por nós.
> 5. **Métricas do admin** (`/admin/metricas`): MRR, recebido no mês,
>    inadimplência e uso por escritório (13 testes de regra de negócio).
> 6. **`0074`** — conserta o efeito colateral silencioso das `0069`/`0073`:
>    GRANT por coluna em `contabilidades` **não alcança coluna criada depois**,
>    e a tela concluía "este escritório não tem subconta".
> 7. **`0075`** — **domínio próprio arquivado** (decisão do usuário): o cliente
>    não pediu (devolutiva 3.4). Backup em `docs/arquivo/`. O SLA ficou.
>
> ### Estado da conciliação em produção
> **A porta de entrada está fechada de propósito.** `conciliacaoDisponivel()`
> exige `OPEN_FINANCE_PROVEDOR` real; com o mock, a tela mostra "em preparação"
> e a action recusa conectar. O cron continua rodando com o mock (testável),
> mas nenhum cliente recebe promessa de vigilância bancária que não existe.
> **Para ligar:** definir `OPEN_FINANCE_PROVEDOR` quando houver contrato.
>
> ### Documento para a reunião com o cliente
> `docs/product/2026-08-12-BATIMENTO-E-PERGUNTAS-AO-CLIENTE.md` — batimento do
> verde (**17 ✅ / 4 🟡 / 1 🔴**, era 8/5/9 em junho) e **16 perguntas** já no
> Trello, na lista "❓ Perguntas ao cliente". As respostas do Michel estavam
> escondidas no JS do `devolutiva-dev-preenchido.html` (os checkboxes do arquivo
> estão em branco) — inclusive explicações dele que não estavam em lugar nenhum.
>
> ### Pendências que sobraram
> - **Único item verde ainda 🔴:** onboarding conversacional com IA — que o
>   cliente marcou "essencial para lançar".
> - **IA sugerindo código de serviço** na emissão: idem, marcado essencial.
> - **Dashboard do empresário**: ele reprovou a tela; falta "pendências" e
>   "resumo financeiro" (o "saldo" virou o saque da subconta, já entregue).
> - Smoke do saldo/saque não foi roteirizado (a tela foi vista ao vivo).

---

> ## Histórico anterior

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-08-12 (sessão 22 — as três pendências que a sessão 21 deixou registradas foram fechadas em sequência: `/notificacoes`, resolução no ponto de escrita e coalescência de WhatsApp. Migrations `0067` e `0068` aplicadas no banco. **Push pendente de confirmação.**)

> ## ⛔ AO RETOMAR: push dos commits `d2988f9` e `526f877`
>
> As três pendências da sessão 21 estão fechadas, aplicadas no banco e
> commitadas — **falta só o push** (auto-deploy em produção, exige
> confirmação explícita do usuário).
>
> 1. **`/notificacoes` (a página cheia)** listava "DAS a vencer" de guia já
>    quitada — mesmo gap que o sino tinha. Passa a usar a RPC
>    `notificacoes_sino`, que ganhou `norma` no retorno (a página mostra a
>    norma; o sino não). Trocar o retorno exigiu `DROP FUNCTION` —
>    `CREATE OR REPLACE` não muda assinatura de saída.
> 2. **Resolução no ponto de escrita** (a recomendação arquitetural do
>    `/code-review`): coluna `notifications.resolvida_em` + RPC
>    `resolver_notificacoes_guia` (SECURITY DEFINER, autoriza por
>    `user_owns_company` — a notificação é do dono da empresa, não de quem
>    clicou) chamada por `marcarGuiaPagaAction`. Os filtros de leitura das
>    `0065`/`0066` **ficam**, como defesa em profundidade: cobrem a guia paga
>    por caminho que não passe pela action (importação, SQL manual,
>    conciliação futura), enquanto `resolvida_em` cobre o consumidor novo que
>    esqueça o join.
> 3. **Rajada de WhatsApp** (decisão do usuário: **coalescer por guia**):
>    coluna `suprimida_whatsapp_em` + RPC `suprimir_whatsapp_superadas`,
>    chamada no cron **antes** de ler os pendentes (a ordem é o que faz valer
>    — tem teste que a fixa). Só a notificação mais recente de cada guia
>    sobrevive. Coluna própria em vez de carimbar `enviada_whatsapp_em`:
>    marcar como "enviada" o que nunca saiu corromperia auditoria futura de
>    "o que foi enviado a este cliente". Vale só pro WhatsApp — o e-mail já
>    saiu na época certa e o sino mostra a lista inteira de propósito.
>
> **Migrations `0067` + `0068` aplicadas** numa transação só, com 12
> verificações e `ROLLBACK` automático se qualquer uma falhasse (runner
> `app/scratchpad/_aplicar-0067.mjs`, gitignorado). Todas passaram.
>
> ⚠️ **Duas verificações passaram com zero dado**: o backfill resolveu 0 e a
> coalescência suprimiu 0. Probe somente-leitura depois
> (`scratchpad/_probe-0067-dados.mjs`) provou que é zero honesto, não join
> quebrado: das 21 notificações, só 1 é `das_*`, o `entidade_ref` dela casa
> com uma guia existente (1 de 1, nenhuma órfã), e essa guia **não está
> paga** — nada a resolver. Só 1 pendente de WhatsApp, logo nada a coalescer.
> **A coalescência nunca rodou contra backlog real** — quando a instância
> uazapi for provisionada, conferir `whatsapp_suprimidas` na resposta do cron.
>
> `tsc` 0 · vitest **1390/1390** (27 pulados; 2 testes novos) · `next build`
> limpo.

> ## ⛔ HISTÓRICO (sessão 21): push do fix de e-mail/sino + decisões registradas

> **Linha digitável do DAS no WhatsApp: EMPURRADA e em produção** (commits
> até `54ff95d`). Spec: `docs/superpowers/specs/2026-07-31-linha-digitavel-
> whatsapp-design.md`. Plano: `docs/superpowers/plans/2026-07-31-linha-
> digitavel-whatsapp.md` (subagent-driven, 3 tasks). Migrations `0064` e
> `0065` aplicadas — `0065` corrige o bug crítico achado numa revisão
> holística antes do push original: guia paga não cancelava a notificação
> de WhatsApp pendente, e agora a mensagem carrega código de pagamento.
>
> **Depois do push, o usuário pediu `/code-review`.** Achou 7 itens; 2 eram
> bugs reais da MESMA causa-raiz do que a `0065` já tinha corrigido só pro
> WhatsApp — **corrigidos nesta continuação, ainda NÃO empurrados**:
>
> 1. **`notificacoes_pendentes_email`** nunca filtrava guia paga — reenviava
>    lembrete pra sempre. Sem efeito prático hoje só porque o Resend está
>    bloqueado por domínio não verificado (só manda pro próprio e-mail de
>    teste), mas o defeito estava ativo no código.
> 2. **`SinoNotificacoes.tsx`** (sino da sidebar) lia `notifications` direto,
>    sem join nenhum — usuário continuava vendo "DAS a vencer" não-lido na
>    tela pra guia já quitada, **ativo agora**, visível pra qualquer usuário.
>    Substituído por RPC nova `notificacoes_sino` (SECURITY INVOKER, respeita
>    RLS de `notifications`+`guias_fiscais`).
>
> Migration `0066` aplicada e verificada contra o banco real (probe com
> `BEGIN`/`ROLLBACK` + `SET ROLE authenticated` simulando RLS de verdade).
> **Achado no processo de provar isso** (não no code-review original): a
> primeira versão do fix usava `g.status <> 'erro'`, que em SQL avalia pra
> `NULL` (não `TRUE`) quando `g.status` é `NULL` — e uma `WHERE` com `NULL`
> descarta a linha em vez de mostrar por padrão. Corrigido pra `IS DISTINCT
> FROM 'erro'` (null-safe) nas três RPCs (whatsapp/email/sino).
>
> `tsc` 0 · vitest 1388/1388 (27 pulados) · `next build` 0 erros/65 rotas.
> Commits: `86282ad` (limpeza — trim duplicado, mock morto) e `60d266f`
> (fix de e-mail/sino + migration `0066`).
>
> **Próximo passo exato:** `main` local está à frente de `origin/main` —
> **push pendente, precisa de confirmação explícita do usuário** (auto-deploy
> em produção). — ✅ **feito**: `f277115` está em `origin/main` (confirmado
> por `git fetch` na sessão 22). As três pendências abaixo também foram
> fechadas na sessão 22 (ver bloco no topo).
>
> **Pendências registradas, NÃO corrigidas nesta sessão (mesma causa-raiz,
> escopo explicitamente não aprovado pra esta rodada):**
> - **`/notificacoes` (a página cheia, não só o sino)** tem o mesmo gap —
>   lê `notifications` direto sem join. Achado durante o fechamento, não fazia
>   parte do que o usuário aprovou corrigir.
> - **Recomendação arquitetural do `/code-review`:** resolver a notificação
>   NO PONTO DE ESCRITA (`marcarGuiaPagaAction` cancelar/marcar a notificação
>   da guia ao confirmar o pagamento) em vez de filtrar em cada RPC de
>   leitura — mais robusto, cobre qualquer consumidor futuro de uma vez só,
>   mas é mudança maior. Os filtros de leitura (0065/0066) resolvem o
>   problema prático hoje; a refatoração fica como melhoria futura.
> - **Risco de rajada de mensagens duplicadas:** com `UAZAPI_TOKEN` não
>   configurado, o backlog de notificações D7/D3/D1/vencido de uma mesma
>   guia se acumula sem enviar nada; no dia em que a instância for
>   provisionada, o cliente pode receber várias mensagens quase idênticas
>   de uma vez (mesma linha digitável repetida). É uma decisão de produto
>   (dedupe/coalescer antes de enviar), não um bug simples — não decidido
>   nesta sessão.
---

> ## ✅ SMOKE DO 6A CONCLUÍDO (2026-07-29, sessão 17) — §0 a §9, todas passaram
> **Nenhum bug novo encontrado no smoke** — as duas rodadas de `/code-review` +
> `/systematic-debugging` da sessão 16 (17 achados) já tinham fechado tudo que o
> smoke poderia achar. Único wart real: o **card "Competência atual" e o wizard
> apontam para meses diferentes** (pré-existente, fora desta branch — ver a
> seção "O que este bloco NÃO resolve" do roteiro).
>
> **Confirmado explicitamente pelo usuário** (não assumido): o re-render do
> rascunho de IA no §7 **atualizou sozinho**, sem reload manual — a regressão
> que o 2º code-review consertou não voltou.
>
> **Três decisões tomadas na retomada:**
> 1. O texto aprovado do catálogo (`das-mei:inss+iss`, redigido com apoio de IA)
>    **fica** — conteúdo legítimo e reaproveitável para qualquer MEI de serviços.
> 2. A `config_ia` gravada em produção durante o §7 (chave OpenRouter cifrada)
>    **fica configurada** — produção passa a ter "Gerar com IA" ativo de verdade.
> 3. Cenário restaurado pela tela (§9): as três empresas de volta em
>    `regime="1"`, confirmado com `node scratchpad/seed-6a.mjs listar`.
>
> **Verificação final, nesta ordem:** suíte completa sem seed interferindo
> (1326/1326, 0 falhas) → `tsc --noEmit` (0 erros) → dev server parado → `next
> build` limpo (0 erros/warnings, 45 rotas confirmadas em
> `.next/app-build-manifest.json` — o resumo do `rtk` mostrou "1 routes" nesta
> sessão, era ruído do parser dele, não do build; confirmado com `npx next
> build` puro e com o manifesto).
>
> **Falta:** commit da documentação, merge `--no-ff` em `main`, e **push só com
> confirmação explícita** do usuário (auto-deploy em produção).
>
> Roteiro completo com os resultados: `docs/smoke/2026-07-29-bloco-6a-roteiro-smoke.md`.

> ## ⛔ HISTÓRICO: o que faltava antes do smoke
> **Bloco 6A COMPLETO — Tasks 1 a 12.** Branch `feat/bloco-6a-explicacao-ia`,
> **22 commits, NÃO mergeada, NADA empurrado.** Árvore limpa (só os dois
> untracked de sempre: um PDF na raiz e um `.docx` em `app/`).
> `tsc` 0 · vitest **1326/1326** · `next build` 0 erros, com
> `ƒ /admin/configuracoes/ia` e `ƒ /admin/explicacoes`.
> Migrations **0056 a 0060 aplicadas em produção**.
>
> **Duas rodadas de `/code-review` + `/systematic-debugging`**: 8 achados na
> primeira (Tasks 1–7), **9 na segunda** (branch inteira). Todos corrigidos com
> prova antes do conserto, e cada correção com sabotagem que morde.
>
> ### ✅ O caminho de IA JÁ FOI PROVADO contra provedor real
> A chave está em `app/.env.local` como **`TOKEN_OPENROUTER`**. Rodando o código
> **real** (`cliente.ts` + `prompt.ts`) contra o OpenRouter:
> - o adaptador OpenAI-compatível **é aceito**;
> - chave errada → **401 legível, sem a chave na mensagem**;
> - o prompt produz rascunho **com os marcadores certos e nenhum intruso**.
>
> ```bash
> cd app && npx vitest run --config scratchpad/vitest.ia.config.ts
> ```
> Essa config vive em `scratchpad/` (não versionada) e **não entra na suíte
> offline** — a suíte normal continua sem tocar rede. Modelo usado:
> **`mistralai/mistral-small-24b-instruct-2501`**. ⚠️ **Evitar `:free`**: o
> `google/gemma-4-31b-it:free` deu **429** (limite upstream, não é bug nosso).
>
> **O que o provedor real ensinou e o mock não podia:** o modelo tratava o
> marcador como se fosse o NOME do tributo (`"a contribuição {inss}"` → depois
> da troca, `"a contribuição R$ 75,90"`). O prompt passou a pedir segunda pessoa
> e a mostrar a forma certa — usando o **primeiro marcador da situação**, nunca
> um literal (a primeira tentativa injetava `{inss}` no prompt do PGDAS-D, onde
> ele é intruso; o próprio teste pegou).
>
> **Da segunda rodada, o que muda o roteiro do smoke:** o §7.4 dizia que o
> rascunho gerado "aparece no campo" — isso **não acontecia** (o textarea não
> ressincronizava depois do `router.refresh()`), e agora acontece. E os três
> escritores de `explicacoes_fiscais` passaram a ter **trava otimista** em
> `updated_at`: com duas abas abertas, a segunda gravação recusa com "recarregue
> a página" em vez de sobrescrever — comportamento novo, esperado no smoke.
>
> **▶ HÁ SMOKE PENDENTE.** Roteiro pronto em
> `docs/smoke/2026-07-29-bloco-6a-roteiro-smoke.md` (9 seções, já atualizado com
> tudo acima). A regra do projeto: **renderizar o roteiro completo na conversa
> logo na retomada**, sem esperar o usuário pedir — com os comandos, as contas e
> os valores esperados.
>
> ### Estado do cenário AGORA (conferido em 2026-07-29, fim da sessão)
> - **catálogo VAZIO**, `explicacoes_faltando` vazia, **`config_ia` vazia** — a
>   chave do OpenRouter **não** foi gravada no banco de propósito: quem a grava é
>   o §7, pela tela, que é o que ele testa;
> - **nenhum MEI**: as 3 empresas estão em `regime="1"`, `atividade_mei=null`
>   (ids e valores originais na tabela do roteiro) — o §0 promove a `ideapp`
>   **pela tela de Configurações** e o §9 desfaz;
> - nada meu ficou no banco: todas as sondas rodaram em transação desfeita ou
>   limparam o que criaram.
>
> Conferir antes de mostrar o roteiro (ambos somente leitura):
> `node app/scratchpad/_probe-6a.mjs` e `node app/scratchpad/seed-6a.mjs listar`.
>
> **Depois do smoke:** verificação com o cenário vivo → restaurar (§9) → rodar a
> suíte **sem** o cenário → `next build` com o dev parado → merge `--no-ff` →
> **confirmar antes do push** (auto-deploy em produção).
>
> **⛔ DUAS COISAS QUE O SMOKE PRECISA SABER ANTES DE COMEÇAR:**
> 1. **Não existe nenhum MEI no banco** (`Code_regime_tributario = '4'`: zero
>    empresas). A explicação só é renderizada no card do MEI — `isSimples`
>    manda a tela para o outro layout. Para ver a explicação na tela, o smoke
>    **precisa mudar o regime de uma empresa para `'4'` em produção**: pedir ao
>    usuário antes, anotar o valor original e restaurar no fim.
> 2. **`atividade_mei` é `null` nas 3 empresas fiscais.** Não é problema — cai no
>    fallback de Serviços, que é o mesmo da estimativa —, mas significa que a
>    chave exercitada será `das-mei:inss+iss`. Para testar outra, preencher a
>    coluna (e restaurar).
>
> **O que a Task 11 descobriu, e vale para o roteiro:** a explicação só aparece
> quando o total na tela é a soma dos componentes. Com guia real do SERPRO
> divergindo da estimativa (dívida do salário mínimo de 2025), ela **não
> aparece** — de propósito. No smoke, usar competência com apuração nossa
> (`valor_imposto`), não com guia do SERPRO, ou a explicação some e parecerá bug.
>
> **Escopo entregue:** a explicação renderiza **só para MEI**. O catálogo aceita
> chaves de PGDAS-D (`pgdas:anexo-iii+fator-r`) e o admin consegue aprová-las,
> mas nenhuma tela do Simples as consome ainda — fica para um bloco próprio.
>
> **O caminho manual é o único que funciona hoje.** Sem chave de IA, "Gerar com
> IA" está desligado na tela (dito na entrada, com o motivo). Escrever à mão e
> aprovar cria a linha e funciona ponta a ponta — dá para encher o catálogo e
> fazer o smoke inteiro do 6A sem nenhuma credencial de IA.
>
> - spec (aprovada): `docs/superpowers/specs/2026-07-28-bloco-6a-explicacao-ia-design.md`
> - plano: `docs/superpowers/plans/2026-07-28-bloco-6a-explicacao-ia.md` (12 tasks)
>
> **⚠️ TRÊS COISAS QUE MUDARAM O PLANO — ler antes de escrever a Task 8:**
> 1. **A Task 10 tem de usar o `createAdminClient()`** para chamar
>    `registrar_explicacao_faltando`. A 0059 tirou essa RPC de `authenticated`:
>    ela conta *situação*, não pessoa, e quem a chama é Server Component. Chamar
>    pela sessão do usuário agora dá 401.
> 2. **`upsert` é proibido neste repo** (o do PostgREST manda NULL nas colunas
>    ausentes). O plano pede upsert na Task 8 (`explicacoes_fiscais`) e na 7 —
>    na 7 já virou `select` → `update`/`insert`; a 8 precisa do mesmo.
> 3. **Guardas reais:** `requireAdminBaluPage()` / `requireAdminBaluAction()`
>    (`src/lib/admin/guard.ts`). Não existe `requireAdmin`.
>
> **Ainda pendente do usuário:** a **chave de IA** (só necessária para *gerar*
> rascunho, nunca para exibir) e o **salário mínimo de 2026** (o DAS-MEI usa o de
> 2025; agora é trocar `INSS_MENSAL` e o total se ajusta sozinho).
>
> ### 🔒 O que a sessão 16 achou de segurança, fora do escopo do 6A
> Conferir o **efeito** da 0056 no banco (em vez de aceitar que o SQL rodou)
> revelou que o `pg_default_acl` da role `postgres` abre **toda tabela e toda
> função nova** de `public` para anon/authenticated. Provado por HTTP com a anon
> key, **sem login**: `notificacoes_pendentes_email` devolvia e-mail de todos os
> usuários e `anonimizar_usuario` executava. Fechado nas **0057 + 0058 + 0059**,
> com 15 privilégios conferidos um a um e a fronteira HTTP re-sondada (401).
>
> **A 0057 sozinha NÃO bastava, e o comentário dela dizia que bastava** — um
> `/code-review` pegou. O `EXECUTE` que `acldefault()` concede a **PUBLIC**
> sobrevive ao revoke por schema, e anon é membro de PUBLIC; só a variante
> **GLOBAL** (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON
> FUNCTIONS FROM PUBLIC`, sem `IN SCHEMA`) fecha. A errata está na 0057 e o
> conserto na 0058, ambos com o mecanismo escrito por extenso.
>
> **Consequência para a próxima migration:** função nova nasce executável só pelo
> dono. Se uma RPC "não aparece" para a tela, é isso — o conserto é o `GRANT
> EXECUTE ... TO authenticated`, não afrouxar a 0058.
>
> ⚠️ **Sujeira de produção que EU criei e ficou:** uma sonda minha chamou duas
> RPCs de escrita que estavam abertas. As 6 notificações espúrias (chave com
> `1899`) foram **apagadas** — nenhuma lida, nenhuma enviada. **Ficou 1 honorário
> de R$ 1.890** (julho/2026, empresa `ideapp`, `atrasado`), por decisão do
> usuário: era devido desde 01/07 e a empresa é a do cenário de teste do 4B.
>
> **O que é o 6A.** O Bloco 6 do Master PRD junta IA e WhatsApp; virou **6A (IA)**
> e **6B (WhatsApp)**, pela mesma lógica que dividiu o 4. E dentro do 6A, apenas a
> **primeira** das três features de IA: **explicar imposto**. Sugestão de código de
> serviço e onboarding conversacional viram blocos próprios.
>
> **As três decisões do usuário que moldaram o desenho:**
> 1. **Só a FORMA sai da Balu.** A IA recebe `{ tributo, regime, componentes }` e
>    devolve texto **com marcadores**; a Balu troca `{inss}` por `R$ 61,60` na hora
>    de exibir. Nenhum dado de contribuinte atravessa a fronteira — não há
>    transferência internacional a fundamentar porque não há dado de titular.
> 2. **Uma vez por situação, revisada por humano.** Consequência direta da
>    primeira: se a explicação descreve uma *situação* e não um *cliente*, ela é
>    idêntica para todo MEI do país. Isso deixou de ser "IA no caminho da
>    requisição" e virou **catálogo**: custo ~zero, latência zero, provedor fora do
>    ar é indiferente, e nenhum texto sobre tributo chega ao cliente sem um humano
>    ter lido (DL 9.295/46).
> 3. **Provedor escolhido pelo AdminBalu** — dropdown com Anthropic, Gemini,
>    OpenAI, OpenRouter, Groq, DeepSeek, Mistral e "Personalizado", chave cifrada
>    no banco. **Dois adaptadores cobrem a lista inteira** (a chamada é texto entra
>    / texto sai). É barato *por causa* das decisões 1 e 2: sem dado do cliente
>    saindo, trocar de provedor não mexe no risco; com revisão humana, provedor
>    ruim vira rascunho rejeitado.
>
> **Nenhuma credencial de IA existe** (`ANTHROPIC_API_KEY` ausente, sem SDK, sem
> `src/lib/ai/`). O usuário disse que **vai pegar a chave em breve** — e o desenho
> só precisa dela para **gerar rascunho**, nunca para exibir.
>
> **Três achados levantados contra o repo real, que o PRD errava:**
> - **Não existe lista oficial de códigos de serviço.** São 10 escritos à mão em
>   `codigos-tributacao.ts` e um validador que só confere 6 dígitos — `999999`
>   passa. E o repo usa a **Lista Nacional (6 dígitos)**, não a LC 116 (`X.XX`)
>   que o PRD cita. **Pré-requisito da feature de sugestão de código.**
> - **O Pix do DAS é suposição.** O PRD afirma que o SERPRO devolve o
>   copia-e-cola; nosso parser não lê campo nenhum de Pix e **descarta em silêncio
>   o que não lê**. **Pré-requisito do 6B** — sondar quando houver credencial.
> - **O DAS-MEI usa o salário mínimo de 2025** (R$ 1.518 → INSS 75,90), com um
>   comentário mandando conferir "quando o de 2026 for oficial". Já é julho de
>   2026: **a estimativa provavelmente está errada hoje**, independentemente do
>   6A. A Task 1 do plano estrutura a composição; trocar o valor vira uma linha.
>
> ⚠️ **Pendência do 4B combinada com o usuário:** o cenário do smoke (4 cobranças,
> 1 serviço avulso, 2 honorários, a subconta) **fica vivo como prova de que o teste
> foi feito**, e a limpeza acontece **antes da entrega ao dono do produto**.

---

> ## ✅ SMOKE DO 4B CONCLUÍDO (2026-07-28) — §1 a §10, todas passaram
> **Nenhum bug novo** — o primeiro bloco do projeto em que isso acontece. Não é
> sorte: o `/code-review` + `/systematic-debugging` rodados **antes** do smoke
> acharam 6 problemas (`7b4a233`), incluindo a corrida de lost-update que teria
> aparecido justamente no §7.
>
> **Provado ao vivo contra o Asaas:** as 4 cobranças dão **200 pela subconta e
> 404 pela conta-mãe**; o trinco recusa emissão **sem tocar no Asaas**; a
> reconciliação faz o pagamento aparecer **sem webhook nenhum**; o estorno
> desfaz o semáforo e **3 rodadas** do cron não o ressuscitam; o gate alcança
> **criar** mas não **ver**, **receber** nem o cliente final.
>
> ⚠️ **CENÁRIO DEIXADO VIVO por decisão do usuário:** 4 cobranças, 1 serviço
> avulso, 2 honorários de teste e a subconta ficam no banco **como prova de que
> o teste foi feito**. **A limpeza acontece antes da entrega ao dono do
> produto** — é uma pendência real, não lixo esquecido. A assinatura do
> escritório JÁ foi restaurada (`cortesia`, `plano_id` nulo).
>
> Roteiro completo com os resultados: `docs/smoke/2026-07-28-bloco-4b-roteiro-smoke.md`.

> ## ⛔ HISTÓRICO: o que faltava antes do smoke
> **Roteiro pronto e renderizado:** `docs/smoke/2026-07-28-bloco-4b-roteiro-smoke.md`
> (10 seções). **Mostrá-lo na conversa é a primeira coisa a fazer**, sem esperar
> o usuário pedir.
>
> **Estado:** branch `feat/bloco-4b-subcontas`, árvore limpa (só os dois
> untracked de sempre: um PDF na raiz e um `.docx` em `app/`). **Nada pela
> metade, nada a desfazer.** Nenhum `node` vivo. Cenário do smoke **NÃO montado**
> — nenhuma subconta, nenhuma cobrança, catálogo vazio; é o próprio smoke que
> monta, pelas telas.
>
> **Verificação no fecho:** `tsc` 0 · vitest **1142/1142** (27 pulados) ·
> `next build` **0 erros / 56 rotas**.
>
> **O código passou por `/code-review` + `/systematic-debugging` antes do smoke**
> (commit `7b4a233`): 6 achados, 5 corrigidos. O grave era uma **corrida de
> lost-update** nascida na própria Task 13 — a varredura virou o segundo escritor
> de `cobrancas_escritorio` e um UPDATE cego por `id` deixava um estorno recém-
> chegado ser sobrescrito por um snapshot velho, marcando pago um honorário cujo
> dinheiro voltou. Resolvido com compare-and-swap. Detalhes na seção da sessão 15.
>
> **A seção que decide o merge é a §9:** `node scratchpad/_probe-4b.mjs`. Cada
> cobrança é consultada pela subconta (tem de dar **200**) e pela conta-mãe da
> Balu (tem de dar **404**). Se a conta-mãe enxergar qualquer cobrança, o bloco
> **não vai para `main`** por mais que todas as telas funcionem.
>
> **Duas coisas que o smoke local NÃO prova, e não são bug:** (a) o webhook da
> subconta não pode ser cadastrado em local — `NEXT_PUBLIC_SITE_URL` é
> `localhost` e `ehUrlEntregavel` recusa `http`/localhost de propósito, e
> `ASAAS_WEBHOOK_SECRET` nem está no `.env.local`; (b) portanto o pagamento não
> chega sozinho — quem o faz aparecer é a **reconciliação da Task 13**, e é
> exatamente isso que o §6 do roteiro testa.
>
> Dependências externas que seguem de pé: aprovação comercial do Asaas para
> criar subconta **em produção** (sandbox já funciona), o
> `ASAAS_WEBHOOK_SECRET` (≥32 chars) para o webhook em produção, e as premissas
> do Michel (§8 da spec).

---

## Sessão 15 (2026-07-28) — Tasks 13 e 14, navegação, e o 4B fica pronto para o smoke

Três commits: `468f8d9` (Task 13), `ebb75dc` (navegação + tela nova), `d6e3877`
(roteiro do smoke).

### Revisão das duas frentes que a sessão 14 deixou sem revisar

A Task 12 (`34a9a62`) e o cadastro do webhook (`dd6b285`) foram revisadas antes
de tudo. **Nada a corrigir** — leitura pela sessão com a policy real, chave da
subconta que entra e não sai, best-effort na criação para não gerar subconta
duplicada. Um detalhe herdado: as mensagens de `avisoDoDiagnostico` prometem
"conferência diária", que só passou a existir com a Task 13.

### Task 13 — a varredura, e as quatro decisões do plano que não sobreviveram

Nenhuma das quatro decisões do snippet do plano resistiu ao repo real:

1. **`lerCredencial` FORA do `try`**, com `if (!token) continue` supondo retorno
   nulável. Ela **lança** desde a sessão 14 — uma contabilidade corrompida
   derrubaria a reconciliação de **todas**, justo a rede de segurança.
2. **Perdia o ESTORNO.** O plano copiava só a metade que ACENDE o semáforo do
   honorário. Em vez de repetir o código, a escrita foi **extraída** para
   `lib/billing/aplicar-cobranca-escritorio.ts` e **o webhook passou a chamar a
   mesma função**. Sabotar o ramo do estorno agora derruba **os dois** caminhos
   ao mesmo tempo — e essa é a prova de que não há como divergirem.
3. **Filtrava por `asaas_subconta_status = 'aprovada'`.** Emitir exige KYC;
   reconhecer o pagamento de uma cobrança **já emitida** não pode exigir nada.
   KYC que regride não apaga os boletos na mão dos clientes.
4. **Lia só a primeira página.** A rede viraria buraco no escritório com mais de
   100 cobranças — o que tem mais dinheiro em jogo.

**Levantado contra o sandbox** (`_probe-listar-pagamentos.mjs`): `GET /v3/payments`
devolve `{ object, hasMore, totalCount, limit, offset, data }`, e o item da
**lista** traz `paymentDate` **e** `confirmedDate` — iguais aos do corpo do
webhook, que é o que permite a mesma escrita servir aos dois sem tradução.
`paymentDate` vem **`null`** em cobrança não paga: o tipo `PagamentoAsaas` dizia
`string | undefined`, era o **tipo** que mentia.

> ⚠️ **`?status=BANANA` responde 200 e devolve a lista INTEIRA.** Filtro de
> status com erro de digitação não falha: varre tudo **parecendo** que filtrou.
> Daí não haver filtro de status na varredura, com teste que morde se aparecer.

Teto de 50 páginas (5.000 cobranças/dia) como freio contra `hasMore` que nunca
desce. Bater no teto é **contado e logado** — varredura truncada em silêncio é
pior que varredura nenhuma, porque parece completa.

**Quatro sabotagens provadas**, cada uma falhando no teste certo (credencial
fora do try; filtro por 'aprovada'; ramo do estorno removido — derrubou webhook
**e** varredura; leitura de uma página só).

**Vazamento que o teste pegou:** o log de falha da varredura podia carregar o
token se a mensagem viesse de fora. A mensagem do cliente Asaas hoje não o
carrega, mas ela é montada longe dali e a regra do módulo é "nunca entra em log,
**inclusive log de erro**" — agora é redigida com `mascarar` antes de sair.

### Navegação: duas decisões do usuário e um bug que a seção criou

**Decisão 1 — "Cobranças" do empresário aparece quando existe BOLETO**, não
quando existe escritório. Ele convivia com "Honorários" falando da mesma dívida,
e a maioria dos escritórios cobra fora da Balu: para esses o item era tela vazia
permanente. O layout pergunta com `limit(1)`, não `count` (a pergunta é
"existe?"). Não exige escritório aprovado nem subconta de pé — uma vez emitido,
o boleto está na mão do cliente.

**Decisão 2 — a tela que não existia.** O CHECKPOINT descrevia a seção
agrupando três telas; **só duas existiam**. O contador via cobrança dentro de
`/contador/honorarios` e por cliente, e uma **avulsa vencida não aparecia em
lugar nenhum** — ele não tinha onde perguntar "o que está em aberto comigo?".
Criada `/contador/cobrancas`: abas por situação, origem (honorário × avulso),
totais do recorte atual, link da fatura para reenviar sem entrar no painel do
Asaas. Leitura pela **sessão** — a primeira perna da policy `cobrancas_escritorio_select`
é literalmente essa tela.

**O vocabulário de status virou compartilhado.** `cobrancas-vm.ts` saiu da pasta
da tela do cliente e virou `lib/billing/cobranca-escritorio-vm.ts`: duas telas
leem a **mesma** cobrança agora, e rótulos separados fariam a conversa entre
cliente e escritório começar com os dois olhando telas que discordam.

**O bug que a seção criou, e que foi corrigido:** o realce do menu era
`pathname.startsWith(href)` e funcionava **só porque nenhum href era prefixo de
outro**. `/contador/configuracoes` é prefixo de `/contador/configuracoes/subconta`
— os **dois** itens acendiam. A regra virou `components/menu-ativo.ts` (puro, com
teste, porque **não há jsdom neste repo**): vence o href mais **longo**, e o
prefixo tem de terminar em `/` — senão `/contador` acenderia numa futura
`/contadores`.

### Task 14 — o probe e o roteiro

`scratchpad/_probe-4b.mjs`, **somente leitura**, e de propósito **não cria** a
subconta nem a cobrança: ele audita o caminho de produção, não um caminho
sintético que só ele percorre. A metade que o plano não tinha: além do **404
pela conta-mãe**, ele consulta a mesma cobrança **pela subconta e exige 200** —
sem isso, um `chargeId` errado daria 404 e o probe diria "separado" sem ter
olhado para nada. **Um 404 sozinho não prova separação; prova ausência.**

Ferramentas novas em `app/scratchpad/`: `_probe-listar-pagamentos.mjs`,
`_probe-4b.mjs`, `_estado-4b.mjs` (estado do cenário), `_sandbox-pagar.mjs`
(pagar/estornar no sandbox **sem tocar no banco** — é o banco que a reconciliação
tem de atualizar sozinha; se o script mexesse na tabela, o smoke provaria a si
mesmo), `_fk-cobrancas.mjs`.

### A rodada de revisão antes do smoke (`7b4a233`)

`/code-review` + `/systematic-debugging`. Seis achados; **cinco viraram
correção**, e um era assert meu mal calibrado.

**O grave, e ele nasceu na Task 13.** Até esta sessão o webhook era o **único**
escritor de `cobrancas_escritorio`, e um `UPDATE ... WHERE id` bastava. A
varredura o tornou o **segundo** — e ela lê uma **página inteira** (até 100
linhas) antes de aplicar uma a uma, então o snapshot da última linha pode estar
dezenas de round-trips velho. Um `PAYMENT_REFUNDED` chegando no meio era
sobrescrito: a varredura reavaliava a trava "estorno é terminal" contra um estado
que já não existia e regravava `paga`, marcando pago um honorário cujo dinheiro
tinha voltado. **`aplicarEventoNaCobranca` decidia certo sobre um estado errado**
— a falha escapava por fora dela. Conserto: **compare-and-swap**
(`.eq('status', cob.status)` + linhas afetadas); zero linhas = outro escritor
moveu, descarta sem retentar.

> **A lição, e ela vale para qualquer bloco:** *acrescentar um segundo escritor a
> uma tabela invalida as travas de concorrência do primeiro.* Nenhum teste do 4B
> falhou quando a varredura nasceu, porque todos exercitavam um escritor de cada
> vez. O teste que pegou isso precisou de um gancho (`aoAplicar`) que simula o
> webhook chegando **entre** a leitura e a escrita — e os dois mocks de UPDATE
> tiveram de passar a **honrar as condições `.eq`**: mock que responde "afetou"
> sempre faria um CAS quebrado parecer funcionar.

**Os outros quatro:** (a) **boleto órfão** nunca era detectado depois da emissão —
a varredura é o único componente que vê os dois lados, e o `externalReference`
torna o reconhecimento exato; agora é contado (`orfaos`) e logado; (b) **ordem
explícita** `sort=dateCreated&order=desc` na listagem, porque batendo o teto de
páginas é a ordem que decide qual ponta fica de fora — e o `order` foi **sondado**,
não assumido (a lição do `status=BANANA` vale para qualquer parâmetro); (c)
**`maxDuration = 60`** nas duas rotas de cron, que não declaravam nenhum: timeout
de wall-clock não é capturável por try/catch, e como a varredura roda por último
ela seria a primeira sacrificada — em silêncio; (d) **cap calado** em
`/contador/cobrancas`: sem `.limit()` valia o "Max rows" do Supabase e **os totais
eram somados sobre o array cortado**; agora `LIMITE=200` com aviso na tela e
totais rotulados "(parcial)". E (e) o **nome do cliente que saiu do escritório**,
que o embed pela sessão não alcançava — cobranças em aberto apareciam como
"Cliente sem nome".

**O achado que não era achado, e o que ele ensinou.** O probe acusou
`asaas_api_key_cifrada` acessível a `authenticated`: era `INSERT`, e
`contabilidades` tem RLS ligada e **nenhuma policy de INSERT** — grant de coluna
inalcançável. Pior: o mesmo probe usava `.includes()` sobre um `array_agg` que o
driver devolve como **string**, ou seja, fazia *substring match* e dava a resposta
certa por acidente. **Assert mal calibrado custa o mesmo que teste que não morde:
some a diferença entre achado e ruído.**

**Confirmado no caminho** (evidência, não suposição): a `0053` funcionou como
documentado — SELECT em todas as colunas menos a chave, UPDATE só nas 4 previstas;
e o conjunto `DELETE/TRUNCATE/…` é o **default da plataforma Supabase**, idêntico
em `companies`, `notifications`, `assinaturas` e `cobrancas`, todas pré-4B.

Probes novos, todos somente leitura: `_probe-fronteiras-4b.mjs` (grants, embed do
PostgREST, as consultas novas contra o banco real), `_probe-paginacao.mjs` (o laço
de produção rodado contra o Asaas: 4 voltas em `limit=1`, para sozinho, cobertura
idêntica a `limit=100`), `_probe-ordem.mjs`. A varredura também foi executada no
**runtime real** via `/api/cron/billing`.

### Dívidas registradas nesta sessão

- `/honorarios` e `/cobrancas` **continuam convivendo** no menu do cliente por
  decisão do usuário: um honorário cobrado aparece nas duas telas, com status
  calculado por caminhos diferentes. Aceito conscientemente; reavaliar se o
  smoke mostrar que confunde.
- As duas telas antigas continuam em `/contador/configuracoes/{subconta,avulsos}`
  na **URL** — só a posição no menu mudou. Mudar a rota quebraria link já mandado.
- Seguem de pé as da sessão 14: `DROP COLUMN` dos ganchos mortos da `0032`;
  `UNIQUE (contabilidade_id, lower(nome))` no catálogo; órfão de webhook só em
  `console.error`; `db_atual.sql` e `types/database.ts` atrasados desde a `0050`.

---

## Sessão 14 (2026-07-28) — Bloco 4B em execução (subagent-driven)

**Tasks 1–12 do plano fechadas**, cada uma com subagente próprio + revisão de conformidade e de qualidade. Branch `feat/bloco-4b-subcontas`, 38 commits, **não mergeada**. Migrations `0053`, `0054` e `0055` aplicadas em produção.

**Verificação no fecho da sessão** (commit `e1cc9f5`, ambiente limpo, nenhum node vivo): `tsc --noEmit` **0 erros** · vitest **1112 passando / 0 falhando** (27 pulados — os smoke/e2e que exigem credencial) · `next build` **compilado com sucesso, 0 erros**.

> ⚠️ **Duas frentes pousaram DEPOIS do pedido de encerramento e NÃO passaram por revisão:** a Task 12 (`34a9a62`) e o cadastro do webhook na subconta (`dd6b285`). Estão commitadas e verdes (`tsc` 0, 1112 testes), mas **nenhuma teve revisão de conformidade nem de qualidade**, ao contrário das Tasks 1–11. **Revisá-las é a primeira coisa a fazer, antes da Task 13.**
>
> **Nota da Task 12, decisão de produto pendente:** o empresário passou a ter **dois itens de menu concorrentes** — `/honorarios` (razão manual de mensalidades, sem link de pagamento, status calculado por data) e `/cobrancas` (boleto real da subconta, status do Asaas). Um honorário cobrado aparece **nas duas telas, com status calculado por caminhos diferentes**. Isso vai gerar pergunta no smoke. Decidir se `/honorarios` vira aba de `/cobrancas`, ou se some do menu quando o escritório usa subconta.

### O achado que vale mais que o código desta sessão

**O plano do 4B tem código pronto, e parte dele não funciona.** Não é plano ruim — é o que acontece quando um desenho vira código e encosta no repo e no banco reais. Mas mudou o método: **toda task passou a mandar o subagente conferir as suposições do plano antes de usá-las e reportar as divergências em vez de contorná-las em silêncio.** Nenhuma das 12 tasks passou sem divergência.

Três defeitos que nenhuma verificação automática pegaria, e que só apareceram porque alguém abriu o arquivo:

1. **O bloco nunca emitiria uma cobrança.** O plano gravava `asaas_subconta_status = 'pendente'` na criação, gateava a emissão (linha 1637) e a sincronização (2085) em `'aprovada'` — e **nenhuma das 2300 linhas jamais escrevia `'aprovada'`**. Resolvido consultando o Asaas de verdade (§KYC abaixo).
2. **Retry num POST que devolve segredo de uso único.** `call` repetia `POST /v3/accounts` até 3× em 5xx/rede. Um 504 depois da criação deixava subconta órfã com a `apiKey` perdida **e sem registro em `audit_log`** — exatamente a janela que a Task 5 existia para fechar. Agora essa rota não retenta, e falha ambígua grava `subconta.possivel_orfa` com o documento para busca manual.
3. **Um teste que anunciava uma invariante e não a checava.** O caso "a chave não vaza" montava o pior cenário e depois inspecionava **só o retorno**, enquanto os dois testes vizinhos inspecionavam os logs. Com a redação sabotada **e** o assert antigo, o teste passava. Corrigidos os dois lados.

**A regra que se firmou na sessão, e que vale além do 4B:** *garantia de servidor não pode depender da tela.* Apareceu três vezes — o "apagar" do catálogo travado só na interface, a chave de idempotência opcional (Server Action é endpoint público), e o botão desabilitado apresentado como se fechasse uma corrida.

### Dois bugs de PRODUÇÃO corrigidos, nenhum deles do 4B

- **`0054`** — `criar_assinatura_trial()` quebrava **todo cadastro de escritório novo** desde a `0050`. Detalhes no §landmines.
- **`e5685a4`** — estorno ressuscitado por evento reentregue no **4A**. `persistirCobranca` preservava `pago_em` no estorno (de propósito), mas `jaPaga = Boolean(pago_em)` continuava verdadeiro, e um `PAYMENT_RECEIVED` reentregue devolvia o status para `RECEIVED`. Agora `REFUNDED`/`REFUND_REQUESTED` são terminais para evento de pagamento. Os valores saíram do `efeitoDoStatusCobranca` que o próprio 4A já usa — não de suposição.

### O status do KYC, que destravou o bloco

`GET /v3/myAccount/status` com o token da **própria subconta** (a conta-mãe não tem rota de KYC por subconta). Sondado no sandbox: devolve **quatro** eixos — `commercialInfo`, `bankAccountInfo`, `documentation`, `general`. `mapearStatusSubconta` exige **os quatro** em `APPROVED` para promover; qualquer `REJECTED` recusa; **todo o resto vira `pendente`**. Exigir os quatro é deliberado: a doc diz que `general` deriva só de `commercialInfo`+`documentation`, então `general: APPROVED` com `bankAccountInfo: PENDING` é estado possível — subconta que cobra sem conta bancária aprovada acumula saldo que o escritório não saca. Errar para cima custa um clique em "sincronizar"; errar para baixo faz a cobrança falhar na frente do cliente do escritório.

**Limite honesto:** só o valor `APPROVED` foi observado ao vivo (a conta-mãe está 100% aprovada e **não há nenhuma subconta no sandbox** — `GET /v3/accounts` devolve `totalCount: 0`). O mapeamento é à prova disso por construção, mas vale rodar `app/scratchpad/_probe-kyc-subconta.mjs` quando a primeira subconta pendente existir.

### Idempotência da emissão: a arbitragem acontece ANTES do Asaas

Duplo clique simultâneo emitia **dois boletos reais**. A `0055` fechou com **três camadas, nesta ordem**:

1. **Reserva** (`reservas_cobranca_escritorio` + RPCs `reservar_emissao_cobranca`/`liberar_reserva_cobranca`) — trinco tomado **antes de qualquer chamada ao Asaas**, na chave desta emissão: `hon:<uuid>` (chave natural do honorário) ou `idem:<uuid>` (submissão do avulso). **Quem perde não fala com o Asaas.**
2. **Pré-checagem já com o trinco na mão** — nunca antes; perguntar primeiro deixa a janela em que o vencedor commita entre a pergunta e a reserva do perdedor.
3. **Índices únicos parciais** como rede de baixo: uma cobrança **viva** por honorário (`pendente|paga|vencida`; `estornada` não conta, para permitir recobrar) e `(contabilidade_id, idempotency_key)`.

**A decisão mais sutil:** o trinco **não é devolvido depois de erro ambíguo** (5xx, timeout, 2xx sem `id`). Ali a cobrança *pode* ter nascido, e devolver o trinco na hora transformaria o próximo clique num segundo boleto **certo**. O TTL de 120s decide, e a reserva vencida é **roubada** pelo pedido seguinte no mesmo statement (com coluna `dono`, para que liberar seja exato). Pior caso: trancado por 2 minutos, nunca para sempre.

**Caso residual irredutível:** erro ambíguo do Asaas **depois** de `criarCobranca` — não há como saber se nasceu. Delimitado no tempo, sem retry automático, com mensagem mandando conferir.

**A chave do avulso** é UUID gerado na tela **uma vez por abertura do diálogo**, renovado **só após sucesso** (erro não renova: repetir com a mesma chave é o que impede o segundo boleto quando a falha foi ambígua). Ela não descreve *o que* se cobra — descreve **qual submissão está se repetindo**, e por isso não barra cobrança legítima repetida. Falha fechada: sem fonte criptográfica, o botão recusa emitir em vez de cair para `Math.random()`.

### Decisões tomadas durante a execução (além das duas da retomada):
- **Status do KYC vem do Asaas**, via `GET /v3/myAccount/status` com o token da própria subconta — nenhuma outra fonte é verdade sobre KYC.
- **Navegação: seção "Cobranças" no menu lateral do contador**, agrupando conta de recebimento, catálogo de avulsos e cobranças emitidas. É módulo novo do produto, não ajuste de configuração, e o escritório volta nele toda semana. Fazer **depois da Task 12**, com todas as telas prontas.
- **Modelo de papéis fica como dívida registrada** (ver §papéis abaixo), não interrompe o 4B.

**Duas decisões tomadas na retomada:** execução **subagent-driven** (um subagente por task + revisão de spec e de qualidade entre elas), e o **gate de inadimplência do 4A bloqueia apenas *criar* cobrança nova pela subconta** — nunca alcança ver, sincronizar ou receber as já emitidas, porque é com esse dinheiro que o escritório paga a Balu. Mesma forma das duas fronteiras do 4A.

### Duas landmines novas, ambas em `contabilidades`

**1. A tabela não tem mais grant de tabela para `anon`/`authenticated`.** A 0053 acrescentou as cinco colunas `asaas*` e elas caíram debaixo das policies da `0035:20-27`, que dão SELECT **e UPDATE** a qualquer membro do escritório sobre a linha inteira. Pela anon key dava para se autoaprovar o KYC (`asaas_subconta_status='aprovada'`) e, pior, **zerar `asaas_api_key_cifrada`** — chave que o Asaas devolve uma única vez e sem a qual a subconta fica inoperável.

O conserto (fim da 0053) **não pôde ser `REVOKE` por coluna**: privilégio de tabela e de coluna se **somam**, então revogar a coluna com o grant de tabela de pé não corta nada e **falha em silêncio**. Foi preciso revogar no nível da tabela e reconceder coluna a coluna — UPDATE só nas 4 colunas que a `0030:84` já pretendia (`nome, logo_url, whatsapp_suporte, email_remetente_nome`), SELECT em todas menos `asaas_api_key_cifrada`.

**Consequência que vai morder:** **coluna nova em `contabilidades` nasce ilegível para o cliente** até alguém reaplicar o bloco `DO` do fim da 0053. E um `GRANT ALL ON ALL TABLES IN SCHEMA public` futuro reabre tudo calado.

**2. `criar_assinatura_trial()` quebrava todo cadastro de escritório novo — em produção desde a 0050.** Corrigido pela **migration 0054**, já aplicada. A guarda era `IF TG_TABLE_NAME = 'companies' AND NEW.contabilidade_id IS NOT NULL`; **PL/pgSQL não garante short-circuit**, e a mesma função serve `trg_assinatura_contabilidade`, onde a coluna não existe → todo `INSERT INTO contabilidades` morria com `42703`. Passou meses despercebido porque só existe uma contabilidade, criada antes da 0050. Provado antes/depois em `BEGIN`/`ROLLBACK`, incluindo os dois caminhos de `companies`.

### `lerCredencial` agora LANÇA — as Tasks 9 e 13 precisam mudar por causa disso

O landmine do Bloco E foi retirado de verdade: `decifrarCampo` **rodou em runtime com a `CERT_ENC_KEY` real**, devolvendo o token `$aact_…` idêntico ao que entrou. (O probe do plano reimplementa o AES, então provaria a *chave* e não o *código*; a prova válida foi injetar a chave real na suíte, porque o `beforeAll` usa `??=` e a env vence a sintética.)

No caminho, `lerCredencial` foi endurecida: **lança** quando falta o prefixo `enc:v1:`, em vez de herdar de `decifrarCampo` o fallback que devolve o valor cru. Esse fallback existe para certificado gravado em claro antes do Bloco E; para a apiKey da subconta **não há legado**, e devolver o valor cru esconderia o segredo mais sensível do sistema em claro no banco, parecendo que tudo funciona.

**Efeito colateral a corrigir quando as tasks chegarem:** o plano chama `lerCredencial` **fora** do `try` em dois lugares — Task 13 (linhas 2089-2098, `sincronizarCobrancasEscritorio`) e Task 9 (linha 1671) — e escreve `if (!token) continue`, supondo retorno nulável. Com o throw, **uma** contabilidade corrompida derruba a reconciliação de **todas** — e essa varredura é justamente a rede de segurança para o webhook que não chega. A leitura tem de ficar **dentro** do `try`, um por linha.

O literal `'enc:v1:'` foi eliminado da duplicação: `envelope.ts` passou a exportar `PREFIXO`. Sem isso, uma futura `enc:v2:` faria `lerCredencial` acusar "gravação corrompida" em credencial perfeitamente válida — a falha mais enganosa possível, porque aponta o dado bom.

### O plano do 4B tem código escrito contra APIs que não existem

Padrão que apareceu em três tasks seguidas e que nenhuma verificação automática pega: o plano traz código pronto, mas parte dele foi escrita contra funções inventadas. `requireContadorAction`, `requireContadorPage` e `exigirAcessoContador` (linha 1637) **não existem no repo** — o real é `getContabilidadeCtx()` em `@/lib/contador/guard**s**` (plural), com forma de retorno diferente. `tsc` não pega (o arquivo nem chega a existir), teste não pega. Só pega quem abre o arquivo real. **Toda task do 4B daqui em diante manda o subagente conferir as suposições do plano antes de usá-las e reportar as divergências, em vez de contorná-las em silêncio.**

O mesmo padrão produziu o defeito de fluxo do §KYC acima: `'aprovada'` gateava tudo e ninguém escrevia.

### Sem modelo de papéis, qualquer membro decide onde o dinheiro do escritório liquida

`contabilidade_membros` não tem coluna de papel (`0030_contabilidades.sql:24-32`, com o TODO "dropar na V2/papéis"). Então **qualquer membro convidado** pode criar a subconta — isto é, escolher em qual CPF/CNPJ vai liquidar o dinheiro que os clientes do escritório pagam — e a guarda de "já tem subconta" torna a escolha **irreversível pela UI**. É coerente com o resto do produto hoje; o 4B é apenas a primeira ação em que a ausência de papéis custa dinheiro. **Decisão do usuário: registrar e seguir** — dívida conhecida, bloco próprio depois, feito direito e alcançando todas as ações sensíveis, não só esta. Hoje só existe um escritório e ele tem um dono; o risco vira real quando escritórios começarem a convidar equipe.

### Buraco no plano do 4B: a cobrança de honorário nunca era emitida

A tabela de arquivos a modificar do plano (linha 65) promete **"Gerar cobrança" no honorário**, e o webhook (linha 1910) e a sincronização (2110) já tratam `cob.honorario_id` — mas **nenhuma task preenchia `honorario_id`**. O único caminho de emissão escrito era o de **serviço avulso**, o que deixaria de fora a **mensalidade**, o principal que um escritório cobra. O módulo de honorários já tinha sido construído esperando isso: a `0032` criou `asaas_charge_id` e `asaas_customer_id` com o comentário literal `-- gancho Bloco B`.

**Decisão do usuário: emitir por clique, dentro do 4B** — os dois caminhos (avulso e honorário), sempre por ação do contador. **Nada de cron nem emissão automática**: dinheiro emitido sem humano no laço é outro perfil de risco, e um cron errado emite para a carteira inteira.

**Cuidado herdado:** passaram a existir **três** ligações honorário↔cobrança. A canônica eleita é **`cobrancas_escritorio.honorario_id`** — é a direção em que a resposta do dinheiro chega (webhook e cron só têm o `chargeId`) e mora na mesma linha do `asaas_charge_id UNIQUE`. `honorarios.cobranca_escritorio_id` é **derivada** (escrita na emissão com compare-and-swap, lida só para "já tem cobrança?"; **nenhuma decisão de pagamento passa por ela**). `honorarios.asaas_charge_id`/`asaas_customer_id` (ganchos da `0032`) ficaram **mortos de propósito** — preenchê-los seria a terceira ligação meia-preenchida. **Recomendação: `DROP COLUMN` na próxima migration do bloco.**

### O webhook da subconta NÃO ESTÁ CADASTRADO — o ciclo não fecha

Achado da Task 11, fora do plano: **não existe no repo nenhuma chamada a `POST /v3/webhooks`**, `asaasSub` não tinha o método, e o plano não menciona. O webhook da conta-mãe (cadastrado à mão no painel) entrega apenas os eventos **da conta-mãe**. Logo, **nenhum evento de subconta chega**: o roteamento do 4B está correto e **dormente**, e o escritório emitiria cobrança sem jamais saber que foi paga.

A falha é do **lado seguro** — sem cadastro nada chega, e nada é marcado como pago indevidamente. O portão de autenticidade (`segredoDoHeader` com `ASAAS_WEBHOOK_SECRET`) roda **antes** de ler o corpo e vale igual para os dois ramos; sem o segredo certo a entrega morre em `unauthorized`.

**Preocupação residual herdada do 4A:** o segredo é *bearer*. Quem o descobrir consegue postar `PAYMENT_RECEIVED` — no 4A isso mexia no dinheiro da Balu; no 4B passa a marcar honorário de terceiro como pago. Atenuante: é preciso acertar um `asaas_charge_id` existente, porque cobrança desconhecida é ignorada e **nenhum dos dois ramos faz INSERT**.

**Roteamento:** por ausência de `subscription`. O payload do Asaas **não traz dono** (conferido contra o objeto real capturado em `asaas.e2e.test.ts`), e `externalReference` foi rejeitado por ser campo escolhido pelo remetente. O desenho compensa: **a ausência escolhe o RAMO, a busca decide a AÇÃO** — os dois ramos só agem sobre linha existente e nenhum faz INSERT, então evento roteado para o lado errado vira log e 200.

### ⛔ AÇÃO DO USUÁRIO: `ASAAS_WEBHOOK_SECRET` não existe, e sem ele nenhuma subconta registra

O cadastro do webhook (`dd6b285`) usa o **mesmo** `ASAAS_WEBHOOK_SECRET` que o `route.ts` já valida. **Ele não está em `app/.env.local`** (conferido: zero ocorrências) e precisa existir também na Vercel, **com no mínimo 32 caracteres** — o Asaas recusa `authToken` menor (`"O token deve ter pelo menos 32 caracteres."`).

**O modo de falha é o mais silencioso possível:** se o valor configurado à mão no painel do Asaas for mais curto que 32, a conta-mãe continua funcionando normalmente e **nenhuma subconta jamais registra webhook**. Ninguém percebe até um escritório reclamar que cobrança paga não baixa.

Dois detalhes do sandbox que moldaram o desenho:
- **`POST /v3/webhooks` sem `authToken` NÃO deixa a config sem token** — o Asaas **gera um** e responde `hasAuthToken: true`. Como o segredo nunca volta na leitura, um webhook cadastrado à mão é **indistinguível de um saudável**, e mesmo assim toda entrega morre em `unauthorized`. Não há como diagnosticar pela API; só `PUT` sobrescreve. Daí o botão **"Reconfigurar avisos"**, sempre visível.
- **O dedupe do Asaas é pela URL sozinha** — segundo POST com mesma URL devolve `400 "Já existe uma configuração..."`, o que dá idempotência de graça.

**Trocar o segredo derruba todas as subcontas de uma vez, em silêncio:** elas seguem emitindo e nenhum pagamento volta. O conserto é apertar "Reconfigurar avisos" em cada escritório — não há automação.

O estado do webhook é lido **ao vivo** na tela da subconta a cada carregamento, e não de uma coluna: o webhook pode ser apagado no painel do Asaas sem avisar, e uma coluna espelhada mentiria justamente no caso que importa.

### O que falta para fechar o 4B

1. **Task 13** — sincronização (com as duas correções do bloco ▶ no topo).
2. **Task 14** — verificação final + `_probe-4b.mjs` (404 pela conta-mãe).
3. ~~Cadastrar o webhook na subconta~~ — FEITO (`dd6b285`), mas depende do `ASAAS_WEBHOOK_SECRET` (§acima) e ainda sem revisão.
4. **Navegação** — seção "Cobranças" no menu lateral; **hoje nenhuma tela do 4B é alcançável**.
5. **Smoke manual do usuário**, o gate antes do merge.

**Dívidas registradas, não bloqueantes:** `DROP COLUMN` dos ganchos mortos da `0032`; `UNIQUE (contabilidade_id, lower(nome))` no catálogo de avulsos (o seed pode duplicar em clique simultâneo — 13 linhas editáveis, zero dinheiro emitido); órfão de webhook só vai para `console.error` e não para `audit_log` (o helper exige `actorUserId`, e ali não há ator); `docs/reference/db_atual.sql` e `src/types/database.ts` seguem atrasados desde a `0050` (drift pré-existente).

---

## Sessão 13 (2026-07-27) — smoke do 4A concluído + comprovante obrigatório (0052)

**O smoke fechou, e ainda gerou uma regra de produto nova no caminho** — a terceira do bloco. 4 commits (`b163e89` → o merge).

### O que passou

`§2.4–2.6` (o cliente não sente a inadimplência do escritório: emitir nota funciona, `/conta` sem faixa de cobrança, tela de assinatura explicando que quem paga é o escritório) e `§3-bis` completo (L.1→L.9), que **nunca tinha sido exercido**.

### Decisão de produto nº 3: comprovante obrigatório na liberação manual

Pedido do usuário no meio do §3-bis. **Não existe liberação sem arquivo anexado.** A justificativa é de auditoria: a liberação manual é a única porta que destrava o gate sem passar pelo Asaas, e o único lastro era um texto livre digitado pelo próprio admin que liberou — que não distingue "o cliente mandou o comprovante do boleto" de "alguém liberou um conhecido".

**Migration 0052:** quatro colunas em `assinaturas` (path, nome, mime, tamanho) + bucket privado `liberacoes-comprovantes`. O path é **único por upload** (carimbo de tempo), nunca sobrescrito: o `audit_log` guarda o path de cada liberação, e um path reaproveitado apontaria para o arquivo errado — pior que não ter histórico, porque parece certo.

**A lista de formatos virou de PERMISSÃO, por decisão do usuário.** Eu tinha feito lista de bloqueio (barrar executável, deixar o resto passar) com o argumento de que, sendo o comprovante obrigatório, uma lista estreita não aperta a segurança — impede a liberação de quem já pagou. O usuário barrou: só carrega o que está listado. O argumento sobrevive na **largura** da lista: PDF, JPG/PNG/**HEIC**/WEBP/GIF/BMP/TIFF/AVIF, TXT/RTF/DOC/DOCX/ODT, CSV/XLS/XLSX/ODS, EML/MSG. Formato legítimo que falte se resolve acrescentando uma linha.

**Um bug meu, achado pelo usuário na tela:** eu validava só no "Confirmar", então escolher um `.exe` o deixava **listado como se tivesse sido aceito** e a recusa vinha no envio. Agora a validação é **na escolha** — o arquivo recusado nunca chega a ser o selecionado, o input é limpo e o erro aparece sob o campo. O `accept` do input sai da **mesma constante** da validação do servidor, com teste que falha se divergirem.

Nada é servido inline: a signed URL força `attachment`, dura 5 min e é gerada **no clique**, não junto com a lista — senão o HTML da página carregaria uma URL assinada por titular.

### O achado de processo desta sessão

O usuário relatou "L.1 ao L.9 prontos". O `audit_log` mostrava **uma** liberação e **nenhum** revogar — L.8 e L.9 não tinham rodado. Rodados de fato, provaram a promessa central do desenho: **3 liberações, 3 paths distintos**, os dois arquivos convivendo no bucket, comprovante permanecendo na linha depois do revogar. **Conferir o banco antes de aceitar um "passou" custa 30 segundos** e foi o que separou "testado" de "dito como testado".

### Armadilha de ambiente reincidente

O dev server caiu no meio da sessão com `_document.js` ausente e `clientReferenceManifest` indefinido. Causa: **dois `npm run dev` vivos** (um da sessão anterior, às 14:41, segurando a 3000; o meu na 3001) escrevendo o mesmo `.next/`. Mesmo estrago que `next build` com dev no ar. Conserto: matar os dois, `rm -rf .next`, subir **um**. Vale checar `Get-CimInstance Win32_Process` antes de subir o dev.

### Ainda na sessão 13: o 4B saiu do papel

Depois do merge do 4A, o usuário decidiu **fechar o Bloco B inteiro (4A + 4B)**. Os **5 pontos do §7** da spec do 4B foram fechados — quatro por decisão dele, um contra o sandbox — e o **plano de implementação** foi escrito (`docs/superpowers/plans/2026-07-27-bloco-4b-subcontas-escritorio.md`, 14 tasks).

**O achado do sandbox que mudou o desenho:** `birthDate` é obrigatório só para **CPF**. Com `companyType` de PJ o validador do Asaas para de pedir — então o onboarding da subconta são **dois formulários** (escritório PJ e contador autônomo PF), não um com campo condicional. A conta-mãe **já opera subcontas em sandbox** (`GET /accounts` → 200): a aprovação comercial do Asaas trava só a produção, não a construção.

**Duas decisões de estrutura tomadas no plano:**
- **`cobrancas_escritorio` é tabela separada de `cobrancas`.** Encaixar honorário na tabela do 4A exigiria afrouxar o `assinatura_id NOT NULL`, que é o que garante que tudo ali é dinheiro da Balu. A separação do dinheiro passa a existir no banco, não só no discurso.
- **`honorarios.pagamento_origem`** (`asaas` | `manual`), decorrência da decisão 7.4: com o semáforo alimentado por dois caminhos, um `status` único sobrescrito pelos dois esconde qual falou por último.

**A verificação que importa mais que as telas:** o `_probe-4b.mjs` (Task 14) consulta a cobrança **pela conta-mãe** e espera **404**. Se a conta-mãe enxergar a cobrança, o dinheiro está passando pela Balu — o princípio do §1 foi violado por mais que tudo funcione. É a única checagem que não depende de eu ter escrito o código certo.

### Scripts novos em `app/scratchpad/`

`apply-0052.mjs` · `_reload-postgrest.mjs` (coluna nova sem reload = "column does not exist" pelo supabase-js) · `_probe-comprovante.mjs` (prova upload/signed URL/attachment/acesso público negado fora da tela) · `_ver-liberacoes.mjs` (audit + bucket + linha) · `_probe-subconta.mjs` (campos exigidos pelo Asaas, sem criar nada) · `_esquema-4b.mjs` (dump das colunas reais das tabelas que o 4B toca). O `_rearmar-contratacao.mjs` passou a apagar também os comprovantes do bucket — sem isso o fechamento "passa limpo" deixando arquivo de teste para trás.

---

## Sessão 12 (2026-07-27) — smoke do 4A: 8 bugs, 2 regras de produto novas, migration 0051

**O smoke manual pagou por si já no primeiro clique.** Oito bugs, nenhum pego por teste automatizado, e duas decisões de produto do usuário que mudaram o comportamento do bloco. 8 commits novos (`5bfb96a` → `8468ddd`).

### Os oito bugs

1. **`$` do token do Asaas comido pelo `dotenv-expand`.** O token começa com `$aact_…`; o Next passa o `.env` pelo dotenv-expand, que lê isso como referência de variável e resolve para **string vazia**. Chave certa no arquivo, app dizendo "não configurado". Escapar com `\$` resolve — e **não vale na Vercel**, onde o valor não passa por dotenv. Documentado no `.env.example`.
2. **O guarda do erro procurava `ASAAS_API_KEY`**, nome que não existe desde que os tokens viraram por ambiente. Token ausente caía no genérico "Tente novamente" — foi o que escondeu o bug 1 e custou o diagnóstico direto.
3. **`TOKEN_ASAAS_PRODUÇÃO`** estava escrito com `Ç` e `Ã` no `.env.local`. O código procura `TOKEN_ASAAS_PRODUCAO`. Mina armada para o dia do `ASAAS_ENV=prod`, com dinheiro real em jogo.
4. **Contratar não liberava o acesso.** `assinar.ts` gravava `trial_termina_em` contando que isso liberasse, mas não mexia no status; `statusEfetivo` de propósito não honra data para `inadimplente`. As duas metades se contradiziam em silêncio. *(Corrigido e depois **revertido pela decisão de produto A** abaixo.)*
5. **`cobrancas` nascia 100% dependente do webhook**, que não alcança `localhost`, não atravessa firewall e pode falhar. O Asaas emite a primeira fatura junto com a assinatura: agora ela é puxada na hora (`sincronizarCobrancas`) e o cron faz o mesmo com a lista que já tem em mãos.
6. **Cancelar deixava o `asaas_subscription_id` morto na linha** (o `DELETE` no Asaas já tinha apagado a subscription lá), e `assinarPlanoAction` recusava com "Já existe uma assinatura ativa". **Quem cancelasse nunca mais voltava.**
7. **A tela não refletia o pagamento sem F5.** O webhook avisa o *servidor*; o navegador que já renderizou não fica sabendo. Resolvido com consulta enquanto há o que esperar, só com a aba visível, checando na hora em que o usuário volta da aba do Asaas, e desistindo após 3 minutos.
8. **Re-contratar depois de cancelar nunca reconhecia o pagamento.** A linha ficava em `cancelada`, e os **três** caminhos de reconciliação excluem esse status de propósito (cron por filtro, tela por early-return, webhook por regra). Três portas fechadas pelo motivo certo, e o resultado era um beco. `statusAoContratar` tira a linha de lá.

### Duas decisões de produto do usuário

**A. Contratar não libera nada.** Clicar "Assinar" mostrava "plano assinado" e destravava na hora. O usuário barrou: *"a mensagem e a liberação só devem ser efetivadas após o reconhecimento do pagamento"*. `criarAssinaturaNoAsaas` não toca mais em `status` nem em `trial_termina_em` — quem estava em teste vigente segue no prazo que já tinha, quem estava bloqueado continua bloqueado. **Consequência aceita:** boleto só libera na compensação.

**B. O bloqueio é dito na entrada, não no envio.** Cadastrar cliente vira a tela de aviso; honorários mantêm a lista visível (consultar não é escrita e não depende de pagamento) com tarja no topo e o "Novo honorário" explicando o motivo. A frase saiu para `lib/billing/mensagens.ts` — `gate.ts` é `server-only` e a tela precisa do mesmo texto.

### Migration `0051` — liberação manual (aplicada em produção)

Resposta à consequência aceita em (A): `/admin/configuracoes` com botão de **liberar acesso** para quem pagou por boleto e mandou o comprovante. Colunas `liberado_ate`, `liberacao_motivo`, `liberacao_por`, `liberacao_em`.

**Por que uma coluna e não "marcar como ativa":** seria desfeito sozinho. A reconciliação lê as cobranças no Asaas e, no vencimento, um boleto ainda não compensado vira `OVERDUE` → `inadimplente`. Quem mandou o comprovante seria bloqueado de novo na madrugada.

`statusEfetivo` consulta `liberado_ate` **depois** do status e **só no sentido de liberar** — assim nunca bloqueia ninguém por engano. Sempre tem prazo (teto 60 dias) e motivo obrigatório; liberar e revogar vão para o `audit_log`.

### Armadilhas que valem para as próximas sessões

- **Log do dev em arquivo é obrigatório.** O `next dev` sem redirecionamento não deixava rastro, e o diagnóstico do bug 1 dependia de um `console.error` que ninguém via. Hoje: `npm run dev > app/scratchpad/dev.log 2>&1`. Foi esse log que pegou o `server-only` importado em Client Component — erro que **o `tsc` não vê**.
- **`.env.local` tem armadilha dupla:** `$` não escapado e nome de chave com acento. `_auditar-env.mjs` varre as duas.
- **Reconciliação e tela têm de usar a MESMA regra.** Extraída para `lib/billing/reconciliar.ts` — duplicada, cron e tela acabariam discordando sobre quem está em dia, e o cron roda de madrugada (a divergência só apareceria no dia seguinte).

---

## Sessão 11 (2026-07-27) — Bloco 4: spec, divisão em 4A/4B e plano

**Nada de código foi escrito.** A sessão produziu desenho, plano e material para o Michel. Branch `bloco-4-billing-asaas` (3 commits, só documentos): `694774e` spec inicial · `54b714a` divisão 4A/4B · `ab3bba1` plano do 4A.

**Decisão de rota do usuário:** deixar pronto **tudo que dá para construir sem as chaves**, e trazer as credenciais depois só para validar. Ordem acordada: **4 → 5 (andaime da flag) → 6 (IA + WhatsApp) → 7**.

**Duas decisões fechadas antes do desenho:**
- **A entrega da DASN/DEFIS continua exigindo o formulário completo** — resolve a "decisão em aberto" que a sessão 10 deixou. Segue a decisão nº 3 da spec do Bloco 3; nada muda no código.
- **O Bloco 4 virou dois.** O usuário reverteu a proposta de deixar honorários fora, por princípio: **a Balu não pode intermediar dinheiro de terceiro**. Isso descartou também o *split* (que eu não tinha examinado direito — numa cobrança com split a cobrança ainda pertence à conta da Balu e o dinheiro passa por ela). Só **subconta por escritório** resolve. Como isso é outro produto, virou o 4B.

**Bloco 4A — a Balu cobrando** (`docs/superpowers/specs/2026-07-27-bloco-4a-assinatura-balu-design.md` + plano de 15 tasks TDD em `docs/superpowers/plans/2026-07-27-bloco-4a-assinatura-balu.md`):
- Migration `0050`: `planos`, `assinaturas`, `cobrancas`. Titular por duas FKs anuláveis com `CHECK` de exclusividade. **Trigger** cria a assinatura em trial no INSERT de `company`/`contabilidade` — `company` nasce em vários caminhos e espalhar a criação pelas actions garantiria esquecer um. **Cortesia para tudo que já existe**, senão o deploy bloqueia os pilotos e as contas de vocês.
- **Duas fronteiras inegociáveis do gate**, e são o miolo do bloco: (1) nunca alcança **obrigação legal com prazo** (gerar DAS, registrar declaração, transmitir PGDAS-D) — bloquear vira multa da Receita para o usuário, dano de terceiro desproporcional à dívida e exposição pelo CDC art. 39; (2) nunca alcança **direito do titular** — LGPD art. 18 (acesso, correção, portabilidade, eliminação) e o §5º, que obriga atendimento **sem custo**; inadimplência não é hipótese legal de suspensão desses direitos. Consequência de interface: a faixa de aviso de cobrança **não aparece** nas telas de direito do titular.
- Trial de **7 dias**; preço, faixas e trial editáveis pelo AdminBalu em `/admin/assinaturas` — mudar preço virou operação, não deploy. Isso criou um caso novo: o admin pode gerar **buraco entre faixas**, tratado explicitamente.
- Escritório inadimplente **não trava a carteira** (o empresário não é parte do contrato e não tem como quitar). Consequência aceita: escritório que nunca assinou não trava os clientes.
- Status **derivado na leitura**, nunca lido cru da coluna — cron que falha não pode liberar quem devia bloquear nem bloquear quem pagou.

**Bloco 4B — o escritório cobrando** (`docs/superpowers/specs/2026-07-27-bloco-4b-subcontas-escritorio-design.md`, **design decidido, pendente de revisão própria**): subconta criada pela API da Balu (a cobrança nasce na subconta, o credor é o escritório, o dinheiro liquida na conta dele); honorários; catálogo de avulsos gerido pelo escritório, aceitando **valor fixo ou percentual** (recuperação de crédito é percentual). Risco central registrado: a Balu passa a guardar credencial que **movimenta dinheiro de terceiro** — mais sensível que a service role; cifrar com `cifrarCampo` (que hoje não tem uso em runtime, o landmine anotado no Bloco E ganha seu primeiro ciclo legítimo). Criar subconta em **produção** provavelmente exige aprovação comercial do Asaas, não só chave.

**Três erros do PRD derrubados pela auditoria do código real:**
1. `notifications.tipo` tem **CHECK de lista fechada** (`0045:10-12`) — aviso de cobrança sem `ALTER` falha em runtime, não em compilação.
2. `api/webhooks/segredo.ts` **não existe**; o real está dentro de `focus/`, lê da query `?s=` e tem `FOCUS_WEBHOOK_SECRET` hardcoded. É extração, não reuso — e o teste da Focus é a rede de segurança.
3. **`vercel.json` já tem 2 crons e o plano Hobby permite exatamente 2.** A Task 13 confirma o tier antes de criar o terceiro; se for Hobby, a reconciliação entra no cron diário que já existe.

**Correção ao PRD sobre o Bloco 6:** a conta Envia.Click conectada é a **do próprio Grupo Ide** (inboxes Eight Brand / Luan Suporte IA / Suporte Envia.Click, 2 agentes de IA ativos). A chave de API do Envia.Click **não é dependência do Michel** — a plataforma é de vocês. Mas **não há inbox de WhatsApp** (só `WebWidget` e `Api`), então o WABA do Balu segue faltando.

**PDF para o Michel:** `Direcionamento/Balu-Como-vai-funcionar-a-cobranca-2026-07-27.pdf` (5 páginas, linguagem de negócio, sem termo técnico). Explica os dois tipos de cobrança, o que trava e o que nunca trava (com o porquê jurídico), a subconta, e reúne **7 perguntas abertas** para ele responder.

### Implementação do 4A (mesma sessão) — 15 tasks executadas, 16 commits

**Migration `0050` aplicada e verificada em produção:** `planos`, `assinaturas`, `cobrancas`, RLS, e a **trigger** que cria assinatura em trial no INSERT de `company`/`contabilidade` (trigger e não chamada nas actions porque `company` nasce em vários caminhos). **Cortesia para tudo que já existia** — 3 titulares, zero órfãos: o deploy não bloqueia ninguém.

**15 bugs corrigidos.** Os cinco que valem lembrar:

1. **Não existia caminho para assinar.** `criarCliente`/`criarAssinatura` tinham **zero chamadores**: no dia 8 o trial acabava, as 22 actions barravam e a única ação na tela era "cancelar". Falha da **minha spec**, não da implementação — o §9.2 listava o que a tela mostra e nunca previu contratar.
2. **A reconciliação desfazia o gate toda madrugada.** Promovia por `remota.status === 'ACTIVE'`, mas status de *subscription* não é status de *pagamento*: fica ACTIVE com cobrança vencida. Todo `PAYMENT_OVERDUE` era revertido na noite seguinte. Passou a reconciliar pelas **cobranças**.
3. **O `upsert` do PostgREST manda NULL nas colunas ausentes** — provado contra o banco. A correção anterior do `pago_em` **causava** o bug que pretendia evitar. O padrão certo (`update` parcial) já estava no webhook da Focus. A persistência saiu da route para `lib/billing/cobranca.ts`, onde dá para testar.
4. **`TOKEN_ASAAS_SANDBOX` vs `ASAAS_API_KEY`** — o incidente do Resend se repetindo. Adotada a nomenclatura do usuário (token separado por ambiente), que é melhor: impossível rodar sandbox com chave de produção.
5. **`nextDueDate` da resposta do Asaas é o ciclo SEGUINTE.** Pedindo 30/07 ele cria a cobrança em 30/07 e devolve 30/08. Usá-lo como "liberado até" dava **um mês de acesso grátis** a quem não pagasse. Só apareceu falando com o sandbox real.

**Duas fronteiras do gate, fixadas por teste nos dois sentidos** (`cobertura-gate.test.ts`, 45 casos): nunca alcança **obrigação legal com prazo** (11 actions) nem **direito do titular** (LGPD art. 18, 7 actions). Três actions entraram na lista de "nunca" durante a execução: `criarContabilidadeAction` (o escritório ainda não existe), `removerClienteDaCarteiraAction` (reduzir a carteira **baixa** a fatura) e `removerMembroAction` (tirar acesso é segurança).

**Cron:** o projeto está no plano **Hobby** da Vercel (2 crons, e o `vercel.json` já tem 2), então `rodarBilling` é chamada de dentro de `/api/cron/obrigacoes`, **por último** — timeout de wall-clock não é capturável por `try/catch`, e a materialização das obrigações tem prazo legal.

**⚠️ Armadilha nova:** `next build` recusa export extra em `route.ts` e **`tsc --noEmit` não pega** (a validação vive nos tipos gerados em `.next/types`). `tsc` limpo não é garantia neste repo.

**RETOMAR EM: ver a sessão 12 acima** — o smoke começou e parou no §2.4.

**Depois do 4A:** o **4B** (subcontas do escritório) tem spec de design mas **5 pontos em aberto no §7** que precisam de decisão antes do plano.

---

## Sessão 10 (2026-07-26) — Bloco 3: smoke manual e 6 correções

**O smoke manual rodou e o Bloco 3 foi validado ao vivo.** Nenhuma das 22 tasks precisou ser refeita, mas o smoke achou **6 bugs que nenhum teste pegava** — 4 commits novos sobre os 25 da branch.

**Os 6 bugs, em ordem de gravidade:**

1. **Entrega regredia para rascunho** (`registrar.ts`). O upsert reescreve toda coluna do payload, então "salvar rascunho" **depois** da entrega gravava `data_transmissao`, `numero_declaracao` e `status` como `null` — perda silenciosa numa declaração já entregue. Reproduzido contra o banco antes de corrigir. Agora a entrega não regride: editar valores de uma declaração entregue é **retificação**.
2. **Upload do comprovante batia em RLS** — `new row violates row-level security policy`. O bucket é privado e **não tem policy em `storage.objects`** (a própria 0048 diz: escrita só pela service role). O caminho do contador já fazia isso; o do empresário passava o client da sessão. Passou a usar `uploadToBucket()`. A escrita na **tabela** continua na sessão, então a RLS do empresário segue cobrindo a linha.
3. **Gravava na empresa errada.** `registrarDeclaracaoAnualAction` lia `profiles.current_company` **no momento do envio**, não a empresa que a página renderizou — as duas divergem com outra aba, cache de rota do Next, ou o link de notificação. Agora o `companyId` vem do render e é conferido contra a RLS de `companies`.
4. **"Salvar rascunho" era impossível de usar.** Validava contra o schema **completo** do art. 72; com o formulário em branco a mensagem era o `"Required"` cru do Zod. Travava também o card do contador, que só aparece depois de um rascunho salvo. Rascunho agora aceita parcial (`.partial()`), a **entrega** segue exigindo tudo, e `declaracoes-anuais/erros.ts` traduz o erro usando os `label` de `grupos.ts`.
5. **Notificação levava à empresa errada.** `notifications.company_id` sempre existiu e ninguém lia; o `action_href` é rota crua e `/impostos` renderiza para a empresa **ativa**. O sino dizia "pendente" e a tela dizia "entregue" — eram duas empresas. Nova rota `/notificacoes/abrir/[id]` troca a empresa ativa antes de redirecionar; sino e lista passam a mostrar de qual empresa é cada aviso, com "Abrir em `<empresa>`". **É bug do Bloco 1** e atinge todos os tipos; o Bloco 3 só tornou visível.
6. **Zero preso nas caixas de valor** — `value={numero}` impedia o campo de ficar vazio.

**⚠️ A URL do DEFIS estava errada de novo — e fecha uma premissa do Michel.** `defis.app/entrada.aspx` responde **HTTP 200 com a página "Não Autorizado"**. A verificação da sessão 9 conferiu que não dava 404 — dava 200 com página de erro. **Conferir só o status engana neste portal.** O DEFIS **não tem endereço próprio abrível de fora**: é módulo do PGDAS-D e só existe dentro de sessão autenticada (`pgdasd2018.app/` idem). Não é caso de achar a URL certa — ela não existe. Agora aponta para `Servicos/ServicosComControleDeAcesso.aspx` (o balcão de e-CAC / código de acesso), o rótulo virou "Acessar o portal do Simples" e a seção explica o caminho `PGDAS-D → "Acessar a DEFIS"`.

**Cobertura fechada (+12 testes).** Os três bugs de `registrar.ts` não tinham teste **nenhum**: o smoke rodava inteiro com service role, nunca enviava arquivo e só provava o lado da RPC, jamais o `lida_em`. Entraram os casos que faltavam, cada um com **discriminante**: a entrega da DASN não cala o aviso mensal do PGDAS-D (senão o teste de `lida_em` passaria com o filtro de chave errado) e "a ENTREGA continua exigindo o formulário inteiro" (senão os testes de rascunho passariam com a validação afrouxada por engano).

**⚠️ Armadilha desarmada:** o smoke **lançava** no `beforeAll` quando a empresa do seed não existia. Como o seed é removido no fechamento do bloco, `npm test` em `main` quebraria a partir daqui. Agora **pula** (`describe.skipIf`) — 568 passam, 9 pulados, sem o seed.

**Decisão em aberto (não mudei sozinho):** a **entrega** ainda exige o formulário completo. Argumento contra: quando o comprovante é registrado, a declaração **já foi transmitida de verdade** no portal — barrar o registro porque a cópia na Balu está incompleta impede guardar um fato consumado, e o bloco tem como princípio "sinaliza, nunca bloqueia". Contra a mudança: sem completude a cópia vale pouco. Contraria a decisão de produto nº 3 da spec, por isso ficou para o usuário decidir.

**Seeds restaurados:** `seed-defis-rascunho.mjs restore`, `gate-serpro-bloco3.mjs restore` (`sincronizacao_inicial_serpro_at` de volta a `NULL`) e `seed-empresa-mei.mjs restore`. Nenhuma alteração de banco pendente.

**⚠️ Lição de processo:** rodar `next build` com o `npm run dev` no ar corrompe `.next/` (`Cannot find module './XXXX.js'`) — os dois disputam a pasta. E **rodar a suíte durante o smoke manual apaga os dados do teste**: o `afterAll` do smoke limpa as declarações da empresa do seed.

**MERGEADO E NO AR.** `faa6ef1` (`--no-ff`) em `main`, pushed → auto-deploy. Branch `bloco-3-dasn-defis` pode ser apagada.

**RETOMAR EM:** decidir o próximo bloco. Estado dos 7 do Master PRD:

| Bloco | Estado |
|---|---|
| 1 — Motor Obrigações/Notificações | ✅ em `main` |
| 2 — Abertura digital completa | ✅ em `main` |
| 3 — DASN/DEFIS assistidas | ✅ em `main` (esta sessão) |
| 4A — Assinatura da Balu | ✅ smoke concluído e mergeado em `main` (0050, 0051, 0052) |
| 4B — Subcontas do escritório | 📋 **design fechado e plano escrito** (14 tasks); falta escolher o modo de execução e decidir o gate da Task 9 |
| 5 — Produção Fiscal | 🔒 credencial do Michel (token Focus não é de revenda) |
| 6 — WhatsApp/IA (Envia.Click + Claude) | 🔒 credencial do Michel |
| 7 — Domínio/SLA/Conciliação | 🔒 depende do 4 |

**Tudo que sobra depende de credencial externa.** O caminho sem bloqueio é: (a) a decisão em aberto acima sobre exigir formulário completo na entrega; (b) as premissas do Michel — a lista de campos do art. 72 é a cara de mudar depois; (c) os follow-ups não-bloqueantes do Bloco 1 (cadência de bucket PGDAS/DASN divergindo da spec §5, badge contando só entre os 15 carregados, `getSiteUrl` no cron).

---

## Sessão 9 (2026-07-26) — Bloco 3: interface (Tasks 16–22)

**Branch `bloco-3-dasn-defis`**, 6 commits novos. `tsc` 0 · **vitest 565/565** · `next build` limpo. Nada mergeado ainda.

**Entregue (Tasks 16–21):**
- **Task 16** — `DeclaracaoAnualShell.tsx` (casca comum: título, prazo, norma, badge rascunho/entregue/em atraso) e `RegistrarComprovanteDialog.tsx` (nº da declaração + data de transmissão + upload).
- **Task 17** — `DasnAssistidaForm.tsx`: pré-preenche com as notas do ano, deixa editar, alerta divergência e teto do MEI (art. 18-A). Nunca bloqueia.
- **Task 18** — `DeclaracoesMeiSection.tsx` reescrita e **o texto falso corrigido**: a promessa de "transmissão automática quando a Receita liberar a API" saiu. O Integra Contador **consulta**, não transmite declaração anual — o fluxo é assistido por definição, não por limitação temporária.
- **Task 19** — `DefisForm.tsx` (accordions dirigidos por `GRUPOS_DEFIS`, grupo repetível de sócios com adicionar/remover, contador de progresso) e `DeclaracoesDefisSection.tsx`.
- **Task 20** — ligação em `impostos/page.tsx`: DASN no ramo MEI, DEFIS no ramo Simples gated por `regimeCode === '1' || '2'` (Regime Normal, code `'3'`, não entrega DEFIS).
- **Task 21** — card de declarações anuais no painel do contador, com o docblock do invariante "zero botões" atualizado junto.

**Três correções ao plano, encontradas na execução:**
1. **A URL do portal do DEFIS que o plano trazia dá 404.** `ATBHE/defis.app/` não existe — foi escrita por analogia, como o próprio plano avisava. A real é `https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/defis.app/entrada.aspx`, destino do link "Acessar a DEFIS" **de dentro do PGDAS-D 2018** (o DEFIS é módulo do PGDAS-D, não app irmão). Conferida em 2026-07-26: responde com o gate de login, não com 404. Diferente da DASN-SIMEI, **não tem entrada pública por CNPJ** — exige e-CAC ou código de acesso, e a UI diz isso.
2. **O card da Task 21 era só leitura no plano** — o que deixaria `registrarDeclaracaoAnualContadorAction` (Task 12) sem nenhum chamador, código morto justamente na decisão de produto nº 1. O dialog foi ligado de verdade. Regra: **o registro pelo contador só aparece quando o cliente já salvou o rascunho**, porque a action valida `dados` contra o schema inteiro e o contador não tem de onde inventar os valores declarados; sem rascunho a UI diz isso em vez de oferecer um botão que falharia na validação. Exigiu `dados` na query de `contador/clientes/[companyId]/page.tsx` (o plano dizia que nenhuma mudança ali era necessária — verdade só para o card read-only).
3. **`btoa(String.fromCharCode(...bytes))` do dialog estoura a pilha** bem antes dos 5 MB que o próprio campo anuncia (o spread vira um argumento por byte). Trocado por codificação em blocos de 32 KB, mais validação de mime/tamanho no cliente espelhando `validarComprovante()` — o servidor revalida de qualquer jeito.

**Dois desvios menores, deliberados:** o `dados` enviado ao registrar o comprovante é o **corrente**, não o inicial (o plano usava `inicial` na DASN, o que gravaria valores antigos de quem editou e salvou); e a busca do rascunho em `page.tsx` é **por tipo**, não só por competência (uma empresa que trocou de regime pode ter DASN e DEFIS no mesmo ano, e o `find` só por competência devolveria a errada).

**⚠️ `npm run lint` não é executável neste repo** — não existe config de ESLint e o `next lint` cai no wizard interativo. É pré-existente (o script nunca rodou); não foi introduzida config, está fora do escopo do bloco. `typecheck` e `build` cobriram a verificação.

**⚠️ Seed MEI SEGUE ATIVO de propósito** (`app/scratchpad/seed-empresa-mei.mjs`): sem ele não há empresa MEI no banco e a tela da DASN não aparece pra clicar. O `restore` do plano (Task 22, Step 3) **foi adiado para depois do smoke manual** — rodar `node app/scratchpad/seed-empresa-mei.mjs restore` só no fechamento, junto do merge.

**Retomar em:** smoke manual do usuário. Passando → merge `--no-ff` para `main` + push (auto-deploy) + `restore` do seed. As sete premissas do Michel (tabela no fim do plano) continuam abertas — a lista de campos do art. 72 é a cara de mudar depois.

### ⛔ Ponto de retomada exato (sessão 9 parou aqui)

O servidor de dev foi subido, o banco foi conferido e o smoke **não chegou a ser rodado** — o usuário optou por parar e retomar depois. Estado levantado (scripts de conferência ficaram em `app/scratchpad/check-smoke-bloco3.mjs` e `check-smoke-bloco3b.mjs`, não versionados):

- **DASN — destravada, pode testar direto.** Seed MEI vivo (`SEED BLOCO3 MEI LTDA`, 3 notas de 2025) e `profiles.current_company` de `walacesssantos@gmail.com` apontando pra ela. Esperado em `/impostos → Declarações`: comércio R$ 2.300 · serviço R$ 2.200 · total R$ 4.500 — a nota de **31/12/2025 23:30 BRT** (gravada como `2026-01-01T02:30Z`) tem de contar em **2025**; é o teste da borda do ano. Conferir também: alerta de divergência ao editar, alerta de teto acima de R$ 81.000, e que **salvar rascunho não cala o sino — só o registro do comprovante com data de transmissão cala**.
- **DEFIS e card do contador — TRAVADOS por dado, não por código.** As duas `dev.ide` (Simples code `'1'`, de `walacesssantos@gmail.com`) têm `sincronizacao_inicial_serpro_at = NULL`, então `GateInicialSerpro` toma a página inteira e a seção do DEFIS nunca renderiza. A única Simples com sync feito é `AL PISCINAS LTDA` de `allanvalle@outlook.com` — a conta externa cuja senha não funciona neste ambiente (falha pré-existente conhecida). O card do contador cai junto: o escritório `Escritório Teste Balu` (login `testeefluxodeautomacao@gmail.com`) tem só a `dev.ide` `c2410872-c9c0-47b5-a0e9-4d3e699a614e` na carteira, e o card só oferece o registro **depois** que o cliente salvou um rascunho — que ele não consegue salvar com o gate no caminho.
- **DECISÃO PENDENTE, é a primeira coisa a resolver ao voltar:** destravar exige `UPDATE public.empresas_fiscais SET sincronizacao_inicial_serpro_at = now() WHERE empresa_id = 'c2410872-c9c0-47b5-a0e9-4d3e699a614e'` — um campo, na empresa que serve aos dois testes de uma vez. **Não foi executado.** É banco de produção e a linha não é de seed, por isso a pergunta ficou aberta. Valor original a restaurar: `NULL`.

---

## Sessão 8 (2026-07-25) — Bloco 3: spec, plano e 15/22 tasks

**Branch `bloco-3-dasn-defis`** (16 commits à frente de `main`, nada mergeado ainda). `tsc` 0 · **vitest 565/565** · working tree limpo.

**Spec (`aab8117`) e plano (`3c06fa5`) escritos e commitados:**
- `docs/superpowers/specs/2026-07-25-bloco-3-dasn-defis-assistidas-design.md`
- `docs/superpowers/plans/2026-07-25-bloco-3-dasn-defis-assistidas.md` (22 tasks TDD, código completo em cada passo)

**Arquitetura decidida:** dois módulos irmãos (`lib/fiscal/dasn/`, `lib/fiscal/defis/`) sobre uma costura mínima (`lib/fiscal/declaracoes-anuais/`). **Nenhuma tabela nova.** Três decisões de produto travadas antes de escrever a spec: (1) o **contador** também registra o comprovante, via Server Action com service role — o empresário registra o dele pela própria sessão; (2) o app **pré-preenche editável** e sinaliza divergência, nunca bloqueia; (3) DEFIS **completo**, todos os campos do art. 72.

**A regra central do bloco, provada em smoke contra o banco real:** só `data_transmissao IS NOT NULL` cala o aviso do sino. **Rascunho não silencia nada.** E a RPC só deixa de *criar* o aviso — as notificações já criadas são marcadas como lidas pelo `registrar.ts`, senão o sino continua tocando depois da entrega.

**Implementado (Tasks 1–15):**
- **Migration 0048** (`966052c`) — aplicada e verificada: 5 colunas em `declaracoes_fiscais` (`dados` jsonb, `comprovante_path`, `origem`, `registrado_por`, `divergencia_receita`) + bucket privado `declaracoes-comprovantes`. **RLS não mudou nada:** `declaracoes_fiscais_owner` (0025) já deixa o empresário escrever e `declaracoes_select_contador` (0033) segue SELECT-only.
- **Migration 0049** (`5403e3f`) — aplicada: bloco `defis_pendente` na RPC `materializar_obrigacoes` (ME/EPP codes `'1'`/`'2'`, janela jan–abr, `danger` a partir de março, prazo 31/03, art. 72). ACL `REVOKE/GRANT` preservada.
- **Lógica pura, toda testada:** `declaracoes-anuais/{tipos,divergencia,comprovante}.ts`, `dasn/{resumo,campos}.ts`, `defis/{grupos,campos}.ts`. `resumirReceitasAno` recorta o ano em **BRT** (a nota de 31/12 22h BRT é 01/01 em UTC e cairia no ano errado); `avaliarLimiteMei` cobre o teto de R$ 81.000 e o excesso >20% (desenquadramento retroativo).
- **`lerNotasAnoCalendario`** (`f3993c6`) entrou no **mesmo** `receitas-source.ts`, para não furar o docblock que diz que toda leitura de receita passa por ali. A janela SQL é folgada de propósito; o recorte exato do ano é da função pura.
- **Duas Server Actions** (`a7795ec`, `4f76e3b`): a do empresário roda na sessão dele (RLS cobre); a do contador prova a permissão na aplicação (`requireEscritorio()` + `companyDaCarteira()`) e escreve com service role, com 403 genérico que não revela se a empresa existe. A guarda de carteira mora em `src/lib/contador/carteira.ts` — **não pode** ficar no arquivo `'use server'`, onde todo export precisa ser action serializável.
- **Smoke `registrar.smoke.test.ts`** (`e2df92e`) — 6/6 contra o banco real: rascunho não cala / entrega cala, mais os três de anti-IDOR (recusa contabilidade errada, recusa ID inexistente com o mesmo `null`, e um **controle discriminante** que prova que a guarda aceita o caso legítimo — sem ele os dois primeiros passariam mesmo se ela recusasse tudo).

**Correções ao plano descobertas na execução (o schema real manda):**
- `notas_fiscais` **não tem** `owner_user_id`; `referencia` e `payload_focusnfe` são NOT NULL.
- `companies_status_check` aceita só `active`/`inactive`/`em_abertura` — não `'ativa'`.
- Tolerância da soma de participações do DEFIS: o plano se contradizia (o teste mandava rejeitar 59,99+40, a tolerância `<= 0.01` aceitava). Ficou `< 1e-6` — a folga é para resíduo de float, não para um centésimo de ponto, que é erro de digitação.
- `resumo.ts` reusa `ymdBrt` de `tempo-brt.ts` em vez de duplicar o deslocamento de −3h.

**⚠️ Seed MEI ATIVO no banco** (`app/scratchpad/seed-empresa-mei.mjs`, não versionado): não existia **nenhuma** empresa MEI na base. Criou `SEED BLOCO3 MEI LTDA` (`2afa159b-790e-4a28-a3b2-e7ea32cb8f2d`) com 3 notas de 2025 (comércio 2300 + serviço 2200 = 4500) e **apontou `profiles.current_company` do `walacesssantos@gmail.com` para ela**. O smoke depende do seed. Ao terminar o bloco: `! node app/scratchpad/seed-empresa-mei.mjs restore`.

**RETOMAR NA TASK 16** (as 7 restantes são só interface): 16 casca + dialog de comprovante · 17 `DasnAssistidaForm` · 18 seção da DASN + **correção do texto** de `DeclaracoesMeiSection.tsx:32` ("A transmissão automática pela Balu chega quando a Receita liberar a API" — é falso: a SERPRO **consulta, não transmite** declaração anual; é assistido por definição, não por limitação temporária) · 19 form + seção do DEFIS · 20 ligar em `page.tsx` (DEFIS gated em `regimeCode === '1' || '2'`) · 21 card no painel do contador · 22 fechamento.

**⚠️ Task 21 quebra um invariante de propósito:** o docblock de `VisaoCliente.tsx` diz *"Zero botões de ação — o contador só enxerga, nunca edita"*. O card de declarações anuais é a primeira exceção, consequência da decisão nº 1. O docblock tem de ser atualizado junto, não em silêncio.

**Premissas a confirmar com o Michel antes do merge:** a lista de campos do art. 72 (define o tamanho do formulário inteiro — barata de mudar agora, cara depois), o público do DEFIS (`'1'`/`'2'`), a URL do portal do DEFIS (a da DASN está conferida no código desde 06/06; a do DEFIS entrou por analogia) e o realinhamento de que **a Balu não transmite** a declaração anual.

---

## Sessão 7 (2026-07-25) — merge do Bloco 2 + validação SERPRO + correção 0047

**Bloco 2 MERGEADO em `main`** (`6f01f1e`, `--no-ff`, pushed → auto-deploy). O usuário rodou o smoke manual das frentes A (checklist), B (notificação/sino) e C (Realtime) e passou. As frentes **D e E foram testadas por harness automatizado** contra o banco real, reproduzindo o núcleo das actions (o que sobra depois de `requireEscritorio()`), **9/9**:
- **D — minuta por tipo:** MEI → `roteiro_mei` (cita CCMEI/Portal, diz "Não há contrato social ou ato constitutivo a registrar"); EI → `requerimento_empresario` (modelo DREI); LTDA → `ato_constitutivo_slu` (CC art. 1.052). Guardas: LTDA sem capital bloqueia nomeando o campo; **MEI sem capital gera** (capital não se aplica); erro cumulativo lista todos os faltantes; anti-IDOR bloqueia escritório alheio.
- **E — abertura sem dono:** `user_id null` avança etapa sem quebrar e **não notifica**; controle discriminante com a mesma função em abertura COM dono **cria** a notificação; reavançar mesma etapa não duplica.
- Seed do Bloco 2 **restaurado** (`restore`) após o merge. Working tree limpo, 513/513.

**SERPRO de PRODUÇÃO VALIDADA (derruba pendência antiga do Michel).** Com as chaves do `app/.env.local` + o certificado do contratante guardado no banco (**PIPER AUTOMAÇÕES E INTEGRAÇÕES LTDA**, CNPJ 61.061.690/0001-83), a cadeia inteira fechou ao vivo: `mTLS + consumer key/secret` → `/authenticate` (role-type TERCEIROS, accessToken 1h) → `Termo XML assinado com o A1 da empresa` → `POST /Apoiar (AUTENTICAPROCURADOR/ENVIOXMLASSINADO81)` → **token de procurador gerado** (36 chars, validade até a meia-noite BRT). Testado com **AL PISCINAS LTDA** (CNPJ 10.358.425/0001-20, único A1 no sistema, válido até 20/03/2027) e o token foi **restaurado ao valor original** depois. ⚠️ Isso valida a autenticação; **não** valida que uma consulta de um contribuinte específico será autorizada (depende da procuração daquele CNPJ).

**Focus:** `FOCUS_NFE_ENV=hom`, token de 32 chars — `GET /v2/cnpjs/:cnpj` dá **404 em homologação** (endpoint só existe em `api.focusnfe.com.br`) e **403 `permissao_negada` em produção**. Não é token de revenda. Não afeta o Bloco 3 (SERPRO puro); é assunto do **Bloco 5**.

**Correção 0047 — janela do aviso da DASN-SIMEI.** Descoberta testando a RPC do Bloco 1: a `0045b` abria a janela em **março** (`BETWEEN 3 AND 6`), mas o comentário da própria migration dizia "(jan–jun)" e o Master PRD pede aviso "a partir de janeiro" — o MEI perdia 2 meses num prazo que vence 31/05 com multa mínima de R$ 25 (art. 111). **Migration `0047_dasn_janela_janeiro.sql` aplicada em produção e commitada** (`f134dbc`): única mudança funcional é `BETWEEN 1 AND 6`. Provado no banco antes (15/02 → 0 avisos) e depois (15/01 e 15/02 → aviso `warning`, buckets M1/M2).

**Bloco 3 — o que já existia (correção ao levantamento anterior):** o bloco `dasn_pendente` **já está implementado** na RPC `materializar_obrigacoes`; só o **DEFIS** é TODO (`0045b:174`). Testado 5/5: avisa em abril com `warning`/prazo 31/05/norma art. 109, escala para `danger` em junho (bucket `V`), é idempotente e **suprime quem já entregou** (declaração `DASN-SIMEI` com `data_transmissao` registrada). **Falta construir:** tela assistida da DASN, **registro manual de comprovante/`numero_declaracao`**, **DEFIS inteiro** (builder + tela + registro) e o bloco `defis_pendente` na RPC.

**Bloqueio de dado (não de credencial) para testar a consulta DASN real:** não existe **nenhuma empresa MEI** no banco (as 4 `empresas_fiscais` são Simples, `code '1'`) e a DASN-SIMEI é MEI-only — a action barra antes da SERPRO. Para testar ponta a ponta é preciso um CNPJ MEI com A1 + procuração RFB.

---

## Sessão 5 (2026-07-24) — Master PRD + Bloco 1 (motor de obrigações/notificações)

**Planejamento cruzado (`Direcionamento/planejamento.pdf` × estado atual) → Master PRD + specs/planos.** Via /brainstorming. Entregues (também copiados p/ `D:\balu-app-v2\Direcionamento\`):
- **`docs/novas specs e prd/PRD-MASTER-Balu-2026-07-24.md`** — 8 pilares × estado, decomposto em **7 blocos**: (1) Motor Obrigações/Notificações 🟢 buildável-já; (2) Abertura completa 🟢; (3) DASN/DEFIS assistidas 🟢; (4) Billing Asaas 🔒; (5) Produção Fiscal 🔒; (6) WhatsApp/IA 🔒; (7) Domínio/SLA/Conciliação 🔒. (🔒 = trava em credencial externa do Michel.) Decisões: PIX via WhatsApp + conciliação + domínio + SLA IN de escopo; contrato social por minuta/template; WhatsApp = **Envia.Click (Chatwoot)**; DEFIS = fluxo assistido completo; IA = **Claude/Anthropic**.
- **Specs** (`docs/superpowers/specs/`): `2026-07-24-bloco-1-motor-obrigacoes-notificacoes-design.md`, `2026-07-24-bloco-2-abertura-digital-completa-design.md`.
- **Planos** (`docs/superpowers/plans/`): Bloco 1 (12 tasks) e Bloco 2 (7 tasks).

**Bloco 1 IMPLEMENTADO (branch `feat/bloco-1-obrigacoes`, subagent-driven, 12 tasks) — mergeado para main.** O que entrou:
- **Migration 0045** (`notifications` + `notification_preferences`, RLS `owner_user_id = auth.uid()`, índice único idempotência `(owner_user_id, chave)`, publicação realtime guardada) e **0045b** (RPCs). Ambas aplicadas via runner node+pg.
- **RPC `materializar_obrigacoes(p_hoje date)`** — gera notificações de DAS, cert A1, PGDAS-D, DASN-SIMEI, honorário. **RPC `notificacoes_pendentes_email(p_limite int)`** — junta `auth.users` + contabilidades p/ co-branding do e-mail. Ambas `SECURITY DEFINER` com `REVOKE ALL FROM public` + `GRANT EXECUTE TO service_role` (padrão 0034). **Provada idempotente** no banco (2ª execução = 0 duplicatas).
- **Cron diário** `0 11 * * *` (`api/cron/obrigacoes/route.ts` + `vercel.json`, auth Bearer `CRON_SECRET`): materializa + envia e-mail (marca `enviada_email_em` só quando `r.ok`).
- **UI:** sino com badge + dropdown + realtime (`SinoNotificacoes.tsx` no `MenuLateral`), página `/notificacoes` (marcar lida / todas lidas), aba **Conta → Notificações** com opt-out de e-mail por tipo (`PreferenciasNotificacao.tsx`). Card de pendência de cert A1 no dashboard (`getPendingActions`).
- **3 bugs pegos por review adversarial antes do merge:** (1) `code IN (1,2)` em coluna varchar → runtime error no 1º cron (corrigido p/ `'1'/'2'/'4'`); (2) SECURITY — `notificacoes_pendentes_email` sem filtro de auth deixava anon ler e-mails de todos (corrigido com REVOKE/GRANT); (3) chaves de idempotência PGDAS/DASN sem `company_id` → dono multi-empresa perdia notificação (corrigido).
- **Bug pego no smoke test manual:** aba de preferências — checkbox `defaultChecked` revertia ao salvar (Server Action não revalida rota sozinha). Corrigido com `revalidatePath('/conta')` (`cd13457`). Persistência já funcionava; era só UI. **Smoke test manual: OK.**
- **Follow-ups não-bloqueantes documentados** (do review final): cadência de bucket PGDAS/DASN diverge da spec §5; badge conta só entre os 15 carregados; `getSiteUrl` no cron; `marcarNotificacaoLidaAction` não fiada ao clique; blocos DEFIS/limite_faturamento na RPC (TODO).

**Próximo:** Bloco 2 (abertura digital completa) — plano pronto em `docs/superpowers/plans/2026-07-24-bloco-2-...md`, depende do Bloco 1 (usa `abertura_etapa` nas notificações).

---

## Sessão 6 (2026-07-24) — Bloco 2: Abertura Digital completa

**Bloco 2 IMPLEMENTADO (branch `feat/bloco-2-abertura`, subagent-driven, 7 tasks).** Fecha as 4 lacunas da abertura para o cliente viver o processo. `tsc` 0 · **vitest 513/513** · `next build` limpo. Ainda **não mergeado** (aguarda aplicar a migration 0046 + consentimento — mesmo protocolo do Bloco 1).

- **Migration 0046** (`app/supabase/migrations/0046_abertura_checklist.sql`): coluna `docs_revisao jsonb NOT NULL DEFAULT '{}'` em `abertura_empresas` + `abertura_empresas` na publication `supabase_realtime` (guarda idempotente igual à 0045). ⚠️ **Aplicar em produção antes/no merge** (runtime depende da coluna): `! node app/scratchpad/apply-migration.mjs app/supabase/migrations/0046_abertura_checklist.sql`.
- **Frente A — Checklist de docs com status.** Helper puro `src/lib/abertura/checklist.ts` (`docsExigidos(tipo)`, `estadoDoc(path,rev)` → pendente_envio/aguardando_analise/aprovado/recusado; testes 6/6). `revisarDocumentoAction` em `contador/aberturas/actions.ts` faz **merge parcial** do JSONB `docs_revisao[docKey]` (nunca sobrescreve o objeto), e recusa move `processo_etapa → pendente_documentos` (se não terminal). UI: contador aprova/recusa por doc (com observação) em `DetalheAbertura.tsx`; cliente vê checklist read-only + reenvio (reusa `AlteracaoDialog`) em `AberturaInfoView.tsx`.
- **Frente B — Notificação na transição (usa Bloco 1).** Helper `src/lib/abertura/notificar.ts` insere `notifications` (tipo `abertura_etapa`, upsert `ignoreDuplicates` por `(owner_user_id, chave)`; **guarda `user_id` null** = office-initiated, no-op). Ganchos em `avancarProcessoAction` (nova etapa), `concluirAberturaAction` (CNPJ emitido) e `revisarDocumentoAction` (recusa). E-mail sai pelo cron diário do Bloco 1.
- **Frente C — Realtime.** `AberturaInfoView.tsx` assina `abertura_empresas` filtrado por `id=eq.{id}` (`createBrowserClient`, padrão do sino) → `router.refresh()` no UPDATE; cleanup `removeChannel`.
- **Frente D — Minuta por tipo.** `src/lib/abertura/minuta/` (`tipoDocumento`: MEI→roteiro, EI→requerimento DREI, LTDA→ato SLU art. 1.052 CC; `minutaPronta` lista faltantes; templates HTML com escape completo, marca "MINUTA — rascunho"). `gerarMinutaAction` (guards + audit, não persiste) devolve HTML; UI baixa o arquivo (o contador usa "Salvar como PDF"). Testes 6/6.
- **DECISÃO de formato (registrada):** minuta = **HTML pronto p/ impressão**, não PDF binário. Motivo: nenhuma lib de PDF instalada; `pdf-lib` renderiza prosa jurídica de forma tosca e Chromium em serverless é pesado/frágil; HTML é editável pela equipe e dá o melhor resultado. Zero dependência nova.
- **Correções ao plano descobertas na execução** (o plano tinha placeholders): `registrarAuditoria` é objeto único (sem admin); `aberturaDaCarteira` retorna só `{aberturaId,companyId}` (as actions buscam a linha à parte p/ `docs_revisao`/`user_id`/etapa); `requireEscritorio` retorna `{error}|{userId,contabilidadeId}`; não existe tipo 'SLU' (LTDA→ato SLU); severidade só `info|warning|danger`.
- **Follow-ups não-bloqueantes:** re-recusar o **mesmo** doc não re-notifica no sino (idempotente por chave `doc_recusado_{docKey}`) — mitigado pelo checklist+realtime que refletem o novo motivo; a chamada de notificação nas actions é `await` best-effort (poderia lançar em erro de rede após o UPDATE já persistido, como o insert de `empresas_fiscais` da conclusão); cliente vê checklist sem link de download (só path bruto, sem signed URL — por design).

### Rodada de smoke do Bloco 2 — ✅ CONCLUÍDA (histórico; o rótulo "EM ANDAMENTO" abaixo ficou obsoleto)

> ⚠️ Corrigido em 19/08/2026: esta seção dizia "EM ANDAMENTO — retomar aqui na
> próxima sessão" há semanas. O Bloco 2 está **em `main`** desde julho (merge
> `6f01f1e`, migration 0046 aplicada). Mantida como histórico do que foi feito;
> não há nada a retomar aqui.
Migration 0046 **aplicada** em produção (confirmado no banco: `docs_revisao` + `abertura_empresas` na publication `supabase_realtime`). Dev server pode estar de pé em localhost:3000 (se não, `npm run dev` em `balu/app`). **2 bugs achados no smoke e já corrigidos na branch:**
- `ec80d73` — **Realtime não atualizava sem F5.** Causa: o `@supabase/ssr` carrega a sessão do cookie de forma assíncrona, e o `subscribe()` acontecia antes → socket **anon**, `auth.uid()` null, RLS descartava todos os eventos. Fix: `await getSession()` + `supabase.realtime.setAuth(access_token)` **antes** de `subscribe()`, no sino (`SinoNotificacoes.tsx`, Bloco 1) e na abertura (`AberturaInfoView.tsx`, Bloco 2). (DB estava certo — não era publication.)
- `5c43c1f` — **clique no sino não abria a notificação.** O item linkava para `action_href` (ex.: `/configuracoes`), que parecia "só fechar o dropdown" quando o usuário já estava lá. Fix: item linka para `/notificacoes?sel=<id>#n-<id>` → a página marca a selecionada como lida, destaca (ring) e rola até ela; o botão "Abrir" (contexto) segue em cada item.

**Seed de teste** (scratchpad, não commitado): `app/scratchpad/seed-abertura-bloco2.mjs` cria uma abertura **com dono** (cliente `walacesssantos@gmail.com`, editável), na carteira do escritório de teste, com 3 docs reais no storage — para testar o fluxo completo dos dois lados. Rodar: `! node app/scratchpad/seed-abertura-bloco2.mjs` (imprime o id da abertura + URLs); limpar: `... restore` (apaga o seed e devolve o `current_company` do cliente). Última abertura semeada: `6ecf3668-71b2-4015-a2e0-db5e3cd3f8b1`.

**FALTA (retomada):** usuário rodar o smoke — checklist aprovar/recusar (contador) + realtime/sino/checklist (cliente) + minuta por tipo. Se passar: **merge** `feat/bloco-2-abertura` → `main` (+ push/deploy, mesmo protocolo do Bloco 1) e depois `restore` do seed. Branch tem 9 commits (7 de feature + 2 de smoke). Todos os fixes de smoke tocam Realtime/UX, não a lógica de negócio já revisada.

---

## Sessão 4 (2026-07-23) — abertura lado-contador + auditoria cards 3/5

**Abertura de empresa (lado operador/contador) — CONSTRUÍDA e no ar.** O app já coletava dados (fluxo do empresário), mas o lado do contador operar a abertura estava faltando. Entregue e deployado:
- **Migration 0044** aplicada (runner node+pg): `abertura_empresas.user_id` agora nullable + 2 SELECT policies de contador (`abertura_empresas_select_contador`, `abertura_alteracoes_select_contador`, escopadas por carteira via `minha_contabilidade()`).
- `lib/abertura/form.ts` (parse compartilhado), `lib/abertura/etapas.ts` (7 etapas: recebido→em_analise→pendente_documentos→enviado_receita→enviado_junta→enviado_prefeitura→concluido, +cancelado).
- `contador/actions.ts::criarAberturaClienteAction` — abertura nasce na carteira sem dono (`user_id null`, company stub `status='em_abertura'`), não mexe no `current_company`.
- Fila `contador/aberturas/page.tsx` (botão **Abrir empresa** no header → `AbrirEmpresaButton.tsx` abre o wizard em modal; card com a lista; empty-state com prédio `Building2` + "Ainda não há solicitações de abertura") + detalhe/operação `[aberturaId]/` (`DetalheAbertura.tsx`: timeline, avançar etapa, concluir com CNPJ, aprovar/recusar alterações). Actions em `aberturas/actions.ts` (guard anti-IDOR `aberturaDaCarteira`). Item **Aberturas** (ícone FilePlus) no menu do contador.
- Menu do **AdminBalu** completado com seção de oversight própria (`lib/admin/guard.ts`, `lib/admin/users.ts`, telas `admin/`, `admin/empresas`, `admin/usuarios`; item `/` escondido pro admin). `gate-context.ts` redireciona adminbalu→/admin.
- Último commit desta frente: `aff5fc9` (pushed). Auto-deploy ok.

**Auditoria: cards 3 e 5 do HTML do Michel × app de hoje** (`Direcionamento/devolutiva-dev-preenchido.html`, respostas reais na função `prefill()`, ~L723-775). Cruzamento feito por 2 subagentes Explore.

**Card 3 (Painel do Contador & marca) → ✅ ALINHADO.** Michel: painel essencial p/ lançar (3.1); mostrar lista de clientes + irregulares + honorários não pagos + faturamento + resumo financeiro (3.2) — **os 5 EXISTEM** (`PainelClientes.tsx`, RPCs `painel_contador()`/`resumo_escritorio()`, `lib/fiscal/semaforo.ts`). 3.3 "só visualizar" → **bate exatamente** (RLS dá só SELECT nos dados fiscais do cliente, drill-down zero-botões). 3.4 white-label logo+nome+WhatsApp → EXISTE (co-branding no app do cliente); **e-mail branded só no nome do remetente, não no domínio** (⚠️ depende de verificar domínio no Resend). 3.5 vários escritórios → multitenant é a espinha dorsal. Michel NÃO pediu cores/tema nem domínio próprio → ausência OK.

**Card 5 (Impostos/declarações/emissão "valendo") → ⚠️ 2 TRAVAS de lançamento.** Fundação toda construída; faltam 2 chaves de produção que ele marcou "essencial":
1. **Transmissão oficial PGDAS-D** (5.1 "app transmite"): código real existe (`lib/fiscal/serpro-pgdasd.ts::transmitirPgdasd`) mas só é chamado com `indicadorTransmissao:false` (dry-run) em `impostos/actions.ts::previewDeclaracaoAction` (L560-580). SERPRO/Integra Contador integrado e robusto (mTLS+procurador). DASN-SIMEI (MEI) só consulta — SERPRO ainda não expõe transmissão na API.
2. **Emissão de nota em produção** (5.4 "essencial"): `notas_fiscais/actions.ts` tem `env: FocusEnv = 'hom'` **hardcoded** em emitirNotaAction (L281), emitirNfeAction (L670), emitirNfceAction (L781) e cancelarNotaAction (L452). Flag `emitir_nota_homol_antes_producao` existe (0001) mas é ignorada (`_flagIgnoradaPorEnquanto`). Provedor = Focus NFe (`lib/clients/focus-nfe.ts`, suporta 'prod'/'hom'). Regimes MEI+Simples calculam (`apuracao.ts`); LP/LR não (`RegimeNaoSuportadoError`).
   - **5.6 eSocial/SPED marcados pelo Michel = provável engano** (o próprio HTML sinaliza que são de LP/LR, não do público MEI/Simples) → confirmar antes de virar escopo. 5.7 folha "depois" ✅ (só há input p/ Fator R). 5.5 MEI+Simples ✅.

**DESTRAVAMENTO DO CARD 5 — PLANO (aprovado pelo usuário "destrave o card 5"; investigação feita, ZERO edição de código ainda).** Estratégia: destravar **atrás de flag por empresa, default seguro `hom`** — nada muda em produção até virar uma empresa explicitamente. Passos previstos:
- **(a) Nova coluna `empresas_fiscais.ambiente_atual` `text default 'hom'` (`'hom'|'prod'`)** — migration 0045 (usuário roda via runner). Substitui a leitura de `env` fixo.
- **(b) Token de produção da Focus:** hoje `companies.focus_token` guarda só o `token_homologacao` (ver `focus-empresa-sync.ts` L97: `resp.token_homologacao ?? resp.token_producao`). Para `prod` real precisa do `token_producao` — decidir: coluna nova `companies.focus_token_producao` capturada no POST /v2/empresas, OU trocar a seleção. **PENDÊNCIA: a empresa precisa de cert A1 + habilita_*_producao na Focus** (contrato Focus produção é pendência externa do Michel — ver lista abaixo). Sem isso o `prod` retorna 401/não-habilitado; a flag existe mas só funciona de fato quando a Focus liberar produção.
- **(c) notas_fiscais/actions.ts:** ler `ambiente_atual` da empresa; `env = ambiente_atual === 'prod' ? 'prod' : 'hom'`; escolher token (`focus_token_producao` p/ prod). Aplicar nos 4 pontos (emitir NFSe/NFe/NFCe + cancelar) e no polling `atualizarStatusNotaAction` (L354-360, hoje 'hom' fixo). Manter guards de habilitação.
- **(d) Declaração: nova `transmitirDeclaracaoAction(competencia)`** em `impostos/actions.ts` que chama `transmitirPgdasd(..., {indicadorTransmissao:true})`, gated pela mesma flag `ambiente_atual==='prod'` + confirmação explícita na UI, e **persiste o resultado em `declaracoes_fiscais`** (hoje o dry-run não grava). Botão em `impostos/SecaoDeclaracao.tsx` (só aparece em prod; hoje o texto diz "Fase 2: botão abre dry-run/prévia"). DASN-SIMEI segue só-consulta (limite da SERPRO).
- **(e) Verificar:** `rtk proxy npx vitest run` + `rtk proxy npx next build` a partir de `app/`. Testes de emissão que assumem 'hom' podem precisar de ajuste.
- **Arquivos já lidos nesta sessão (não re-investigar):** `notas_fiscais/actions.ts` (completo), `focus-nfe.ts` (completo), `serpro-pgdasd.ts` (completo), `impostos/actions.ts` L520-614, `focus-empresa-sync.ts` (completo). Falta ler antes de editar: `impostos/SecaoDeclaracao.tsx` e onde `declaracoes_fiscais` é gravada (consultarDeclaracoesAction).
- **RISCO:** virar `prod` = emissão real na SEFAZ + transmissão real na Receita (irreversível/consequência legal). Por isso default `hom` e flip só por empresa, explícito. NÃO virar nenhuma empresa pra `prod` sem o Michel confirmar cert A1 + contrato Focus produção + procuração SERPRO daquele CNPJ.

---

## Sessão 3 (2026-07-23) — QA manual em produção + fixes

**Auto-deploy Git↔Vercel:** ATIVO e testado — cada push na `main` deploya produção sozinho (~1 min).

**AdminBalu de produção criado:** `eufacopublicidade+admin@gmail.com` (via API admin + SQL). Contas de teste em prod: `testeefluxodeautomacao@gmail.com` (contador, escritório "Escritório Teste Balu" aprovado), `walacesssantos@gmail.com` (empresário, dona da empresa dev.ide), `eufacopublicidade+e2e@gmail.com` (E2E). Cadastros/aceites confirmados manualmente via API admin (Redirect URLs do Supabase ainda pendentes → links de e-mail caem em localhost).

**7 bugs de UX/produto corrigidos** (todos com push→deploy, exceto onde nota):
1. `2513c1a`+`3868866` — **loop de redirect pós-login (tela preta)**: gate de aceite LGPD dependia de header `x-pathname` do middleware que não chega nas navegações RSC na Vercel → loop `/aceite→/aceite`. Gates movidos p/ route group `(auth)/(gated)/` (todas as páginas menos /aceite); middleware removido; ordem aceite→onboarding corrigida.
2. `33951b0` — menu do empresário (Clientes/Notas/Impostos/Honorários/Config) aparecia p/ contador/admin sem empresa → beco "Nenhuma empresa selecionada". Marcados `precisaEmpresa` e filtrados.
3. `ee80f87` — página `/contador/honorarios` estava **órfã** (sem link no menu). Link adicionado ao NAV do contador.
4. `c3935f8` — limite do logo do escritório 1MB→**4MB** (teto de body da Vercel; 500MB pedido é inviável).
5. `937118e` — honorário rejeitava valor com separador de milhar (`1.200,00`). Novo helper `normalizarValorBRL` em `lib/format/dinheiro.ts` + `z.preprocess` no `HonorarioV2Schema`; exige >0.
6. `917b7a3` — **furo: `aceitar_convite` não conferia e-mail** → contador (sessão ativa) abriu o link do convite de cliente e assumiu a empresa do próprio cliente. **Migration 0043** aplicada no banco (trava: e-mail da conta logada = `convites.email`, case-insensitive; erro `EMAIL_NAO_CONFERE`). Vale p/ link vazado também.
7. Gap documentado: `role_types` **sem UNIQUE(user_id)** (permitiu duplicata no insert manual do admin) — candidata a migration futura.

**Migrations aplicadas em prod nesta sessão:** 0043 (via runner node+pg no scratchpad; classifier bloqueia MCP/escrita, usuário roda os scripts com `! node ...`).

**Pendências reabertas:** (a) Supabase Auth Redirect URLs (`https://balu-contabil.vercel.app/**` + Site URL) — trava links de e-mail; (b) **Resend: chave configurada** — `RESEND_API_KEY` + `EMAIL_FROM` postos no `.env.local` (corrigido de `CHAVE_API_RESENDE`, nome que o código não lia) e no Vercel/Production (pendente redeploy p/ valer). **Bloqueio restante é DNS do usuário:** conta Resend (`contato@excluvia.com.br`) sem domínio verificado → modo teste, só entrega p/ `contato@excluvia.com.br`; `EMAIL_FROM` provisório = `Balu <onboarding@resend.dev>`. Ao verificar domínio em resend.com/domains, trocar `EMAIL_FROM` p/ remetente do domínio (local + Vercel). Fluxo de convite funciona pelo **link copiável** na tela enquanto isso.

**Não confirmado ainda:** co-branding (logo/nome do escritório na sidebar do empresário) em produção.

**Rodada de code-review + systematic-debugging (fim da sessão 3):** review dos commits de hoje achou 5 pontos; 3 corrigidos, 2 rejeitados com fundamento. (a) `(gated)/layout` refazia `getUser`+`profiles`+`role_types` que o pai já rodava (custo do split em route-group) → novo `lib/auth/gate-context.ts` memoizado com React `cache()`, usado pelos dois layouts (dedup por request; redirects seguem em cada layout). (b) `.replace(',', '.')` morto nas actions de honorário removido (schema já normaliza a ponto). Rejeitados: `"10.999"→10999` é leitura pt-BR correta; `valor>0` é validação melhor (V2, sem dado legado 0). Verificado: `tsc` limpo + **494/494** testes.

---

## Onde estamos

**Fase:** **Bloco A e Bloco E concluídos em `main`; código no GitHub e app no ar na Vercel.** Próximo passo de produto: **P0.2 — motor de obrigações/notificações** (buildável já, sem depender do Michel — ver `docs/novas specs e prd/`). Bloco D/B/C dependem de credenciais externas do Michel. Fluxo por bloco: /brainstorming → spec → writing-plans → execução.

## Infraestrutura (GitHub + Vercel) — configurada em 2026-07-22

**GitHub:** repo **`gestao-hub/balu-contabil`** (⚠️ **público**). `main` + tags (`pre-preview-bloco-a`, `pre-bloco-e`) + as 5 branches antigas empurradas. Remote `origin` já configurado; **push autentica como `grupoideapps`** (colaborador, e-mail contato@grupoidecomunicacao.com). Auditoria de segredos feita antes do push: histórico limpo. `main` = `origin/main`.

**Vercel:** projeto **`balu-contabil`** no scope **`gestao-9664s-projects`** (conta do luan@grupoidecomunicacao.com — NÃO usar tryia-social nem a Vercel do grupoideapps). **App no ar: https://balu-contabil.vercel.app** (deploy de produção via CLI, aponta pro **Supabase de PRODUÇÃO**). Config: 11 env vars em prod+preview (Supabase, Focus, SERPRO, CERT_ENC_KEY, CRON_SECRET, FOCUS_WEBHOOK_SECRET, NEXT_PUBLIC_SITE_URL=https://balu-contabil.vercel.app), `rootDirectory=app`, framework nextjs. Deploy manual: `cd app && npx vercel deploy --prod --scope gestao-9664s-projects`. (Domínio `app.balu.com.br` foi configurado e depois **revertido** a pedido do usuário — projeto só tem `balu-contabil.vercel.app`.)

**Pendências de infra:**
1. ✅ **Auto-deploy (Git integration): ATIVO e testado em 2026-07-23** — usuário conectou o OAuth no navegador; push `accd874` na main disparou build automático (user `gestao-9664`), Ready em 58s, aliased para balu-contabil.vercel.app, smoke test ok (307→/login). Cada push na main deploya produção sozinho.
2. **Supabase Auth:** adicionar `https://balu-contabil.vercel.app/**` em Authentication → URL Configuration → Redirect URLs (senão cadastro/reset/convite por e-mail não redirecionam).
3. **Rotação da `SUPABASE_SERVICE_ROLE_KEY`** (recomendação pendente de incidentes anteriores; a chave também está agora nas env vars da Vercel — legítimo, mas se quiser zero risco residual, rotacionar).

**Bloco E — hardening + LGPD (COMPLETO, direto em `main`, sem branch — repo local):** 16 tasks + 2 rodadas de code-review adversarial com fixes verificados no banco vivo.
- Migrations **0037–0042** aplicadas: rate_limit, audit_log, documento_versoes/aceites, anonimizar_usuario (+ correções), triggers de validação.
- Entregue: rate-limiting (login/cadastro/convite/reset/webhook), anti-SSRF no download (allowlist S3 + redirect:manual), anti-IDOR clientes, webhook Focus com segredo constant-time (`FOCUS_WEBHOOK_SECRET`), cifra AES-256-GCM das credenciais NFS-e, aceite versionado de termos/política + gate de re-aceite (`assertAceitesEmDia` nas ações de escrita), export de dados do titular, **exclusão = anonimiza + retém fiscal + bane login (nunca deleta auth.user — FKs são CASCADE)**, trilha de auditoria, minutas jurídicas (política/termos v1.0 seedadas, DPO placeholder), inventário de dados.
- **Code review (2 rodadas) — todos os achados corrigidos e verificados:** escalação AdminBalu via role_types (0036); PGDAS competência YYYY-MM×YYYYMM; open-redirect TAB/CR/LF no safeNext; fuso BRT; SSRF por redirect-follow; anonimização incompleta (companies/empresas_fiscais/cert/**abertura CPF-RG-nome-mãe**); **regressão que eu introduzi** (0041 perdeu `contabilidade_id=NULL`, corrigida na 0042); aceites auto-fabricáveis (trigger); rate-limit case-splitting. Anonimização **provada end-to-end** no banco (nota retida, PII zerada, abertura apagada, rollback limpo).
- Verificação final: typecheck 0 · vitest **490** · build limpo · Playwright RLS 17/17.
- **Pendências de go-live (não bloqueiam código):** revisão jurídica das minutas + nome/e-mail do DPO + razão/CNPJ do controlador; definir `FOCUS_WEBHOOK_SECRET` na URL de callback da Focus; allowlist de IP da Focus no edge; rotação da service_role.
- **Itens menores documentados (aceitos):** `decifrarCampo` sem uso em runtime hoje (landmine se alguém ler credencial NFS-e do banco no futuro — tem que decifrar); `deleteAccountAction` não é atômica entre RPC e ban do auth (retorna erro se falhar, sem retry); `signOut` não revoga sessões de outros dispositivos (JWT expira naturalmente); entidades do contador (contabilidades) não anonimizadas (identidade de negócio).

**Backup/reversão do Bloco A:** tag `pre-preview-bloco-a` (f1c3f21); main pré-merge estava em `78dd189`. Reverter dados do teste: `scratchpad/reverter-preview.sql` + `docs/reference/RESTORE-POINT-preview-2026-07-22.md`.

**Backup/reversão do Bloco A:** tag `pre-preview-bloco-a` (f1c3f21); main pré-merge estava em `78dd189`. Reverter dados do teste: `scratchpad/reverter-preview.sql` + `docs/reference/RESTORE-POINT-preview-2026-07-22.md`.

**Preview Vercel:** NÃO subido (adiado pelo usuário). Não há projeto Vercel do balu em nenhuma scope da CLI logada (luan-4913: times ide-apps, tryia-social). `app/vercel.json` só tem crons — não linka projeto. Ao retomar o preview: precisa definir a conta/scope (tryia-social foi descartada pelo usuário) e as env vars vão do `app/.env.local` (menos SUPABASE_PASSWORD; NEXT_PUBLIC_SITE_URL = URL do preview). O deploy apontará para o Supabase de PRODUÇÃO (único que existe).

**Bloco A — progresso (22/07, sessão 2):**
- ✅ Tasks 1–5: migrations 0030–0034 escritas, commitadas e **aplicadas no banco real** com verificação (runner node+pg no scratchpad lendo `SUPABASE_PASSWORD` do `app/.env.local` — MCP Supabase rejeitado pelo usuário; ver memória `balu-migrations-e-env`).
- ✅ Task 6: tipos TS + Zod + helpers dinheiro (`64cc1c7`).
- ✅ Task 7: `lib/fiscal/semaforo.ts` TDD 10/10 (`ed231ab`).
- ✅ Task 8: tetos de `parametros_fiscais` com fallback (`d8cd22c`).
- ✅ Task 9: guards contador + client email (`1d1db91`) — ⚠️ incidente: `.env.example` no disco era cópia do `.env.local` com segredos reais e foi commitado por engano; commit emendado com template sanitizado (sem remote, nada vazou; considerar rotacionar SERVICE_ROLE_KEY por cautela).
- ✅ Task 10: cadastro contabilidade + aguardando (`9009cef`).
- ✅ Task 11: admin aprovação + gate do layout isentando `adminbalu`/`contador` do onboarding (`ee9513a`) — emenda ao plano registrada.
- ✅ Task 12: convites (`73817ab` + fix `01b8695` — revisão pegou open-redirect `\`, HTML injection em e-mails, checagem de dono, `next` no signup; tudo corrigido).
- ✅ Task 13: painel do contador com semáforo (`672a882`).
- ✅ Task 14: drill-down read-only com guard extra de escopo (`9f6fe0b`).
- ✅ Task 15: cliente pelo contador + refactor `posProcessarNovaEmpresa` (`c9a4f2a` + fix normCnpj `37e50bb`).
- ✅ Task 16: honorários v2 + visão do empresário (`b7ee53a`) — FK do join verificado no banco.
- ✅ Task 17: equipe (`acb4a03`).
- ✅ Task 18: white-label + co-branding + desvincular (`65783f5` + menu `29eb854`); bucket `branding` criado no banco.
- ✅ Task 19: cron honorários recorrentes (`ba51b49`).
- ✅ Task 20: **testes de RLS 8/8 verdes** (`206c46e`) — o teste pegou recursão infinita (42P17) nas policies da 0030; corrigida pela **migration 0035** (`ae8426f`, helper `minha_contabilidade_membro()` SECURITY DEFINER), aplicada no banco.
- ✅ Task 21: E2E da jornada 9/9 verde (`6072b20`, inclui fix de upsert de profiles no aceite). Verificação final: typecheck 0 erros · vitest 471/0 · build limpo · Playwright 35/36 (única falha restante: `rls-isolation.spec.ts`, conta externa hardcoded `allanvalle@outlook.com` com senha inválida — genuinamente pré-existente). A "outra falha pré-existente" apontada pelo subagente (`02-cadastro`, hydration #418) era na verdade **regressão da Task 12** — provada por bisect manual e corrigida em `adb4e0e` (useQueryParam pós-mount).

**BLOCO A COMPLETO — 21/21 tasks. Critério de merge (RLS verde) atendido.**

**Code review + systematic debugging (22/07, sessão 2):** 4 revisores (segurança, correção, SQL, UI/mocks) + verificação no banco vivo. UI limpa: zero mocks, zero botões mortos. Achados corrigidos e **verificados**:
- **Migration 0036** (`550064f`): (a) CRÍTICO — qualquer autenticado podia se auto-promover a `AdminBalu` via `role_types` (sem trigger/constraint) — provado explorável e corrigido (trigger com `current_user`/SECURITY INVOKER; atacante bloqueado, service_role liberado — testado); (b) CRÍTICO — semáforo comparava competência `YYYY-MM` mas app grava `YYYYMM` → todo Simples ficava vermelho pra sempre — provado com dados reais e corrigido; (c) `aceitar_convite` queimava convite de membro sem vincular (usuário já em outro escritório); (d) convites exigem escritório aprovado + trigger anti-vazamento de company_id; cert/guias-erro/DASN na RPC.
- **App** (`a477b90`): open-redirect por TAB/CR/LF no `safeNext` (+teste); fuso BRT em statusHonorario/semaforo/marcar-pago (novo `tempo-brt`, +testes de fronteira); erro do profiles-upsert propagado no aceite; CNAE sync disparado no aceite (antes empresa do contador ficava sem CNAE); SVG recusado no upload de logo; **dead-end de UI corrigido** — `/contador` sempre visível pro contador (caminho até o cadastro).
- Não alterado (decisão registrada): compare do cron secret segue `!==` como o cron `sync-municipios` existente (risco timing marginal); policy `apuracoes_select_contador` fica (superfície morta inócua).
- Verificação final: typecheck 0 · vitest **478/0** · build limpo · **RLS 8/8 reconfirmado** após a 0036.

**Falta: decisão de merge para main.**

**Correções ao plano descobertas na execução:**
- `arquivos_auxiliares` usa `company_id` (não `unique_id_empresa`) — plano corrigido, 0033 ajustada.
- Papel `contador` também precisava de isenção no gate `/onboarding` (Task 11 cobriu).
- Policies da 0030 recursavam (42P17) — 0035 corrige (padrão SECURITY DEFINER).

**Gaps conhecidos (aceitos para o lançamento, revisar depois):**
- CNAEs de empresa criada pelo contador ficam vazios até o cliente aceitar o convite (`company_cnaes.owner_user_id NOT NULL`) — sem backfill automático no aceite.
- Convidado NOVO que cria conta pelo botão do convite: `next` só funciona no fluxo auto-confirm; com confirmação por e-mail, ele volta pelo link do convite no e-mail original.
- Logo antigo fica órfão no bucket ao trocar de extensão (higiene de storage, sem impacto).

**Pendências desta fase:** conceder `AdminBalu` ao usuário do Michel (falta o UUID — Step 4 da Task 11; em 2026-07-23 foi criado o AdminBalu do Walace em produção — `eufacopublicidade+admin@gmail.com`, via API admin + SQL, senha temporária fora do repo). ⚠️ Gap descoberto: `role_types` **não tem UNIQUE(user_id)** — o insert manual duplicou a linha e o `.maybeSingle()` do layout falharia; duplicata removida, mas vale migration com unique index (candidata a 0043); `docs/reference/db_atual.sql` regenerado nesta sessão (conferir commit); decidir merge da branch após E2E verde.

O código do app está congelado desde 15/06/2026 (commit `52a0844`). Em 22/07 foi feita a análise cruzada dos documentos de direcionamento (`Direcionamento/`: batimento, comparativo Contabilizei e devolutiva do Michel) contra o código real, e produzidos os documentos abaixo.

## Documentos-guia (ordem de leitura para retomar contexto)

1. `docs/product/PRD-Balu-V2.md` — **escopo de lançamento**: visão, 5 blocos (A–E), enquadramento legal consolidado, dependências externas, critérios de aceite propostos, pontos a realinhar com o Michel.
2. `docs/product/2026-07-22-bloco-a-multitenant-contador-design.md` — spec aprovada do Bloco A (movida de specs/ por decisão do usuário em 22/07; specs dos próximos blocos seguem em `docs/superpowers/specs/`).
3. `docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md` — **plano de implementação do Bloco A (21 tasks, próximo passo)**.
4. `docs/investigations/BATIMENTO-PLANEJAMENTO-VERDE.md` — o que está entregue vs. planejado (jun/2026, ainda válido).
5. `Direcionamento/devolutiva-dev-preenchido.html` (fora do repo, em `D:\balu-app-v2\Direcionamento\`) — fonte da verdade das decisões do cliente.

## Sequência dos blocos

> ⚠️ Duas numerações convivem: a **antiga A–E** (PRD-Balu-V2, blocos A e E já em main) e a **nova 1–7** do `PRD-MASTER-Balu-2026-07-24.md`, que é a válida desde a sessão 5. A tabela A–E abaixo fica como histórico.

**Numeração vigente (Master PRD) — tabela conferida contra o código e as migrations em 19/08/2026** (ela vinha desatualizada: mostrava 4 a 7 como não iniciados, e três deles estão em `main` há semanas):

| Bloco (Master PRD) | Spec | Plano | Implementação |
|---|---|---|---|
| 1 — motor de obrigações/notificações | ✅ aprovada | ✅ escrito (12 tasks) | ✅ **em main** (0045, 0045b, 0047) |
| 2 — abertura digital completa | ✅ aprovada | ✅ escrito (7 tasks) | ✅ **em main** (0046) — merge `6f01f1e` |
| 3 — DASN-SIMEI assistida + DEFIS | ✅ aprovada | ✅ escrito (22 tasks) | ✅ **em main** (0048, 0049) desde a sessão 10 |
| 4 — billing Asaas | ✅ 4A + 4B | ✅ escrito | ✅ **em main** (0050–0055) — 🔒 roda em **sandbox**; produção depende de credencial + webhook com URL pública |
| 5 — produção fiscal | ⬜ | ⬜ | ⬜ **não iniciado** — `notas_fiscais/actions.ts` segue com `env: FocusEnv = 'hom'` fixo (emissão NFSe/NFe/NFCe, cancelamento e polling) |
| 6 — WhatsApp + IA | ✅ 6A + 6B | ✅ escrito | ✅ **em main** (0056 IA, 0061 WhatsApp, 0062–0063 base jurídica, 0064/0068 linha digitável e coalescência) — ⚠️ o canal é **uazapi**, não Envia.Click como o PRD previa; 🔒 falta `UAZAPI_TOKEN` |
| 7 — SLA + conciliação | ✅ aprovada | ✅ escrito | 🟡 **em main com dois desvios**: (a) **domínio próprio arquivado** pela 0075 (12/08 — o cliente não pediu; veio do PRD Master); (b) conciliação por **Open Finance trocada** por SERPRO + Asaas na Frente 3 (0071–0073, 0086–0088), com o Open Finance atrás de adaptador e mock. SLA entregue (0070) |

⚠️ **Para quem for atualizar esta tabela:** use as migrations e o código como
fonte, não o histórico deste arquivo. Foi assim que ela ficou ~15 sessões
mentindo sobre os blocos 4, 6 e 7.


**Histórico (numeração antiga A–E):**

| Bloco | Spec | Plano | Implementação |
|---|---|---|---|
| A — multi-tenant, painel contador, white-label, honorários v2 | ✅ aprovada | ✅ escrito (21 tasks) | ✅ **em main** (0030–0036) |
| E — hardening + LGPD | ✅ aprovada | ✅ escrito (16 tasks) | ✅ **em main** (0037–0042) |
| D — produção fiscal (Focus prod, PGDAS-D real, DASN assistida, abertura UI) | ⬜ | ⬜ | ⬜ (virou Bloco 5) |
| B — billing Asaas | ⬜ | ⬜ | ⬜ (virou Bloco 4) |
| C — notificações, WhatsApp, IA | ⬜ | ⬜ | ⬜ (virou Bloco 6) |

## Decisões-chave já tomadas (não rediscutir sem motivo novo)

- Multi-escritório desde o lançamento; 1 escritório = N usuários iguais (papéis = V2).
- Painel do contador é **somente visualização**; garantia no banco (RLS sem políticas de escrita).
- Cadastro de escritório com **aprovação por admin** (validação CRC — DL 9.295/46).
- Co-branding (não substituição total); e-mails de auth continuam Balu.
- Honorários v2: controle manual + recorrência via cron; Asaas pluga depois (campos `asaas_*` prontos).
- Semáforo "irregular": 5 critérios fiscais (LC 123 arts. 3º/18-A/21; Res. CGSN 140/2018 arts. 38 e 109); honorário atrasado é coluna separada.
- Tetos fiscais em tabela `parametros_fiscais`, nunca hard-coded.
- IA nunca calcula/transmite — determinístico decide, IA explica (guard-rail de todos os blocos).
- Reforma Tributária: CBS/IBS **não atinge Simples/MEI em 2026** — sem ação no lançamento.

## Pendências externas (cobrar do Michel — travam D/B/C, não A/E)

- [x] ~~Validar credenciais SERPRO de produção (ele diz "já tenho"; Trial dava 403)~~ — **VALIDADA em 2026-07-25** (sessão 7): autenticação de produção + geração de token de procurador funcionando com as chaves do `.env.local` e o cert do contratante (PIPER). Falta ainda: **procuração RFB por cliente** (a autorização por CNPJ segue sendo dependência real).
- [ ] Credenciais Asaas de produção (não existem)
- [ ] Credenciais WhatsApp Business API (ele diz que tem)
- [ ] Contrato Focus produção + certificados A1 dos pilotos + procurações RFB
- [ ] Realinhar: "saldo disponível real" no dashboard · DASN-SIMEI sem transmissão automática (fluxo assistido) · DEFIS no lançamento ou V2 · definição de pronto + nº de pilotos

## Próximo passo imediato

> ⚠️ Reescrita no fim da **sessão 29 (19/08, noite)**. Se voltar a divergir do
> topo do arquivo, o topo é que vale.
>
> 🕐 **ESTA LISTA ESTÁ DEFASADA — conferida item a item em 29/08 (sessão 36).**
> Ela é de 19/08 e as sessões 30–35 aconteceram depois. Os itens 1, 2 e 5 já
> foram entregues e estão marcados abaixo. Antes de usar qualquer item daqui
> como pendência, confira contra o topo do arquivo ou contra o código — foi
> exatamente assim que o item 5 sobreviveu obsoleto por dez dias.

**Lançamento: segunda-feira, 24/08.**

### Para o piloto rodar — dependem de você, não de código

1. ✅ **Número oficial do Balu** na instância da plataforma — **ENTREGUE**
   (confirmado pelo usuário em 29/08). O canal foi provado de ponta a ponta na
   **sessão 33 (25/08)**, com os 5 passos do roteiro passando e três defeitos
   achados só pelo teste real. ⚠️ Continua valendo a higiene combinada, se ainda
   não foi feita: **desligar o webhook do número pessoal e limpar de
   `whatsapp_atendimentos` as conversas de terceiros** (três conversas viraram
   linha em 12/08). Não é opcional — são dados pessoais de quem nunca foi
   cliente.
2. ✅ **Um escritório conectar o próprio número** pela tela nova
   (`/contador/configuracoes/whatsapp`) — **ENTREGUE** (confirmado pelo usuário
   em 29/08).
3. 🟡 **Anexo do Simples da `ideapp`** (ou o `anexo_base` do CNAE 7319002 no
   catálogo `cnae_anexo`). Enquanto faltar, o imposto dela não é recalculado —
   e agora o dono é avisado disso todo mês. **É decisão fiscal: não preenchi.**
4. 🟡 **Asaas em produção** — nenhuma variável Asaas na Vercel; `ASAAS_ENV`
   ausente significa **sandbox**. É o que falta para a cobrança valer dinheiro.
5. ✅ **`env: FocusEnv = 'hom'` fixo — NÃO EXISTE MAIS.** Corrigido no Bloco 5;
   `notas_fiscais/actions.ts:307` usa `credencial.ambiente`, decidido por
   `resolverCredencialEmissao`. O texto abaixo ficou dez dias descrevendo código
   que já não existia. 🟡 **O que de fato falta** para emissão em produção:
   contrato Focus + certificado A1 dos pilotos + procuração por CNPJ — e o
   token do painel, que a sessão 35 deixou dando **401 em `/v2/empresas`**.
6. 🟡 **Token de revenda da Focus na tela nova** (`/admin/configuracoes/focus`).
   Hoje ele vive só como variável na Vercel, com valor "Sensitive" que ninguém
   consegue ler de fora — inclusive para conferir. Colar na tela e clicar em
   "Testar" tira a plataforma dessa dependência e prova a credencial num clique.
   Enquanto a coluna estiver vazia, nada muda: o app usa a variável. (Sessão 30.)
7. 🟡 **Custo por instância na uazapi** não foi levantado. Com provisionamento
   self-service, ele cresce por escritório **sem teto** — confirmar com o
   fornecedor antes de abrir para todos.

### Dívidas técnicas registradas

- **LGPD:** a política de privacidade **não menciona WhatsApp**, e agora
  conversas de clientes ficam armazenadas por escritório. Não editei: é
  documento versionado, já aceito por usuários, e está na fila de revisão
  jurídica. **Levar o ponto junto.**
- **Chave `sending_access` restrita no Resend** — hoje o `smtp_pass` do Supabase
  e o `.env.local` usam a full-access, por decisão explícita ("por enquanto").
- **Grafia oficial do nome** — "Balu Contábil" (saudação da IA), "Balu
  Contabilidade" (prompt) e `balucontabil.com.br` convivem.
- **Conexão órfã de conciliação** da `ideapp` (`status:'ativa'`,
  `consentida_em: null`) — revogar, é uma linha.
- **Smoke da IA (`ia.smoke.test.ts`)** nunca rodou de verdade: é pulado sem
  chave de IA, e a asserção do guard-rail jurídico ficou meses passando por um
  byte 0x08. Corrigida, mas ainda **não executada**.
- **Smoke manual da Frente 3** (6 critérios, roteiro no histórico da sessão 26).

**Antes de mexer em qualquer coisa:** `npx tsc --noEmit && npx vitest run &&
npm run build` **a partir de `app/`, nunca da raiz**. Linha de base ao fim da
sessão 29: **tsc 0 · 1868 testes · 36 pulados · build limpo**.

## Convenções da sessão

- Rodar **git** a partir de `balu/` (raiz do repo); rodar **`tsc`, `vitest` e `next build` a partir de `app/`** — da raiz o vitest varre também os testes das 57 skills instaladas e o vermelho não tem relação com o produto (sessão 27). Specs/planos via skills brainstorming → writing-plans.
- Git identity local: Walace <eufacopublicidade@gmail.com>.
- Banco: `docs/reference/db_atual.sql` é a fonte da verdade do schema (a `0001` é idealizada e diverge — ver `docs/investigations/DB-DIVERGENCIA.md`); migrations aplicadas manualmente no SQL Editor.
