# Spec — Bloco 2: Abertura Digital completa

> **Data:** 2026-07-24 · **Status:** aprovada (design) · **Bloco:** 2 de 7 do `PRD-MASTER-Balu-2026-07-24.md`
> **Pré-requisito de leitura:** §3 (princípios anti-bug) e §4 Bloco 2 do Master PRD; spec do **Bloco 1** (este bloco usa a tabela `notifications`).
> **Natureza:** 🟢 buildável agora. **Depende do Bloco 1** (notificação na transição usa `notifications` + `materializar_obrigacoes`).
> **Base factual:** auditoria do código real em 2026-07-24. Schema de `abertura_empresas` lido do `db_atual.sql` (schema moderno, linhas 223-286) — as migrations `0001` têm o schema **antigo** e não valem aqui (Master §3.1).

---

## 1. Objetivo

Fechar a promessa do pilar 2 ("abertura 100% online — MEI + ME sem sócio"). A sessão 4 entregou coleta + lado-contador (fila, avanço de etapa, conclusão com CNPJ, alterações). Faltam **4 lacunas** para o cliente viver a abertura como um processo transparente:

- **A. Checklist de documentos com status** (hoje os 8 docs são upload livre, sem estado de revisão).
- **B. Notificação ao cliente na transição de etapa** (hoje ninguém é avisado).
- **C. Status em tempo real** (hoje é `router.refresh()` manual).
- **D. Minuta do ato constitutivo gerada pelo app** (hoje o app não gera documento nenhum).

Modelo mantido (decisão da sessão 4, `0044`): **o app coleta; a equipe do escritório protocola nos órgãos**. Sem RedeSim/automação de órgão no lançamento.

## 2. Escopo

**Dentro:** checklist de docs com status por documento (ambos os lados); disparo de notificação nas transições (via Bloco 1); status tempo-real na visão do cliente (Supabase Realtime); geração de minuta por tipo de empresa (PDF, rascunho para a equipe revisar).

**Fora:** integração RedeSim/Portal do Empreendedor; execução automática nos órgãos; e-assinatura; OCR de documentos; múltiplos sócios (o escopo é MEI + ME **sem sócio**).

## 3. Frente A — Checklist de documentos com status

### 3.1 Dado
Os 8 documentos são colunas `text` em `abertura_empresas` (path/URL ou null): `doc_rg_frente`, `doc_rg_verso`, `doc_cnh_frente`, `doc_cnh_verso`, `doc_cpf`, `doc_comprovante_titular`, `doc_comprovante_sede`, `doc_declaracao_uso`. A **presença do path** já indica "enviado"; falta persistir o **estado de revisão** (o contador aprovou/recusou?).

**Decisão de design:** nova coluna JSONB `docs_revisao jsonb NOT NULL DEFAULT '{}'` em `abertura_empresas` (migration `0046`), mapeando `DocKey → { status, observacao, revisado_por, revisado_em }`, `status ∈ {'pendente_revisao','aprovado','recusado'}`. Preferido ao invés de tabela filha: são 8 docs fixos, sem histórico exigido, e evita join na fila. O estado **derivado** por doc:

| doc_* (path) | `docs_revisao[key].status` | Estado exibido |
|---|---|---|
| null | — | **Pendente de envio** |
| presente | ausente / `pendente_revisao` | **Enviado, aguardando análise** |
| presente | `aprovado` | **Aprovado** |
| presente | `recusado` (+ observacao) | **Recusado** (mostra o motivo; cliente reenvia) |

`DOC_KEYS` é a fonte única das chaves (`src/types/abertura.ts:5`). Nem todo tipo exige todos os docs (ex.: RG **ou** CNH) — o checklist marca os **exigidos por tipo** como obrigatórios; os demais como opcionais. A regra de exigência por `empresa_tipo` fica em um helper novo `src/lib/abertura/checklist.ts` (`docsExigidos(empresaTipo): DocKey[]`), testável.

