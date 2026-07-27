# CHECKPOINT — Balu

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-07-27 (sessão 13 — **smoke do Bloco 4A CONCLUÍDO e 4A fechado.** Branch `bloco-4-billing-asaas`, 38 commits. `tsc` 0 · **vitest 731/731** (27 pulados) · `next build` 0 erros / 46 rotas · migrations `0050`, `0051` e `0052` aplicadas em produção. O smoke da sessão 12 achou **8 bugs**; a 13 fechou o §2.4–2.6 e o §3-bis, e o usuário pediu uma regra nova: **comprovante obrigatório na liberação manual** (migration 0052). **Blocos 1, 2 e 3 em `main` e no ar.**)

> ## ▶ AO RETOMAR: voltar direto na pergunta de execução do 4B
> **Pedido explícito do usuário ao encerrar a sessão 13:** retomar já na
> pergunta, sem recapitular o que ficou pronto.
>
> **Perguntar as duas coisas, juntas:**
>
> **1. Como executar o plano do 4B?**
> - **(1) Subagent-driven** *(recomendado)* — um subagente novo por task, com
>   revisão entre elas.
> - **(2) Inline** — executar na própria sessão, em lotes com checkpoints.
>
> **2. O gate de inadimplência do 4A alcança a emissão de cobrança pela
> subconta?** (bloqueia a **Task 9**)
> Recomendação registrada no plano: bloqueia **criar** cobrança nova, e **nunca**
> alcança ver, sincronizar ou receber as já emitidas — é com esse dinheiro que o
> escritório paga a Balu. Mesma forma das duas fronteiras do 4A.
>
> **Estado:** o 4A está fechado e no ar (**não há smoke pendente**); a spec do 4B
> teve os 5 pontos do §7 decididos; o plano está escrito e commitado em
> `docs/superpowers/plans/2026-07-27-bloco-4b-subcontas-escritorio.md`
> (14 tasks, TDD, código completo em cada passo). **Nenhuma linha de código do
> 4B foi escrita ainda** — nada a desfazer.
>
> **Primeiro comando ao começar a executar:**
> ```
> git checkout main && git pull && git checkout -b feat/bloco-4b-subcontas
> ```
>
> Dependências externas que seguem de pé: aprovação comercial do Asaas para
> criar subconta **em produção** (em sandbox já funciona — provado nesta sessão)
> e as premissas do Michel (§8 da spec).

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

### Rodada de smoke (EM ANDAMENTO — retomar aqui na próxima sessão)
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

**Numeração vigente (Master PRD):** 1 (obrigações/notificações) → 2 (abertura completa) → **3 (DASN/DEFIS assistidas — próximo)** → 4 (billing Asaas 🔒) → 5 (produção fiscal 🔒) → 6 (WhatsApp/IA 🔒) → 7 (domínio/SLA/conciliação 🔒)

| Bloco (Master PRD) | Spec | Plano | Implementação |
|---|---|---|---|
| 1 — motor de obrigações/notificações | ✅ aprovada | ✅ escrito (12 tasks) | ✅ **em main** (0045, 0045b, **0047**) |
| 2 — abertura digital completa | ✅ aprovada | ✅ escrito (7 tasks) | ✅ **em main** (0046) — merge `6f01f1e` |
| 3 — DASN-SIMEI assistida + DEFIS | ✅ aprovada | ✅ escrito (22 tasks) | 🟡 **22/22 na branch `bloco-3-dasn-defis`** (0048, 0049) — aguarda smoke manual + merge |
| 4 — billing Asaas 🔒 | ⬜ | ⬜ | ⬜ |
| 5 — produção fiscal 🔒 | ⬜ | ⬜ | ⬜ |
| 6 — WhatsApp (Envia.Click) + IA (Claude) 🔒 | ⬜ | ⬜ | ⬜ |
| 7 — domínio + SLA + conciliação 🔒 | ⬜ | ⬜ | ⬜ |

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

**Bloco 3 com as 22 tasks feitas na branch `bloco-3-dasn-defis`.** O que falta é o **smoke manual do usuário** — mesmo protocolo dos Blocos 1 e 2:
1. DASN: entrar como `walacesssantos@gmail.com` (o seed apontou o `current_company` dele para a empresa MEI) → `/impostos` → seção Declarações → conferir pré-preenchimento (R$ 4.500 = 2.300 comércio + 2.200 serviço), editar e salvar rascunho, registrar comprovante e verificar que **só a entrega cala o sino**.
2. DEFIS: uma das 4 empresas Simples → `/impostos` → seção Declaração anual → accordions, sócios somando 100%, salvar rascunho.
3. Contador: `/contador/clientes/<id>?tab=declaracoes` → card com situação e, havendo rascunho do cliente, o registro de comprovante.

Passando → merge `--no-ff` para `main` + push (auto-deploy) + `node app/scratchpad/seed-empresa-mei.mjs restore`. **Não rodar o `restore` antes do smoke** — sem o seed não há empresa MEI e a tela da DASN não aparece.

## Convenções da sessão

- Rodar ferramentas a partir de `balu/` (raiz do git). Specs/planos via skills brainstorming → writing-plans.
- Git identity local: Walace <eufacopublicidade@gmail.com>.
- Banco: `docs/reference/db_atual.sql` é a fonte da verdade do schema (a `0001` é idealizada e diverge — ver `docs/investigations/DB-DIVERGENCIA.md`); migrations aplicadas manualmente no SQL Editor.