### 3.2 Ações (contador)
Em `src/app/(auth)/(gated)/contador/aberturas/actions.ts` (padrão existente: `requireEscritorio()` + `aberturaDaCarteira()` anti-IDOR + `registrarAuditoria`):
- `revisarDocumentoAction({ aberturaId, docKey, status: 'aprovado'|'recusado', observacao? })` → atualiza `docs_revisao[docKey]` (merge JSONB, não sobrescrever o objeto todo), grava `revisado_por`/`revisado_em`.
- Ao **recusar** um doc, mover automaticamente `processo_etapa → 'pendente_documentos'` (se não estiver em etapa terminal) e disparar notificação (Frente B).

### 3.3 UI
- **Contador** (`.../aberturas/[aberturaId]/DetalheAbertura.tsx`): por doc, botões Aprovar/Recusar + campo de observação; badge de status.
- **Cliente** (`.../configuracoes/AberturaInfoView.tsx`): checklist read-only com os estados acima; docs recusados destacam o motivo e permitem reenvio (reusa o fluxo de alteração/`AlteracaoDialog` já existente para reupload).

## 4. Frente B — Notificação na transição (usa Bloco 1)

### 4.1 Gancho
Nas actions do contador que mudam o estado da abertura, após o `UPDATE` bem-sucedido, inserir uma notificação para o **titular** (`abertura_empresas.user_id`) na tabela `notifications` do Bloco 1:
- `avancarProcessoAction` → notifica a nova etapa.
- `concluirAberturaAction` → notifica "empresa aberta! CNPJ X".
- `revisarDocumentoAction` (recusa) → notifica "documento X precisa de ajuste".

Novo `tipo = 'abertura_etapa'` (adicionar ao CHECK de `notifications.tipo`), severidade `info` (etapa) / `warning` (pendência de doc) / `success`→mapeado a `info` (conclusão). `action_href = '/configuracoes'` (onde vive a `AberturaInfoView`). `entidade_ref = aberturaId`. `chave = 'abertura_etapa:{aberturaId}:{etapa}'` (idempotente por etapa — reavançar para a mesma etapa não duplica).

### 4.2 Seam de inserção
Reusar a mesma tabela/insert do Bloco 1. Como as actions do contador usam `createAdminClient()` (service role), o insert em `notifications` é direto (RLS bypass), com `owner_user_id = abertura.user_id`. **Guarda:** se `user_id IS NULL` (abertura office-initiated ainda sem dono — sessão 4), **não** notificar (não há destinatário); a notificação passa a valer quando o cliente aceita o convite e vira dono.

### 4.3 E-mail
O e-mail dessas notificações sai pelo mesmo despacho do cron do Bloco 1 (busca `enviada_email_em IS NULL`), com co-branding do escritório. Não é preciso enviar e-mail síncrono na action — o cron diário cobre; se quiser imediatismo, a action pode chamar `sendEmail` diretamente (opcional, decidir no plano). **Baseline:** deixar o cron entregar (simples, retryável).

## 5. Frente C — Status em tempo real

- Na visão do cliente (`AberturaInfoView.tsx`), assinar um canal **Supabase Realtime** sobre `abertura_empresas` filtrado por `id = aberturaId` (via `createBrowserClient()`); ao receber `UPDATE`, refazer o fetch/atualizar o estado local (a etapa, o `processo_protocolo`, `docs_revisao`).
- Baseline sem realtime: manter o `router.refresh()` atual; realtime é a **camada de imediatismo** por cima. Habilitar Realtime na tabela (publication) na migration.
- Landmine da timeline: `DetalheAbertura.tsx` calcula `idxAtual` sobre `ETAPAS` (7 itens, **sem** `cancelado`) → `cancelado` fica `indexOf === -1`. Ao renderizar a timeline (ambos os lados), tratar `cancelado` como estado terminal fora da régua linear.

## 6. Frente D — Minuta do ato constitutivo

### 6.1 Nuance legal (importante — o documento correto depende do tipo)
"Contrato social" só existe para **sociedades**. Para o público do lançamento (MEI + ME sem sócio), o documento gerado difere por `empresa_tipo`:

| `empresa_tipo` | Documento gerado | Observação legal |
|---|---|---|
| **MEI** | **Não gera** ato constitutivo — o CCMEI é emitido pelo Portal do Empreendedor após a inscrição. O app gera um **roteiro/resumo** dos dados para conferência. | Registro do MEI é automático (LC 123 art. 18-A; Res. CGSN 140/2018) |
| **EI** (empresário individual) | **Requerimento de Empresário** (modelo padrão DREI). | Lei 6.015/73; IN DREI vigente |
| **LTDA / SLU** (unipessoal sem sócio) | **Ato Constitutivo de Sociedade Limitada Unipessoal** (contrato social unipessoal). | CC art. 1.052 §§1º/2º (SLU); IN DREI |

O documento é **rascunho para a equipe revisar e protocolar** — nunca um ato registrado. Marca d'água/rodapé "Minuta — sujeita a revisão do contador responsável". Sem e-assinatura.

### 6.2 Geração
- Template por tipo em `src/lib/abertura/minuta/` (um por documento), preenchido com `titular_*`, `empresa_*` (razão social escolhida, capital social, objeto social, CNAE principal/secundários, regime), `sede_*`.
- Renderização para PDF server-side (candidatos: `pdf-lib` para preencher, ou HTML→PDF; decidir no plano — preferir a lib mais leve já compatível com o runtime Node das rotas). Skill `pdf` disponível como referência.
- Action `gerarMinutaAction({ aberturaId })` (contador, guards padrão) → retorna o PDF para download em `DetalheAbertura.tsx`. Registrar em `audit_log`. **Não** persiste como documento oficial (é regenerável a partir dos dados).

### 6.3 Guarda
Só gera minuta quando os campos mínimos por tipo estão preenchidos (validação via helper `minutaPronta(abertura): {ok, faltando[]}`), senão erro claro listando o que falta.

## 7. Modelo de dados

Migration **`0046_abertura_checklist_minuta.sql`** (parte do schema real de `abertura_empresas` — §3.1 do Master):
- `ALTER TABLE public.abertura_empresas ADD COLUMN docs_revisao jsonb NOT NULL DEFAULT '{}'::jsonb;`
- `ALTER TABLE public.notifications ... ` — **não**; o CHECK de `tipo` do Bloco 1 já deve incluir `'abertura_etapa'` (coordenar: ou o Bloco 1 já o inclui, ou esta migration recria o CHECK). **Decisão:** o Bloco 1 (`0045`) já inclui `'abertura_etapa'` na lista de tipos (previsto na spec do Bloco 1 §5). Se por ordem de merge o `0045` não incluir, `0046` faz o `ALTER ... DROP/ADD CONSTRAINT` do CHECK.
- Habilitar Realtime: adicionar `abertura_empresas` à publication `supabase_realtime` (Frente C). RLS de `abertura_empresas` já existe (cliente vê a própria; contador via carteira) — Realtime respeita RLS.

Sem tabela nova. Nenhuma coluna do schema antigo (`0001`) é referenciada.

## 8. Seams de código (recap)

| Alvo | Arquivo:linha | Ação |
|---|---|---|
| Migration | `app/supabase/migrations/0046_abertura_checklist_minuta.sql` (nova) | `docs_revisao` jsonb + Realtime publication |
| Actions contador | `app/src/app/(auth)/(gated)/contador/aberturas/actions.ts` | `revisarDocumentoAction`, `gerarMinutaAction`; hook de notificação em `avancarProcessoAction`/`concluirAberturaAction` |
| Contrato de campos/docs | `app/src/types/abertura.ts:5` (`DOC_KEYS`), `ABERTURA_TEXT_FIELDS` | fonte única |
| Exigência por tipo | `app/src/lib/abertura/checklist.ts` (novo) | `docsExigidos()`, testável |
| Minuta | `app/src/lib/abertura/minuta/` (novo) | templates por `empresa_tipo` + `minutaPronta()` |
| Etapas/timeline | `app/src/lib/abertura/etapas.ts` (`ETAPAS`, `ETAPA_LABEL`) | tratar `cancelado` (indexOf -1) |
| UI contador | `.../contador/aberturas/[aberturaId]/DetalheAbertura.tsx` | checklist + botões revisão + download minuta |
| UI cliente | `.../configuracoes/AberturaInfoView.tsx` | checklist read-only + reenvio + Realtime |
| Notificações | tabela `notifications` (Bloco 1) | insert `tipo='abertura_etapa'` |

## 9. Landmines
1. **Schema real de `abertura_empresas` vive no banco/`db_atual.sql`**, não nas migrations `0001` (schema antigo). A `0046` parte das colunas reais (§7).
2. **`abertura_empresas.user_id` pode ser null** (abertura office-initiated) → não notificar sem destinatário (Frente B §4.2).
3. **`cancelado` não está em `ETAPAS`** (7 itens) → `indexOf === -1` na timeline; tratar como terminal (Frente C).
4. **Merge JSONB** em `docs_revisao`: atualizar só a chave do doc (`docs_revisao || jsonb_build_object(...)`), nunca sobrescrever o objeto inteiro (perderia os outros docs).
5. **Nuance legal do documento por tipo** (Frente D) — não gerar "contrato social" para MEI/EI; usar o documento correto por `empresa_tipo`.
6. **CHECK de `tipo` em `notifications`** precisa conter `'abertura_etapa'` — coordenar com o Bloco 1 (§7).
7. **Realtime respeita RLS** — confirmar que a policy de SELECT do cliente sobre a própria abertura permite o stream (senão o canal não emite).

## 10. Dependência do Bloco 1
Frente B (notificação) exige a tabela `notifications` e o tipo `'abertura_etapa'` do Bloco 1. **Ordem:** implementar o Bloco 1 antes, ou pelo menos a `0045` (tabela + CHECK). As Frentes A, C e D **não** dependem do Bloco 1 e podem ser feitas em paralelo.

## 11. Testes
- **Unit:** `docsExigidos(empresaTipo)` (MEI/EI/LTDA exigem conjuntos diferentes); `minutaPronta()` (lista o que falta); estado derivado do doc (null/enviado/aprovado/recusado).
- **Integração:** `revisarDocumentoAction` faz merge JSONB sem apagar outros docs; recusa move para `pendente_documentos` e cria notificação; `avancarProcessoAction` cria `notifications` idempotente (reavançar mesma etapa não duplica); abertura com `user_id` null não cria notificação.
- **E2E (Playwright):** contador recusa um doc → cliente vê "recusado" + motivo e reenvia; contador avança etapa → cliente recebe notificação (sino do Bloco 1); download da minuta gera PDF do tipo correto.
- **Regressão:** typecheck 0, vitest verde, build limpo, RLS suite verde.

## 12. Critérios de aceite
1. Checklist mostra, por doc, um dos 4 estados; recusa com observação volta ao cliente, que reenvia.
2. Contador avança etapa → cliente vê a etapa nova **em tempo real** (Realtime) **e** recebe notificação (Bloco 1); conclusão notifica o CNPJ.
3. Minuta gerada é o **documento correto para o `empresa_tipo`** (MEI = roteiro; EI = Requerimento; LTDA/SLU = Ato Constitutivo), marcada como rascunho.
4. Nenhuma ação de escritório alheio altera a abertura (RLS/anti-IDOR mantidos); tudo em `audit_log`.
5. Abertura sem dono (`user_id` null) não quebra nem tenta notificar.

## 13. Fora de escopo / futuro
RedeSim/Portal do Empreendedor; execução automática nos órgãos; e-assinatura da minuta; OCR/validação automática de documentos; sociedades com múltiplos sócios; geração do CCMEI (é do portal oficial).

## 14. Próximo passo
Spec aprovada → **writing-plans** (migration `0046` → helper checklist → actions de revisão + minuta → UI ambos os lados → hook de notificação → Realtime → testes), com verificação entre tasks. Implementar **após** o Bloco 1 (dependência da Frente B).
